// ============================================================
//  Denní úklid vypršelých her z Firebase Realtime Database.
//  Spouští ho GitHub Actions (.github/workflows/uklid.yml), ručně se pouštět nemusí.
//
//  Hra vyprší po 24 hodinách bez tahu, stejně jako ve hře (js/net.js)
//  a v pravidlech databáze. Smazáním hry se uvolní i její kód.
//
//  Bezpečnost:
//   - klíč servisního účtu přichází jen z tajemství FIREBASE_SERVICE_ACCOUNT,
//     nikam se neukládá a nevypisuje,
//   - repozitář je veřejný, takže log ukazuje jen počty, nikdy kódy her,
//   - servisní účet obchází pravidla databáze, proto skript maže jen hry
//     s rezervou 10 minut po vypršení,
//   - žádné závislosti z npm, jen vestavěné funkce Node.js.
// ============================================================
import { createSign } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const TTL = 24 * 60 * 60 * 1000; // stejné jako ROOM_TTL v js/net.js
const MARGIN = 10 * 60 * 1000; // rezerva, ať se nikdy nesmaže hra těsně na hraně
const BATCH = 50; // kolik her se smaže jedním požadavkem
const DRY = process.env.DRY_RUN === 'true';

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function secretJson(name) {
  const raw = process.env[name];
  if (!raw) fail(`Chybí tajemství ${name} (Settings → Secrets and variables → Actions).`);
  try {
    return JSON.parse(raw);
  } catch {
    fail(`Tajemství ${name} není platný JSON.`);
  }
}

// dokud není úklid nastavený, denní běh jen upozorní a neskončí chybou (GitHub by posílal e-maily)
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('::warning::Úklid není nastavený: chybí tajemství FIREBASE_SERVICE_ACCOUNT (postup je v README.md).');
  process.exit(0);
}
const config = secretJson('FIREBASE_CONFIG');
const sa = secretJson('FIREBASE_SERVICE_ACCOUNT');
if (!config.databaseURL) fail('FIREBASE_CONFIG nemá databaseURL.');
if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
  fail('FIREBASE_SERVICE_ACCOUNT nevypadá jako klíč servisního účtu (JSON stažený z Google Cloud).');
}
const DB = String(config.databaseURL).replace(/\/+$/, '');

// Přihlášení servisním účtem: podepsaný JWT se vymění za krátkodobý přístupový token.
async function accessToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: tokenUri,
    iat,
    exp: iat + 3600,
  })}`;
  let sig;
  try {
    sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  } catch {
    fail('Soukromý klíč v FIREBASE_SERVICE_ACCOUNT nejde použít.');
  }
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) fail(`Přihlášení servisním účtem selhalo (HTTP ${res.status} ${j.error || ''}).`);
  return j.access_token;
}

let token;
async function db(method, path, { query = '', body } = {}) {
  const res = await fetch(`${DB}/${path.split('/').map(encodeURIComponent).join('/')}.json${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // do chyby jen první část cesty, kód hry do veřejného logu nepatří
  if (!res.ok) fail(`Databáze vrátila HTTP ${res.status} (${method} ${path.split('/')[0]}).`);
  return res.json();
}

// Hra bez meta je neúplná (hra vždy zapisuje meta jako první), takže jde pryč také.
function expired(meta, active, now) {
  if (!meta || typeof meta !== 'object') return true;
  const last = Math.max(Number(meta.created) || 0, Number(active) || 0);
  return now - last > TTL + MARGIN;
}

token = await accessToken();
const now = Date.now();
const codes = Object.keys((await db('GET', 'rooms', { query: '?shallow=true' })) || {});
const gone = [];
for (const code of codes) {
  const [meta, active] = await Promise.all([db('GET', `rooms/${code}/meta`), db('GET', `rooms/${code}/active`)]);
  if (expired(meta, active, now)) gone.push(code);
}

if (!DRY) {
  for (let i = 0; i < gone.length; i += BATCH) {
    const upd = {};
    for (const code of gone.slice(i, i + BATCH)) {
      upd[`rooms/${code}`] = null;
      upd[`presence/${code}`] = null;
    }
    await db('PATCH', '', { body: upd });
  }
}

const msg = DRY
  ? `Zkušební běh: her v databázi ${codes.length}, vypršelých ${gone.length}. Nic jsem nesmazal.`
  : `Her v databázi ${codes.length}, smazáno vypršelých ${gone.length}, zůstává ${codes.length - gone.length}.`;
console.log(msg);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${msg}\n`);
