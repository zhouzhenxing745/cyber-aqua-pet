/* math, rng, noise, timing helpers */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/* frame-rate independent exponential approach */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
export const reseed = (s) => { rng = mulberry32(s >>> 0); };
export const rnd = () => rng();
export const rand = (a, b) => a + rng() * (b - a);
export const randInt = (a, b) => Math.floor(a + rng() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export const chance = (p) => rng() < p;
export const sign = () => (rng() < 0.5 ? -1 : 1);

/* cheap smooth value noise, good enough for wander + drift */
const PERM = new Uint8Array(512);
(function () {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(1337);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad1(h, x) { return (h & 1) === 0 ? x : -x; }
export function noise1(x) {
  const xi = Math.floor(x) & 255, xf = x - Math.floor(x);
  const u = fade(xf);
  return lerp(grad1(PERM[xi], xf), grad1(PERM[xi + 1], xf - 1), u) * 2;
}
export function noise2(x, y) {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const aa = PERM[PERM[xi] + yi], ab = PERM[PERM[xi] + yi + 1];
  const ba = PERM[PERM[xi + 1] + yi], bb = PERM[PERM[xi + 1] + yi + 1];
  const g = (h, dx, dy) => ((h & 1) ? -dx : dx) + ((h & 2) ? -dy : dy);
  return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v) * 0.7;
}

/* timer registry — every scheduled callback is cancellable as a group */
export class Timers {
  constructor() { this.ids = new Set(); }
  after(ms, fn) {
    const id = setTimeout(() => { this.ids.delete(id); fn(); }, ms);
    this.ids.add(id);
    return id;
  }
  every(ms, fn) {
    const id = setInterval(fn, ms);
    this.ids.add(id);
    return id;
  }
  cancel(id) { if (id == null) return; clearTimeout(id); clearInterval(id); this.ids.delete(id); }
  clear() { for (const id of this.ids) { clearTimeout(id); clearInterval(id); } this.ids.clear(); }
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbCss = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a == null ? 1 : a})`;
export function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

export function fmtClock(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export function dayPhaseName(h) {
  if (h < 5) return '深夜';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 14) return '正午';
  if (h < 17) return '午后';
  if (h < 20) return '黄昏';
  if (h < 23) return '夜晚';
  return '深夜';
}