// ============================================================
//  Vizuální efekty: plovoucí částky, konfety.
//  Kreslí se do vrstvy #fx, takže je nepřepíše překreslení UI.
// ============================================================

const layer = () => document.getElementById('fx');
export const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// plovoucí text nad prvkem (např. „+4 000“)
export function floatAt(el, text, cls = '') {
  const host = layer();
  if (!el || !host) return;
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  const f = document.createElement('div');
  f.className = 'float ' + cls;
  f.textContent = text;
  f.style.left = r.left + r.width / 2 + 'px';
  f.style.top = r.top + r.height / 2 + 'px';
  host.appendChild(f);
  setTimeout(() => f.remove(), 1700);
}

export function confetti(ms = 4200) {
  const host = layer();
  if (!host || reducedMotion()) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  host.appendChild(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const g = c.getContext('2d');
  const colors = ['#f7d36b', '#e3aa2f', '#e53935', '#1e88e5', '#43a047', '#ffffff', '#8e24aa', '#fb8c00'];
  const parts = Array.from({ length: 170 }, (_, k) => ({
    x: Math.random() * c.width,
    y: -Math.random() * c.height * 0.6,
    vx: (Math.random() - 0.5) * 2.4 * dpr,
    vy: (2.2 + Math.random() * 3.6) * dpr,
    w: (6 + Math.random() * 6) * dpr,
    h: (9 + Math.random() * 9) * dpr,
    r: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.28,
    col: colors[k % colors.length],
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const el = now - t0;
    g.clearRect(0, 0, c.width, c.height);
    g.globalAlpha = Math.max(0, Math.min(1, (ms - el) / 900));
    for (const p of parts) {
      p.x += p.vx + Math.sin(now / 420 + p.r) * 0.7 * dpr;
      p.y += p.vy;
      p.r += p.vr;
      if (p.y > c.height + 30 && el < ms - 1500) {
        p.y = -30;
        p.x = Math.random() * c.width;
      }
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.col;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.7)));
      g.restore();
    }
    if (el < ms) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}
