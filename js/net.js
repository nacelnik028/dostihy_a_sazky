// ============================================================
//  Síťová vrstva.
//
//  Bezpečnostní model:
//   - každý hráč je anonymně přihlášený (Firebase Auth) a má své uid,
//   - stav hry smí zapisovat JEN hostitel (hlídají to pravidla databáze),
//   - ostatní posílají do fronty jen žádosti o akci ("chci hodit kostkou"),
//     hostitelův prohlížeč je ověří herním enginem, sám hází kostkou a zapíše výsledek,
//   - když hostitel vypadne, roli převezme jiný hráč (pravidla to dovolí jen,
//     když je původní hostitel offline).
//   - hra vyprší po ROOM_TTL bez jediné akce. Vypršelou hru smí smazat kdokoli
//     (běžící ne, hlídají to pravidla), tím se uvolní i její kód pro novou hru.
//     Mažou ji prohlížeče hráčů: při otevření starého odkazu a při zakládání hry.
//
//  Stejné rozhraní má i lokální testovací backend (localStorage + záložky prohlížeče).
// ============================================================

const FB = '10.12.2';
export const DUP = '__dup__';
const REPLY_TIMEOUT = 15000;
// za jak dlouho bez akce hra vyprší (stejné číslo 86400000 je v database.rules.json)
export const ROOM_TTL = 24 * 60 * 60 * 1000;
const SWEEP_LIMIT = 10; // kolik vypršelých her smaže jedno založení hry (limit je i v pravidlech)

// čas poslední akce ve hře (u her z doby před zavedením expirace jen čas založení)
export function lastActivity(meta, active) {
  return Math.max((meta && meta.created) || 0, active || 0);
}

// Seznam členů místnosti pro pravidla databáze (jen členové smí převzít roli hostitele).
// Vyhození hráči v něm nejsou, i když ve stavu hry zůstávají jako vyřazení.
function membersOf(s) {
  const banned = new Set(s.banned || []);
  return Object.fromEntries(s.players.filter((p) => !banned.has(p.id)).map((p) => [p.id, true]));
}

export async function makeBackend({ local, config }) {
  if (local) return localBackend();
  if (!config || !config.apiKey || !config.databaseURL) throw new Error('NOCONFIG');
  return firebaseBackend(config);
}

// ---------------- Firebase ----------------
async function firebaseBackend(config) {
  const [appM, authM, db_] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FB}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FB}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FB}/firebase-database.js`),
  ]);
  const app = appM.initializeApp(config);
  const auth = authM.getAuth(app);
  // počkáme, až se obnoví případné předchozí přihlášení (stejné uid po obnovení stránky)
  const existing = await new Promise((res) => {
    const off = authM.onAuthStateChanged(auth, (u) => {
      off();
      res(u);
    });
  });
  const user = existing || (await authM.signInAnonymously(auth)).user;
  const uid = user.uid;

  const db = db_.getDatabase(app);
  const { ref, onValue, onChildAdded, runTransaction, set, update, push, remove, onDisconnect } = db_;
  const { serverTimestamp, get, query, orderByChild, endAt, limitToFirst } = db_;
  const R = (code, path = '') => ref(db, `rooms/${code}${path ? '/' + path : ''}`);
  const pending = new Map();
  // odchylka hodin zařízení od serveru, ať expirace nezávisí na špatně nastaveném čase
  let offset = 0;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => (offset = Number(snap.val()) || 0));
  const now = () => Date.now() + offset;

  // smaže celou hru i s přítomností hráčů; pravidla to dovolí jen u vypršelé hry
  async function dropRoom(code) {
    try {
      await update(ref(db), { [`rooms/${code}`]: null, [`presence/${code}`]: null });
      return true;
    } catch {
      return false;
    }
  }

  return {
    kind: 'firebase',
    uid,
    now,
    dropRoom,

    async createRoom(code, state) {
      await dropRoom(code); // když kód patří vypršelé hře, uvolní ho; běžící hru pravidla smazat nedovolí
      try {
        await set(R(code, 'meta'), { hostUid: uid, created: serverTimestamp() });
      } catch (e) {
        return false; // kód má běžící hra
      }
      await set(R(code, 'active'), serverTimestamp()).catch(() => {});
      await set(R(code, 'members'), { [uid]: true });
      await set(R(code, 'state'), { s: JSON.stringify(state), v: 1 });
      return true;
    },

    watchRoom(code, h) {
      const offs = [];
      offs.push(
        onValue(
          R(code, 'state'),
          (snap) => {
            const v = snap.val();
            h.onState(v ? JSON.parse(v.s) : null);
          },
          (e) => h.onError && h.onError(e)
        )
      );
      offs.push(onValue(R(code, 'meta'), (snap) => h.onMeta(snap.val())));
      offs.push(onValue(R(code, 'active'), (snap) => h.onActive(snap.val())));
      offs.push(onValue(ref(db, `presence/${code}`), (snap) => h.onPresence(snap.val() || {})));
      offs.push(
        onValue(R(code, `replies/${uid}`), (snap) => {
          const r = snap.val();
          if (r && pending.has(r.id)) {
            pending.get(r.id)(r.err || null);
            pending.delete(r.id);
          }
        })
      );
      const mine = ref(db, `presence/${code}/${uid}`);
      offs.push(
        onValue(ref(db, '.info/connected'), (snap) => {
          if (snap.val() !== true) return;
          onDisconnect(mine)
            .remove()
            .then(() => set(mine, true))
            .catch(() => {});
        })
      );
      return () => {
        offs.forEach((f) => f());
        remove(mine).catch(() => {});
      };
    },

    // pošle žádost o akci a počká na odpověď hostitele (null = OK, jinak text chyby)
    async send(code, action) {
      const r = push(R(code, 'actions'));
      const id = r.key;
      const answer = new Promise((res) => {
        pending.set(id, res);
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          remove(r).catch(() => {});
          res('Hostitel neodpovídá. Zkus to prosím za chvíli znovu.');
        }, REPLY_TIMEOUT);
      });
      try {
        await set(r, { uid, a: JSON.stringify(action), t: Date.now() });
      } catch (e) {
        pending.delete(id);
        return 'Akci se nepodařilo odeslat: ' + e.message;
      }
      return answer;
    },

    // --- jen pro hostitele ---
    hostListen(code, cb) {
      return onChildAdded(
        R(code, 'actions'),
        (snap) => {
          const v = snap.val();
          if (v) cb(snap.key, v.uid, v.a);
        },
        (e) => console.warn('hostListen', e)
      );
    },

    async hostProcess(code, id, actor, fn) {
      let err = null;
      let newState = null;
      await runTransaction(
        R(code, 'state'),
        (cur) => {
          err = null;
          newState = null;
          if (cur === null) return null; // cache ještě není načtená – server transakci zopakuje
          const s = JSON.parse(cur.s);
          const res = fn(s);
          if (res === DUP) return;
          if (res) {
            err = res;
            return;
          }
          newState = s;
          return { s: JSON.stringify(s), v: (cur.v || 0) + 1 };
        },
        { applyLocally: false }
      );
      const upd = {
        [`actions/${id}`]: null,
        [`replies/${actor}`]: { id, err: err || null, t: Date.now() },
      };
      if (newState) upd.members = membersOf(newState);
      await update(R(code), upd);
      // čas poslední akce; zvlášť, aby tah nerozbila ještě nenahraná pravidla bez uzlu "active"
      set(R(code, 'active'), serverTimestamp()).catch(() => {});
    },

    async claimHost(code, created) {
      try {
        await set(R(code, 'meta'), { hostUid: uid, created });
        return true;
      } catch (e) {
        return false;
      }
    },

    // smaže pár vypršelých her, aby se databáze neplnila a kódy se uvolňovaly
    async sweep() {
      try {
        const cutoff = now() - ROOM_TTL - 60000; // rezerva, ať pravidla dotaz určitě pustí
        const snap = await get(query(ref(db, 'rooms'), orderByChild('active'), endAt(cutoff), limitToFirst(SWEEP_LIMIT)));
        await Promise.all(Object.keys(snap.val() || {}).map(dropRoom));
      } catch (e) {
        console.warn('Úklid vypršelých her se nepovedl:', e.message);
      }
    },
  };
}

// ---------------- Lokální testovací režim ----------------
function localBackend() {
  let uid = null;
  try {
    uid = sessionStorage.getItem('ds_local_uid');
    if (!uid) {
      uid = 'L' + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('ds_local_uid', uid);
    }
  } catch {
    uid = 'L' + Math.random().toString(36).slice(2, 12);
  }

  const K = (c, k) => `ds:${c}:${k}`;
  const rd = (k) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  const listeners = new Set();
  const fire = (key, val) => {
    for (const l of listeners) if (key.startsWith(l.prefix)) l.cb(key, val);
  };
  const wr = (k, v) => {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
    fire(k, v);
  };
  const on = (prefix, cb) => {
    const l = { prefix, cb };
    listeners.add(l);
    return () => listeners.delete(l);
  };
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    let v = null;
    try {
      v = e.newValue ? JSON.parse(e.newValue) : null;
    } catch {}
    fire(e.key, v);
  });
  const pending = new Map();
  const online = (c, who) => Date.now() - (Number(localStorage.getItem(K(c, 'pres:' + who))) || 0) < 6000;
  // napodobuje pravidla databáze: smazat jde jen vypršelou (nebo neúplnou) hru
  const dropRoom = async (c) => {
    const m = rd(K(c, 'meta'));
    if (m && Date.now() - lastActivity(m, rd(K(c, 'active'))) <= ROOM_TTL) return false;
    const pre = `ds:${c}:`;
    const keys = [];
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key && key.startsWith(pre)) keys.push(key);
    }
    keys.forEach((k) => wr(k, null));
    return true;
  };

  return {
    kind: 'local',
    uid,
    now: () => Date.now(),
    dropRoom,

    async createRoom(c, state) {
      await dropRoom(c);
      if (rd(K(c, 'meta'))) return false;
      wr(K(c, 'meta'), { hostUid: uid, created: Date.now() });
      wr(K(c, 'active'), Date.now());
      wr(K(c, 'members'), { [uid]: true });
      wr(K(c, 'state'), { s: JSON.stringify(state), v: 1 });
      return true;
    },

    watchRoom(c, h) {
      const offs = [];
      let sig = null;
      const emitState = () => {
        const v = rd(K(c, 'state'));
        h.onState(v ? JSON.parse(v.s) : null);
      };
      const emitMeta = () => h.onMeta(rd(K(c, 'meta')));
      const emitActive = () => h.onActive(rd(K(c, 'active')));
      const emitPres = () => {
        const out = {};
        const pre = K(c, 'pres:');
        for (let k = 0; k < localStorage.length; k++) {
          const key = localStorage.key(k);
          if (key && key.startsWith(pre) && online(c, key.slice(pre.length))) out[key.slice(pre.length)] = true;
        }
        const ns = Object.keys(out).sort().join(',');
        if (ns !== sig) {
          sig = ns;
          h.onPresence(out);
        }
      };
      offs.push(on(K(c, 'state'), emitState));
      offs.push(on(K(c, 'meta'), emitMeta));
      offs.push(on(K(c, 'active'), emitActive));
      offs.push(on(K(c, 'pres:'), emitPres));
      offs.push(
        on(K(c, 'rep:' + uid), (k, r) => {
          if (r && pending.has(r.id)) {
            pending.get(r.id)(r.err || null);
            pending.delete(r.id);
          }
        })
      );
      const beat = () => {
        localStorage.setItem(K(c, 'pres:' + uid), String(Date.now()));
        emitPres();
      };
      const bye = () => localStorage.removeItem(K(c, 'pres:' + uid));
      beat();
      const t = setInterval(beat, 2000);
      window.addEventListener('beforeunload', bye);
      setTimeout(() => {
        emitMeta();
        emitActive();
        emitState();
      });
      return () => {
        offs.forEach((f) => f());
        clearInterval(t);
        bye();
        window.removeEventListener('beforeunload', bye);
      };
    },

    async send(c, action) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const answer = new Promise((res) => {
        pending.set(id, res);
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          localStorage.removeItem(K(c, 'act:' + id));
          res('Hostitel neodpovídá. Zkus to prosím za chvíli znovu.');
        }, REPLY_TIMEOUT);
      });
      wr(K(c, 'act:' + id), { uid, a: JSON.stringify(action), t: Date.now() });
      return answer;
    },

    hostListen(c, cb) {
      const pre = K(c, 'act:');
      const seen = new Set();
      const got = (key, v) => {
        if (!v) return;
        const id = key.slice(pre.length);
        if (seen.has(id)) return;
        seen.add(id);
        cb(id, v.uid, v.a);
      };
      const keys = [];
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        if (key && key.startsWith(pre)) keys.push(key);
      }
      keys.sort().forEach((k) => got(k, rd(k)));
      return on(pre, got);
    },

    async hostProcess(c, id, actor, fn) {
      const cur = rd(K(c, 'state'));
      let err = null;
      let newState = null;
      if (cur) {
        const s = JSON.parse(cur.s);
        const res = fn(s);
        if (res && res !== DUP) err = res;
        else if (!res) {
          newState = s;
          wr(K(c, 'state'), { s: JSON.stringify(s), v: cur.v + 1 });
        }
      } else err = 'Hra neexistuje.';
      wr(K(c, 'act:' + id), null);
      if (newState) wr(K(c, 'members'), membersOf(newState));
      wr(K(c, 'rep:' + actor), { id, err, t: Date.now() });
      if (cur) wr(K(c, 'active'), Date.now());
    },

    // napodobuje pravidla databáze: převzít lze jen, když je hostitel offline a já jsem hráč
    async claimHost(c, created) {
      const m = rd(K(c, 'meta'));
      const members = rd(K(c, 'members')) || {};
      if (!m || online(c, m.hostUid) || !members[uid]) return false;
      wr(K(c, 'meta'), { hostUid: uid, created: m.created });
      return true;
    },

    async sweep() {
      const codes = new Set();
      for (let k = 0; k < localStorage.length; k++) {
        const m = (localStorage.key(k) || '').match(/^ds:([A-Z0-9]{5}):/);
        if (m) codes.add(m[1]);
      }
      for (const c of codes) await dropRoom(c);
    },
  };
}
