// ============================================================
//  Herní logika. Nepracuje s DOM ani se sítí.
//  Stav hry je jeden JSON objekt; akce ho mění přes applyAction().
// ============================================================
import { BOARD, STABLES, RULES, CARDS, DECKS, PLAYER_COLORS } from './config.js';

// ---------- pomocné tabulky ----------
function indexesOf(type) {
  return BOARD.map((b, i) => (b.type === type ? i : -1)).filter((i) => i >= 0);
}
export const STABLE_SQ = STABLES.map((_, st) =>
  BOARD.map((b, i) => (b.type === 'horse' && b.stable === st ? i : -1)).filter((i) => i >= 0)
);
export const JOCKEYS = indexesOf('jockey');
export const SERVICES = indexesOf('service');
const OWNABLE = new Set(['horse', 'jockey', 'service']);
export const isOwnable = (i) => !!BOARD[i] && OWNABLE.has(BOARD[i].type);
const JAIL_POS = BOARD.findIndex((b) => b.type === 'jail');

// ---------- formátování ----------
export function fmtN(n) {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 ? '−' : '') + s;
}
export const fmt = (n) => fmtN(n) + ' Kč';
export const cardText = (c) => c.t.replace(/\{(\d+)\}/g, (_, n) => BOARD[+n].name);
const pn = (id) => `{p:${id}}`;

// ---------- ceny ----------
export const trainingCost = (i) => RULES.trainingCost[BOARD[i].stable];
export const sellValue = (i) => Math.round(trainingCost(i) * RULES.sellRate);
export const propSellValue = (i) => Math.round(BOARD[i].price * RULES.propertySellRate);

// ---------- hráči ----------
export const getP = (s, id) => s.players.find((p) => p.id === id);
export const curP = (s) => s.players[s.turn];
export const activeP = (s) => s.players.filter((p) => !p.bankrupt);
export const ownsStable = (s, pid, st) => STABLE_SQ[st].every((j) => s.owner[j] === pid);
export const debtOf = (s, pid) => s.debts.filter((d) => d.d === pid).reduce((x, d) => x + d.a, 0);

export function netWorth(s, pid) {
  const p = getP(s, pid);
  let w = p.money;
  for (let i = 0; i < 40; i++) {
    if (s.owner[i] !== pid) continue;
    w += BOARD[i].price;
    if (s.level[i]) w += s.level[i] * trainingCost(i);
  }
  return w;
}

// kolik peněz může hráč nejvýš sehnat (prodej tréninků a majetku bance)
export function liquidation(s, pid) {
  const p = getP(s, pid);
  let w = p.money;
  for (let i = 0; i < 40; i++) {
    if (s.owner[i] !== pid) continue;
    if (s.level[i]) w += s.level[i] * sellValue(i);
    w += propSellValue(i);
  }
  return w;
}

export function rentFor(s, i, diceTotal, opts = {}) {
  const b = BOARD[i];
  const owner = s.owner[i];
  if (!owner || s.mortgaged[i]) return 0;
  if (b.type === 'horse') {
    // majitel, který vynechává tah, bere jen základní poplatek (bez tréninků)
    const lv = getP(s, owner).skip > 0 ? 0 : s.level[i];
    if (lv > 0) return b.rent[lv];
    return ownsStable(s, owner, b.stable) ? b.rent[0] * 2 : b.rent[0];
  }
  if (b.type === 'jockey') {
    const n = JOCKEYS.filter((j) => s.owner[j] === owner).length;
    return RULES.jockeyRent[n] * (opts.double ? 2 : 1);
  }
  if (b.type === 'service') {
    const n = SERVICES.filter((j) => s.owner[j] === owner).length;
    return diceTotal * (opts.serviceMult || RULES.serviceMult[n]);
  }
  return 0;
}

// ---------- nový stav ----------
function newPlayer(id, name, color) {
  return { id, name, color, money: 0, pos: 0, jail: false, skip: 0, bankrupt: false, passes: [] };
}

function cleanName(n) {
  return String(n || '')
    .replace(/[\u0000-\u001f{}<>]/g, '')
    .trim()
    .slice(0, 16);
}

export function newRoom(hostId, hostName, color) {
  const s = {
    v: 1,
    phase: 'lobby', // lobby | playing | over
    hostId,
    settings: { startMoney: RULES.startMoney, startBonus: RULES.startBonus, limitType: 'none', limitValue: 0 },
    players: [],
    turn: 0,
    round: 1,
    stage: 'roll', // roll | buy | done
    owner: Array(40).fill(null),
    level: Array(40).fill(0), // 0–4 tréninky, 5 = Velká cena
    mortgaged: Array(40).fill(false),
    decks: {},
    dice: [],
    buySq: null,
    landSq: null, // vlastní kůň, na kterém hráč v tomto tahu zastavil (jen tam smí koupit tréninky)
    debts: [], // {d: dlužník, c: věřitel|null (banka), a: částka}
    trade: null,
    tradeSeq: 0,
    events: [],
    evSeq: 0,
    log: [],
    logSeq: 0,
    lastCard: null,
    startedAt: null,
    ranking: null,
    out: [],
  };
  s.players.push(newPlayer(hostId, cleanName(hostName) || 'Hostitel', pickColor(s, color)));
  return s;
}

function pickColor(s, wanted) {
  const used = new Set(s.players.map((p) => p.color));
  if (PLAYER_COLORS.some((c) => c.hex === wanted) && !used.has(wanted)) return wanted;
  return (PLAYER_COLORS.find((c) => !used.has(c.hex)) || PLAYER_COLORS[0]).hex;
}

// ---------- interní pomocníci ----------
function log(s, m) {
  s.log.push({ i: ++s.logSeq, m });
  if (s.log.length > 150) s.log.splice(0, s.log.length - 150);
}

// události pro animaci (kostky, pohyb, karta) – každá akce má vlastní sadu
function ev(s, e) {
  if (!s._ev) {
    s._ev = true;
    s.events = [];
    s.evSeq++;
  }
  s.events.push(e);
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rollDie = (ctx) => 1 + Math.floor(ctx.rng() * 6);

// padne-li 6, hází se znovu a hody se sčítají; dvě šestky po sobě = karanténa
function rollSeq(ctx) {
  const dice = [];
  while (dice.length < 2) {
    const d = rollDie(ctx);
    dice.push(d);
    if (d !== 6) break;
  }
  return dice;
}

function charge(s, payer, amount, creditor) {
  if (amount <= 0) return;
  if (creditor && getP(s, creditor).bankrupt) creditor = null;
  const p = getP(s, payer);
  if (p.money >= amount && !s.debts.some((d) => d.d === payer)) {
    p.money -= amount;
    if (creditor) getP(s, creditor).money += amount;
  } else {
    s.debts.push({ d: payer, c: creditor, a: amount });
    log(s, `${pn(payer)} nemá na zaplacení ${fmt(amount)} → ${creditor ? pn(creditor) : 'bance'}. Musí sehnat peníze.`);
  }
}

function settleDebts(s) {
  let changed = true;
  while (changed && s.debts.length) {
    changed = false;
    const blocked = new Set();
    s.debts = s.debts.filter((d) => {
      if (blocked.has(d.d)) return true;
      const p = getP(s, d.d);
      if (!p || p.bankrupt) {
        changed = true;
        return false;
      }
      if (p.money >= d.a) {
        p.money -= d.a;
        const c = d.c && getP(s, d.c);
        if (c && !c.bankrupt) c.money += d.a;
        log(s, `${pn(d.d)} splácí dluh ${fmt(d.a)}.`);
        changed = true;
        return false;
      }
      blocked.add(d.d);
      return true;
    });
  }
}

function sendToJail(s, p) {
  p.pos = JAIL_POS;
  p.jail = true;
  ev(s, { k: 'jump', pid: p.id, to: JAIL_POS });
}

function move(s, p, steps, ctx, opts) {
  const from = p.pos;
  if (steps > 0 && from + steps >= 40) {
    p.money += s.settings.startBonus;
    log(s, `${pn(p.id)} projíždí Startem a dostává ${fmt(s.settings.startBonus)}.`);
  }
  p.pos = (((from + steps) % 40) + 40) % 40;
  if (steps) ev(s, { k: 'walk', pid: p.id, from, steps });
  land(s, p, ctx, opts || {});
}

function moveTo(s, p, target, ctx, opts) {
  move(s, p, (target - p.pos + 40) % 40, ctx, opts);
}

function land(s, p, ctx, opts) {
  const i = p.pos;
  const b = BOARD[i];
  if (OWNABLE.has(b.type)) {
    const o = s.owner[i];
    if (!o) {
      s.buySq = i;
      s.stage = 'buy';
      return;
    }
    if (o === p.id) {
      if (b.type === 'horse') s.landSq = i;
      return;
    }
    const total = s.dice.reduce((x, y) => x + y, 0);
    const amt = rentFor(s, i, total, opts);
    if (amt > 0) {
      log(s, `${pn(p.id)} platí ${fmt(amt)} za ${b.name} → ${pn(o)}.`);
      charge(s, p.id, amt, o);
    }
    return;
  }
  if (b.type === 'card') return drawCard(s, p, b.deck, ctx);
  if (b.type === 'tax') {
    log(s, `${pn(p.id)} platí ${b.acc} ${fmt(b.amount)}.`);
    charge(s, p.id, b.amount, null);
    return;
  }
  if (b.type === 'skip') {
    p.skip = 1;
    log(s, `🩹 ${pn(p.id)}: kůň kulhá – příští tah se vynechává. Do té doby jen základní poplatky za koně.`);
  }
}

// Balíček si pamatuje jen to, které karty v něm zbývají (ne pořadí).
// Karta se losuje až při tažení, takže pořadí nejde ze stavu hry vyčíst.
function refillDeck(s, deck) {
  const held = new Set(s.players.flatMap((pl) => pl.passes.filter((x) => x.deck === deck).map((x) => x.id)));
  s.decks[deck] = CARDS[deck].map((_, i) => i).filter((i) => !held.has(i));
}

function drawCard(s, p, deck, ctx) {
  if (!s.decks[deck] || !s.decks[deck].length) refillDeck(s, deck);
  const pile = s.decks[deck];
  if (!pile.length) return;
  const id = pile.splice(Math.floor(ctx.rng() * pile.length), 1)[0];
  const c = CARDS[deck][id];
  s.lastCard = { deck, id, pid: p.id };
  ev(s, { k: 'card', deck, id, pid: p.id });
  log(s, `${pn(p.id)} – ${DECKS[deck].icon} ${DECKS[deck].name}: „${cardText(c)}“`);
  applyCard(s, p, c, deck, id, ctx);
}

function applyCard(s, p, c, deck, id, ctx) {
  const others = activeP(s).filter((q) => q.id !== p.id);
  switch (c.e) {
    case 'money':
      if (c.a >= 0) p.money += c.a;
      else charge(s, p.id, -c.a, null);
      break;
    case 'collectEach':
      for (const q of others) charge(s, q.id, c.a, p.id);
      break;
    case 'payEach':
      for (const q of others) charge(s, p.id, c.a, q.id);
      break;
    case 'repairs': {
      let t = 0;
      let g = 0;
      s.owner.forEach((o, i) => {
        if (o === p.id && s.level[i]) {
          if (s.level[i] === 5) g++;
          else t += s.level[i];
        }
      });
      const amt = t * c.tr + g * c.vc;
      if (amt) {
        log(s, `${pn(p.id)} platí ${fmt(amt)} (tréninky: ${t}, Velké ceny: ${g}).`);
        charge(s, p.id, amt, null);
      } else log(s, `${pn(p.id)} nemá žádné tréninky – nic neplatí.`);
      break;
    }
    case 'perHorse': {
      const n = s.owner.filter((o, i) => o === p.id && BOARD[i].type === 'horse').length;
      if (n) {
        log(s, `${pn(p.id)} platí ${fmt(n * c.a)} (koně: ${n}).`);
        charge(s, p.id, n * c.a, null);
      } else log(s, `${pn(p.id)} nemá žádné koně – nic neplatí.`);
      break;
    }
    case 'moveTo':
      moveTo(s, p, c.to, ctx, {});
      break;
    case 'moveBy':
      move(s, p, c.n, ctx, {});
      break;
    case 'jail':
      sendToJail(s, p);
      break;
    case 'nearest': {
      const list = c.kind === 'jockey' ? JOCKEYS : SERVICES;
      const target = list.find((i) => i > p.pos) ?? list[0];
      moveTo(s, p, target, ctx, c.kind === 'jockey' ? { double: true } : { serviceMult: RULES.cardServiceMult });
      break;
    }
    case 'pass':
      p.passes.push({ deck, id });
      break;
  }
}

function moveByDice(s, p, dice, ctx) {
  s.dice = dice;
  s.landSq = null;
  ev(s, { k: 'dice', pid: p.id, v: dice });
  s.stage = 'done';
  if (dice.length === 2 && dice.every((d) => d === 6)) {
    log(s, `${pn(p.id)} hází dvě šestky po sobě a jde do karantény!`);
    sendToJail(s, p);
    return;
  }
  const total = dice.reduce((x, y) => x + y, 0);
  log(s, `${pn(p.id)} hází ${dice.join(' + ')}${dice.length > 1 ? ` = ${total}` : ''}.`);
  move(s, p, total, ctx, {});
}

// z karantény ven jen šestkou; po ní se hází znovu a táhne se podle nového hodu
function jailRoll(s, p, ctx) {
  const d = rollDie(ctx);
  s.dice = [d];
  ev(s, { k: 'dice', pid: p.id, v: [d] });
  if (d === 6) {
    p.jail = false;
    log(s, `${pn(p.id)} hází šestku a opouští karanténu! Hází znovu.`);
    moveByDice(s, p, rollSeq(ctx), ctx);
    return;
  }
  s.stage = 'done';
  log(s, `${pn(p.id)} hází ${d} a zůstává v karanténě.`);
}

function nextTurn(s, ctx) {
  const n = s.players.length;
  const st = s.settings;
  let i = s.turn;
  for (let guard = 0; guard < n * 3; guard++) {
    i = (i + 1) % n;
    if (i === 0) {
      s.round++;
      const over =
        (st.limitType === 'rounds' && s.round > st.limitValue) ||
        (st.limitType === 'minutes' && ctx.now - s.startedAt >= st.limitValue * 60000);
      if (over) return endGame(s, 'limit');
    }
    const p = s.players[i];
    if (p.bankrupt) continue;
    if (p.skip > 0) {
      p.skip--;
      log(s, `🩹 ${pn(p.id)} vynechává tah.`);
      continue;
    }
    break;
  }
  s.turn = i;
  s.stage = 'roll';
  s.dice = [];
  s.buySq = null;
  s.landSq = null;
  log(s, `Na tahu je ${pn(s.players[i].id)}.`);
}

function endGame(s, why) {
  s.phase = 'over';
  s.trade = null;
  s.debts = [];
  const alive = activeP(s)
    .map((p) => ({ id: p.id, worth: netWorth(s, p.id) }))
    .sort((a, b) => b.worth - a.worth);
  const dead = [...s.out].reverse().map((id) => ({ id, worth: 0 }));
  s.ranking = [...alive, ...dead];
  if (!alive.length) return;
  if (why === 'limit') log(s, `⏱️ Konec hry! Vítězí ${pn(alive[0].id)} s jměním ${fmt(alive[0].worth)}.`);
  else log(s, `🏆 Vítězem je ${pn(alive[0].id)}!`);
}

function goBankrupt(s, pid, creditor, ctx) {
  const p = getP(s, pid);
  if (creditor && getP(s, creditor).bankrupt) creditor = null;
  const c = creditor ? getP(s, creditor) : null;
  let cash = p.money;
  for (let i = 0; i < 40; i++) {
    if (s.owner[i] !== pid) continue;
    if (s.level[i]) cash += s.level[i] * sellValue(i);
    s.level[i] = 0;
    if (c) s.owner[i] = c.id;
    else {
      s.owner[i] = null;
      s.mortgaged[i] = false;
    }
  }
  p.money = 0;
  if (c) {
    c.money += cash;
    c.passes.push(...p.passes);
  }
  p.passes = [];
  p.bankrupt = true;
  p.jail = false;
  p.skip = 0;
  s.out.push(pid);
  s.debts = s.debts.filter((d) => d.d !== pid);
  for (const d of s.debts) if (d.c === pid) d.c = null;
  if (s.trade && (s.trade.from === pid || s.trade.to === pid)) s.trade = null;
  log(s, c ? `💀 Bankrot: ${pn(pid)} končí, majetek přebírá ${pn(c.id)}.` : `💀 Bankrot: ${pn(pid)} končí, majetek se vrací bance.`);
  if (activeP(s).length <= 1) return endGame(s, 'last');
  if (curP(s).id === pid) nextTurn(s, ctx);
}

// ---------- validace (používá ji i UI) ----------
function turnErr(s, id) {
  if (s.phase !== 'playing') return 'Hra neběží.';
  const p = getP(s, id);
  if (!p || p.bankrupt) return 'Nejsi ve hře.';
  if (curP(s).id !== id) return 'Nejsi na tahu.';
  if (s.debts.length) return 'Nejdřív se musí splatit dluhy.';
  if (s.trade) return 'Nejdřív vyřeš rozjednaný obchod.';
  return null;
}

// kind: 'raise' (prodej tréninku nebo majetku bance) | 'spend' (nákup tréninku)
export function manageError(s, pid, kind) {
  if (s.phase !== 'playing') return 'Hra neběží.';
  const p = getP(s, pid);
  if (!p || p.bankrupt) return 'Nejsi ve hře.';
  if (s.debts.length) {
    if (!s.debts.some((d) => d.d === pid)) return 'Čeká se na splacení dluhu.';
    return kind === 'spend' ? 'Nejdřív splať dluh.' : null;
  }
  if (curP(s).id !== pid) return 'Majetek můžeš spravovat jen na svém tahu.';
  if (s.trade) return 'Probíhá obchod.';
  return null;
}

export function buildError(s, pid, i) {
  const e = manageError(s, pid, 'spend');
  if (e) return e;
  const b = BOARD[i];
  if (!b || b.type !== 'horse') return 'Trénovat lze jen koně.';
  if (s.owner[i] !== pid) return 'Kůň ti nepatří.';
  if (!ownsStable(s, pid, b.stable)) return 'Musíš vlastnit celou stáj.';
  if (s.landSq !== i || s.stage !== 'done') return 'Tréninky koupíš, jen když na tohoto koně v tahu stoupneš.';
  if (s.level[i] >= 5) return 'Kůň už má Velkou cenu.';
  if (getP(s, pid).money < trainingCost(i)) return 'Nemáš dost peněz.';
  return null;
}

export function sellError(s, pid, i) {
  const e = manageError(s, pid, 'raise');
  if (e) return e;
  const b = BOARD[i];
  if (!b || b.type !== 'horse' || s.owner[i] !== pid) return 'Kůň ti nepatří.';
  if (s.level[i] <= 0) return 'Kůň nemá žádný trénink.';
  return null;
}

// prodej koně / žokeje / služby zpět bance za plnou cenu (stáj s tréninky nejde rozdělit)
export function sellPropError(s, pid, i) {
  const e = manageError(s, pid, 'raise');
  if (e) return e;
  if (!isOwnable(i) || s.owner[i] !== pid) return 'Nepatří ti.';
  if (tradeBlocked(s, i)) return 'Nejdřív prodej tréninky v celé stáji.';
  return null;
}

export const tradeBlocked = (s, i) =>
  BOARD[i].type === 'horse' && STABLE_SQ[BOARD[i].stable].some((j) => s.level[j] > 0);

export function itemsError(s, owner, it) {
  const p = getP(s, owner);
  for (const i of it.sq) {
    if (!isOwnable(i) || s.owner[i] !== owner) return 'Nabízený majetek už nepatří původnímu majiteli.';
    if (tradeBlocked(s, i)) return `${BOARD[i].name}: ve stáji jsou tréninky, nejdřív je prodej.`;
  }
  if (!Number.isInteger(it.money) || it.money < 0) return 'Neplatná částka.';
  if (p.money < it.money) return `${p.name} nemá tolik peněz.`;
  if (it.passes > p.passes.length) return 'Neplatný počet propustek.';
  return null;
}

function cleanItems(x) {
  x = x || {};
  return {
    sq: [...new Set((Array.isArray(x.sq) ? x.sq : []).filter((i) => Number.isInteger(i) && isOwnable(i)))],
    money: Math.max(0, Math.floor(Number(x.money) || 0)),
    passes: Math.max(0, Math.floor(Number(x.passes) || 0)),
  };
}

const sqIndex = (a) => (Number.isInteger(a.i) && a.i >= 0 && a.i < 40 ? a.i : -1);

// ---------- akce ----------
const ACTIONS = {
  // prázdná akce – nový hostitel ji pošle po převzetí, aby se zapsal do stavu
  ping() {
    return null;
  },

  // --- lobby ---
  join(s, id, a) {
    if (s.phase !== 'lobby') return 'Hra už začala.';
    if (getP(s, id)) return null;
    if (s.players.length >= RULES.maxPlayers) return `Hra je plná (max. ${RULES.maxPlayers} hráčů).`;
    const name = cleanName(a.name);
    if (!name) return 'Zadej jméno.';
    if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return 'Toto jméno už někdo má.';
    s.players.push(newPlayer(id, name, pickColor(s, a.color)));
    log(s, `${pn(id)} se připojuje ke hře.`);
  },

  update(s, id, a) {
    if (s.phase !== 'lobby') return 'Hra už začala.';
    const p = getP(s, id);
    if (!p) return 'Nejsi ve hře.';
    if (a.name !== undefined) {
      const name = cleanName(a.name);
      if (!name) return 'Zadej jméno.';
      if (s.players.some((q) => q !== p && q.name.toLowerCase() === name.toLowerCase())) return 'Toto jméno už někdo má.';
      p.name = name;
    }
    if (a.color !== undefined) {
      if (!PLAYER_COLORS.some((c) => c.hex === a.color)) return 'Neplatná barva.';
      if (s.players.some((q) => q !== p && q.color === a.color)) return 'Tuto barvu už má někdo jiný.';
      p.color = a.color;
    }
  },

  leave(s, id) {
    if (s.phase !== 'lobby') return 'Hra už běží.';
    const idx = s.players.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    log(s, `${s.players[idx].name} odchází z lobby.`);
    s.players.splice(idx, 1);
    if (s.hostId === id) s.hostId = s.players[0] ? s.players[0].id : null;
  },

  settings(s, id, a) {
    if (s.phase !== 'lobby') return 'Hra už běží.';
    if (id !== s.hostId) return 'Nastavení mění hostitel.';
    const st = s.settings;
    if ([20000, 30000, 40000, 50000].includes(a.startMoney)) st.startMoney = a.startMoney;
    if ([2000, 3000, 4000, 5000].includes(a.startBonus)) st.startBonus = a.startBonus;
    if (['none', 'rounds', 'minutes'].includes(a.limitType)) {
      st.limitType = a.limitType;
      st.limitValue = a.limitType === 'none' ? 0 : Math.max(5, Math.min(300, a.limitValue | 0));
    }
  },

  start(s, id, a, ctx) {
    if (s.phase !== 'lobby') return 'Hra už běží.';
    if (id !== s.hostId) return 'Hru spouští hostitel.';
    if (s.players.length < RULES.minPlayers) return `Jsou potřeba aspoň ${RULES.minPlayers} hráči.`;
    shuffle(s.players, ctx.rng);
    for (const p of s.players) {
      Object.assign(p, { money: s.settings.startMoney, pos: 0, jail: false, skip: 0, bankrupt: false, passes: [] });
    }
    s.owner = Array(40).fill(null);
    s.level = Array(40).fill(0);
    s.mortgaged = Array(40).fill(false);
    s.decks = {};
    for (const d of Object.keys(CARDS)) refillDeck(s, d);
    Object.assign(s, {
      phase: 'playing',
      turn: 0,
      round: 1,
      stage: 'roll',
      dice: [],
      buySq: null,
      landSq: null,
      debts: [],
      trade: null,
      lastCard: null,
      out: [],
      ranking: null,
      startedAt: ctx.now,
    });
    log(s, `🏁 Hra začíná! Pořadí: ${s.players.map((p) => pn(p.id)).join(', ')}.`);
    log(s, `Na tahu je ${pn(s.players[0].id)}.`);
  },

  rematch(s, id) {
    if (s.phase !== 'over') return 'Hra ještě neskončila.';
    if (!getP(s, id)) return 'Nejsi ve hře.';
    if (!getP(s, s.hostId)) s.hostId = id;
    for (const p of s.players) Object.assign(p, { money: 0, pos: 0, jail: false, skip: 0, bankrupt: false, passes: [] });
    Object.assign(s, { phase: 'lobby', ranking: null, out: [], trade: null, debts: [], lastCard: null, dice: [] });
    log(s, '🔁 Nová hra – čeká se na spuštění.');
  },

  // --- tah ---
  roll(s, id, a, ctx) {
    const e = turnErr(s, id);
    if (e) return e;
    if (s.stage !== 'roll') return 'V tomto tahu už bylo hozeno.';
    const p = getP(s, id);
    if (p.jail) jailRoll(s, p, ctx);
    else moveByDice(s, p, rollSeq(ctx, []), ctx);
  },

  jailPass(s, id) {
    const e = turnErr(s, id);
    if (e) return e;
    const p = getP(s, id);
    if (!p.jail || s.stage !== 'roll') return 'Teď to nejde.';
    if (!p.passes.length) return 'Nemáš propustku.';
    p.passes.shift();
    p.jail = false;
    log(s, `${pn(id)} používá propustku a opouští karanténu.`);
  },

  buy(s, id) {
    const e = turnErr(s, id);
    if (e) return e;
    if (s.stage !== 'buy') return 'Není co kupovat.';
    const i = s.buySq;
    const p = getP(s, id);
    const price = BOARD[i].price;
    if (p.money < price) return 'Nemáš dost peněz. Můžeš něco zastavit.';
    p.money -= price;
    s.owner[i] = id;
    s.buySq = null;
    s.stage = 'done';
    log(s, `${pn(id)} kupuje ${BOARD[i].name} za ${fmt(price)}.`);
  },

  skip(s, id) {
    const e = turnErr(s, id);
    if (e) return e;
    if (s.stage !== 'buy') return 'Není co odmítat.';
    log(s, `${pn(id)} nekupuje ${BOARD[s.buySq].name}.`);
    s.buySq = null;
    s.stage = 'done';
  },

  endTurn(s, id, a, ctx) {
    const e = turnErr(s, id);
    if (e) return e;
    if (s.stage === 'buy') return 'Nejdřív se rozhodni, jestli koupíš.';
    if (s.stage !== 'done') return 'Nejdřív hoď kostkou.';
    nextTurn(s, ctx);
  },

  // --- správa majetku ---
  build(s, id, a) {
    const i = sqIndex(a);
    const e = buildError(s, id, i);
    if (e) return e;
    getP(s, id).money -= trainingCost(i);
    s.level[i]++;
    log(s, s.level[i] === 5 ? `🏆 ${pn(id)} pořádá Velkou cenu – ${BOARD[i].name}!` : `${pn(id)} kupuje trénink – ${BOARD[i].name} (${s.level[i]}).`);
  },

  sell(s, id, a) {
    const i = sqIndex(a);
    const e = sellError(s, id, i);
    if (e) return e;
    s.level[i]--;
    getP(s, id).money += sellValue(i);
    log(s, `${pn(id)} prodává trénink – ${BOARD[i].name} (+${fmt(sellValue(i))}).`);
  },

  sellProp(s, id, a) {
    const i = sqIndex(a);
    const e = sellPropError(s, id, i);
    if (e) return e;
    s.owner[i] = null;
    s.mortgaged[i] = false;
    getP(s, id).money += propSellValue(i);
    log(s, `${pn(id)} prodává bance ${BOARD[i].name} (+${fmt(propSellValue(i))}).`);
  },

  bankrupt(s, id, a, ctx) {
    if (s.phase !== 'playing') return 'Hra neběží.';
    const d = s.debts.find((x) => x.d === id);
    if (!d) return 'Bankrot lze vyhlásit jen při dluhu.';
    goBankrupt(s, id, d.c, ctx);
  },

  // vyřazení hráče (např. odešel) nebo vzdání se (target === id).
  // Cizího hráče může vyřadit hostitel, ostatní jen toho, kdo je offline (ctx.online = Set online hráčů).
  kick(s, id, a, ctx) {
    if (s.phase === 'lobby') {
      if (id !== s.hostId) return 'Hráče z lobby může odebrat jen hostitel.';
      if (a.target === id) return 'Sám sebe odebrat nemůžeš – použij „Opustit hru“.';
      const idx = s.players.findIndex((p) => p.id === a.target);
      if (idx < 0) return 'Hráč už v lobby není.';
      log(s, `${s.players[idx].name} byl(a) odebrán(a) z lobby.`);
      s.players.splice(idx, 1);
      return null;
    }
    if (s.phase !== 'playing') return 'Hra neběží.';
    if (!getP(s, id)) return 'Nejsi ve hře.';
    const t = getP(s, a.target);
    if (!t || t.bankrupt) return 'Hráč už není ve hře.';
    if (a.target !== id && id !== s.hostId && ctx.online && ctx.online.has(a.target))
      return 'Vyřadit můžeš jen hráče, který je offline. Online hráče může vyřadit hostitel.';
    log(s, a.target === id ? `${pn(id)} to vzdává.` : `${pn(id)} vyřazuje ze hry ${pn(t.id)}.`);
    goBankrupt(s, t.id, null, ctx);
  },

  // --- obchod ---
  trade(s, id, a) {
    const e = turnErr(s, id);
    if (e) return e;
    if (s.stage === 'buy') return 'Nejdřív se rozhodni o koupi.';
    const to = getP(s, a.to);
    if (!to || to.bankrupt || to.id === id) return 'Neplatný obchodní partner.';
    const give = cleanItems(a.give);
    const want = cleanItems(a.want);
    const empty = (x) => !x.sq.length && !x.money && !x.passes;
    if (empty(give) && empty(want)) return 'Obchod je prázdný.';
    const err = itemsError(s, id, give) || itemsError(s, to.id, want);
    if (err) return err;
    s.trade = { id: ++s.tradeSeq, from: id, to: to.id, give, want };
    log(s, `🤝 ${pn(id)} nabízí obchod → ${pn(to.id)}.`);
  },

  cancelTrade(s, id) {
    if (!s.trade || s.trade.from !== id) return 'Nemáš žádnou nabídku.';
    s.trade = null;
    log(s, `${pn(id)} ruší nabídku obchodu.`);
  },

  rejectTrade(s, id) {
    if (!s.trade || s.trade.to !== id) return 'Nemáš žádnou nabídku.';
    log(s, `${pn(id)} odmítá obchod.`);
    s.trade = null;
  },

  acceptTrade(s, id) {
    const t = s.trade;
    if (!t || t.to !== id) return 'Nemáš žádnou nabídku.';
    if (s.debts.length) return 'Teď nelze obchodovat – čeká se na splacení dluhu.';
    const err = itemsError(s, t.from, t.give) || itemsError(s, t.to, t.want);
    if (err) return err;
    const A = getP(s, t.from);
    const B = getP(s, t.to);
    for (const i of t.give.sq) s.owner[i] = B.id;
    for (const i of t.want.sq) s.owner[i] = A.id;
    A.money += t.want.money - t.give.money;
    B.money += t.give.money - t.want.money;
    const fromA = A.passes.splice(0, t.give.passes);
    const fromB = B.passes.splice(0, t.want.passes);
    B.passes.push(...fromA);
    A.passes.push(...fromB);
    s.trade = null;
    log(s, `🤝 ${pn(A.id)} a ${pn(B.id)} uzavírají obchod.`);
  },
};

export function applyAction(s, actor, a, ctx) {
  const fn = a && ACTIONS[a.t];
  if (!fn) return 'Neznámá akce.';
  const err = fn(s, actor, a, ctx);
  if (err) return err;
  if (s.phase === 'playing') settleDebts(s);
  delete s._ev;
  return null;
}
