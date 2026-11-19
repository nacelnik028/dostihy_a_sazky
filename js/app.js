// ============================================================
//  Uživatelské rozhraní + napojení na síť a hostitelskou logiku.
// ============================================================
import { BOARD, STABLES, RULES, CARDS, DECKS, PLAYER_COLORS, GAME_NAME, SETTINGS_OPTIONS } from './config.js';
import * as E from './engine.js';
import { makeBackend, DUP } from './net.js';
import { firebaseConfig } from './firebase-config.js';

// ---------- pomocníci ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const params = new URLSearchParams(location.search);
const LOCAL = params.has('local');
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

const A = {
  backend: null,
  backendErr: null,
  me: null,
  room: null,
  s: null,
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
};

// ---------- start aplikace ----------
boot();

async function boot() {
  app.innerHTML = screen('<p class="center muted">Načítám…</p>');
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
  const name = lsGet('ds_name') || '';
  let body;
  if (A.backendErr === 'noconfig') {
    const u = new URL(location.href);
    u.search = '?local=1';
    body = `<div class="note warn"><b>Hra zatím není propojená s Firebase.</b><br>Vyplň soubor <code>js/firebase-config.js</code> podle návodu v README.md.<br><br>Mezitím si můžeš hru vyzkoušet v <a href="${esc(u.toString())}">lokálním testovacím režimu</a>.</div>`;
  } else if (A.backendErr) {
    body = `<div class="note warn"><b>Nepodařilo se připojit k serveru.</b><br>${esc(A.backendErr)}</div><button class="btn big" data-a="reload">Zkusit znovu</button>`;
  } else {
    body = `
      <label class="lbl" for="h-name">Tvoje jméno</label>
      <input id="h-name" maxlength="16" autocomplete="nickname" value="${esc(name)}" placeholder="např. Anna">
      <button class="btn big" data-a="create">🏁 Založit novou hru</button>
      <div class="or"><span>nebo se připoj ke hře</span></div>
      <div class="row"><input id="h-code" class="code-in" maxlength="5" placeholder="KÓD" value="${esc(prefill)}" autocapitalize="characters" autocomplete="off"><button class="btn secondary" data-a="joinCode">Připojit se</button></div>`;
  }
  app.innerHTML = screen(
    `<div class="logo-big">🏇</div>
     <h1 class="title">${GAME_NAME}</h1>
     <p class="sub">Dostihová obchodní hra pro 2–6 hráčů. Každý hraje na svém mobilu nebo počítači.</p>
     ${LOCAL ? '<div class="note">🧪 <b>Lokální testovací režim</b> – hráči jsou jen záložky tohoto prohlížeče. Dalšího hráče přidáš otevřením odkazu hry v nové záložce.</div>' : ''}
     ${msg ? `<div class="note warn">${esc(msg)}</div>` : ''}
     ${body}`,
    'home'
  );
}

async function createGame() {
  const name = ($('#h-name').value || '').trim();
  if (!name) return toast('Zadej své jméno.');
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
    toast('Hru se nepodařilo založit, zkus to znovu.');
  } catch (e) {
    toast('Hru se nepodařilo založit: ' + e.message);
  }
  A.busy = false;
}

// ---------- vstup do hry ----------
function enterRoom(code) {
  leaveRoom();
  Object.assign(A, {
    room: code,
    s: null,
    meta: undefined,
    pres: {},
    seq: null,
    screen: null,
    modal: null,
    hideOver: false,
    hideTrade: 0,
    hostGoneSince: null,
    lbKey: null,
  });
  history.replaceState(null, '', urlFor(code));
  app.innerHTML = screen(`<p class="center">Připojuji se ke hře <b>${esc(code)}</b>…</p>`);
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
    onError: (e) => toast('Chyba spojení: ' + e.message),
  });
}

function leaveRoom() {
  if (A.unwatch) A.unwatch();
  if (A.hostOff) A.hostOff();
  Object.assign(A, { unwatch: null, hostOff: null, queue: [], room: null, s: null, meta: undefined });
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
  render();
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
    toast('Chyba při zpracování tahu: ' + e.message);
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
  if (err) toast(err);
  return err;
}

// ---------- vykreslování ----------
function render() {
  if (!A.s || !A.room) return;
  if (A.s.phase === 'lobby') renderLobby();
  else renderGame();
  renderModal();
}

function nameHtml(p) {
  if (!p) return '?';
  return `<span class="pn"><i style="background:${p.color}"></i>${esc(p.name)}</span>`;
}

function logHtml(m) {
  return esc(m).replace(/\{p:([A-Za-z0-9_-]+)\}/g, (_, id) => nameHtml(E.getP(A.s, id)));
}

const initial = (name) => (Array.from(String(name || '?'))[0] || '?').toUpperCase();

// ---------- lobby ----------
function renderLobby() {
  const s = A.s;
  const me = E.getP(s, A.me);
  const host = s.hostId === A.me;
  if (A.screen !== 'lobby') {
    A.screen = 'lobby';
    A.lbKey = null;
    A.modal = null;
    app.innerHTML = screen(
      `<h1 class="title small">🏇 ${GAME_NAME}</h1>
       <div class="room-code"><span>Kód hry</span><b>${esc(A.room)}</b></div>
       <p class="center muted small">Pošli ostatním odkaz nebo kód hry.</p>
       <div class="btn-row center"><button class="btn secondary" data-a="copyLink">📋 Kopírovat odkaz</button>${
         navigator.share ? '<button class="btn secondary" data-a="shareLink">📤 Sdílet</button>' : ''
       }</div>
       <div id="lb-me"></div>
       <h3>Hráči</h3><div id="lb-players" class="lb-players"></div>
       <div id="lb-settings"></div>
       <div id="lb-start"></div>
       <div class="center"><button class="btn link" data-a="leaveRoom">Opustit hru</button></div>`,
      'lobby'
    );
  }
  const key = me ? 'in' : 'out';
  if (A.lbKey !== key) {
    A.lbKey = key;
    const nm = me ? me.name : lsGet('ds_name') || '';
    $('#lb-me').innerHTML = me
      ? `<h3>Ty</h3><div class="row"><input id="lb-name" maxlength="16" value="${esc(nm)}"><button class="btn secondary" data-a="rename">Uložit</button></div><div class="lbl">Barva figurky</div><div id="lb-colors" class="swatches"></div>`
      : `<h3>Připoj se do hry</h3><input id="lb-name" maxlength="16" placeholder="Tvoje jméno" value="${esc(nm)}"><div class="lbl">Barva figurky</div><div id="lb-colors" class="swatches"></div><button class="btn big" data-a="join">Připojit se</button>`;
  }
  const used = new Map(s.players.map((p) => [p.color, p]));
  if (!me && (!A.joinColor || used.has(A.joinColor))) A.joinColor = (PLAYER_COLORS.find((c) => !used.has(c.hex)) || {}).hex;
  const selected = me ? me.color : A.joinColor;
  $('#lb-colors').innerHTML = PLAYER_COLORS.map((c) => {
    const owner = used.get(c.hex);
    const taken = owner && owner.id !== A.me;
    return `<button class="sw ${c.hex === selected ? 'sel' : ''}" style="background:${c.hex}" data-a="color" data-c="${c.hex}" ${
      taken ? 'disabled' : ''
    } title="${esc(c.name)}${taken ? ' – obsazeno' : ''}" aria-label="${esc(c.name)}"></button>`;
  }).join('');
  const jb = $('[data-a="join"]');
  if (jb) jb.disabled = s.players.length >= RULES.maxPlayers;

  $('#lb-players').innerHTML =
    s.players
      .map(
        (p) =>
          `<div class="lb-pl"><span class="dot" style="background:${p.color}"></span><span class="pname">${esc(p.name)}${
            p.id === A.me ? ' <small>(ty)</small>' : ''
          }</span>${p.id === s.hostId ? '<span class="tag">👑 hostitel</span>' : ''}<span class="online ${A.pres[p.id] ? 'on' : ''}" title="${
            A.pres[p.id] ? 'online' : 'offline'
          }"></span>${host && p.id !== A.me ? `<button class="x-mini" data-a="kick" data-id="${p.id}" title="Odebrat z lobby" aria-label="Odebrat z lobby">✕</button>` : ''}</div>`
      )
      .join('') +
    (s.players.length < RULES.maxPlayers ? `<div class="lb-pl empty">Volná místa: ${RULES.maxPlayers - s.players.length}</div>` : '');

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
            <label>Startovní kapitál<select data-set="startMoney">${opts(SETTINGS_OPTIONS.startMoney, st.startMoney)}</select></label>
            <label>Odměna za Start<select data-set="startBonus">${opts(SETTINGS_OPTIONS.startBonus, st.startBonus)}</select></label>
            <label>Délka hry<select data-set="limit">${SETTINGS_OPTIONS.limits
              .map((l) => `<option value="${l.v}" ${l.v === limVal ? 'selected' : ''}>${esc(l.label)}</option>`)
              .join('')}</select></label>
          </div>`
        : `<ul class="setlist"><li>Startovní kapitál: <b>${E.fmt(st.startMoney)}</b></li><li>Odměna za Start: <b>${E.fmt(
            st.startBonus
          )}</b></li><li>Délka hry: <b>${esc(limLabel)}</b></li></ul>`);
  }
  const n = s.players.length;
  $('#lb-start').innerHTML = host
    ? `<button class="btn big" data-a="start" ${n < RULES.minPlayers ? 'disabled' : ''}>🏁 Spustit hru (${n} ${plural(n, 'hráč', 'hráči', 'hráčů')})</button>${
        n < RULES.minPlayers ? '<p class="center muted small">Čeká se na další hráče…</p>' : ''
      }`
    : `<p class="center muted">${me ? 'Čeká se, až hostitel spustí hru…' : ''}</p>`;
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
  if (b.type === 'horse') {
    const col = STABLES[b.stable].color;
    inner = `<div class="band" style="--sc:${col}"><span class="lvl"></span></div>
      <div class="cbody"><span class="cart" style="color:${col}">♞</span><div class="cname">${esc(b.name)}</div><div class="cprice">${E.fmtN(b.price)}</div></div>`;
  } else if (b.type === 'jockey' || b.type === 'service') {
    inner = `<div class="cbody"><div class="cicon">${b.icon}</div><div class="cname">${esc(b.name)}</div><div class="cprice">${E.fmtN(b.price)}</div></div>`;
  } else if (b.type === 'tax') {
    inner = `<div class="cbody"><div class="cicon">${b.icon}</div><div class="cname">${esc(b.name)}</div><div class="cprice minus">−${E.fmtN(b.amount)}</div></div>`;
  } else if (b.type === 'card') {
    inner = `<div class="cbody"><div class="minicard deck-${b.deck}">${b.icon}</div><div class="cname">${esc(b.name)}</div></div>`;
  } else {
    const sub = b.type === 'start' ? '<div class="csub" id="start-bonus"></div>' : b.type === 'jail' ? '<div class="csub">i návštěva</div>' : '';
    inner = `<div class="cbody"><div class="cicon">${b.icon}</div><div class="cname">${esc(b.name)}</div>${sub}</div>`;
  }
  return `<div class="cell ${sideOf(i)} t-${b.type}" style="grid-row:${r};grid-column:${c}" data-a="sq" data-i="${i}">${inner}<div class="tokens"></div></div>`;
}

function buildGame() {
  A.screen = 'game';
  app.innerHTML = `
    <div class="game">
      <div class="board-wrap"><div class="board" id="board">${BOARD.map(cellHtml).join('')}<div class="bcenter" id="center"></div></div></div>
      <aside class="side">
        <section class="panel" id="me"></section>
        <section class="panel" id="players"></section>
        <section class="panel"><h3>Průběh hry</h3><div id="log" class="log"></div></section>
        <div class="foot" id="foot"></div>
      </aside>
    </div>`;
  A.cells = [...document.querySelectorAll('#board .cell')];
}

function renderGame() {
  if (A.screen !== 'game') buildGame();
  drawCells();
  drawTokens();
  drawCenter();
  drawMe();
  drawPlayers();
  drawLog();
  drawFoot();
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
    el.style.setProperty('--own', op ? op.color : 'transparent');
    el.title = op ? `${BOARD[i].name} – majitel: ${op.name}` : BOARD[i].name;
    const lvl = el.querySelector('.lvl');
    if (lvl) {
      const lv = s.level[i];
      lvl.innerHTML = lv === 5 ? '<span class="vc">🏆</span>' : '<i></i>'.repeat(lv);
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
          `<span class="tok ${p.id === cur ? 'cur' : ''} ${p.id === moving ? 'hop' : ''} ${p.jail ? 'jailed' : ''}" style="--pc:${p.color}" title="${esc(
            p.name
          )}">♞</span>`
      )
      .join('');
  });
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHtml(v, rolling = false) {
  const on = new Set(PIPS[v] || []);
  return `<div class="die ${rolling ? 'rolling' : ''}">${Array.from({ length: 9 }, (_, k) => `<span class="${on.has(k) ? 'on' : ''}"></span>`).join('')}</div>`;
}

function cardHtml(lc) {
  if (!lc) return '';
  const c = CARDS[lc.deck][lc.id];
  return `<div class="cardbox deck-${lc.deck}"><div class="ch">${DECKS[lc.deck].icon} ${DECKS[lc.deck].name}</div><div class="ct">${esc(
    E.cardText(c)
  )}</div><div class="cw">${nameHtml(E.getP(A.s, lc.pid))}</div></div>`;
}

function drawCenter() {
  const s = A.s;
  const c = $('#center');
  let turn;
  if (s.phase === 'over') {
    const w = s.ranking && s.ranking[0] && E.getP(s, s.ranking[0].id);
    turn = `<div class="turnbar win">🏆 Vítěz: ${nameHtml(w)}</div>`;
  } else {
    const cp = E.curP(s);
    turn = `<div class="turnbar"><span class="round">Kolo ${s.round}</span><span class="sep"></span>Na tahu: ${nameHtml(cp)}${
      cp.id === A.me ? ' <span class="you">(ty)</span>' : ''
    }</div>`;
  }
  const dice = (s.dice && s.dice.length ? s.dice : [0]).map((v) => dieHtml(v)).join('');
  const deck = (d) => {
    const n = s.decks && s.decks[d] ? s.decks[d].length : CARDS[d].length;
    return `<div class="deck deck-${d}" title="Balíček ${DECKS[d].name}"><div class="deck-face"><span>${DECKS[d].icon}</span><b>${DECKS[d].name}</b></div><small>${n} ${plural(
      n,
      'karta',
      'karty',
      'karet'
    )}</small></div>`;
  };
  let notes = '';
  if (s.trade) notes += `<div class="cnote">🤝 Obchod: ${nameHtml(E.getP(s, s.trade.from))} → ${nameHtml(E.getP(s, s.trade.to))}</div>`;
  if (s.debts.length) notes += '<div class="cnote">💸 Čeká se na splacení dluhu</div>';
  c.innerHTML = `<div class="track"></div><div class="cc">
    <div class="logo">${GAME_NAME}</div>
    ${turn}
    <div class="table">${deck('tiket')}<div class="dice" id="c-dice">${dice}</div>${deck('stesti')}</div>
    <div id="c-card">${cardHtml(s.lastCard)}</div>
    ${notes}
    <div class="cmsg">${s.log
      .slice(-3)
      .reverse()
      .map((l) => `<div>${logHtml(l.m)}</div>`)
      .join('')}</div>
  </div>`;
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
      await sleep(400);
    } else if (e.k === 'card') {
      const box = $('#c-card');
      if (box) {
        box.innerHTML = cardHtml({ deck: e.deck, id: e.id, pid: e.pid });
        if (box.firstElementChild) box.firstElementChild.classList.add('flash');
      }
      await sleep(1600);
    }
  }
}

async function animDice(vals) {
  const box = $('#c-dice');
  if (!box) return;
  const t0 = Date.now();
  while (Date.now() - t0 < 600) {
    box.innerHTML = vals.map(() => dieHtml(1 + Math.floor(Math.random() * 6), true)).join('');
    await sleep(70);
  }
  box.innerHTML = vals.map((v) => dieHtml(v)).join('');
  await sleep(300);
}

async function animWalk(pid, from, steps) {
  A.disp[pid] = from;
  const dir = Math.sign(steps);
  const n = Math.abs(steps);
  const dt = n > 12 ? 90 : 150;
  for (let k = 1; k <= n; k++) {
    A.disp[pid] = (from + dir * k + 40) % 40;
    drawTokens(pid);
    await sleep(dt);
  }
  await sleep(200);
}

// ---------- panel hráče (akce) ----------
function drawMe() {
  const s = A.s;
  const el = $('#me');
  const me = E.getP(s, A.me);
  const hostOffline = A.meta && !A.pres[A.meta.hostUid] && s.phase === 'playing';
  const hostNote = hostOffline ? '<div class="note warn small">Hostitel je offline – tahy se zpracují, až se vrátí, nebo roli za chvíli převezme jiný hráč.</div>' : '';
  if (!me) {
    el.innerHTML = `<h3>👀 Sleduješ hru</h3><p class="muted">Do rozehrané hry se už nedá přidat.</p>${hostNote}`;
    return;
  }
  const cp = E.curP(s);
  const myTurn = s.phase === 'playing' && cp.id === A.me && !me.bankrupt;
  const head = `<div class="me-head"><span class="tok big" style="--pc:${me.color}">${esc(initial(me.name))}</span><div class="me-info"><div class="me-name">${esc(
    me.name
  )}</div><div class="me-money">${E.fmt(me.money)}</div></div>${me.passes.length ? `<div class="tag">🎟️ Propustka ×${me.passes.length}</div>` : ''}</div>`;
  let acts = '';
  const tools = (tradeOk) =>
    `<div class="btn-row"><button class="btn secondary" data-a="manage">🏠 Můj majetek</button>${
      tradeOk !== undefined ? `<button class="btn secondary" data-a="trade" ${tradeOk ? '' : 'disabled'}>🤝 Obchod</button>` : ''
    }</div>`;

  if (s.phase === 'over') {
    acts = '<button class="btn big" data-a="showOver">🏆 Výsledky</button>';
  } else if (me.bankrupt) {
    acts = '<p>Jsi mimo hru (bankrot). Můžeš dál sledovat.</p>';
  } else if (s.debts.length) {
    const mine = s.debts.filter((d) => d.d === A.me);
    if (mine.length) {
      const total = mine.reduce((x, d) => x + d.a, 0);
      const liq = E.liquidation(s, A.me);
      acts = `<div class="alert">💸 Dlužíš <b>${E.fmt(total)}</b> → ${mine
        .map((d) => (d.c ? nameHtml(E.getP(s, d.c)) : 'bance'))
        .join(', ')}.<br><small>Sežeň peníze prodejem tréninků (za polovinu) nebo prodejem majetku bance (za plnou cenu) – dluh se zaplatí automaticky.</small></div>
        ${liq < total ? `<p class="warn-text">Ani prodejem všeho nezískáš dost (max. ${E.fmt(liq)}).</p>` : ''}
        <button class="btn big" data-a="manage">🏠 Sehnat peníze</button>
        <button class="btn danger" data-a="bankrupt">Vyhlásit bankrot</button>`;
    } else {
      const who = [...new Set(s.debts.map((d) => d.d))].map((id) => nameHtml(E.getP(s, id))).join(', ');
      acts = `<p class="muted">Čeká se, až ${who} sežene peníze na dluh…</p>`;
    }
  } else if (s.trade && s.trade.to === A.me) {
    acts = `<div class="alert">🤝 ${nameHtml(E.getP(s, s.trade.from))} ti nabízí obchod.</div><button class="btn big" data-a="showTrade">Zobrazit nabídku</button>`;
  } else if (myTurn) {
    if (s.trade) {
      acts = `<p>Čekáš na odpověď na nabídku obchodu → ${nameHtml(E.getP(s, s.trade.to))}.</p><button class="btn secondary" data-a="cancelTrade">Zrušit nabídku</button>`;
    } else if (s.stage === 'roll' && me.jail) {
      acts = `<div class="alert">🚧 Máš distanc. Zruší ho šestka nebo propustka. Po šestce házíš znovu.</div>
        <button class="btn big" data-a="roll">🎲 Zkusit hodit šestku</button>
        ${me.passes.length ? '<div class="btn-row"><button class="btn secondary" data-a="jailPass">🎟️ Použít propustku</button></div>' : ''}${tools(true)}`;
    } else if (s.stage === 'roll') {
      acts = `<button class="btn big" data-a="roll">🎲 Hodit kostkou</button>${tools(true)}`;
    } else if (s.stage === 'buy') {
      const b = BOARD[s.buySq];
      const lack = me.money < b.price;
      acts = `<div class="offer" data-a="sq" data-i="${s.buySq}"><span class="sw-mini" style="background:${
        b.type === 'horse' ? STABLES[b.stable].color : '#8a7a5a'
      }"></span><div><b>${esc(b.name)}</b><div class="muted small">${b.type === 'horse' ? esc(STABLES[b.stable].name) : b.type === 'jockey' ? 'Žokej' : 'Služba'} · podrobnosti ›</div></div></div>
        <div class="btn-row"><button class="btn" data-a="buy" ${lack ? 'disabled' : ''}>Koupit za ${E.fmt(b.price)}</button><button class="btn secondary" data-a="skip">Nekupovat</button></div>
        ${lack ? '<p class="muted small">Nemáš dost peněz – můžeš něco prodat bance v „Můj majetek“.</p>' : ''}${tools()}`;
    } else {
      acts = `${trainingOffer(s)}<button class="btn big" data-a="endTurn">Ukončit tah ➜</button>${tools(true)}`;
    }
  } else {
    acts = `<p class="muted">Na tahu je ${nameHtml(cp)}.</p>${tools()}`;
  }
  const skipNote =
    me.skip > 0 && s.phase === 'playing'
      ? '<div class="note small">🩹 Kůň kulhá – příští tah vynecháš. Do té doby dostáváš za koně jen základní poplatek.</div>'
      : '';
  el.innerHTML = head + hostNote + skipNote + `<div class="actions">${acts}</div>`;
}

// po zastavení na vlastním koni z kompletní stáje lze koupit tréninky (1–4, pak Velkou cenu)
function trainingOffer(s) {
  const i = s.landSq;
  if (i === null || i === undefined || s.owner[i] !== A.me || BOARD[i].type !== 'horse') return '';
  const b = BOARD[i];
  if (!E.ownsStable(s, A.me, b.stable)) return '';
  const lv = s.level[i];
  if (lv >= 5) return `<div class="offer"><span class="sw-mini" style="background:${STABLES[b.stable].color}"></span><div><b>${esc(b.name)}</b> 🏆<div class="muted small">Kůň už má Velkou cenu.</div></div></div>`;
  const err = E.buildError(s, A.me, i);
  const label = lv === 4 ? `🏆 Uspořádat Velkou cenu (${E.fmt(E.trainingCost(i))})` : `🏇 Koupit trénink (${E.fmt(E.trainingCost(i))})`;
  return `<div class="offer" data-a="sq" data-i="${i}"><span class="sw-mini" style="background:${STABLES[b.stable].color}"></span><div><b>${esc(b.name)}</b> <span class="lv">${
    lv ? '●'.repeat(lv) : ''
  }</span><div class="muted small">Stojíš na svém koni z celé stáje – můžeš koupit tréninky.</div></div></div>
    <button class="btn big" data-a="build" data-i="${i}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
}

function chipHtml(s, i) {
  const b = BOARD[i];
  const col = b.type === 'horse' ? STABLES[b.stable].color : '#8a7a5a';
  const label = s.level[i] === 5 ? '🏆' : s.level[i] ? s.level[i] : b.type === 'horse' ? '' : b.icon;
  return `<span class="chip ${s.mortgaged[i] ? 'm' : ''}" style="background:${col}" title="${esc(b.name)}${s.mortgaged[i] ? ' (v zástavě)' : ''}">${label}</span>`;
}

function drawPlayers() {
  const s = A.s;
  const cur = s.phase === 'playing' ? E.curP(s).id : null;
  $('#players').innerHTML =
    '<h3>Hráči</h3>' +
    s.players
      .map((p) => {
        const on = !!A.pres[p.id];
        const owned = BOARD.map((_, i) => i).filter((i) => s.owner[i] === p.id);
        return `<div class="pl ${p.id === cur ? 'cur' : ''} ${p.bankrupt ? 'out' : ''}" data-a="player" data-id="${p.id}">
          <div class="pl-top"><span class="dot" style="background:${p.color}"></span><span class="pname">${esc(p.name)}${
          p.id === A.me ? ' <small>(ty)</small>' : ''
        }${p.id === s.hostId ? ' <span title="hostitel">👑</span>' : ''}</span><span class="online ${on ? 'on' : ''}" title="${on ? 'online' : 'offline'}"></span><span class="pmoney">${
          p.bankrupt ? 'bankrot' : E.fmt(p.money)
        }</span></div>
          <div class="chips">${owned.map((i) => chipHtml(s, i)).join('')}${p.jail ? '<span class="tag">🚧 Distanc</span>' : ''}${
          p.skip > 0 ? '<span class="tag">🩹 vynechá tah</span>' : ''
        }${
          p.passes.length ? `<span class="tag">🎟️×${p.passes.length}</span>` : ''
        }</div></div>`;
      })
      .join('');
}

function drawLog() {
  $('#log').innerHTML = A.s.log
    .slice(-80)
    .reverse()
    .map((l) => `<div class="le">${logHtml(l.m)}</div>`)
    .join('');
}

function drawFoot() {
  const host = A.meta && A.s && E.getP(A.s, A.meta.hostUid);
  $('#foot').innerHTML = `Hra <b>${esc(A.room)}</b>${LOCAL ? ' · lokální režim' : ''}${
    host ? ` · hostitel: ${esc(host.name)} ${A.pres[host.id] ? '🟢' : '⚪'}` : ''
  }<br><button class="btn link" data-a="copyLink">📋 Odkaz na hru</button> <button class="btn link" data-a="leaveRoom">Odejít na úvod</button>`;
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
  if (!m && s && s.phase !== 'lobby') {
    if (s.trade && s.trade.to === A.me && A.hideTrade !== s.trade.id) m = { type: 'incoming', auto: true };
    else if (s.phase === 'over' && !A.hideOver) m = { type: 'over', auto: true };
  }
  if (!m || !s) {
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
  if (!html) {
    if (A.modal) A.modal = null;
    root.innerHTML = '';
    A.autoShown = null;
    A.modalKey = null;
    return;
  }
  A.autoShown = m.auto ? m.type : null;
  A.modalKey = key;
  const scroll = root.querySelector('.modal') ? root.querySelector('.modal').scrollTop : 0;
  root.innerHTML = `<div class="overlay" data-a="closeOverlay"><div class="modal" role="dialog" aria-modal="true">${html}<button class="x" data-a="close" aria-label="Zavřít">✕</button></div></div>`;
  root.querySelector('.modal').scrollTop = scroll;
}

function btnM(a, i, label, err) {
  return `<button class="btn secondary small" data-a="${a}" data-i="${i}" ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
}

function manageButtons(i) {
  const s = A.s;
  const b = BOARD[i];
  const out = [];
  if (b.type === 'horse') {
    const lv = s.level[i];
    if (lv < 5) out.push(btnM('build', i, lv === 4 ? `🏆 Velká cena (−${E.fmtN(E.trainingCost(i))})` : `+ Trénink (−${E.fmtN(E.trainingCost(i))})`, E.buildError(s, A.me, i)));
    if (lv > 0) out.push(btnM('sell', i, `− Prodat trénink (+${E.fmtN(E.sellValue(i))})`, E.sellError(s, A.me, i)));
  }
  out.push(btnM('sellProp', i, `Prodat bance (+${E.fmtN(E.propSellValue(i))})`, E.sellPropError(s, A.me, i)));
  return out.join('');
}

function sqModal(i) {
  const s = A.s;
  const b = BOARD[i];
  if (!b) return '';
  const color = b.type === 'horse' ? STABLES[b.stable].color : '#7a6a4a';
  const sub = { horse: b.type === 'horse' && STABLES[b.stable].name, jockey: 'Žokej', service: 'Služba', card: 'Karta', tax: 'Poplatek' }[b.type] || '';
  let h = `<div class="sq-head" style="--sc:${color}"><div class="sq-icon">${b.type === 'horse' ? '🐎' : b.icon}</div><div><h2>${esc(b.name)}</h2>${
    sub ? `<div class="muted">${esc(sub)}</div>` : ''
  }</div></div>`;
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
      ['🏆 Velká cena', b.rent[5]],
    ];
    const ownerSkips = s.owner[i] && E.getP(s, s.owner[i]).skip > 0;
    const curRow = !s.owner[i] ? -1 : lv > 0 && !ownerSkips ? lv + 1 : full ? 1 : 0;
    h += `<table class="rent"><tr><th>Poplatek</th><th></th></tr>${rows
      .map((r, k) => `<tr class="${k === curRow ? 'cur' : ''}"><td>${r[0]}</td><td>${E.fmt(r[1])}</td></tr>`)
      .join('')}</table>
      <div class="facts">Cena koně <b>${E.fmt(b.price)}</b> · trénink <b>${E.fmt(E.trainingCost(i))}</b> · prodej tréninku bance <b>${E.fmt(E.sellValue(i))}</b></div>
      <p class="muted small">Stáj: ${E.STABLE_SQ[b.stable].map((j) => esc(BOARD[j].name)).join(', ')}. Tréninky (1–4, pak Velkou cenu) koupíš, jen když na koně z vlastní celé stáje stoupneš.</p>`;
  } else if (b.type === 'jockey') {
    h += `<table class="rent"><tr><th>Majitel vlastní</th><th>Poplatek</th></tr>${[1, 2, 3, 4]
      .map((n) => `<tr><td>${n} ${plural(n, 'žokeje', 'žokeje', 'žokejů')}</td><td>${E.fmt(RULES.jockeyRent[n])}</td></tr>`)
      .join('')}</table><div class="facts">Cena <b>${E.fmt(b.price)}</b></div>`;
  } else if (b.type === 'service') {
    h += `<p>Poplatek je hod kostkou × <b>${RULES.serviceMult[1]}</b>. Vlastní-li majitel obě služby (Veterinář i Kovář), platí se hod × <b>${RULES.serviceMult[2]}</b>.</p><div class="facts">Cena <b>${E.fmt(
      b.price
    )}</b></div>`;
  } else if (b.type === 'card') {
    h += `<p>Kdo sem stoupne, táhne kartu z balíčku „${esc(b.name)}“.</p>`;
  } else if (b.type === 'start') {
    h += `<p>${esc(b.desc)}</p><div class="facts">Odměna: <b>${E.fmt(s.settings.startBonus)}</b></div>`;
  } else if (b.type === 'jail') {
    h += `<p>${esc(b.desc)}</p><p class="muted small">Distanc dostaneš i po dvou šestkách v jednom tahu.</p>`;
  } else {
    h += `<p>${esc(b.desc || '')}</p>${b.amount ? `<div class="facts">Částka: <b>${E.fmt(b.amount)}</b></div>` : ''}`;
  }
  if (E.isOwnable(i)) {
    const o = s.owner[i] && E.getP(s, s.owner[i]);
    h += `<div class="owner">${
      o ? `Majitel: ${nameHtml(o)}${o.skip > 0 ? ' <span class="tag">🩹 vynechává tah – jen základní poplatek</span>' : ''}` : 'Volné – koupit ho můžeš, když na pole stoupneš.'
    }</div>`;
    if (o && o.id === A.me && s.phase === 'playing') {
      const ctxErr = E.manageError(s, A.me, 'raise');
      h += `<div class="btn-col">${manageButtons(i)}</div>${ctxErr ? `<p class="muted small">${esc(ctxErr)}</p>` : hintFor(i)}`;
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
  let h = `<h2>🏠 Můj majetek</h2><div class="facts">Hotovost <b>${E.fmt(me.money)}</b>${debt ? ` · dluh <b class="red">${E.fmt(debt)}</b>` : ''} · jmění <b>${E.fmt(
    E.netWorth(s, A.me)
  )}</b></div>`;
  const ctxErr = E.manageError(s, A.me, 'raise');
  if (ctxErr) h += `<p class="muted small">${esc(ctxErr)} Můžeš si ale vše prohlédnout.</p>`;
  if (!mine.length) return h + '<p class="muted">Zatím nic nevlastníš.</p>';
  const groups = [];
  STABLES.forEach((st, k) => {
    const items = E.STABLE_SQ[k].filter((i) => s.owner[i] === A.me);
    if (items.length) groups.push({ title: `${st.name}${E.ownsStable(s, A.me, k) ? ' ✓ celá' : ` (${items.length}/${E.STABLE_SQ[k].length})`}`, color: st.color, items });
  });
  const others = mine.filter((i) => BOARD[i].type !== 'horse');
  if (others.length) groups.push({ title: 'Žokejové a služby', color: '#8a7a5a', items: others });
  h += groups
    .map(
      (g) =>
        `<div class="mgroup"><div class="mtitle" style="--sc:${g.color}">${esc(g.title)}</div>${g.items
          .map((i) => {
            const lv = s.level[i];
            const lvl = BOARD[i].type === 'horse' ? (lv === 5 ? '🏆' : lv ? '●'.repeat(lv) : '') : '';
            return `<div class="mrow ${s.mortgaged[i] ? 'm' : ''}"><button class="mname" data-a="sq" data-i="${i}">${esc(BOARD[i].name)} <span class="lv">${lvl}</span>${
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
    return `<h2>🤝 Obchod</h2><p>S kým chceš obchodovat?</p><div class="btn-col">${others
      .map((p) => `<button class="btn secondary" data-a="tradeTo" data-id="${p.id}">${nameHtml(p)}</button>`)
      .join('')}</div>`;
  }
  const other = E.getP(s, m.to);
  if (!other) return '';
  const col = (p, side) => {
    const items = BOARD.map((_, i) => i).filter((i) => s.owner[i] === p.id);
    const sel = m[side];
    return `<div class="tcol"><h4>${side === 'give' ? 'Dávám' : `Chci od: ${nameHtml(p)}`}</h4>
      ${
        items.length
          ? items
              .map((i) => {
                const blocked = E.tradeBlocked(s, i);
                return `<label class="titem ${blocked ? 'dis' : ''}"><input type="checkbox" data-t="${side}" data-i="${i}" ${sel.sq.includes(i) ? 'checked' : ''} ${
                  blocked ? 'disabled' : ''
                }>${chipHtml(s, i)} ${esc(BOARD[i].name)}${s.mortgaged[i] ? ' <small>(zástava)</small>' : ''}${blocked ? ' <small>(tréninky)</small>' : ''}</label>`;
              })
              .join('')
          : '<p class="muted small">Žádný majetek</p>'
      }
      <label class="lbl">Peníze (max. ${E.fmtN(p.money)})</label><input type="number" inputmode="numeric" min="0" step="100" max="${p.money}" data-t="${side}" data-f="money" value="${
      sel.money || ''
    }" placeholder="0">
      ${
        p.passes.length
          ? `<label class="lbl">Propustky (max. ${p.passes.length})</label><input type="number" min="0" max="${p.passes.length}" data-t="${side}" data-f="passes" value="${sel.passes || ''}" placeholder="0">`
          : ''
      }
    </div>`;
  };
  return `<h2>🤝 Obchod ↔ ${nameHtml(other)}</h2><div class="tgrid">${col(me, 'give')}${col(other, 'want')}</div>
    <p class="muted small">Cenu si dohodnete mezi sebou. Stáj s tréninky nejde rozdělit, takže její koně obchodovat nelze.</p>
    <button class="btn big" data-a="tradeSend">Odeslat nabídku</button>`;
}

function itemsList(it) {
  const s = A.s;
  const parts = it.sq.map((i) => `<li>${chipHtml(s, i)} ${esc(BOARD[i].name)}${s.mortgaged[i] ? ' <small>(v zástavě)</small>' : ''}</li>`);
  if (it.money) parts.push(`<li>💰 ${E.fmt(it.money)}</li>`);
  if (it.passes) parts.push(`<li>🎟️ Propustka ×${it.passes}</li>`);
  return parts.length ? `<ul class="tlist">${parts.join('')}</ul>` : '<p class="muted">nic</p>';
}

function incomingModal() {
  const s = A.s;
  const t = s.trade;
  if (!t || t.to !== A.me) return '';
  return `<h2>🤝 Nabídka obchodu</h2><p>${nameHtml(E.getP(s, t.from))} ti dá:</p>${itemsList(t.give)}<p>a chce od tebe:</p>${itemsList(t.want)}
    <div class="btn-row"><button class="btn" data-a="acceptTrade">✔ Přijmout</button><button class="btn danger" data-a="rejectTrade">✖ Odmítnout</button></div>`;
}

function playerModal(id) {
  const s = A.s;
  const p = E.getP(s, id);
  if (!p) return '';
  const online = !!A.pres[id];
  const owned = BOARD.map((_, i) => i).filter((i) => s.owner[i] === id);
  const amPlayer = !!E.getP(s, A.me);
  const canKick = s.phase === 'playing' && !p.bankrupt && amPlayer && (id === A.me || s.hostId === A.me || !online);
  return `<h2>${nameHtml(p)}${id === s.hostId ? ' 👑' : ''}</h2>
    <div class="facts">${online ? '🟢 online' : '⚪ offline'} · hotovost <b>${E.fmt(p.money)}</b> · jmění <b>${E.fmt(E.netWorth(s, id))}</b></div>
    ${p.jail ? '<p>🚧 Má distanc</p>' : ''}${p.passes.length ? `<p>🎟️ Propustek: ${p.passes.length}</p>` : ''}
    <div class="olist">${
      owned
        .map(
          (i) =>
            `<button class="mname" data-a="sq" data-i="${i}">${chipHtml(s, i)} ${esc(BOARD[i].name)}${
              s.level[i] ? ` <span class="lv">${s.level[i] === 5 ? '🏆' : '●'.repeat(s.level[i])}</span>` : ''
            }${s.mortgaged[i] ? ' <span class="tag">zástava</span>' : ''}</button>`
        )
        .join('') || '<p class="muted">Nic nevlastní.</p>'
    }</div>
    ${canKick ? `<button class="btn danger" data-a="kick" data-id="${id}">${id === A.me ? 'Vzdát hru' : 'Vyřadit ze hry'}</button>` : ''}`;
}

function overModal() {
  const s = A.s;
  const r = s.ranking || [];
  const medal = ['🥇', '🥈', '🥉'];
  return `<h2>🏆 Konec hry</h2><ol class="rank">${r
    .map((x, k) => {
      const p = E.getP(s, x.id);
      return `<li><span>${medal[k] || `${k + 1}.`}</span> ${nameHtml(p)} <b>${p && p.bankrupt ? 'bankrot' : E.fmt(x.worth)}</b></li>`;
    })
    .join('')}</ol>
    <div class="btn-row">${E.getP(s, A.me) ? '<button class="btn" data-a="rematch">🔁 Nová hra se stejnými hráči</button>' : ''}<button class="btn secondary" data-a="leaveRoom">Zpět na úvod</button></div>`;
}

// ---------- potvrzovací dialog a hlášky ----------
function confirmBox(html, okLabel = 'Ano', danger = false) {
  return new Promise((res) => {
    const root = $('#confirm-root');
    root.innerHTML = `<div class="overlay top"><div class="modal small"><p>${html}</p><div class="btn-row"><button class="btn ${
      danger ? 'danger' : ''
    }" id="cf-ok">${okLabel}</button><button class="btn secondary" id="cf-no">Zpět</button></div></div></div>`;
    $('#cf-ok').onclick = () => {
      root.innerHTML = '';
      res(true);
    };
    $('#cf-no').onclick = () => {
      root.innerHTML = '';
      res(false);
    };
  });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Odkaz zkopírován.');
  } catch {
    window.prompt('Zkopíruj odkaz:', text);
  }
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
  if (SIMPLE.has(a)) return act({ t: a });
  if (MANAGE.has(a)) return act({ t: a, i });
  switch (a) {
    case 'reload':
      return location.reload();
    case 'create':
      return createGame();
    case 'joinCode': {
      const code = cleanCode($('#h-code').value);
      if (code.length !== 5) return toast('Kód hry má 5 znaků.');
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
      if (!err) closeModal();
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
      if (!name) return toast('Zadej své jméno.');
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (A.modal || A.autoShown)) dismissModal();
  if (e.key === 'Enter' && e.target.id === 'h-name') createGame();
  if (e.key === 'Enter' && e.target.id === 'h-code') $('[data-a="joinCode"]').click();
});
