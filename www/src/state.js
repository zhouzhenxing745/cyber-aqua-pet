import { clamp } from './util.js';

export const SAVE_KEY = 'fish-tank-3d-v2';
export const FISH_MAX = 12;
export const GUEST_MAX = 3;
export const SAT_HUNGRY = 28;
export const SAT_STARVED = 14;
export const SAT_FULL = 96;

export const DEFAULT_SETTINGS = {
  volume: 0.7, muted: false, sens: 1, dayLen: 6, haptic: true, tags: true, rays: true,
  quality: 'mid', tilt: 0, light: 100, wave: 60, bub: 55, speed: 100, glow: 70,
  waterColor: '#12657f', cycle: true, grid: false, thought: true, autoRot: false, cam: 'free'
};

export function xpNeed(level) { return 80 + (level - 1) * 65; }

export class State {
  constructor() {
    this.sat = 78;
    this.mood = 82;
    this.clean = 92;
    this.xp = 0;
    this.level = 1;
    this.tankName = '珊瑚小筑';
    this.fishes = [];
    this.guests = [];
    this.bottleCount = 60;
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.lastSeen = Date.now();
    this.totalEaten = 0;
    this.totalPlays = 0;
    this.totalCleans = 0;
    this.created = Date.now();
    this._dirty = false;
    this._saveAt = 0;
    this.offlineMinutes = 0;
  }

  load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) return false;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || typeof d !== 'object') return false;
    this.sat = clamp(Number(d.sat) || 0, 0, 100);
    this.mood = clamp(Number(d.mood) || 0, 0, 100);
    this.clean = clamp(Number(d.clean) || 0, 0, 100);
    this.xp = Math.max(0, Number(d.xp) || 0);
    this.level = Math.max(1, Math.min(99, Number(d.level) || 1));
    this.tankName = typeof d.tankName === 'string' && d.tankName.trim() ? d.tankName.slice(0, 12) : this.tankName;
    this.fishes = Array.isArray(d.fishes) ? d.fishes.slice(0, FISH_MAX).filter((f) => f && typeof f.key === 'string') : [];
    this.guests = Array.isArray(d.guests) ? d.guests.slice(0, GUEST_MAX).filter((g) => typeof g === 'string') : [];
    this.bottleCount = clamp(Number(d.bottleCount) || 0, 0, 60);
    this.totalEaten = Number(d.totalEaten) || 0;
    this.totalPlays = Number(d.totalPlays) || 0;
    this.totalCleans = Number(d.totalCleans) || 0;
    this.created = Number(d.created) || Date.now();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
    this.settings.quality = ['low', 'mid', 'high'].includes(this.settings.quality) ? this.settings.quality : 'mid';
    this.settings.cam = ['free', 'front', 'top', 'side', 'under', 'follow'].includes(this.settings.cam) ? this.settings.cam : 'free';
    const last = Number(d.lastSeen) || Date.now();
    const mins = clamp((Date.now() - last) / 60000, 0, 480);
    this.offlineMinutes = mins;
    if (mins > 1) {
      this.sat = clamp(this.sat - mins * 0.9, 12, 100);
      this.mood = clamp(this.mood - mins * 0.6, 15, 100);
      this.clean = clamp(this.clean - mins * 0.45, 20, 100);
    }
    this.lastSeen = Date.now();
    return true;
  }

  save() {
    this.lastSeen = Date.now();
    const d = {
      sat: this.sat, mood: this.mood, clean: this.clean, xp: this.xp, level: this.level,
      tankName: this.tankName, fishes: this.fishes, guests: this.guests, bottleCount: this.bottleCount,
      settings: this.settings, lastSeen: this.lastSeen, totalEaten: this.totalEaten,
      totalPlays: this.totalPlays, totalCleans: this.totalCleans, created: this.created
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { /* storage full or blocked */ }
    this._dirty = false;
  }

  touch() { this._dirty = true; }

  flush(t) {
    if (this._dirty && t > this._saveAt) { this._saveAt = t + 4; this.save(); }
  }

  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  tick(dt, wasteCount) {
    const n = this.fishes.length || 1;
    const load = 0.6 + n * 0.09;
    this.sat = clamp(this.sat - dt * (3.1 / 60) * load, 0, 100);
    this.mood = clamp(this.mood - dt * (2.3 / 60) * (this.sat < SAT_HUNGRY ? 1.8 : 1), 0, 100);
    this.clean = clamp(this.clean - dt * ((1.5 + wasteCount * 1.4) / 60) * load, 0, 100);
    if (this.clean < 30) this.mood = clamp(this.mood - dt * (1.6 / 60), 0, 100);
    this._dirty = true;
  }

  addXp(n) {
    this.xp += n;
    let ups = 0;
    while (this.xp >= xpNeed(this.level) && this.level < 99) {
      this.xp -= xpNeed(this.level);
      this.level++;
      ups++;
    }
    this._dirty = true;
    return ups;
  }

  feed(amount) {
    this.sat = clamp(this.sat + amount, 0, 100);
    this.totalEaten++;
    this._dirty = true;
  }

  serializeFish(f) {
    return { key: f.key, name: f.name, born: f.born, eaten: f.eaten, growth: f.growth, scale: f.baseScale, schoolId: f.schoolId };
  }
}

/* ---------- thought lines ---------- */
const HUNGRY = ['我饿啦，投一点嘛～', '肚子咕咕叫了…', '饲料瓶！看这里！', '有吃的吗？'];
const STARVED = ['快饿扁了…救救', '好饿…没力气了', '想吃东西…'];
const FULL = ['吃撑啦，游不动了', '好饱～谢谢', '肚子圆滚滚'];
const HAPPY = ['今天水好舒服', '一起玩呀！', '转个圈圈～', '这里最喜欢了'];
const DIRTY = ['水有点浑…', '便便好多呀', '想换干净的水'];
const SAD = ['有点无聊…', '陪我玩嘛', '闷闷的'];
const NIGHT = ['zzZ…', '晚安…', '困了…'];
const THANKS = ['谢谢！好吃', '唔姆唔姆～', '再来一粒！'];

export function thoughtFor(f, st, night) {
  if (night) return pick1(NIGHT);
  if (st.sat < SAT_STARVED) return pick1(STARVED);
  if (st.sat < SAT_HUNGRY) return pick1(HUNGRY);
  if (st.sat > SAT_FULL) return pick1(FULL);
  if (st.clean < 35) return pick1(DIRTY);
  if (st.mood < 35) return pick1(SAD);
  return pick1(HAPPY);
}
export function thanksLine() { return pick1(THANKS); }
function pick1(a) { return a[Math.floor(Math.random() * a.length)]; }