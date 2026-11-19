// ============================================================
//  Uživatelské rozhraní + napojení na síť a hostitelskou logiku.
// ============================================================
import { BOARD, STABLES, RULES, CARDS, DECKS, JOCKEY_COLOR, PLAYER_COLORS, GAME_NAME, SETTINGS_OPTIONS } from './config.js';
import * as E from './engine.js';
import { makeBackend, DUP } from './net.js';
import { firebaseConfig } from './firebase-config.js';
import { sound, unlock, play as sfx } from './sound.js';
import { floatAt, confetti, reducedMotion } from './fx.js';

// ---------- pomocníci ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const params = new URLSearchParams(location.search);
const LOCAL = params.has('local');
const IS_TOUCH = window.matchMedia && matchMedia('(hover: none)').matches;
const JAIL = BOARD.findIndex((b) => b.type === 'jail');
// názvy polí do textů pravidel (mění se v config.js)
const SERVICE_NAMES = E.SERVICES.map((i) => BOARD[i].name).join(' a ');
const SKIP_NAME = (BOARD.find((b) => b.type === 'skip') || { name: 'Vynechání tahu' }).name;
const app = $('#app');
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const horse = (cls = '') => `<svg class="hh ${cls}" aria-hidden="true"><use href="#i-horse"/></svg>`;
const icon = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const KBD = IS_TOUCH ? '' : '<kbd>mezerník</kbd>';
const cssId = (id) => (window.CSS && CSS.escape ? CSS.escape(id) : id);
// zkratka typu pole pro malé štítky (žokej / služba)
const typeMark = (b) => ({ jockey: 'Ž', service: 'S' })[b.type] || '';

// barvy žokejů a karetních polí se berou z config.js
document.documentElement.style.setProperty('--c-jockey', JOCKEY_COLOR);
for (const [k, d] of Object.entries(DECKS)) document.documentElement.style.setProperty(`--c-${k}`, d.color);

const emblem = (cls = '') =>
  `<svg class="emblem ${cls}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="57" fill="url(#g-gold)"/><circle cx="60" cy="60" r="48" fill="url(#g-turf)" stroke="#7a560c" stroke-width="1.5"/><circle cx="60" cy="60" r="43" fill="none" stroke="#f7d36b" stroke-opacity=".45" stroke-dasharray="1.5 3.5"/><use href="#i-horse" x="22" y="18" width="76" height="76" fill="url(#g-gold)"/></svg>`;

const sndBtn = () =>
  `<button class="icon-btn snd" data-a="sound" title="${sound.on ? 'Vypnout zvuk' : 'Zapnout zvuk'} (M)" aria-label="Zvuk" aria-pressed="${sound.on}">${icon(
    sound.on ? 'snd-on' : 'snd-off'
  )}</button>`;

const A = {
  backend: null,
  backendErr: null,
  me: null,
  room: null,
  s: null,
  prev: null,
  meta: undefined,
  pres: {},
  unwatch: null,
  seq: null,
  anim: false,
  disp: {},
  screen: null,
  busy: false,
  modal: null,
  autoShown: null,
  modalKey: null,
  hideTrade: 0,
  hideOver: false,
  joinColor: null,
  hostOff: null,
  queue: [],
  draining: false,
  hostGoneSince: null,
  claiming: false,
  cells: [],
  lbKey: null,
  logSeen: 0,
};

// ---------- start aplikace ----------
boot();

async function boot() {
  for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, unlock, { passive: true });
  app.innerHTML = screen('<div class="loader">' + emblem('spin') + '<p>Načítám…</p></div>');
  try {
    A.backend = await makeBackend({ local: LOCAL, config: firebaseConfig });
    A.me = A.backend.uid;
  } catch (e) {
    if (!(e && e.message === 'NOCONFIG')) console.error(e);
    A.backendErr = e && e.message === 'NOCONFIG' ? 'noconfig' : String((e && e.message) || e);
  }
  const code = cleanCode(params.get('room'));
  if (code && A.backend) enterRoom(code);
  else showHome(code);
  setInterval(checkTakeover, 3000);
  setInterval(tickClock, 1000);
}

const cleanCode = (c) =>
  String(c || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);

function urlFor(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  if (LOCAL) u.searchParams.set('local', '1');
  if (code) u.searchParams.set('room', code);
  return u.toString();
}

function screen(inner, cls = '') {
  return `<div class="screen"><div class="card ${cls}">${inner}</div></div>`;
}

function roomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => abc[b % 32]).join('');
}

// ---------- úvodní obrazovka ----------
function showHome(prefill = '', msg = '') {
  leaveRoom();
  A.screen = 'home';
  history.replaceState(null, '', urlFor(null));
  updateTitle();
  const name = lsGet('ds_name') || '';
  let body;
  if (A.backendErr === 'noconfig') {
    const u = new URL(location.href);
    u.search = '?local=1';
    body = `<div class="note warn"><b>Hra zatím není propojená s Firebase.</b><br>Vyplň soubor <code>js/firebase-config.js</code> podle návodu v README.md.<br><br>Mezitím si můžeš hru vyzkoušet v <a href="${esc(
      u.toString()
    )}">lokálním testovacím režimu</a>.</div>`;
  } else if (A.backendErr) {
    body = `<div class="note warn"><b>Nepodařilo se připojit k serveru.</b><br>${esc(A.backendErr)}</div><button class="btn big" data-a="reload">Zkusit znovu</button>`;
  } else {
    body = `
      <label class="lbl" for="h-name">Tvoje jméno</label>
      <input id="h-name" maxlength="16" autocomplete="nickname" value="${esc(name)}" placeholder="např. Anna">
      <button class="btn big" data-a="create">Založit novou hru</button>
      <div class="or"><span>nebo se připoj kódem</span></div>
      <div class="row"><input id="h-code" class="code-in" maxlength="5" placeholder="KÓD" value="${esc(prefill)}" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn secondary" data-a="joinCode">Připojit se</button></div>`;
  }
  app.innerHTML = `<div class="screen home-screen">
      <div class="screen-tools">${sndBtn()}</div>
      <header class="hero">
        ${emblem('hero-emblem')}
        <h1 class="title">${GAME_NAME}</h1>
        <p class="sub">Dostihová obchodní hra pro 2–6 hráčů. Kupuj koně, skládej stáje, pořádej Velké ceny.</p>
      </header>
      <div class="card home">
        ${LOCAL ? '<div class="note"><b>Lokální testovací režim</b> – hráči jsou jen záložky tohoto prohlížeče. Dalšího hráče přidáš otevřením odkazu hry v nové záložce.</div>' : ''}
        ${msg ? `<div class="note warn">${esc(msg)}</div>` : ''}
        ${body}
      </div>
      <ul class="features">
        <li><b>2–6</b><span>hráčů</span></li>
      </ul>
      <button class="btn ghost" data-a="rules">${icon('book')} Jak se hraje</button>
    </div>`;
}

async function createGame() {
  const name = ($('#h-name').value || '').trim();
  if (!name) {
    $('#h-name').focus();
    return toast('Zadej své jméno.', 'err');
  }
  lsSet('ds_name', name);
  if (A.busy) return;
  A.busy = true;
  try {
    for (let k = 0; k < 6; k++) {
      const code = roomCode();
      if (await A.backend.createRoom(code, E.newRoom(A.me, name, PLAYER_COLORS[0].hex))) {
        A.busy = false;
        return enterRoom(code);
      }
    }
    toast('Hru se nepodařilo založit, zkus to znovu.', 'err');
  } catch (e) {
    toast('Hru se nepodařilo založit: ' + e.message, 'err');
  }
  A.busy = false;
}

// ---------- vstup do hry ----------
function enterRoom(code) {
  leaveRoom();
  Object.assign(A, {
    room: code,
    s: null,
    prev: null,
    meta: undefined,
    pres: {},
    seq: null,
    screen: null,
    modal: null,
    hideOver: false,
    hideTrade: 0,
    hostGoneSince: null,
    lbKey: null,
    logSeen: 0,
  });
  resetMoney();
  history.replaceState(null, '', urlFor(code));
  app.innerHTML = screen(`<div class="loader">${emblem('spin')}<p>Připojuji se ke hře <b>${esc(code)}</b>…</p></div>`);
  A.unwatch = A.backend.watchRoom(code, {
    onState: (s) => onState(s),
    onMeta: (m) => {
      A.meta = m;
      if (m === null) return showHome('', `Hra s kódem ${code} neexistuje.`);
      updateHostRole();
      if (A.s && !A.anim) render();
    },
    onPresence: (p) => {
      A.pres = p || {};
      if (A.s && !A.anim) render();
    },
    onError: (e) => toast('Chyba spojení: ' + e.message, 'err'),
  });
}

function leaveRoom() {
  if (A.unwatch) A.unwatch();
  if (A.hostOff) A.hostOff();
  Object.assign(A, { unwatch: null, hostOff: null, queue: [], room: null, s: null, prev: null, meta: undefined });
  closeModal();
}

async function onState(s) {
  if (!s || !A.room) return;
  A.s = s;
  if (A.seq === null) {
    A.seq = s.evSeq;
    syncDisp();
  }
  checkTakeover();
  if (A.anim) return;
  A.anim = true;
  document.body.classList.add('animating');
  try {
    while (A.s && A.s.evSeq > A.seq) {
      const st = A.s;
      A.seq = st.evSeq;
      if (st.phase !== 'lobby') {
        if (A.screen !== 'game') renderGame();
        await playEvents(st);
      }
    }
  } catch (e) {
    console.error(e);
  }
  A.anim = false;
  document.body.classList.remove('animating');
  if (!A.s) return;
  syncDisp();
  const prev = A.prev;
  A.prev = A.s;
  render();
  reactTo(prev, A.s);
}

function syncDisp() {
  A.disp = {};
  for (const p of A.s.players) A.disp[p.id] = p.pos;
}

// ---------- hostitel: zpracování žádostí ostatních hráčů ----------
function updateHostRole() {
  const amHost = !!(A.room && A.meta && A.meta.hostUid === A.me);
  if (amHost && !A.hostOff) {
    A.queue = [];
    A.hostOff = A.backend.hostListen(A.room, (id, uid, a) => {
      A.queue.push({ id, uid, a });
      drainQueue();
    });
  } else if (!amHost && A.hostOff) {
    A.hostOff();
    A.hostOff = null;
    A.queue = [];
  }
}

async function drainQueue() {
  if (A.draining) return;
  A.draining = true;
  try {
    while (A.queue.length && A.hostOff) {
      const job = A.queue.shift();
      let a = null;
      try {
        a = JSON.parse(job.a);
      } catch {}
      const online = new Set(Object.keys(A.pres));
      await A.backend.hostProcess(A.room, job.id, job.uid, (s) => {
        if ((s.acts || []).includes(job.id)) return DUP;
        if (!a || typeof a !== 'object' || typeof a.t !== 'string') return 'Neplatná akce.';
        if (s.hostId !== A.me && E.getP(s, A.me)) s.hostId = A.me;
        const err = E.applyAction(s, job.uid, a, { rng: rand, now: Date.now(), online });
        if (err) return err;
        s.acts = [...(s.acts || []).slice(-30), job.id];
        return null;
      });
    }
  } catch (e) {
    console.error(e);
    toast('Chyba při zpracování tahu: ' + e.message, 'err');
  }
  A.draining = false;
  if (A.queue.length && A.hostOff) drainQueue();
}

// když je hostitel déle offline, roli převezme první online hráč
function checkTakeover() {
  const s = A.s;
  const m = A.meta;
  if (!A.room || !s || !m || !A.backend) return;
  if (m.hostUid === A.me || A.pres[m.hostUid]) {
    A.hostGoneSince = null;
    return;
  }
  if (!E.getP(s, A.me)) return;
  if (!A.hostGoneSince) {
    A.hostGoneSince = Date.now();
    return;
  }
  if (Date.now() - A.hostGoneSince < 10000 || A.claiming) return;
  const first = s.players.find((p) => A.pres[p.id]);
  if (!first || first.id !== A.me) return;
  A.claiming = true;
  A.backend.claimHost(A.room, m.created).then((ok) => {
    A.claiming = false;
    if (ok) {
      toast('Hostitel je offline – roli hostitele teď máš ty.');
      A.backend.send(A.room, { t: 'ping' });
    }
  });
}

async function act(a) {
  if (A.busy || !A.room) return 'busy';
  A.busy = true;
  document.body.classList.add('busy');
  let err;
  try {
    err = await A.backend.send(A.room, a);
  } catch (e) {
    err = e.message;
  }
  A.busy = false;
  document.body.classList.remove('busy');
  if (err) toast(err, 'err');
  return err;
}

// ---------- vykreslování ----------
function render() {
  if (!A.s || !A.room) return;
  if (A.s.phase === 'lobby') renderLobby();
  else renderGame();
  renderModal();
  updateTitle();
}

function nameHtml(p) {
  if (!p) return '?';
  return `<span class="pn"><i style="background:${p.color}"></i>${esc(p.name)}</span>`;
}

function logHtml(m) {
  return esc(m).replace(/\{p:([A-Za-z0-9_-]+)\}/g, (_, id) => nameHtml(E.getP(A.s, id)));
}

function sqColor(i) {
  const b = BOARD[i];
  if (b.type === 'horse') return STABLES[b.stable].color;
  if (b.type === 'jockey') return JOCKEY_COLOR;
  if (b.type === 'service') return '#5b6b7a';
  return '#7a6a4a';
}

function updateTitle() {
  const s = A.s;
  let t = GAME_NAME;
  if (s && A.room && s.phase === 'playing' && E.getP(s, A.me)) {
    if (s.trade && s.trade.to === A.me) t = 'Nabídka obchodu · ' + GAME_NAME;
    else if (s.debts.some((d) => d.d === A.me)) t = 'Musíš splatit dluh · ' + GAME_NAME;
    else if (E.curP(s).id === A.me) t = 'Jsi na tahu! · ' + GAME_NAME;
  } else if (s && A.room && s.phase === 'lobby') t = `Hra ${A.room} · ${GAME_NAME}`;
  if (document.title !== t) document.title = t;
}

// ---------- peníze: plynulé přičítání a plovoucí částky ----------
const MONEY = {};
let moneyRaf = 0;

function resetMoney() {
  for (const k of Object.keys(MONEY)) delete MONEY[k];
}

function moneyText(p) {
  const m = MONEY[p.id];
  return E.fmt(m ? m.shown : p.money);
}

function syncMoney() {
  const s = A.s;
  if (!s) return;
  for (const p of s.players) {
    const m = MONEY[p.id];
    if (!m) {
      MONEY[p.id] = { shown: p.money, target: p.money, from: p.money, t0: 0 };
      continue;
    }
    if (m.target === p.money) continue;
    const delta = p.money - m.target;
    Object.assign(m, { from: m.shown, target: p.money, t0: performance.now() });
    const sel = `.money[data-pid="${cssId(p.id)}"]`;
    const txt = (delta > 0 ? '+' : '−') + E.fmtN(Math.abs(delta));
    document.querySelectorAll(sel).forEach((el) => {
      floatAt(el, txt, delta > 0 ? 'gain' : 'loss');
      el.classList.remove('up', 'down');
      void el.offsetWidth;
      el.classList.add(delta > 0 ? 'up' : 'down');
    });
  }
  if (!moneyRaf) moneyRaf = requestAnimationFrame(stepMoney);
}

function stepMoney(now) {
  moneyRaf = 0;
  let busy = false;
  for (const [pid, m] of Object.entries(MONEY)) {
    if (m.shown === m.target) continue;
    const k = reducedMotion() ? 1 : Math.min(1, (now - m.t0) / 750);
    const e = 1 - Math.pow(1 - k, 3);
    m.shown = k >= 1 ? m.target : Math.round(m.from + (m.target - m.from) * e);
    document.querySelectorAll(`.money[data-pid="${cssId(pid)}"]`).forEach((el) => (el.textContent = E.fmt(m.shown)));
    if (k < 1) busy = true;
  }
  if (busy) moneyRaf = requestAnimationFrame(stepMoney);
}

// ---------- reakce na změny stavu (zvuky, bannery, konfety) ----------
function reactTo(prev, s) {
  if (!prev || !s || prev === s) return;
  if (s.phase === 'lobby') {
    if (prev.phase === 'lobby') {
      if (s.players.length > prev.players.length) sfx('join');
      else if (s.players.length < prev.players.length) sfx('leave');
    }
    return;
  }
  if (prev.phase === 'lobby') {
    if (s.phase === 'playing') {
      sfx('gameStart');
      setTimeout(() => turnBanner(A.s), 700);
      if (E.curP(s).id === A.me) buzz();
    }
    return;
  }
  if (s.phase === 'over') {
    if (prev.phase !== 'over') {
      const w = s.ranking && s.ranking[0];
      const iPlay = !!E.getP(s, A.me);
      sfx(!iPlay || (w && w.id === A.me) ? 'win' : 'lose');
      confetti();
    }
    return;
  }
  if (s.phase !== 'playing' || prev.phase !== 'playing') return;
  const P0 = (id) => E.getP(prev, id) || {};
  let bought = false;
  let sold = false;
  let moved = false;
  let trained = 0;
  for (let i = 0; i < 40; i++) {
    const a = prev.owner[i];
    const b = s.owner[i];
    if (!a && b) bought = true;
    else if (a && !b) sold = true;
    else if (a && b && a !== b) moved = true;
    if (s.level[i] > prev.level[i]) trained = Math.max(trained, s.level[i]);
    else if (s.level[i] < prev.level[i] && a === b) sold = true;
  }
  const meNow = E.getP(s, A.me);
  const myDelta = meNow ? meNow.money - (P0(A.me).money ?? meNow.money) : 0;
  const anyMoney = s.players.some((p) => p.money !== P0(p.id).money);
  if (s.players.some((p) => p.bankrupt && !P0(p.id).bankrupt)) sfx('bankrupt');
  else if (trained === 5) sfx('grandPrix');
  else if (trained) sfx('train');
  else if (bought) sfx('buy');
  else if (moved) sfx('deal');
  else if (sold) sfx('sell');
  else if (myDelta > 0) sfx('coinIn');
  else if (myDelta < 0) sfx('coinOut');
  else if (anyMoney) sfx('coin');
  if (s.players.some((p) => p.skip > 0 && !(P0(p.id).skip > 0))) sfx('limp', 150);
  if (s.players.some((p) => !p.jail && P0(p.id).jail && p.passes.length < (P0(p.id).passes || []).length)) sfx('pass');
  if (s.trade && s.trade.to === A.me && (!prev.trade || prev.trade.id !== s.trade.id)) sfx('trade', 200);
  if (s.debts.some((d) => d.d === A.me) && !prev.debts.some((d) => d.d === A.me)) sfx('alarm', 250);
  const c0 = E.curP(prev);
  const c1 = E.curP(s);
  if (!c0 || c0.id !== c1.id || prev.round !== s.round) {
    setTimeout(() => turnBanner(A.s), 300);
    if (c1.id === A.me) {
      sfx('yourTurn', 300);
      buzz();
    } else sfx('turn', 300);
  }
  // políčko, na kterém hráč zastavil, krátce zabliká
  const mover = c0 && E.getP(s, c0.id);
  if (mover && P0(mover.id).pos !== mover.pos && A.cells[mover.pos]) pulseCell(mover.pos);
}

function buzz() {
  const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if (sound.on && navigator.vibrate && active) {
    try {
      navigator.vibrate([70, 50, 70]);
    } catch {}
  }
}

function pulseCell(i) {
  const el = A.cells[i];
  if (!el) return;
  el.classList.remove('land');
  void el.offsetWidth;
  el.classList.add('land');
  setTimeout(() => el.classList.remove('land'), 1300);
}

function turnBanner(s) {
  const board = $('#board');
  if (!board || !s || s.phase !== 'playing') return;
  const cp = E.curP(s);
  const mine = cp.id === A.me;
  board.querySelectorAll('.banner').forEach((x) => x.remove());
  const b = document.createElement('div');
  b.className = 'banner' + (mine ? ' mine' : '');
  b.innerHTML = `<div class="banner-in" style="--pc:${cp.color}"><span class="tok xl" style="--pc:${cp.color}">${horse()}</span><div><small>${
    mine ? `Kolo ${s.round}` : 'Na tahu'
  }</small><b>${mine ? 'Jsi na tahu!' : esc(cp.name)}</b></div></div>`;
  board.appendChild(b);
  setTimeout(() => b.remove(), 1900);
}

// ---------- lobby ----------
function renderLobby() {
  const s = A.s;
  const me = E.getP(s, A.me);
  const host = s.hostId === A.me;
  if (A.screen !== 'lobby') {
    A.screen = 'lobby';
    A.lbKey = null;
    A.modal = null;
    resetMoney();
    app.innerHTML = `<div class="screen lobby-screen"><div class="card lobby">
      <div class="card-top">${emblem('sm')}<div class="ct-text"><div class="eyebrow">Příprava hry</div><h1 class="title small">${GAME_NAME}</h1></div>${sndBtn()}</div>
      <div class="room-code"><span>Kód hry</span><div class="code-tiles" data-a="copyLink" title="Kopírovat odkaz">${[...A.room]
        .map((c) => `<b>${esc(c)}</b>`)
        .join('')}</div></div>
      <div class="btn-row center share-row"><button class="btn secondary" data-a="copyLink">${icon('link')} Kopírovat odkaz</button>${
        navigator.share ? `<button class="btn secondary" data-a="shareLink">${icon('share')} Sdílet</button>` : ''
      }</div>
      <section id="lb-me" class="lb-sec"></section>
      <section class="lb-sec"><h3>Hráči <span class="count" id="lb-count"></span></h3><div id="lb-players" class="lb-players"></div></section>
      <section id="lb-settings" class="lb-sec"></section>
      <div id="lb-start"></div>
      <div class="card-foot"><button class="btn link" data-a="rules">${icon('book')} Pravidla</button><button class="btn link" data-a="leaveRoom">${icon(
        'exit'
      )} Opustit hru</button></div>
    </div></div>`;
  }
  const key = me ? 'in' : 'out';
  if (A.lbKey !== key) {
    A.lbKey = key;
    const nm = me ? me.name : lsGet('ds_name') || '';
    $('#lb-me').innerHTML = me
      ? `<h3>Ty</h3><div class="row"><input id="lb-name" maxlength="16" value="${esc(nm)}" aria-label="Tvoje jméno"><button class="btn secondary" data-a="rename">Uložit</button></div><div class="lbl">Barva figurky</div><div id="lb-colors" class="swatches"></div>`
      : `<h3>Připoj se do hry</h3><input id="lb-name" maxlength="16" placeholder="Tvoje jméno" value="${esc(
          nm
        )}" aria-label="Tvoje jméno"><div class="lbl">Barva figurky</div><div id="lb-colors" class="swatches"></div><button class="btn big" data-a="join">Připojit se</button>`;
  }
  const used = new Map(s.players.map((p) => [p.color, p]));
  if (!me && (!A.joinColor || used.has(A.joinColor))) A.joinColor = (PLAYER_COLORS.find((c) => !used.has(c.hex)) || {}).hex;
  const selected = me ? me.color : A.joinColor;
  $('#lb-colors').innerHTML = PLAYER_COLORS.map((c) => {
    const owner = used.get(c.hex);
    const taken = owner && owner.id !== A.me;
    return `<button class="sw ${c.hex === selected ? 'sel' : ''}" style="--pc:${c.hex}" data-a="color" data-c="${c.hex}" ${taken ? 'disabled' : ''} title="${esc(c.name)}${
      taken ? ` – má ${esc(owner.name)}` : ''
    }" aria-label="${esc(c.name)}">${c.hex === selected ? horse() : ''}</button>`;
  }).join('');
  const jb = $('[data-a="join"]');
  if (jb) jb.disabled = s.players.length >= RULES.maxPlayers;

  $('#lb-count').textContent = `${s.players.length}/${RULES.maxPlayers}`;
  const free = RULES.maxPlayers - s.players.length;
  $('#lb-players').innerHTML =
    s.players
      .map((p) => {
        const on = !!A.pres[p.id];
        return `<div class="lb-pl ${p.id === A.me ? 'me' : ''}"><span class="tok md" style="--pc:${p.color}">${horse()}<i class="online ${on ? 'on' : ''}" title="${
          on ? 'online' : 'offline'
        }"></i></span><span class="pname">${esc(p.name)}${p.id === A.me ? ' <small>(ty)</small>' : ''}</span>${
          p.id === s.hostId ? '<span class="tag gold">hostitel</span>' : ''
        }${host && p.id !== A.me ? `<button class="x-mini" data-a="kick" data-id="${p.id}" title="Odebrat z lobby" aria-label="Odebrat z lobby">✕</button>` : ''}</div>`;
      })
      .join('') +
    (free > 0
      ? `<div class="lb-pl empty"><span class="tok md ghost"></span><span>${free} ${plural(free, 'volné místo', 'volná místa', 'volných míst')} – pošli ostatním kód nebo odkaz</span></div>`
      : '');

  const settingsEl = $('#lb-settings');
  if (!(settingsEl.contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) {
    const st = s.settings;
    const limVal = st.limitType === 'none' ? 'none' : `${st.limitType}:${st.limitValue}`;
    const limLabel = (SETTINGS_OPTIONS.limits.find((l) => l.v === limVal) || {}).label || limVal;
    const opts = (list, cur) => list.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${E.fmt(v)}</option>`).join('');
    settingsEl.innerHTML =
      '<h3>Nastavení</h3>' +
      (host
        ? `<div class="setgrid">
            <label><span>Startovní kapitál</span><select data-set="startMoney">${opts(SETTINGS_OPTIONS.startMoney, st.startMoney)}</select></label>
            <label><span>Odměna za Start</span><select data-set="startBonus">${opts(SETTINGS_OPTIONS.startBonus, st.startBonus)}</select></label>
            <label class="wide"><span>Délka hry</span><select data-set="limit">${SETTINGS_OPTIONS.limits
              .map((l) => `<option value="${l.v}" ${l.v === limVal ? 'selected' : ''}>${esc(l.label)}</option>`)
              .join('')}</select></label>
          </div>`
        : `<div class="setstats"><div><span>Kapitál</span><b>${E.fmt(st.startMoney)}</b></div><div><span>Za Start</span><b>${E.fmt(
            st.startBonus
          )}</b></div><div><span>Délka</span><b>${esc(limLabel)}</b></div></div>`);
  }
  const n = s.players.length;
  $('#lb-start').innerHTML = host
    ? `<button class="btn big start-btn" data-a="start" ${n < RULES.minPlayers ? 'disabled' : ''}>Spustit hru <small>(${n} ${plural(n, 'hráč', 'hráči', 'hráčů')})</small></button>${
        n < RULES.minPlayers ? '<p class="waiting">Čeká se na další hráče<span class="dots"></span></p>' : ''
      }`
    : me
    ? '<p class="waiting">Čeká se, až hostitel spustí hru<span class="dots"></span></p>'
    : '';
}

// ---------- herní plán ----------
function cellPos(i) {
  if (i <= 10) return [11, 11 - i];
  if (i <= 20) return [11 - (i - 10), 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}

function sideOf(i) {
  if (i % 10 === 0) return 'corner';
  return ['side-b', 'side-l', 'side-t', 'side-r'][Math.floor(i / 10)];
}

function cellHtml(b, i) {
  const [r, c] = cellPos(i);
  let inner;
  let sc = '';
  if (b.type === 'horse') {
    const col = STABLES[b.stable].color;
    sc = `--sc:${col};`;
    inner = `<div class="band"><span class="lvl"></span></div>
      <div class="cbody"><span class="cart">${horse()}</span><div class="cname">${esc(b.name)}</div><div class="cprice">${E.fmtN(b.price)}</div></div>`;
  } else if (b.type === 'jockey' || b.type === 'service') {
    inner = `<div class="cbody"><div class="cname">${esc(b.name)}</div><div class="cprice">${E.fmtN(b.price)}</div></div>`;
  } else if (b.type === 'tax') {
    inner = `<div class="cbody"><div class="cname">${esc(b.name)}</div><div class="cprice minus">−${E.fmtN(b.amount)}</div></div>`;
  } else if (b.type === 'card') {
    inner = `<div class="cbody"><div class="minicard deck-${b.deck}"></div><div class="cname">${esc(b.name)}</div></div>`;
  } else {
    const sub = b.type === 'start' ? '<div class="csub" id="start-bonus"></div>' : b.type === 'jail' ? '<div class="csub">i návštěva</div>' : '';
    inner = `<div class="cbody"><div class="cname">${esc(b.name)}</div>${sub}</div>`;
  }
  return `<div class="cell ${sideOf(i)} t-${b.type}${b.type === 'card' ? ` deck-${b.deck}` : ''}" style="${sc}grid-row:${r};grid-column:${c}" data-a="sq" data-i="${i}">${inner}<div class="tokens"></div></div>`;
}

function buildGame() {
  A.screen = 'game';
  app.innerHTML = `
    <div class="game">
      <div class="board-wrap"><div class="board" id="board">${BOARD.map(cellHtml).join('')}<div class="bcenter" id="center"></div></div></div>
      <aside class="side">
        <div class="topbar" id="topbar"></div>
        <section class="panel me-panel" id="me"></section>
        <section class="panel players-panel" id="players"></section>
        <section class="panel log-panel"><div class="ph"><h3>Průběh hry</h3></div><div id="log" class="log"></div></section>
      </aside>
    </div>`;
  A.cells = [...document.querySelectorAll('#board .cell')];
  A.logSeen = A.s ? A.s.logSeq : 0;
}

function renderGame() {
  if (A.screen !== 'game') buildGame();
  drawCells();
  drawTokens();
  drawCenter();
  drawTopbar();
  drawMe();
  drawPlayers();
  drawLog();
  syncMoney();
}

function drawCells() {
  const s = A.s;
  const sb = $('#start-bonus');
  if (sb) sb.textContent = '+' + E.fmtN(s.settings.startBonus);
  A.cells.forEach((el, i) => {
    el.classList.toggle('hl', s.phase === 'playing' && s.stage === 'buy' && s.buySq === i);
    if (!E.isOwnable(i)) return;
    const op = s.owner[i] && E.getP(s, s.owner[i]);
    el.classList.toggle('owned', !!op);
    el.classList.toggle('mine', !!op && op.id === A.me);
    el.style.setProperty('--own', op ? op.color : 'transparent');
    el.title = op ? `${BOARD[i].name} – majitel: ${op.name}` : `${BOARD[i].name} – volné`;
    const lvl = el.querySelector('.lvl');
    if (lvl) {
      const lv = s.level[i];
      lvl.innerHTML = lv === 5 ? '<span class="vc">★</span>' : '<i></i>'.repeat(lv);
    }
  });
}

function drawTokens(moving) {
  const s = A.s;
  if (!s || !A.cells.length) return;
  const by = {};
  for (const p of s.players) {
    if (p.bankrupt) continue;
    const pos = A.disp[p.id] ?? p.pos;
    (by[pos] = by[pos] || []).push(p);
  }
  const cur = s.phase === 'playing' ? E.curP(s).id : null;
  A.cells.forEach((el, i) => {
    const list = by[i] || [];
    el.classList.toggle('here', !!cur && list.some((p) => p.id === cur));
    el.querySelector('.tokens').innerHTML = list
      .map(
        (p) =>
          `<span class="tok ${p.id === cur ? 'cur' : ''} ${p.id === moving ? 'hop' : ''} ${p.jail ? 'jailed' : ''}" style="--pc:${p.color}" title="${esc(p.name)}">${horse()}</span>`
      )
      .join('');
  });
}

// ---------- kostky (3D) ----------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
const pips = (v) => {
  const on = new Set(PIPS[v] || []);
  return Array.from({ length: 9 }, (_, k) => `<i class="${on.has(k) ? 'on' : ''}"></i>`).join('');
};
function dieHtml(v) {
  const [x, y] = FACE_ROT[v] || [-18, 25];
  return `<div class="die3d ${v ? '' : 'idle'}"><div class="cube" style="transform:rotateX(${x}deg) rotateY(${y}deg) rotateZ(0deg)">${[1, 2, 3, 4, 5, 6]
    .map((f) => `<div class="face f${f}">${pips(f)}</div>`)
    .join('')}</div></div>`;
}

function cardHtml(lc) {
  if (!lc) return '';
  const c = CARDS[lc.deck][lc.id];
  return `<div class="cardbox deck-${lc.deck}"><div class="ch">${DECKS[lc.deck].name}</div><div class="ct">${esc(
    E.cardText(c)
  )}</div><div class="cw">${nameHtml(E.getP(A.s, lc.pid))}</div></div>`;
}

function canRoll(s) {
  const me = E.getP(s, A.me);
  return s.phase === 'playing' && me && !me.bankrupt && E.curP(s).id === A.me && s.stage === 'roll' && !s.debts.length && !s.trade;
}

function drawCenter() {
  const s = A.s;
  const c = $('#center');
  let turn;
  if (s.phase === 'over') {
    const w = s.ranking && s.ranking[0] && E.getP(s, s.ranking[0].id);
    turn = `<div class="turnbar win">Vítěz: ${nameHtml(w)}</div>`;
  } else {
    const cp = E.curP(s);
    const mine = cp.id === A.me;
    turn = `<div class="turnbar ${mine ? 'mine' : ''}"><span class="tok xs" style="--pc:${cp.color}">${horse()}</span>${
      mine ? '<b>Jsi na tahu</b>' : `<span>Na tahu: <b>${esc(cp.name)}</b></span>`
    }</div>`;
  }
  const roll = canRoll(s);
  const dice = (s.dice && s.dice.length ? s.dice : [0]).map((v) => dieHtml(v)).join('');
  const deck = (d) => {
    const n = s.decks && s.decks[d] ? s.decks[d].length : CARDS[d].length;
    return `<div class="deck deck-${d}" title="Balíček ${DECKS[d].name} – ${n} ${plural(n, 'karta', 'karty', 'karet')}"><div class="deck-face"><b>${DECKS[d].name}</b></div><small>${n} ${plural(n, 'karta', 'karty', 'karet')}</small></div>`;
  };
  let notes = '';
  if (s.trade) notes += `<div class="cnote">Obchod: ${nameHtml(E.getP(s, s.trade.from))} → ${nameHtml(E.getP(s, s.trade.to))}</div>`;
  if (s.debts.length) notes += '<div class="cnote">Čeká se na splacení dluhu</div>';
  c.innerHTML = `<div class="track"></div><div class="cc">
    <div class="logo">${GAME_NAME}</div>
    ${turn}
    <div class="table">${deck('tiket')}<div class="dice ${roll ? 'can-roll' : ''}" id="c-dice" ${
    roll ? 'data-a="roll" role="button" tabindex="0" title="Hodit kostkou" aria-label="Hodit kostkou"' : ''
  }>${dice}${roll ? '<span class="roll-hint">Hodit</span>' : ''}</div>${deck('stesti')}</div>
    <div id="c-card">${cardHtml(s.lastCard)}</div>
    ${notes}
    <div class="cmsg">${s.log
      .slice(-3)
      .reverse()
      .map((l) => `<div>${logHtml(l.m)}</div>`)
      .join('')}</div>
  </div>`;
}

// ---------- horní lišta ----------
function clockText() {
  const s = A.s;
  if (!s || s.settings.limitType !== 'minutes' || !s.startedAt) return '';
  const left = s.phase === 'over' ? 0 : Math.max(0, s.startedAt + s.settings.limitValue * 60000 - Date.now());
  const m = Math.floor(left / 60000);
  const sec = Math.floor((left % 60000) / 1000);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function tickClock() {
  const el = $('#tb-clock');
  if (!el || !A.s) return;
  el.textContent = clockText();
  const left = A.s.startedAt + A.s.settings.limitValue * 60000 - Date.now();
  el.parentElement.classList.toggle('low', left < 5 * 60000);
}

function drawTopbar() {
  const s = A.s;
  const st = s.settings;
  const round =
    st.limitType === 'rounds' ? `Kolo <b>${Math.min(s.round, st.limitValue)}</b><small>/${st.limitValue}</small>` : `Kolo <b>${s.round}</b>`;
  const clock = st.limitType === 'minutes' ? `<span class="tb-item" title="Zbývající čas hry">${icon('clock')}<b id="tb-clock">${clockText()}</b></span>` : '';
  $('#topbar').innerHTML = `
    <button class="room-chip" data-a="copyLink" title="Kopírovat odkaz na hru">${icon('link')}<b>${esc(A.room)}</b>${LOCAL ? '<small>lokálně</small>' : ''}</button>
    <span class="tb-item">${round}</span>${clock}
    <span class="tb-spacer"></span>
    ${sndBtn()}
    <button class="icon-btn" data-a="rules" title="Pravidla" aria-label="Pravidla">${icon('book')}</button>
    <button class="icon-btn" data-a="leaveRoom" title="Odejít na úvod" aria-label="Odejít na úvod">${icon('exit')}</button>`;
  tickClock();
}

// ---------- animace ----------
async function playEvents(st) {
  if (document.hidden) return;
  for (const e of st.events || []) {
    if (e.k === 'dice') await animDice(e.v);
    else if (e.k === 'walk') await animWalk(e.pid, e.from, e.steps);
    else if (e.k === 'jump') {
      A.disp[e.pid] = e.to;
      drawTokens(e.pid);
      if (e.to === JAIL) {
        sfx('jail');
        pulseCell(JAIL);
      }
      await sleep(700);
    } else if (e.k === 'card') {
      sfx('card');
      await revealCard(e);
      const box = $('#c-card');
      if (box) box.innerHTML = cardHtml({ deck: e.deck, id: e.id, pid: e.pid });
    }
  }
}

async function animDice(vals) {
  const box = $('#c-dice');
  if (!box) return;
  box.classList.remove('can-roll');
  box.removeAttribute('data-a');
  box.innerHTML = vals.map(() => dieHtml(1)).join('');
  const cubes = [...box.querySelectorAll('.cube')];
  sfx('roll', 0, 650);
  box.classList.add('throwing');
  const r = () => Math.round((Math.random() * 2 - 1) * 360);
  for (let k = 0; k < 6; k++) {
    cubes.forEach((c) => {
      c.style.transition = 'transform .11s linear';
      c.style.transform = `rotateX(${r()}deg) rotateY(${r()}deg) rotateZ(${r()}deg)`;
    });
    await sleep(110);
  }
  cubes.forEach((c, j) => {
    const [x, y] = FACE_ROT[vals[j]];
    c.style.transition = 'transform .5s cubic-bezier(.2,.9,.3,1.25)';
    c.style.transform = `rotateX(${x}deg) rotateY(${y}deg) rotateZ(0deg)`;
  });
  box.classList.remove('throwing');
  await sleep(260);
  sfx('land', 0, vals.length);
  if (vals.length === 2 && vals[0] === 6 && vals[1] === 6) box.classList.add('bad');
  else if (vals.includes(6)) box.classList.add('six');
  await sleep(380);
}

async function animWalk(pid, from, steps) {
  A.disp[pid] = from;
  const dir = Math.sign(steps);
  const n = Math.abs(steps);
  const dt = n > 20 ? 75 : n > 12 ? 110 : 170;
  for (let k = 1; k <= n; k++) {
    const pos = (from + dir * k + 40) % 40;
    A.disp[pid] = pos;
    drawTokens(pid);
    sfx('step', 0, k);
    if (pos === 0 && dir > 0 && A.s) {
      sfx('startPass');
      floatAt(A.cells[0], '+' + E.fmtN(A.s.settings.startBonus), 'gain big');
    }
    await sleep(dt);
  }
  pulseCell(A.disp[pid]);
  await sleep(240);
}

async function revealCard(e) {
  const board = $('#board');
  if (!board) return;
  const c = CARDS[e.deck][e.id];
  const d = DECKS[e.deck];
  const el = document.createElement('div');
  el.className = 'reveal';
  el.innerHTML = `<div class="rcard deck-${e.deck}"><div class="rface rback"><b>${d.name}</b></div><div class="rface rfront"><div class="ch">${d.name}</div><div class="ct">${esc(E.cardText(c))}</div><div class="cw">${nameHtml(E.getP(A.s, e.pid))}</div></div></div>`;
  board.appendChild(el);
  await sleep(reducedMotion() ? 1400 : 2500);
  el.classList.add('out');
  await sleep(280);
  el.remove();
}

// ---------- panel hráče (akce) ----------
function drawMe() {
  const s = A.s;
  const el = $('#me');
  const me = E.getP(s, A.me);
  const hostOffline = A.meta && !A.pres[A.meta.hostUid] && s.phase === 'playing';
  const hostNote = hostOffline ? '<div class="note warn small">Hostitel je offline – tahy se zpracují, až se vrátí, nebo roli za chvíli převezme jiný hráč.</div>' : '';
  if (!me) {
    el.className = 'panel me-panel';
    el.innerHTML = `<div class="ph"><h3>Sleduješ hru</h3></div><p class="muted">Do rozehrané hry se už nedá přidat.</p>${hostNote}`;
    return;
  }
  const cp = E.curP(s);
  const myTurn = s.phase === 'playing' && cp.id === A.me && !me.bankrupt;
  const tags = [];
  if (me.jail && s.phase === 'playing') tags.push('<span class="tag red">Distanc</span>');
  if (me.skip > 0 && s.phase === 'playing') tags.push(`<span class="tag">${esc(SKIP_NAME)}</span>`);
  if (me.passes.length) tags.push(`<span class="tag gold">Propustka ×${me.passes.length}</span>`);
  const head = `<div class="me-head"><span class="tok xl" style="--pc:${me.color}">${horse()}</span><div class="me-info"><div class="me-name">${esc(me.name)}${
    myTurn ? '<span class="turn-pill">na tahu</span>' : ''
  }</div><div class="me-money money" data-pid="${me.id}">${moneyText(me)}</div><div class="me-worth">Celkové jmění ${E.fmt(E.netWorth(s, me.id))}</div></div></div>${
    tags.length ? `<div class="me-tags">${tags.join('')}</div>` : ''
  }`;
  let acts = '';
  let state = '';
  const tools = (tradeOk) =>
    `<div class="btn-row tools"><button class="btn secondary" data-a="manage">Můj majetek</button>${
      tradeOk !== undefined ? `<button class="btn secondary" data-a="trade" ${tradeOk ? '' : 'disabled'}>Obchod</button>` : ''
    }</div>`;

  if (s.phase === 'over') {
    acts = '<button class="btn big" data-a="showOver">Výsledky</button>';
  } else if (me.bankrupt) {
    acts = '<p class="status">Jsi mimo hru (bankrot). Můžeš dál sledovat.</p>';
  } else if (s.debts.length) {
    const mine = s.debts.filter((d) => d.d === A.me);
    if (mine.length) {
      state = 'alert';
      const total = mine.reduce((x, d) => x + d.a, 0);
      const liq = E.liquidation(s, A.me);
      acts = `<div class="alert red">Dlužíš <b>${E.fmt(total)}</b> → ${mine
        .map((d) => (d.c ? nameHtml(E.getP(s, d.c)) : 'bance'))
        .join(', ')}<small>Sežeň peníze prodejem tréninků (za polovinu) nebo prodejem majetku bance (za plnou cenu) – dluh se zaplatí automaticky.</small></div>
        ${liq < total ? `<p class="warn-text">Ani prodejem všeho nezískáš dost (max. ${E.fmt(liq)}).</p>` : ''}
        <button class="btn big" data-a="manage">Sehnat peníze</button>
        <button class="btn danger" data-a="bankrupt">Vyhlásit bankrot</button>`;
    } else {
      const who = [...new Set(s.debts.map((d) => d.d))].map((id) => nameHtml(E.getP(s, id))).join(', ');
      acts = `<p class="status">Čeká se, až ${who} sežene peníze na dluh…</p>`;
    }
  } else if (s.trade && s.trade.to === A.me) {
    state = 'alert';
    acts = `<div class="alert">${nameHtml(E.getP(s, s.trade.from))} ti nabízí obchod.</div><button class="btn big" data-a="showTrade">Zobrazit nabídku</button>`;
  } else if (myTurn) {
    state = 'turn';
    if (s.trade) {
      acts = `<p class="status">Čekáš na odpověď na nabídku obchodu → ${nameHtml(E.getP(s, s.trade.to))}.</p><button class="btn secondary" data-a="cancelTrade">Zrušit nabídku</button>`;
    } else if (s.stage === 'roll' && me.jail) {
      acts = `<div class="alert">Máš distanc. Zruší ho <b>šestka</b> nebo propustka. Po šestce házíš znovu.</div>
        <button class="btn big" data-a="roll" data-primary>Zkusit hodit šestku ${KBD}</button>
        ${me.passes.length ? '<div class="btn-row"><button class="btn secondary" data-a="jailPass">Použít propustku</button></div>' : ''}${tools(true)}`;
    } else if (s.stage === 'roll') {
      acts = `<button class="btn big pulse" data-a="roll" data-primary>Hodit kostkou ${KBD}</button>${tools(true)}`;
    } else if (s.stage === 'buy') {
      const b = BOARD[s.buySq];
      const lack = me.money < b.price;
      acts = `<div class="ask">Koupíš?</div>${deedMini(s, s.buySq)}
        <div class="btn-row"><button class="btn buy" data-a="buy" ${lack ? 'disabled' : ''}>Koupit za ${E.fmt(b.price)}</button><button class="btn secondary" data-a="skip">Nekupovat</button></div>
        ${
          lack
            ? '<p class="hint warn-text">Nemáš dost peněz – můžeš něco prodat bance v „Můj majetek“.</p>'
            : `<p class="hint">Po koupi ti zůstane <b>${E.fmt(me.money - b.price)}</b>.</p>`
        }${tools()}`;
    } else {
      acts = `${trainingOffer(s)}<button class="btn big" data-a="endTurn" data-primary>Ukončit tah → ${KBD}</button>${tools(true)}`;
    }
  } else {
    acts = `<p class="status"><span class="tok xs" style="--pc:${cp.color}">${horse()}</span><span>Na tahu je ${nameHtml(cp)}.</span></p>${tools()}`;
  }
  const skipNote =
    me.skip > 0 && s.phase === 'playing' ? `<div class="note small">${esc(SKIP_NAME)} – příští tah vynecháš. Do té doby dostáváš za koně jen základní poplatek.</div>` : '';
  el.className = `panel me-panel ${state}`;
  el.style.setProperty('--pc', me.color);
  el.innerHTML = head + hostNote + skipNote + `<div class="actions">${acts}</div>`;
}

// malá „karta koně“ – nabídka koupě, tréninky
function deedMini(s, i, extra = '') {
  const b = BOARD[i];
  let sub;
  let facts;
  if (b.type === 'horse') {
    sub = STABLES[b.stable].name;
    const others = E.STABLE_SQ[b.stable]
      .filter((j) => j !== i)
      .map((j) => {
        const o = s.owner[j] && E.getP(s, s.owner[j]);
        return `<span>${esc(BOARD[j].name)}: ${o ? nameHtml(o) : '<i>volný</i>'}</span>`;
      })
      .join('');
    facts = `<div class="deed-facts"><span>Poplatek <b>${E.fmtN(b.rent[0])}</b></span><span>Celá stáj <b>${E.fmtN(b.rent[0] * 2)}</b></span><span>Velká cena <b>${E.fmtN(
      b.rent[5]
    )}</b></span></div><div class="deed-stable"><small>Další koně stáje</small>${others}</div>`;
  } else if (b.type === 'jockey') {
    sub = 'Žokej';
    const n = E.JOCKEYS.filter((j) => s.owner[j] === A.me).length;
    facts = `<div class="deed-facts"><span>Poplatek ${RULES.jockeyRent
      .slice(1)
      .map((x) => E.fmtN(x))
      .join(' / ')}</span></div><div class="deed-stable"><small>Žokejů už vlastníš: ${n}</small></div>`;
  } else {
    sub = 'Služba';
    facts = `<div class="deed-facts"><span>Hod × <b>${RULES.serviceMult[1]}</b></span><span>Obě služby hod × <b>${RULES.serviceMult[2]}</b></span></div>`;
  }
  return `<div class="deed-mini" style="--sc:${sqColor(i)}" data-a="sq" data-i="${i}"><div class="deed-band"><div><small>${esc(sub)}</small><b>${esc(
    b.name
  )}</b></div><span class="deed-price">${E.fmt(b.price)}</span></div><div class="deed-body">${facts}${extra}<div class="deed-more">Podrobnosti ›</div></div></div>`;
}

const lvDots = (lv) => (lv === 5 ? '<span class="vc">★</span>' : `${'<i class="on"></i>'.repeat(lv)}${'<i></i>'.repeat(4 - lv)}`);

// po zastavení na vlastním koni z kompletní stáje lze koupit tréninky (1–4, pak Velkou cenu)
function trainingOffer(s) {
  const i = s.landSq;
  if (i === null || i === undefined || s.owner[i] !== A.me || BOARD[i].type !== 'horse') return '';
  const b = BOARD[i];
  if (!E.ownsStable(s, A.me, b.stable)) return '';
  const lv = s.level[i];
  const lvl = `<div class="lvl-row"><span>Tréninky</span><span class="lv-dots">${lvDots(lv)}</span></div>`;
  if (lv >= 5) return `<div class="ask">Tvůj kůň má Velkou cenu.</div>${deedMini(s, i, lvl)}`;
  const err = E.buildError(s, A.me, i);
  const label = lv === 4 ? `Uspořádat Velkou cenu (${E.fmt(E.trainingCost(i))})` : `Koupit trénink (${E.fmt(E.trainingCost(i))})`;
  return `<div class="ask">Stojíš na svém koni z celé stáje – můžeš trénovat.</div>${deedMini(s, i, lvl)}
    <button class="btn big train" data-a="build" data-i="${i}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
}

function chipHtml(s, i) {
  const b = BOARD[i];
  const label = s.level[i] === 5 ? '★' : s.level[i] ? s.level[i] : typeMark(b);
  return `<span class="chip ${s.mortgaged[i] ? 'm' : ''}" style="background:${sqColor(i)}" title="${esc(b.name)}${s.mortgaged[i] ? ' (v zástavě)' : ''}">${label}</span>`;
}

// přehled majetku hráče: stáje jako řádky čtverečků (plný = vlastní), žokejové a služby jako ikony
function assetsHtml(s, pid) {
  const groups = [];
  STABLES.forEach((st, k) => {
    const sq = E.STABLE_SQ[k];
    if (!sq.some((i) => s.owner[i] === pid)) return;
    const full = E.ownsStable(s, pid, k);
    groups.push(
      `<span class="sg ${full ? 'full' : ''}" style="--sc:${st.color}" title="${esc(st.name)}${full ? ' – celá stáj' : ''}: ${sq
        .filter((i) => s.owner[i] === pid)
        .map((i) => esc(BOARD[i].name))
        .join(', ')}">${sq.map((i) => (s.owner[i] === pid ? `<i class="own">${s.level[i] === 5 ? '★' : s.level[i] || ''}</i>` : '<i></i>')).join('')}</span>`
    );
  });
  const misc = BOARD.map((_, i) => i).filter((i) => s.owner[i] === pid && BOARD[i].type !== 'horse');
  if (misc.length) groups.push(`<span class="sg misc">${misc.map((i) => `<i class="own" title="${esc(BOARD[i].name)}">${typeMark(BOARD[i])}</i>`).join('')}</span>`);
  return groups.length ? `<div class="assets">${groups.join('')}</div>` : '';
}

function drawPlayers() {
  const s = A.s;
  const cur = s.phase === 'playing' ? E.curP(s).id : null;
  const hostId = A.meta ? A.meta.hostUid : s.hostId;
  $('#players').innerHTML =
    `<div class="ph"><h3>Hráči</h3><span class="ph-meta">${E.activeP(s).length} ve hře</span></div>` +
    s.players
      .map((p) => {
        const on = !!A.pres[p.id];
        const st = [];
        if (p.jail) st.push('<span class="tag red">distanc</span>');
        if (p.skip > 0) st.push('<span class="tag">vynechá</span>');
        if (p.passes.length) st.push(`<span class="tag gold">propustka ×${p.passes.length}</span>`);
        return `<div class="pl ${p.id === cur ? 'cur' : ''} ${p.bankrupt ? 'out' : ''} ${p.id === A.me ? 'me' : ''}" data-a="player" data-id="${p.id}" style="--pc:${p.color}">
          <span class="tok md ${p.jail ? 'jailed' : ''}" style="--pc:${p.color}">${horse()}<i class="online ${on ? 'on' : ''}" title="${on ? 'online' : 'offline'}"></i></span>
          <div class="pl-main">
            <div class="pl-name"><span class="pname">${esc(p.name)}</span>${p.id === A.me ? '<small>ty</small>' : ''}${
          p.id === hostId ? '<small>hostitel</small>' : ''
        }</div>
            <div class="pl-sub">${p.bankrupt ? 'mimo hru' : `<span class="pos">${esc(BOARD[p.pos].name)}</span>`}${st.join('')}</div>
          </div>
          <div class="pl-money">${
            p.bankrupt ? '<span class="bk">bankrot</span>' : `<b class="money" data-pid="${p.id}">${moneyText(p)}</b><small>jmění ${E.fmtN(E.netWorth(s, p.id))}</small>`
          }</div>
          ${p.bankrupt ? '' : assetsHtml(s, p.id)}
        </div>`;
      })
      .join('');
}

const DECK_LOG = new RegExp(` – (${Object.values(DECKS).map((d) => d.name).join('|')}): „`);

function logType(m) {
  if (/^Na tahu je /.test(m)) return 'turn';
  if (DECK_LOG.test(m)) return 'card';
  if (/^Bankrot|to vzdává|vyřazuje ze hry/.test(m)) return 'bad';
  if (/Vítěz|Konec hry|pořádá Velkou cenu/.test(m)) return 'win';
  if (/^Hra začíná|^Nová hra/.test(m)) return 'win';
  if (/kupuje|uzavírají obchod/.test(m)) return 'buy';
  if (/nemá na zaplacení|platí|splácí/.test(m)) return 'pay';
  if (/dostává|prodává/.test(m)) return 'gain';
  if (/distanc/i.test(m)) return 'jail';
  if (/hází/.test(m)) return 'dice';
  return '';
}

function drawLog() {
  const s = A.s;
  const seen = A.logSeen;
  $('#log').innerHTML = s.log
    .slice(-80)
    .reverse()
    .map((l) => {
      const t = logType(l.m);
      const fresh = l.i > seen ? ' fresh' : '';
      if (t === 'turn') return `<div class="le turn${fresh}"><span>na tahu ${logHtml(l.m.replace(/^Na tahu je /, '').replace(/\.$/, ''))}</span></div>`;
      return `<div class="le${t ? ' lk-' + t : ''}${fresh}">${logHtml(l.m)}</div>`;
    })
    .join('');
  A.logSeen = s.logSeq;
}

// ---------- dialogy ----------
function openModal(m) {
  A.modal = m;
  renderModal(true);
}

function closeModal() {
  A.modal = null;
  A.autoShown = null;
  A.modalKey = null;
  const r = $('#modal-root');
  if (r) r.innerHTML = '';
}

function dismissModal() {
  if (A.autoShown === 'incoming' && A.s && A.s.trade) A.hideTrade = A.s.trade.id;
  if (A.autoShown === 'over') A.hideOver = true;
  closeModal();
  renderModal();
}

function renderModal(force = false) {
  const s = A.s;
  const root = $('#modal-root');
  let m = A.modal;
  if (!m && s && A.room && s.phase !== 'lobby') {
    if (s.trade && s.trade.to === A.me && A.hideTrade !== s.trade.id) m = { type: 'incoming', auto: true };
    else if (s.phase === 'over' && !A.hideOver) m = { type: 'over', auto: true };
  }
  if (!m || (!s && m.type !== 'rules')) {
    root.innerHTML = '';
    A.autoShown = null;
    A.modalKey = null;
    return;
  }
  const key = m.type + ':' + (m.to || m.i || m.id || '');
  // nepřekreslovat formulář, do kterého uživatel právě píše
  if (!force && key === A.modalKey && root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  let html = '';
  if (m.type === 'sq') html = sqModal(m.i);
  else if (m.type === 'manage') html = manageModal();
  else if (m.type === 'trade') html = tradeModal(m);
  else if (m.type === 'incoming') html = incomingModal();
  else if (m.type === 'player') html = playerModal(m.id);
  else if (m.type === 'over') html = overModal();
  else if (m.type === 'rules') html = rulesModal();
  if (!html) {
    if (A.modal) A.modal = null;
    root.innerHTML = '';
    A.autoShown = null;
    A.modalKey = null;
    return;
  }
  const fresh = key !== A.modalKey;
  A.autoShown = m.auto ? m.type : null;
  A.modalKey = key;
  const scroll = root.querySelector('.modal') ? root.querySelector('.modal').scrollTop : 0;
  root.innerHTML = `<div class="overlay ${fresh ? 'enter' : ''}" data-a="closeOverlay"><div class="modal m-${m.type}" role="dialog" aria-modal="true">${html}<button class="x" data-a="close" aria-label="Zavřít">✕</button></div></div>`;
  root.querySelector('.modal').scrollTop = fresh ? 0 : scroll;
}

function btnM(a, i, label, err, cls = 'secondary') {
  return `<button class="btn ${cls} small" data-a="${a}" data-i="${i}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
}

function manageButtons(i) {
  const s = A.s;
  const b = BOARD[i];
  const out = [];
  if (b.type === 'horse') {
    const lv = s.level[i];
    if (lv < 5) out.push(btnM('build', i, lv === 4 ? `Velká cena (−${E.fmtN(E.trainingCost(i))})` : `+ Trénink (−${E.fmtN(E.trainingCost(i))})`, E.buildError(s, A.me, i), ''));
    if (lv > 0) out.push(btnM('sell', i, `− Trénink (+${E.fmtN(E.sellValue(i))})`, E.sellError(s, A.me, i)));
  }
  out.push(btnM('sellProp', i, `Prodat bance (+${E.fmtN(E.propSellValue(i))})`, E.sellPropError(s, A.me, i)));
  return out.join('');
}

function sqModal(i) {
  const s = A.s;
  const b = BOARD[i];
  if (!b) return '';
  const color = sqColor(i);
  const sub = { horse: b.type === 'horse' && STABLES[b.stable].name, jockey: 'Žokej', service: 'Služba', card: 'Karta', tax: 'Poplatek' }[b.type] || 'Políčko';
  let h = `<div class="deed-head" style="--sc:${color}">${b.type === 'horse' ? `<div class="deed-ic">${horse()}</div>` : ''}<div><small>${esc(sub)}</small><h2>${esc(
    b.name
  )}</h2></div>${E.isOwnable(i) ? `<span class="deed-price">${E.fmt(b.price)}</span>` : ''}</div>`;
  if (b.type === 'horse') {
    const lv = s.level[i];
    const full = s.owner[i] && E.ownsStable(s, s.owner[i], b.stable);
    const rows = [
      ['Bez tréninku', b.rent[0]],
      ['Celá stáj, bez tréninku', b.rent[0] * 2],
      ['1 trénink', b.rent[1]],
      ['2 tréninky', b.rent[2]],
      ['3 tréninky', b.rent[3]],
      ['4 tréninky', b.rent[4]],
      ['Velká cena', b.rent[5]],
    ];
    const ownerSkips = s.owner[i] && E.getP(s, s.owner[i]).skip > 0;
    const curRow = !s.owner[i] ? -1 : lv > 0 && !ownerSkips ? lv + 1 : full ? 1 : 0;
    h += `<table class="rent"><tr><th>Poplatek</th><th></th></tr>${rows
      .map((r, k) => `<tr class="${k === curRow ? 'cur' : ''}"><td>${r[0]}</td><td>${E.fmt(r[1])}</td></tr>`)
      .join('')}</table>
      <div class="facts"><span>Trénink <b>${E.fmt(E.trainingCost(i))}</b></span><span>Prodej tréninku <b>${E.fmt(E.sellValue(i))}</b></span></div>
      <div class="stable-list"><small>${esc(STABLES[b.stable].name)}</small>${E.STABLE_SQ[b.stable]
        .map((j) => {
          const o = s.owner[j] && E.getP(s, s.owner[j]);
          return `<button class="sl-row ${j === i ? 'this' : ''}" data-a="sq" data-i="${j}"><span>${esc(BOARD[j].name)}</span>${o ? nameHtml(o) : '<i>volný</i>'}</button>`;
        })
        .join('')}</div>
      <p class="muted small">Tréninky (1–4, pak Velkou cenu) koupíš, jen když na koně z vlastní celé stáje stoupneš.</p>`;
  } else if (b.type === 'jockey') {
    h += `<table class="rent"><tr><th>Majitel vlastní</th><th>Poplatek</th></tr>${[1, 2, 3, 4]
      .map((n) => `<tr><td>${n} ${plural(n, 'žokeje', 'žokeje', 'žokejů')}</td><td>${E.fmt(RULES.jockeyRent[n])}</td></tr>`)
      .join('')}</table>`;
  } else if (b.type === 'service') {
    h += `<p>Poplatek je hod kostkou × <b>${RULES.serviceMult[1]}</b>. Vlastní-li majitel obě služby (${esc(SERVICE_NAMES)}), platí se hod ×<b>${RULES.serviceMult[2]}</b>.</p>`;
  } else if (b.type === 'card') {
    h += `<p>Kdo sem stoupne, táhne kartu z balíčku „${esc(b.name)}“.</p>`;
  } else if (b.type === 'start') {
    h += `<p>${esc(b.desc)}</p><div class="facts"><span>Odměna <b>${E.fmt(s.settings.startBonus)}</b></span></div>`;
  } else if (b.type === 'jail') {
    h += `<p>${esc(b.desc)}</p><p class="muted small">Distanc dostaneš i po dvou šestkách v jednom tahu.</p>`;
  } else {
    h += `<p>${esc(b.desc || '')}</p>${b.amount ? `<div class="facts"><span>Částka <b>${E.fmt(b.amount)}</b></span></div>` : ''}`;
  }
  if (E.isOwnable(i)) {
    const o = s.owner[i] && E.getP(s, s.owner[i]);
    h += `<div class="owner">${
      o
        ? `Majitel: ${nameHtml(o)}${o.skip > 0 ? ' <span class="tag">vynechává tah – jen základní poplatek</span>' : ''}`
        : '<span class="muted">Volné – koupit ho můžeš, když na pole stoupneš.</span>'
    }</div>`;
    if (o && o.id === A.me && s.phase === 'playing') {
      const ctxErr = E.manageError(s, A.me, 'raise');
      h += `<div class="btn-row">${manageButtons(i)}</div>${ctxErr ? `<p class="muted small">${esc(ctxErr)}</p>` : hintFor(i)}`;
    }
  }
  return h;
}

function hintFor(i) {
  if (BOARD[i].type !== 'horse') return '';
  const e = E.buildError(A.s, A.me, i);
  return e && A.s.level[i] < 5 ? `<p class="muted small">Trénink: ${esc(e)}</p>` : '';
}

function manageModal() {
  const s = A.s;
  const me = E.getP(s, A.me);
  if (!me) return '';
  const mine = BOARD.map((_, i) => i).filter((i) => s.owner[i] === A.me);
  const debt = E.debtOf(s, A.me);
  let h = `<h2>Můj majetek</h2><div class="stats"><div><span>Hotovost</span><b class="money" data-pid="${me.id}">${moneyText(me)}</b></div>${
    debt ? `<div class="red"><span>Dluh</span><b>${E.fmt(debt)}</b></div>` : ''
  }<div><span>Jmění</span><b>${E.fmt(E.netWorth(s, A.me))}</b></div><div><span>Max. hotovost</span><b>${E.fmt(E.liquidation(s, A.me))}</b></div></div>`;
  const ctxErr = E.manageError(s, A.me, 'raise');
  if (ctxErr) h += `<p class="muted small">${esc(ctxErr)} Můžeš si ale vše prohlédnout.</p>`;
  if (!mine.length) return h + '<p class="empty-state">Zatím nic nevlastníš.</p>';
  const groups = [];
  STABLES.forEach((st, k) => {
    const items = E.STABLE_SQ[k].filter((i) => s.owner[i] === A.me);
    if (items.length)
      groups.push({ title: st.name, badge: E.ownsStable(s, A.me, k) ? 'celá stáj' : `${items.length}/${E.STABLE_SQ[k].length}`, full: E.ownsStable(s, A.me, k), color: st.color, items });
  });
  const others = mine.filter((i) => BOARD[i].type !== 'horse');
  if (others.length) groups.push({ title: 'Žokejové a služby', badge: '', color: JOCKEY_COLOR, items: others });
  h += groups
    .map(
      (g) =>
        `<div class="mgroup" style="--sc:${g.color}"><div class="mtitle"><span>${esc(g.title)}</span>${g.badge ? `<span class="tag ${g.full ? 'green' : ''}">${g.badge}</span>` : ''}</div>${g.items
          .map((i) => {
            const lv = s.level[i];
            const lvl = BOARD[i].type === 'horse' ? `<span class="lv-dots">${lvDots(lv)}</span>` : `<span class="tag">${BOARD[i].type === 'jockey' ? 'žokej' : 'služba'}</span>`;
            return `<div class="mrow ${s.mortgaged[i] ? 'm' : ''}"><button class="mname" data-a="sq" data-i="${i}"><span>${esc(BOARD[i].name)}</span>${lvl}${
              s.mortgaged[i] ? ' <span class="tag">zástava</span>' : ''
            }</button><div class="mbtns">${manageButtons(i)}</div></div>`;
          })
          .join('')}</div>`
    )
    .join('');
  return h;
}

const emptyItems = () => ({ sq: [], money: 0, passes: 0 });

function tradeModal(m) {
  const s = A.s;
  const me = E.getP(s, A.me);
  if (!me) return '';
  if (!m.to) {
    const others = E.activeP(s).filter((p) => p.id !== A.me);
    return `<h2>Obchod</h2><p>S kým chceš obchodovat?</p><div class="pick-list">${others
      .map(
        (p) =>
          `<button class="pick" data-a="tradeTo" data-id="${p.id}"><span class="tok md" style="--pc:${p.color}">${horse()}</span><span class="pname">${esc(p.name)}</span><span class="muted">${E.fmt(
            p.money
          )}</span></button>`
      )
      .join('')}</div>`;
  }
  const other = E.getP(s, m.to);
  if (!other) return '';
  const col = (p, side) => {
    const items = BOARD.map((_, i) => i).filter((i) => s.owner[i] === p.id);
    const sel = m[side];
    return `<div class="tcol ${side}"><h4>${side === 'give' ? 'Dávám' : `Chci od ${nameHtml(p)}`}</h4>
      ${
        items.length
          ? items
              .map((i) => {
                const blocked = E.tradeBlocked(s, i);
                return `<label class="titem ${blocked ? 'dis' : ''}"><input type="checkbox" data-t="${side}" data-i="${i}" ${sel.sq.includes(i) ? 'checked' : ''} ${
                  blocked ? 'disabled' : ''
                }>${chipHtml(s, i)} <span>${esc(BOARD[i].name)}</span>${s.mortgaged[i] ? ' <small>(zástava)</small>' : ''}${blocked ? ' <small>(tréninky)</small>' : ''}</label>`;
              })
              .join('')
          : '<p class="muted small">Žádný majetek</p>'
      }
      <label class="lbl">Peníze (max. ${E.fmtN(p.money)})</label><input type="number" inputmode="numeric" min="0" step="100" max="${p.money}" data-t="${side}" data-f="money" value="${
      sel.money || ''
    }" placeholder="0">
      ${
        p.passes.length
          ? `<label class="lbl">Propustky (max. ${p.passes.length})</label><input type="number" min="0" max="${p.passes.length}" data-t="${side}" data-f="passes" value="${
              sel.passes || ''
            }" placeholder="0">`
          : ''
      }
    </div>`;
  };
  return `<h2>Obchod s ${nameHtml(other)}</h2><div class="tgrid">${col(me, 'give')}${col(other, 'want')}</div>
    <p class="muted small">Cenu si dohodnete mezi sebou. Stáj s tréninky nejde rozdělit, takže její koně obchodovat nelze.</p>
    <button class="btn big" data-a="tradeSend">Odeslat nabídku</button>`;
}

function itemsList(it) {
  const s = A.s;
  const parts = it.sq.map((i) => `<li>${chipHtml(s, i)} ${esc(BOARD[i].name)}${s.mortgaged[i] ? ' <small>(v zástavě)</small>' : ''}</li>`);
  if (it.money) parts.push(`<li>Peníze <b>${E.fmt(it.money)}</b></li>`);
  if (it.passes) parts.push(`<li>Propustka ×${it.passes}</li>`);
  return parts.length ? `<ul class="tlist">${parts.join('')}</ul>` : '<p class="muted">nic</p>';
}

function incomingModal() {
  const s = A.s;
  const t = s.trade;
  if (!t || t.to !== A.me) return '';
  return `<h2>Nabídka obchodu</h2><p>${nameHtml(E.getP(s, t.from))} ti nabízí výměnu:</p>
    <div class="tgrid swap"><div class="tcol give"><h4>Dostaneš</h4>${itemsList(t.give)}</div><div class="tcol want"><h4>Dáš</h4>${itemsList(t.want)}</div></div>
    <div class="btn-row"><button class="btn ok" data-a="acceptTrade">Přijmout</button><button class="btn danger" data-a="rejectTrade">Odmítnout</button></div>`;
}

function playerModal(id) {
  const s = A.s;
  const p = E.getP(s, id);
  if (!p) return '';
  const online = !!A.pres[id];
  const owned = BOARD.map((_, i) => i).filter((i) => s.owner[i] === id);
  const amPlayer = !!E.getP(s, A.me);
  const canKick = s.phase === 'playing' && !p.bankrupt && amPlayer && (id === A.me || s.hostId === A.me || !online);
  return `<div class="p-head" style="--pc:${p.color}"><span class="tok xl" style="--pc:${p.color}">${horse()}</span><div><h2>${esc(p.name)}${
    id === s.hostId ? ' <span class="tag gold">hostitel</span>' : ''
  }</h2><div class="muted">${online ? 'online' : 'offline'}${p.bankrupt ? ' · bankrot' : ` · ${esc(BOARD[p.pos].name)}`}</div></div></div>
    <div class="stats"><div><span>Hotovost</span><b>${E.fmt(p.money)}</b></div><div><span>Jmění</span><b>${E.fmt(E.netWorth(s, id))}</b></div></div>
    ${p.jail ? '<p>Má distanc</p>' : ''}${p.passes.length ? `<p>Propustek: ${p.passes.length}</p>` : ''}
    <div class="olist">${
      owned
        .map(
          (i) =>
            `<button class="mname" data-a="sq" data-i="${i}">${chipHtml(s, i)} <span>${esc(BOARD[i].name)}</span>${
              s.level[i] ? ` <span class="lv-dots">${lvDots(s.level[i])}</span>` : ''
            }${s.mortgaged[i] ? ' <span class="tag">zástava</span>' : ''}</button>`
        )
        .join('') || '<p class="empty-state">Nic nevlastní.</p>'
    }</div>
    ${canKick ? `<button class="btn danger" data-a="kick" data-id="${id}">${id === A.me ? 'Vzdát hru' : 'Vyřadit ze hry'}</button>` : ''}`;
}

function overModal() {
  const s = A.s;
  const r = s.ranking || [];
  const P = (x) => E.getP(s, x.id);
  const w = r[0] && P(r[0]);
  const pod = [1, 0, 2]
    .filter((k) => r[k] && P(r[k]))
    .map((k) => {
      const p = P(r[k]);
      return `<div class="pod p${k + 1}" style="--pc:${p.color}"><span class="tok xl" style="--pc:${p.color}">${horse()}</span><b>${esc(p.name)}</b><small>${
        p.bankrupt ? 'bankrot' : E.fmt(r[k].worth)
      }</small><div class="step">${k + 1}.</div></div>`;
    })
    .join('');
  const rest = r
    .slice(3)
    .map((x, k) => {
      const p = P(x);
      return `<li><span>${k + 4}.</span> ${nameHtml(p)} <b>${p && p.bankrupt ? 'bankrot' : E.fmt(x.worth)}</b></li>`;
    })
    .join('');
  return `<div class="over-head">${emblem('sm')}<h2>Konec hry</h2>${w ? `<p>Vítězem je <b>${esc(w.name)}</b>${w.id === A.me ? ' – gratulujeme!' : ''}</p>` : ''}</div>
    <div class="podium">${pod}</div>${rest ? `<ol class="rank">${rest}</ol>` : ''}
    <div class="btn-row">${E.getP(s, A.me) ? '<button class="btn" data-a="rematch">Nová hra se stejnými hráči</button>' : ''}<button class="btn secondary" data-a="leaveRoom">Zpět na úvod</button></div>`;
}

function rulesModal() {
  const st = (A.s && A.s.settings) || { startMoney: RULES.startMoney, startBonus: RULES.startBonus };
  const R = [
    ['Cíl hry', 'Kupuj koně, skládej celé stáje a trénuj je. Vyhrává poslední hráč, který nezkrachuje – nebo při časovém či kolovém limitu ten s nejvyšším jměním.'],
    ['Tah', 'Hoď kostkou a posuň se. Padne-li <b>šestka</b>, házíš znovu a hody se sčítají. <b>Dvě šestky</b> po sobě znamenají distanc.'],
    ['Koně a stáje', 'Volného koně, žokeje nebo službu můžeš koupit, když na ně stoupneš. Kdo stoupne na cizí, platí majiteli poplatek. Celá stáj bez tréninků = <b>dvojnásobný</b> poplatek.'],
    ['Tréninky', 'Když zastavíš na koni z <b>vlastní celé stáje</b>, můžeš koupit trénink (1–4) a nakonec <b>Velkou cenu</b>. Poplatky pak prudce rostou.'],
    ['Žokejové', `Poplatek podle počtu žokejů majitele: ${RULES.jockeyRent
      .slice(1)
      .map((x) => E.fmtN(x))
      .join(' / ')} Kč.`],
    ['Služby', `${esc(SERVICE_NAMES)}: hod × ${RULES.serviceMult[1]}, majitel obou bere hod × ${RULES.serviceMult[2]}.`],
    ['Karty', `${Object.values(DECKS)
      .map((d) => esc(d.name))
      .join(' a ')}. Propustku rušící distanc si můžeš nechat na později.`],
    ['Distanc', 'Končí <b>šestkou</b> (pak házíš znovu a táhneš) nebo použitím propustky.'],
    [esc(SKIP_NAME), 'Příští tah vynecháš. Do té doby bereš za koně jen základní poplatek.'],
    ['Peníze', `Na začátku ${E.fmt(st.startMoney)}, za průchod Startem ${E.fmt(
      st.startBonus
    )}. Bance prodáš majetek za plnou cenu, tréninky za polovinu. Když nemáš na placení, musíš prodávat – jinak bankrot.`],
    ['Obchod', 'Na svém tahu můžeš ostatním nabídnout výměnu koní, peněz i propustek.'],
  ];
  const keys = IS_TOUCH
    ? ''
    : '<div class="keys"><span><kbd>mezerník</kbd> hodit / ukončit tah</span><span><kbd>M</kbd> zvuk</span><span><kbd>Esc</kbd> zavřít okno</span></div>';
  return `<h2>Jak se hraje</h2><div class="rules">${R.map(([t, d]) => `<div class="rule"><div><b>${t}</b><p>${d}</p></div></div>`).join(
    ''
  )}</div>${keys}`;
}

// ---------- potvrzovací dialog a hlášky ----------
function confirmBox(html, okLabel = 'Ano', danger = false) {
  return new Promise((res) => {
    const root = $('#confirm-root');
    root.innerHTML = `<div class="overlay top enter"><div class="modal small confirm" role="alertdialog" aria-modal="true"><p>${html}</p><div class="btn-row"><button class="btn ${
      danger ? 'danger' : ''
    }" id="cf-ok">${okLabel}</button><button class="btn secondary" id="cf-no">Zpět</button></div></div></div>`;
    const done = (v) => {
      root.innerHTML = '';
      res(v);
    };
    $('#cf-ok').onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
    $('#cf-no').focus();
  });
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  if (kind === 'err') sfx('error');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = kind), 3500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Odkaz zkopírován.');
  } catch {
    window.prompt('Zkopíruj odkaz:', text);
  }
}

function refreshSoundButtons() {
  document.querySelectorAll('.snd').forEach((b) => (b.outerHTML = sndBtn()));
}

// ---------- ovládání ----------
const SIMPLE = new Set(['roll', 'jailPass', 'buy', 'skip', 'endTurn', 'cancelTrade', 'start']);
const MANAGE = new Set(['build', 'sell', 'sellProp']);

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const a = el.dataset.a;
  const i = el.dataset.i !== undefined ? Number(el.dataset.i) : undefined;
  const id = el.dataset.id;
  if (a !== 'closeOverlay' && a !== 'sound') sfx('click');
  if (SIMPLE.has(a)) return act({ t: a });
  if (MANAGE.has(a)) return act({ t: a, i });
  switch (a) {
    case 'reload':
      return location.reload();
    case 'sound':
      sound.toggle();
      return refreshSoundButtons();
    case 'rules':
      return openModal({ type: 'rules' });
    case 'create':
      return createGame();
    case 'joinCode': {
      const code = cleanCode($('#h-code').value);
      if (code.length !== 5) return toast('Kód hry má 5 znaků.', 'err');
      const name = ($('#h-name').value || '').trim();
      if (name) lsSet('ds_name', name);
      return enterRoom(code);
    }
    case 'closeOverlay':
      if (e.target !== el) return;
      return dismissModal();
    case 'close':
      return dismissModal();
    case 'sq':
      return openModal({ type: 'sq', i });
    case 'manage':
      return openModal({ type: 'manage' });
    case 'trade':
      return openModal({ type: 'trade', to: null, give: emptyItems(), want: emptyItems() });
    case 'tradeTo':
      A.modal.to = id;
      return renderModal(true);
    case 'tradeSend': {
      const m = A.modal;
      const err = await act({ t: 'trade', to: m.to, give: m.give, want: m.want });
      if (!err) {
        closeModal();
        toast('Nabídka odeslána.');
      }
      return;
    }
    case 'showTrade':
      A.hideTrade = 0;
      closeModal();
      return renderModal(true);
    case 'showOver':
      A.hideOver = false;
      closeModal();
      return renderModal(true);
    case 'acceptTrade':
    case 'rejectTrade': {
      const err = await act({ t: a });
      if (!err) closeModal();
      return;
    }
    case 'player':
      return openModal({ type: 'player', id });
    case 'kick': {
      const p = E.getP(A.s, id);
      if (!p) return;
      const q =
        A.s.phase === 'lobby'
          ? `Odebrat z lobby: <b>${esc(p.name)}</b>?`
          : id === A.me
          ? 'Opravdu to chceš vzdát? Tvůj majetek se vrátí bance.'
          : `Opravdu vyřadit ze hry: <b>${esc(p.name)}</b>? Majetek se vrátí bance.`;
      if (await confirmBox(q, 'Ano', true)) {
        closeModal();
        act({ t: 'kick', target: id });
      }
      return;
    }
    case 'bankrupt':
      if (await confirmBox('Opravdu vyhlásit bankrot? Tím ve hře končíš.', 'Vyhlásit bankrot', true)) act({ t: 'bankrupt' });
      return;
    case 'rematch':
      A.hideOver = false;
      closeModal();
      return act({ t: 'rematch' });
    case 'leaveRoom': {
      const s = A.s;
      if (s && s.phase === 'lobby' && E.getP(s, A.me)) await act({ t: 'leave' });
      else if (s && s.phase === 'playing' && E.getP(s, A.me) && !E.getP(s, A.me).bankrupt) {
        if (!(await confirmBox('Odejít na úvodní obrazovku? Ve hře zůstáváš a vrátit se můžeš přes stejný odkaz.', 'Odejít'))) return;
      }
      return showHome();
    }
    case 'copyLink':
      return copyText(urlFor(A.room));
    case 'shareLink':
      return navigator.share({ title: GAME_NAME, text: 'Pojď si zahrát dostihy!', url: urlFor(A.room) }).catch(() => {});
    case 'join': {
      const name = ($('#lb-name').value || '').trim();
      if (!name) return toast('Zadej své jméno.', 'err');
      lsSet('ds_name', name);
      return act({ t: 'join', name, color: A.joinColor });
    }
    case 'rename': {
      const name = ($('#lb-name').value || '').trim();
      lsSet('ds_name', name);
      const err = await act({ t: 'update', name });
      if (!err) toast('Jméno uloženo.');
      return;
    }
    case 'color':
      if (E.getP(A.s, A.me)) return act({ t: 'update', color: el.dataset.c });
      A.joinColor = el.dataset.c;
      return renderLobby();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.set) {
    const v = $('[data-set="limit"]').value;
    const [limitType, limitValue] = v === 'none' ? ['none', 0] : [v.split(':')[0], Number(v.split(':')[1])];
    act({
      t: 'settings',
      startMoney: Number($('[data-set="startMoney"]').value),
      startBonus: Number($('[data-set="startBonus"]').value),
      limitType,
      limitValue,
    });
    el.blur();
    return;
  }
  tradeInput(el);
});
document.addEventListener('input', (e) => {
  if (e.target.type === 'number') tradeInput(e.target);
});

function tradeInput(el) {
  const m = A.modal;
  if (!m || m.type !== 'trade' || !el.dataset.t) return;
  const side = m[el.dataset.t];
  if (el.type === 'checkbox') {
    const i = Number(el.dataset.i);
    side.sq = el.checked ? [...new Set([...side.sq, i])] : side.sq.filter((x) => x !== i);
  } else if (el.dataset.f) {
    side[el.dataset.f] = Math.max(0, Math.floor(Number(el.value) || 0));
  }
}

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#confirm-root').innerHTML) return $('#cf-no') && $('#cf-no').click();
    if (A.modal || A.autoShown) return dismissModal();
  }
  if (e.key === 'Enter' && e.target.id === 'h-name') return createGame();
  if (e.key === 'Enter' && e.target.id === 'h-code') return $('[data-a="joinCode"]').click();
  if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'm' || e.key === 'M') {
    sound.toggle();
    refreshSoundButtons();
    toast(sound.on ? 'Zvuk zapnutý' : 'Zvuk vypnutý');
    return;
  }
  if ((e.key === ' ' || e.key === 'Enter') && A.screen === 'game' && !A.modal && !A.autoShown && !$('#confirm-root').innerHTML) {
    if (e.target.closest && e.target.closest('button, [role="button"]') && e.key === 'Enter') return;
    const b = $('#me [data-primary]');
    if (b && !b.disabled && !A.anim) {
      e.preventDefault();
      b.click();
    }
  }
});

// najetí myší na koně zvýrazní celou jeho stáj
document.addEventListener('mouseover', (e) => {
  const cell = e.target.closest && e.target.closest('#board .cell');
  const i = cell ? Number(cell.dataset.i) : -1;
  if (i === A.hoverSq) return;
  A.hoverSq = i;
  A.cells.forEach((c) => c.classList.remove('grp'));
  const b = BOARD[i];
  if (b && b.type === 'horse') E.STABLE_SQ[b.stable].forEach((j) => A.cells[j] && A.cells[j].classList.add('grp'));
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateTitle();
});
