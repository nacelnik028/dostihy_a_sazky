// ============================================================
//  Zvuky hry – všechno se syntetizuje přes Web Audio API,
//  takže hra nepotřebuje žádné zvukové soubory.
// ============================================================

let ctx = null;
let master = null;
let verb = null;
let noiseBuf = null;
let enabled = readPref();

function readPref() {
  try {
    return localStorage.getItem('ds_sound') !== '0';
  } catch {
    return true;
  }
}

// Zvuky, které hrají i ve skryté záložce (upozornění).
const BACKGROUND = new Set(['yourTurn', 'trade', 'alarm', 'win', 'lose', 'gameStart']);

export const sound = {
  get on() {
    return enabled;
  },
  toggle() {
    enabled = !enabled;
    try {
      localStorage.setItem('ds_sound', enabled ? '1' : '0');
    } catch {}
    if (enabled) {
      unlock();
      play('click');
    }
    return enabled;
  },
};

// AudioContext jde vytvořit/spustit jen po akci uživatele (klik, klávesa).
export function unlock() {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.75;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(ctx.destination);
      verb = ctx.createConvolver();
      verb.buffer = impulse(1.8, 3.4);
      const vg = ctx.createGain();
      vg.gain.value = 0.22;
      verb.connect(vg);
      vg.connect(master);
      noiseBuf = makeNoise();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

export function play(name, delayMs = 0, arg) {
  if (!enabled || !SFX[name]) return;
  if (document.hidden && !BACKGROUND.has(name)) return;
  if (!ctx) unlock();
  if (!ctx || ctx.state === 'closed') return;
  const run = () => {
    try {
      SFX[name](arg);
    } catch (e) {
      console.warn('sound', name, e);
    }
  };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

// ---------- stavební kameny ----------
function impulse(sec, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * sec);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeNoise() {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function out(wet) {
  const g = ctx.createGain();
  g.connect(master);
  if (wet > 0) {
    const s = ctx.createGain();
    s.gain.value = wet;
    g.connect(s);
    s.connect(verb);
  }
  return g;
}

function env(g, t0, v, a, d) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
}

function tone({ f, f2, t = 0, d = 0.2, type = 'sine', v = 0.2, a = 0.005, wet = 0.15, lp }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  const g = ctx.createGain();
  env(g, t0, v, a, d);
  let node = o;
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    o.connect(fl);
    node = fl;
  }
  node.connect(g);
  g.connect(out(wet));
  o.start(t0);
  o.stop(t0 + d + 0.05);
}

function noise({ t = 0, d = 0.1, v = 0.2, f = 2000, f2, q = 1, type = 'bandpass', wet = 0.1, a = 0.002 }) {
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(f, t0);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  fl.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, v, a, d);
  src.connect(fl);
  fl.connect(g);
  g.connect(out(wet));
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + d + 0.05);
}

// zvon / cinknutí mince – několik neharmonických alikvót
function bell(f, t = 0, v = 0.1, d = 0.8, wet = 0.3) {
  const parts = [
    [1, 1, 1],
    [2, 0.45, 0.7],
    [2.76, 0.3, 0.5],
    [5.4, 0.12, 0.3],
  ];
  for (const [r, a, dd] of parts) tone({ f: f * r, t, d: d * dd, v: v * a, type: 'sine', a: 0.002, wet });
}

// žesťový tón (fanfáry, trubka)
function brass(f, t, d, v = 0.12, vib = 0) {
  const t0 = ctx.currentTime + t;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.035);
  g.gain.setValueAtTime(v * 0.85, t0 + Math.max(0.05, d - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.14);
  const fl = ctx.createBiquadFilter();
  fl.type = 'lowpass';
  fl.Q.value = 1.4;
  fl.frequency.setValueAtTime(f * 1.3, t0);
  fl.frequency.linearRampToValueAtTime(f * 5.5, t0 + 0.05);
  fl.frequency.exponentialRampToValueAtTime(f * 2.6, t0 + d + 0.1);
  fl.connect(g);
  g.connect(out(0.32));
  for (const det of [1, 1.005]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * det, t0);
    if (vib) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.setValueAtTime(0, t0);
      lg.gain.linearRampToValueAtTime(f * vib, t0 + d * 0.5);
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + d + 0.2);
    }
    o.connect(fl);
    o.start(t0);
    o.stop(t0 + d + 0.2);
  }
}

const N = {
  C4: 261.63, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093,
};

// ---------- jednotlivé zvuky ----------
const SFX = {
  click() {
    tone({ f: 1500, f2: 900, d: 0.04, type: 'triangle', v: 0.06, wet: 0 });
  },

  // chrastění kostek v dlani
  roll(ms = 700) {
    let t = 0;
    while (t < ms / 1000) {
      noise({ t, d: 0.035, v: 0.1 + Math.random() * 0.16, f: 2200 + Math.random() * 2800, q: 2.5, wet: 0.04 });
      tone({ t, f: 650 + Math.random() * 800, d: 0.03, type: 'triangle', v: 0.03, wet: 0 });
      t += 0.035 + Math.random() * 0.05;
    }
  },

  // dopad kostek na stůl
  land(n = 1) {
    for (let k = 0; k < n; k++) {
      const t = k * 0.07;
      noise({ t, d: 0.06, v: 0.3, f: 1700, q: 1.4, wet: 0.08 });
      tone({ t, f: 240, f2: 110, d: 0.1, v: 0.28, wet: 0 });
      tone({ t, f: 1250, d: 0.04, type: 'triangle', v: 0.05, wet: 0 });
    }
  },

  // klapnutí kopyta (střídají se dvě výšky)
  step(k = 0) {
    const hi = k % 2;
    tone({ f: hi ? 560 : 430, f2: hi ? 320 : 250, d: 0.08, v: 0.18, a: 0.002, wet: 0.04 });
    noise({ d: 0.035, v: 0.09, f: hi ? 1500 : 1100, q: 5, wet: 0.02 });
  },

  startPass() {
    bell(N.C6, 0, 0.1, 1.1);
    bell(N.E6, 0.1, 0.09, 1.2);
    bell(N.G6, 0.2, 0.08, 1.4);
  },

  coinIn() {
    noise({ d: 0.05, v: 0.1, f: 7000, type: 'highpass', q: 0.7, wet: 0.1 });
    bell(N.E6, 0.02, 0.08, 0.5);
    bell(N.B6, 0.1, 0.09, 0.9);
  },

  coinOut() {
    bell(N.A6, 0, 0.045, 0.25);
    bell(N.E6, 0.07, 0.045, 0.3);
    bell(N.C6, 0.14, 0.05, 0.45);
    tone({ f: 300, f2: 180, d: 0.18, type: 'triangle', v: 0.05, t: 0.12, wet: 0 });
  },

  coin() {
    bell(N.G6, 0, 0.035, 0.4);
  },

  // pokladna + razítko na smlouvě
  buy() {
    tone({ f: 170, f2: 70, d: 0.14, v: 0.32, wet: 0.02 });
    noise({ d: 0.07, v: 0.2, f: 2600, q: 0.8, wet: 0.05 });
    bell(N.E6, 0.07, 0.09, 0.7);
    bell(N.B6, 0.15, 0.09, 1.1);
  },

  sell() {
    tone({ f: 660, f2: 420, d: 0.16, type: 'triangle', v: 0.07 });
    bell(N.E6, 0.1, 0.045, 0.4);
  },

  train() {
    SFX.step(0);
    setTimeout(() => SFX.step(1), 90);
    [N.C5, N.E5, N.G5, N.C6].forEach((f, k) => tone({ t: 0.12 + k * 0.07, f, d: 0.2, type: 'triangle', v: 0.09, wet: 0.3 }));
  },

  grandPrix() {
    const seq = [
      [N.C5, 0, 0.1],
      [N.E5, 0.11, 0.1],
      [N.G5, 0.22, 0.1],
      [N.C6, 0.33, 0.55],
    ];
    for (const [f, t, d] of seq) brass(f, t, d, 0.1);
    brass(N.G5, 0.33, 0.55, 0.06);
    brass(N.E5, 0.33, 0.55, 0.05);
    for (let k = 0; k < 6; k++) bell([N.C7, N.G6, N.E6][k % 3], 0.4 + k * 0.08, 0.04, 0.6);
  },

  // vytažení karty – švihnutí a plesknutí papíru
  card() {
    noise({ d: 0.22, v: 0.2, f: 700, f2: 4200, q: 1.1, wet: 0.15 });
    noise({ t: 0.2, d: 0.03, v: 0.18, f: 3500, q: 1.5, wet: 0.05 });
  },

  // krátký trubkový signál – jsi na tahu
  yourTurn() {
    const seq = [
      [N.G4, 0, 0.1],
      [N.C5, 0.12, 0.1],
      [N.E5, 0.24, 0.1],
      [N.G5, 0.36, 0.42],
    ];
    for (const [f, t, d] of seq) brass(f, t, d, 0.11);
  },

  turn() {
    tone({ f: N.G5, d: 0.14, v: 0.045, wet: 0.3 });
    tone({ t: 0.09, f: N.C6, d: 0.22, v: 0.045, wet: 0.3 });
  },

  gameStart() {
    for (let k = 0; k < 10; k++) noise({ t: k * 0.045, d: 0.04, v: 0.05 + k * 0.012, f: 1800, q: 0.9, wet: 0.1 });
    const seq = [
      [N.G4, 0.48, 0.12],
      [N.C5, 0.62, 0.12],
      [N.E5, 0.76, 0.12],
      [N.G5, 0.9, 0.26],
      [N.E5, 1.2, 0.1],
      [N.G5, 1.33, 0.6],
    ];
    for (const [f, t, d] of seq) brass(f, t, d, 0.1);
    brass(N.C5, 1.33, 0.6, 0.06);
    brass(N.E5, 1.33, 0.6, 0.05);
  },

  win() {
    const seq = [
      [N.C5, 0, 0.1],
      [N.E5, 0.1, 0.1],
      [N.G5, 0.2, 0.1],
      [N.C6, 0.3, 0.2],
      [N.G5, 0.55, 0.1],
      [N.C6, 0.66, 0.8],
    ];
    for (const [f, t, d] of seq) brass(f, t, d, 0.1);
    brass(N.E5, 0.66, 0.8, 0.06);
    brass(N.G5, 0.66, 0.8, 0.05);
    for (let k = 0; k < 10; k++) bell([N.C7, N.G6, N.E6, N.A6][k % 4], 0.8 + k * 0.09 + Math.random() * 0.04, 0.035, 0.7);
  },

  lose() {
    [N.E5, N.D5, N.C5, N.G4].forEach((f, k) => tone({ t: k * 0.22, f, d: k === 3 ? 0.9 : 0.24, type: 'triangle', v: 0.09, wet: 0.35 }));
  },

  // smutný trombon
  bankrupt() {
    brass(N.G4, 0, 0.28, 0.1);
    brass(N.Fs4, 0.32, 0.28, 0.1);
    brass(N.F4, 0.64, 0.28, 0.1);
    brass(N.E4, 0.96, 0.95, 0.1, 0.02);
  },

  jail() {
    bell(196, 0, 0.12, 1.6, 0.4);
    tone({ t: 0.05, f: 150, d: 0.3, type: 'square', v: 0.06, lp: 700, wet: 0.05 });
    tone({ t: 0.08, f: 440, f2: 200, d: 0.55, type: 'triangle', v: 0.08, wet: 0.2 });
  },

  limp() {
    SFX.step(0);
    setTimeout(() => SFX.step(1), 260);
    tone({ t: 0.35, f: 520, f2: 300, d: 0.35, type: 'triangle', v: 0.06, wet: 0.2 });
  },

  pass() {
    bell(N.E6, 0, 0.08, 0.7);
    bell(N.A6, 0.09, 0.08, 0.9);
  },

  // zvonek u dveří – nabídka obchodu
  trade() {
    bell(N.E5, 0, 0.16, 1.3);
    bell(N.C5, 0.38, 0.16, 1.7);
  },

  deal() {
    [N.G5, N.B5, N.D6].forEach((f, k) => bell(f, k * 0.08, 0.09, 0.9));
    noise({ t: 0.25, d: 0.05, v: 0.08, f: 7000, type: 'highpass', q: 0.7, wet: 0.1 });
  },

  alarm() {
    for (let k = 0; k < 2; k++) tone({ t: k * 0.18, f: N.B5, d: 0.12, type: 'square', v: 0.045, lp: 2200, wet: 0.05 });
  },

  error() {
    tone({ f: 160, d: 0.15, type: 'square', v: 0.05, lp: 650, wet: 0 });
  },

  join() {
    tone({ f: 500, f2: 1100, d: 0.1, v: 0.12, wet: 0.15 });
    tone({ t: 0.08, f: 900, f2: 1500, d: 0.09, v: 0.07, wet: 0.15 });
  },

  leave() {
    tone({ f: 900, f2: 380, d: 0.16, v: 0.09, wet: 0.15 });
  },
};
