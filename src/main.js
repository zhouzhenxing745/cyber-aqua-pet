import * as THREE from '../vendor/three.module.js';
import { clamp, rand, pick, reseed, Timers, TAU } from './util.js';
import { World, BOUNDS, waterTopY, sandY } from './world.js';
import { Fish, SPECIES, randomSpecies } from './fish.js';
import { Bottle } from './bottle.js';
import { FoodSystem, BubbleSystem, SparkSystem, RippleSystem, WasteSystem } from './particles.js';
import { CameraRig } from './camera.js';
import { Critters, GUEST_KEYS } from './critters.js';
import { PostFX } from './postfx.js';
import { Audio } from './audio.js';
import { State, FISH_MAX, GUEST_MAX, SAT_FULL, DEFAULT_SETTINGS, thoughtFor, thanksLine } from './state.js';
import { UI } from './ui.js';

const POUR_TILT = 132 * Math.PI / 180;
const COOL_MAX = { feed: 1.6, play: 6, clean: 8 };
const WATER_PRESETS = ['#12657f', '#0d4f6b', '#1b7a6a', '#2a4f8f', '#0a3a52', '#17708c'];

/* rAF is paused in hidden tabs — the timeout keeps boot progressing there */
const nextFrame = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(fin);
  setTimeout(fin, 60);
});

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.state = new State();
    this.audio = new Audio();
    this.timers = new Timers();
    this.fishes = [];
    this.cool = { feed: 0, play: 0, clean: 0 };
    this.t = 0;
    this.running = false;
    this.manualTilt = 0;
    this.pourHeld = false;
    this.autoHold = false;
    this.autoPour = null;
    this.selected = null;
    this.wantShot = false;
    this.dragMode = null;
    this.downInfo = null;
    this.wasHeld = false;
    this.bubbleAcc = 0;
    this.thoughtAt = 3;
    this.lastNight = false;
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane();
    this._hit = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._lastBottlePos = new THREE.Vector3();
    this._pourTarget = new THREE.Vector3();
    this._errShown = false;
  }

  /* ================= boot ================= */
  async boot() {
    const ui = this.ui = new UI(this.api());
    ui.boot(0.05, '正在唤醒深海…');
    await nextFrame();

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: false,
        powerPreference: 'high-performance', stencil: false
      });
    } catch (e) {
      ui.bootError('这台设备或浏览器不支持 WebGL，无法运行 3D 鱼缸。请换用较新的 Safari / Chrome 再试。');
      return;
    }
    this.renderer = renderer;
    renderer.setClearColor(0x030d15, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
    this.camera.position.set(30, 12, 34);

    ui.boot(0.18, '注入海水与光影…');
    await nextFrame();
    this.world = new World(this.scene, renderer);

    ui.boot(0.4, '铺设沙底与珊瑚…');
    await nextFrame();
    this.food = new FoodSystem(this.scene, 260);
    this.bubbles = new BubbleSystem(this.scene, 340);
    this.sparks = new SparkSystem(this.scene, 280);
    this.ripples = new RippleSystem(this.scene, 14);
    this.waste = new WasteSystem(this.scene, 8);

    ui.boot(0.56, '调配饲料瓶物理…');
    await nextFrame();
    this.bottle = new Bottle(this.scene, (x, y, z, vx, vy, vz) => this.onPour(x, y, z, vx, vy, vz));

    ui.boot(0.7, '唤醒小鱼与邻居…');
    await nextFrame();
    this.critters = new Critters(this.scene);
    this.rig = new CameraRig(this.camera, this.canvas);

    const had = this.state.load();
    this.applySettings(this.state.settings);
    if (had && this.state.fishes.length) {
      for (const d of this.state.fishes) this.spawnFish(d.key, d, true);
    } else {
      this.spawnFish('koi', { name: '阿橘' }, true);
      this.spawnFish('clown', { name: '小蓝' }, true);
      this.spawnFish('gold', { name: '奶糖' }, true);
    }
    for (const k of this.state.guests) this.critters.addGuest(k);
    ui.renderFishGrid();
    ui.renderGuestGrid();
    if (this.state.bottleCount < this.bottle.count) {
      this.bottle.grains.length = Math.max(0, Math.round(this.state.bottleCount));
      this.bottle.syncGrains();
    }

    ui.boot(0.86, '点亮辉光与焦散…');
    await nextFrame();
    this.post = new PostFX(renderer, this.scene, this.camera);
    this.post.setQuality(this.state.settings.quality);
    this.post.bloom = this.state.settings.glow / 100;
    this.resize();
    this.world.update(0.016, 0);
    this.rig.setPreset(this.state.settings.cam, true);
    this.rig.update(0.016, 0);
    this.post.render(0, false);

    ui.boot(1, '准备就绪');
    await nextFrame();
    ui.bootReady();

    this.bindCanvas();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.persist(); this.audio.setMuted(true); }
      else if (!this.state.settings.muted) this.audio.setMuted(false);
    });
    window.addEventListener('error', (ev) => this.onError(ev.message));
    window.addEventListener('unhandledrejection', (ev) => this.onError(String(ev.reason)));

    const start = () => {
      ui.el.bootStart.removeEventListener('click', start);
      this.audio.unlock();
      this.audio.setVolume(this.state.settings.volume);
      this.audio.setMuted(this.state.settings.muted);
      ui.bootHide();
      this.running = true;
      this.last = performance.now();
      this.audio.spawn();
      if (this.state.offlineMinutes > 20) {
        this.timers.after(1200, () => ui.toast(`你离开了 ${Math.round(this.state.offlineMinutes)} 分钟，小鱼想你了`, 'warn'));
      } else if (!had) {
        this.timers.after(1400, () => ui.toast('拖动画面转动视角 · 点饲料瓶拿起来投喂', 'good'));
        this.timers.after(9000, () => { if (!ui.sheetOpen) ui.toast('右上角 ? 有完整玩法说明', ''); });
      }
      requestAnimationFrame(this.loop);
    };
    ui.el.bootStart.addEventListener('click', start);
    this.loop = this.loop.bind(this);
    if (new URLSearchParams(location.search).has('debug')) window.__aqua = this;
    this.idleSpin();
  }

  idleSpin() {
    if (this.running) return;
    this.t += 0.016;
    this.world.update(0.016, this.t);
    this.bottle.update(0.016, this.t);
    this.rig.dTheta += 0.0016;
    this.rig.update(0.016, this.t);
    this.world.billboardRays(this.camera);
    this.post.render(this.t, this.camera.position.y < waterTopY);
    requestAnimationFrame(() => this.idleSpin());
  }

  onError(msg) {
    if (this._errShown || !msg) return;
    this._errShown = true;
    console.error('[aqua]', msg);
    if (this.ui) this.ui.toast('出了点小问题，已自动恢复', 'bad');
  }

  /* ================= api exposed to UI ================= */
  api() {
    const self = this;
    return {
      get state() { return self.state; },
      get fishes() { return self.fishes; },
      sfx: (n) => { if (self.audio.ready && self.audio[n]) self.audio[n](); },
      setParam: (k, v) => self.setParam(k, v),
      setCam: (n) => self.setCam(n),
      setZoom: (v) => { self.rig.zoom01 = v; },
      toggleAutoRot: () => self.setParam('autoRot', !self.state.settings.autoRot),
      toggleSound: () => self.setParam('muted', !self.state.settings.muted),
      feed: () => self.feed(),
      play: () => self.play(),
      clean: () => self.clean(),
      addFish: (key) => self.addFish(key),
      addSchool: () => self.addSchool(),
      removeLastFish: () => self.removeLastFish(),
      releaseFish: (f) => self.releaseFish(f),
      renameFish: (f, n) => { f.name = n.slice(0, 8); self.syncFishState(); self.ui.toast(`它现在叫「${f.name}」`, 'good'); },
      focusFish: (f) => self.focusFish(f),
      feedFish: (f) => self.feedFish(f),
      toggleGuest: (k) => self.toggleGuest(k),
      randomGuest: () => self.randomGuest(),
      guestKeys: () => self.critters.guestKeys(),
      pourStart: () => self.pourStart(),
      pourEnd: () => self.pourEnd(),
      refill: () => self.refill(),
      randomizeScene: () => self.randomizeScene(),
      screenshot: () => { self.wantShot = true; },
      resetScene: () => self.resetScene(),
      resetAll: () => self.resetAll(),
      haptic: (ms) => self.haptic(ms)
    };
  }

  haptic(ms) {
    if (!this.state.settings.haptic) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* unsupported */ } }
  }

  /* ================= settings ================= */
  applySettings(s) {
    const w = this.world;
    w.setLight(s.light / 100);
    w.setWave(s.wave / 100);
    w.setRays(s.rays);
    w.setGrid(s.grid);
    w.setWaterColor(s.waterColor);
    w.cycle = s.cycle;
    w.dayLength = s.dayLen;
    this.rig.setSensitivity(s.sens);
    this.rig.setAutoRotate(s.autoRot);
    this.audio.setVolume(s.volume);
    this.audio.setMuted(s.muted);
    if (this.post) { this.post.bloom = s.glow / 100; this.post.setQuality(s.quality); }
    w.setQuality(s.quality);
    this.applyPixelRatio();
    this.ui.applySettings(s);
  }

  applyPixelRatio() {
    const q = this.state.settings.quality;
    const cap = q === 'high' ? 2 : q === 'mid' ? 1.6 : 1;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(this.pixelRatio);
    if (this.post) this.post.setSize(this.vw || 2, this.vh || 2, this.pixelRatio);
  }

  setParam(k, v) {
    const s = this.state.settings;
    const w = this.world;
    switch (k) {
      case 'tilt':
        this.manualTilt = clamp(v, 0, 170) * Math.PI / 180;
        this.pourHeld = false;
        this.ui.el.btnPour.classList.remove('held');
        if (this.bottle.state === 'docked' && v > 4) { this.bottle.grab(); this.autoHold = true; }
        else if (v <= 4 && this.bottle.state === 'held' && this.autoHold) { this.bottle.release(); this.autoHold = false; this.audio.drop(); }
        break;
      case 'light': s.light = v; w.setLight(v / 100); break;
      case 'wave': s.wave = v; w.setWave(v / 100); break;
      case 'bub': s.bub = v; break;
      case 'speed': s.speed = v; break;
      case 'glow': s.glow = v; if (this.post) this.post.bloom = v / 100; break;
      case 'waterColor': s.waterColor = v; w.setWaterColor(v); break;
      case 'cycle': s.cycle = v; w.cycle = v; this.ui.setToggle(this.ui.el.tCycle, v); this.audio.toggle(v); break;
      case 'grid': s.grid = v; w.setGrid(v); this.ui.setToggle(this.ui.el.tGrid, v); this.audio.toggle(v); break;
      case 'thought': s.thought = v; this.ui.setToggle(this.ui.el.tThought, v); this.audio.toggle(v); break;
      case 'haptic': s.haptic = v; this.ui.setToggle(this.ui.el.tHaptic, v); this.audio.toggle(v); if (v) this.haptic(12); break;
      case 'tags': s.tags = v; this.ui.setToggle(this.ui.el.tTags, v); this.audio.toggle(v); break;
      case 'rays': s.rays = v; w.setRays(v); this.ui.setToggle(this.ui.el.tRays, v); this.audio.toggle(v); break;
      case 'quality':
        s.quality = v;
        for (const b of this.ui.el.segQuality.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === v);
        w.setQuality(v);
        if (this.post) this.post.setQuality(v);
        this.applyPixelRatio();
        this.resize();
        this.audio.toggle(v !== 'low');
        this.ui.toast(v === 'high' ? '高画质：体积光 + 柔和阴影 + 辉光' : v === 'mid' ? '中画质：均衡模式' : '低画质：省电模式', 'good');
        break;
      case 'volume': s.volume = v / 100; this.audio.setVolume(s.volume); break;
      case 'sens': s.sens = v; this.rig.setSensitivity(v); break;
      case 'dayLen': s.dayLen = v; w.dayLength = v; break;
      case 'muted':
        s.muted = v;
        this.audio.setMuted(v);
        this.ui.setSound(!v);
        if (!v) { this.audio.unlock(); this.audio.toggle(true); }
        break;
      case 'autoRot':
        s.autoRot = v;
        this.rig.setAutoRotate(v);
        this.ui.setToggle(this.ui.el.btnAutoRot, v);
        this.audio.toggle(v);
        break;
    }
    this.state.touch();
  }

  setCam(name) {
    if (name === 'follow') {
      const f = this.selected || this.fishes[0];
      if (!f) { this.ui.toast('先添加一条小鱼才能跟随', 'warn'); this.audio.err(); return; }
      this.rig.setFollow(f);
      this.selected = f;
    } else {
      this.rig.setFollow(null);
    }
    this.rig.setPreset(name);
    this.state.settings.cam = name;
    this.ui.setCamActive(name);
    this.audio.click();
    this.haptic(8);
    this.state.touch();
  }

  /* ================= fish management ================= */
  spawnFish(key, data, silent) {
    if (this.fishes.length >= FISH_MAX) return null;
    const k = SPECIES[key] ? key : randomSpecies();
    const f = new Fish(k, BOUNDS, data || {});
    this.scene.add(f.group);
    this.fishes.push(f);
    f.poopAt = 0;
    f.poopPending = 0;
    if (!silent) {
      this.syncFishState();
      this.sparks.burst(f.pos.x, f.pos.y, f.pos.z, 18, SPECIES[k].skin.base, 1.2);
      this.bubbles.burst(f.pos.x, f.pos.y, f.pos.z, 8, 0.6);
      this.audio.spawn();
      this.haptic(14);
      const ups = this.state.addXp(20);
      this.checkLevel(ups);
      this.ui.toast(`${f.name}（${SPECIES[k].name}）加入了鱼缸`, 'good');
    }
    return f;
  }

  addFish(key) {
    if (this.fishes.length >= FISH_MAX) { this.ui.toast(`鱼缸最多 ${FISH_MAX} 条小鱼`, 'warn'); this.audio.err(); return; }
    const f = this.spawnFish(key || randomSpecies());
    if (f) this.ui.renderFishGrid();
  }

  addSchool() {
    const room = FISH_MAX - this.fishes.length;
    if (room < 4) { this.ui.toast('空间不够啦，先送走几条', 'warn'); this.audio.err(); return; }
    const n = Math.min(6, room);
    const id = 'school-' + Date.now();
    const cx = rand(-6, 6), cy = rand(-1, 3), cz = rand(-4, 4);
    for (let i = 0; i < n; i++) {
      const f = this.spawnFish('neon', { schoolId: id, scale: rand(0.9, 1.15) }, true);
      if (f) { f.pos.set(cx + rand(-1.5, 1.5), cy + rand(-1, 1), cz + rand(-1.5, 1.5)); f.group.position.copy(f.pos); }
    }
    this.syncFishState();
    this.audio.spawn();
    this.sparks.burst(cx, cy, cz, 24, '#22e3ff', 1.4);
    const ups = this.state.addXp(26);
    this.checkLevel(ups);
    this.ui.toast(`${n} 条霓虹灯鱼成群入缸`, 'good');
    this.ui.renderFishGrid();
  }

  removeFish(f, quiet) {
    const i = this.fishes.indexOf(f);
    if (i < 0) return;
    this.fishes.splice(i, 1);
    for (const fd of this.food.items) if (fd.claimed === f.id) fd.claimed = 0;
    if (this.selected === f) {
      this.selected = null;
      if (this.rig.preset === 'follow') { this.rig.setFollow(null); this.setCam('free'); }
    }
    f.dispose();
    this.syncFishState();
    if (!quiet) this.ui.renderFishGrid();
  }

  removeLastFish() {
    if (!this.fishes.length) { this.audio.err(); this.ui.toast('鱼缸已经空了', 'warn'); return; }
    this.releaseFish(this.fishes[this.fishes.length - 1]);
  }

  releaseFish(f) {
    const snapshot = { key: f.key, name: f.name, born: f.born, eaten: f.eaten, growth: f.growth, scale: f.baseScale, schoolId: f.schoolId };
    this.sparks.burst(f.pos.x, f.pos.y, f.pos.z, 22, '#43c8ff', 1.1);
    this.bubbles.burst(f.pos.x, f.pos.y, f.pos.z, 12, 0.8);
    this.removeFish(f);
    this.audio.release();
    this.haptic(18);
    this.ui.toast(`已送 ${snapshot.name} 去大海`, '', '撤回', () => {
      if (this.fishes.length >= FISH_MAX) { this.ui.toast('鱼缸满了，无法撤回', 'warn'); return; }
      const back = this.spawnFish(snapshot.key, snapshot, true);
      if (back) { this.syncFishState(); this.audio.spawn(); this.ui.toast(`${back.name} 又游回来了`, 'good'); this.ui.renderFishGrid(); }
    });
  }

  syncFishState() {
    this.state.fishes = this.fishes.map((f) => this.state.serializeFish(f));
    this.state.touch();
  }

  focusFish(f) {
    this.selected = f;
    this.rig.setFollow(f);
    this.rig.setPreset('follow');
    this.state.settings.cam = 'follow';
    this.ui.setCamActive('follow');
    this.audio.click();
    this.ui.toast(`镜头跟随 ${f.name}`, 'good');
  }

  feedFish(f) {
    if (this.bottle.count <= 0) { this.ui.toast('饲料瓶空了，点补满按钮', 'warn'); this.audio.err(); return; }
    for (let i = 0; i < 4; i++) {
      if (this.bottle.count <= 0) break;
      const g = this.bottle.grains.pop();
      if (!g) break;
      this.bottle.syncGrains();
      this.food.spawn(f.pos.x + rand(-0.6, 0.6), waterTopY + 1.2 + i * 0.3, f.pos.z + rand(-0.6, 0.6), rand(-0.4, 0.4), -1, rand(-0.4, 0.4));
    }
    this.state.bottleCount = this.bottle.count;
    this.audio.pour(1);
    this.ui.toast(`给 ${f.name} 开了小灶`, 'good');
    this.state.touch();
  }

  /* ================= guests ================= */
  toggleGuest(key) {
    const active = this.critters.guestKeys();
    if (active.includes(key)) {
      const g = this.critters.guests.find((x) => x.key === key);
      if (g) this.sparks.burst(g.pos.x, g.pos.y, g.pos.z, 16, g.meta.color, 1);
      this.critters.removeGuest(key);
      this.audio.release();
      this.ui.toast(`${g ? g.meta.name : '访客'} 回家了`, '', '撤回', () => { this.critters.addGuest(key); this.syncGuests(); this.ui.renderGuestGrid(); });
    } else {
      if (active.length >= GUEST_MAX) { this.ui.toast(`一次最多 ${GUEST_MAX} 位访客`, 'warn'); this.audio.err(); return; }
      const g = this.critters.addGuest(key);
      if (!g) return;
      this.sparks.burst(g.pos.x, g.pos.y, g.pos.z, 24, g.meta.color, 1.4);
      this.bubbles.burst(g.pos.x, g.pos.y, g.pos.z, 10, 0.7);
      this.audio.spawn();
      this.haptic(14);
      this.checkLevel(this.state.addXp(28));
      this.ui.toast(`${g.meta.name} 来做客啦：${g.meta.desc}`, 'good');
    }
    this.syncGuests();
  }

  randomGuest() {
    const active = this.critters.guestKeys();
    const free = GUEST_KEYS.filter((k) => !active.includes(k));
    if (!free.length || active.length >= GUEST_MAX) { this.ui.toast('访客已经满员啦', 'warn'); this.audio.err(); return; }
    this.toggleGuest(pick(free));
  }

  syncGuests() {
    this.state.guests = this.critters.guestKeys();
    this.state.touch();
  }

  /* ================= actions ================= */
  feed() {
    if (this.cool.feed > 0) return;
    if (this.bottle.count <= 0) { this.ui.toast('饲料瓶空了 · 点右下角补满', 'warn'); this.audio.err(); return; }
    if (!this.fishes.length) { this.ui.toast('先添加一条小鱼吧', 'warn'); this.audio.err(); return; }
    this.cool.feed = COOL_MAX.feed;
    this.autoPour = { t: 0, dur: 2.8, x: rand(-8, 8), z: rand(-5, 5) };
    if (this.bottle.state === 'docked') this.bottle.grab();
    this.audio.grab();
    this.haptic(12);
  }

  play() {
    if (this.cool.play > 0) return;
    if (!this.fishes.length) { this.ui.toast('没有小鱼可以一起玩', 'warn'); this.audio.err(); return; }
    this.cool.play = COOL_MAX.play;
    const n = this.fishes.length;
    const cy = rand(-1, 3);
    this.fishes.forEach((f, i) => {
      const a = (i / n) * TAU;
      f.target.set(Math.cos(a) * 7.5, cy + Math.sin(a * 2) * 1.2, Math.sin(a) * 5);
      f.wanderAt = this.t + 3.2;
      f.dash(this.t, 2.8);
      f.food = null;
    });
    for (const f of this.fishes) this.sparks.burst(f.pos.x, f.pos.y, f.pos.z, 8, '#ff3d8b', 1);
    this.bubbles.burst(0, cy, 0, 22, 3);
    this.state.mood = clamp(this.state.mood + 20, 0, 100);
    this.state.totalPlays++;
    this.checkLevel(this.state.addXp(18));
    this.audio.play();
    this.haptic([10, 40, 14]);
    this.ui.banner('PLAY TIME', '鱼群编队冲刺中');
    this.ui.toast('心情 +20 · 鱼群正在表演', 'good');
    this.state.touch();
  }

  clean() {
    if (this.cool.clean > 0) return;
    this.cool.clean = COOL_MAX.clean;
    const had = this.waste.items.length;
    this.waste.clearAll();
    for (let i = this.food.items.length - 1; i >= 0; i--) if (this.food.items[i].settled) this.food.items.splice(i, 1);
    for (const f of this.fishes) f.poopPending = 0;
    this.state.clean = 100;
    this.state.mood = clamp(this.state.mood + 6, 0, 100);
    this.state.totalCleans++;
    for (let i = 0; i < 16; i++) {
      this.bubbles.burst(rand(-12, 12), rand(sandY + 1, waterTopY - 1), rand(-7, 7), 5, 1.4);
    }
    this.ripples.spawn(0, 0, 1.4);
    this.checkLevel(this.state.addXp(14));
    this.audio.clean();
    this.haptic([8, 30, 8, 30, 16]);
    this.ui.banner('FRESH WATER', had ? `清走了 ${had} 坨便便` : '水质焕然一新');
    this.ui.toast('清洁度 100 · 换水完成', 'good');
    this.state.touch();
  }

  pourStart() {
    if (this.bottle.count <= 0) { this.ui.toast('饲料瓶空了 · 点补满', 'warn'); this.audio.err(); return; }
    this.pourHeld = true;
    this.autoPour = null;
    if (this.bottle.state === 'docked') { this.bottle.grab(); this.autoHold = true; }
    this.audio.grab();
    this.haptic(10);
  }

  pourEnd() {
    if (!this.pourHeld) return;
    this.pourHeld = false;
    if (this.bottle.state === 'held') { this.bottle.release(); this.audio.drop(); }
    this.autoHold = false;
  }

  refill() {
    if (this.bottle.count >= this.bottle.capacity) { this.ui.toast('已经是满的啦', 'warn'); return; }
    this.bottle.refill(false);
    this.state.bottleCount = this.bottle.count;
    this.audio.refill();
    this.haptic(16);
    this.ui.toast('饲料补满 60 / 60', 'good');
    this.state.touch();
  }

  onPour(x, y, z, vx, vy, vz) {
    const f = this.food.spawn(x, y, z, vx * 0.55, vy * 0.55, vz * 0.55);
    if (!f) return;
    this.state.bottleCount = this.bottle.count;
    this.audio.pour(0.8);
    this.state.touch();
  }

  onEat(f, food) {
    food.eaten = true;
    food.claimed = 0;
    f.eaten++;
    f.poopPending = (f.poopPending || 0) + 1;
    if (f.poopPending >= 4) { f.poopPending = 0; f.poopAt = this.t + rand(5, 13); }
    this.state.feed(2.4);
    this.state.mood = clamp(this.state.mood + 0.9, 0, 100);
    this.sparks.burst(food.pos.x, food.pos.y, food.pos.z, 9, '#ffab2e', 0.8);
    this.bubbles.burst(food.pos.x, food.pos.y, food.pos.z, 3, 0.3);
    this.audio.eat();
    this.ui.floatNum(f.pos, this.camera, this.vw, this.vh, '+2.4 饱食', '#ffab2e');
    this.ui.say(f, thanksLine(), this.t, 2.2);
    this.checkLevel(this.state.addXp(6));
    this.syncFishState();
    if (this.state.sat > SAT_FULL && Math.random() < 0.25) this.ui.toast('小鱼吃撑啦，别再喂了', 'warn');
  }

  onScavenge(food) {
    food.eaten = true;
    food.claimed = 0;
    this.state.clean = clamp(this.state.clean + 1.6, 0, 100);
    this.sparks.burst(food.pos.x, food.pos.y, food.pos.z, 5, '#7dff5c', 0.5);
    this.audio.tick();
  }

  checkLevel(ups) {
    if (!ups) return;
    this.audio.levelUp();
    this.haptic([12, 50, 12, 50, 24]);
    this.ui.banner(`LEVEL ${this.state.level}`, '鱼缸声望提升 · 小鱼更活泼了');
    for (const f of this.fishes) this.sparks.burst(f.pos.x, f.pos.y, f.pos.z, 14, '#22e3ff', 1.3);
    this.state.mood = clamp(this.state.mood + 10, 0, 100);
  }

  /* ================= scene tools ================= */
  randomizeScene() {
    reseed((Math.random() * 0xffffffff) >>> 0);
    this.world.clearDecor();
    this.world.scatterDecor();
    const c = pick(WATER_PRESETS);
    this.setParam('waterColor', c);
    this.ui.el.cWater.value = c;
    const light = Math.round(rand(70, 150));
    this.setParam('light', light);
    this.ui.el.sLight.value = light; this.ui.el.vLight.textContent = light;
    const wave = Math.round(rand(25, 95));
    this.setParam('wave', wave);
    this.ui.el.sWave.value = wave; this.ui.el.vWave.textContent = wave;
    this.audio.refill();
    this.haptic(14);
    this.ui.toast('重新布景：换了珊瑚、石头与水色', 'good');
  }

  resetScene() {
    const d = DEFAULT_SETTINGS;
    for (const k of ['light', 'wave', 'bub', 'speed', 'glow']) this.setParam(k, d[k]);
    this.setParam('waterColor', d.waterColor);
    this.setParam('cycle', true);
    this.setParam('grid', false);
    this.setParam('thought', true);
    this.setParam('rays', true);
    this.manualTilt = 0;
    this.pourHeld = false;
    this.autoPour = null;
    this.bottle.release();
    this.bottle.setTilt(0);
    this.setCam('free');
    this.rig.zoom01 = 0.46;
    this.ui.applySettings(this.state.settings);
    this.audio.click();
    this.ui.toast('场景与镜头已复位', 'good');
  }

  resetAll() {
    this.running = false;
    this.timers.clear();
    this.state.reset();
    this.persist = () => {};
    location.reload();
  }

  persist() {
    this.syncFishState();
    this.syncGuests();
    this.state.bottleCount = this.bottle.count;
    this.state.save();
  }

  screenshot() {
    try {
      const url = this.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `cyber-aqua-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.audio.click();
      this.ui.toast('截图已保存', 'good');
    } catch (e) {
      this.ui.toast('截图失败：浏览器阻止了导出', 'bad');
    }
  }

  /* ================= pointer ================= */
  bindCanvas() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', (e) => { if (this.dragMode === 'cam') this.onUp(e); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.rig.onWheel(e); }, { passive: false });
    c.addEventListener('dblclick', (e) => this.onDouble(e));
  }

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
  }

  pickBottle() {
    const hits = this._ray.intersectObjects(this.bottle.hitMeshes, false);
    return hits.length ? hits[0] : null;
  }

  pickFish() {
    const meshes = [];
    for (const f of this.fishes) meshes.push(f.body);
    const hits = this._ray.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const m = hits[0].object;
    return this.fishes.find((f) => f.body === m) || null;
  }

  pickCritter() {
    const groups = this.critters.pickables();
    const objs = groups.map((g) => g.group);
    const hits = this._ray.intersectObjects(objs, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o) {
      const found = groups.find((g) => g.group === o);
      if (found) return found.obj;
      o = o.parent;
    }
    return null;
  }

  onDown(e) {
    if (!this.running || this.dragMode) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.ndc(e);
    this.downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: 0 };
    const bh = this.pickBottle();
    if (bh) {
      this.wasHeld = this.bottle.state === 'held';
      this.dragMode = 'bottle';
      this.bottle.grab();
      this.autoPour = null;
      this.camera.getWorldDirection(this._camDir);
      this._plane.setFromNormalAndCoplanarPoint(this._camDir, this.bottle.group.position);
      this._lastBottlePos.copy(this.bottle.group.position);
      this.canvas.classList.add('grabbing');
      this.audio.grab();
      this.haptic(10);
      this.rig.cancelAll();
      return;
    }
    this.wasHeld = false;
    this.dragMode = 'cam';
    this.rig.onPointerDown(e);
    this.canvas.classList.add('grabbing');
  }

  onMove(e) {
    if (!this.running) return;
    if (!this.dragMode) {
      if (e.pointerType === 'mouse') {
        this.ndc(e);
        const hot = this.pickBottle() || this.pickFish();
        this.canvas.classList.toggle('pointing', !!hot);
      }
      return;
    }
    if (this.downInfo && e.pointerId === this.downInfo.id) {
      this.downInfo.moved = Math.max(this.downInfo.moved, Math.hypot(e.clientX - this.downInfo.x, e.clientY - this.downInfo.y));
    }
    if (this.dragMode === 'bottle') {
      this.ndc(e);
      this.camera.getWorldDirection(this._camDir);
      this._plane.setFromNormalAndCoplanarPoint(this._camDir, this.bottle.group.position);
      if (this._ray.ray.intersectPlane(this._plane, this._hit)) {
        this.bottle.setTarget(this._hit);
        this.bottle.clampTarget();
        const d = this._hit.distanceTo(this._lastBottlePos);
        if (d > 0.55) { this.bottle.shake(Math.min(1.2, d * 0.35)); this._lastBottlePos.copy(this._hit); }
      }
      return;
    }
    this.rig.onPointerMove(e);
  }

  onUp(e) {
    if (!this.dragMode) return;
    const info = this.downInfo;
    const quick = info && e.pointerId === info.id && info.moved < 9 && performance.now() - info.t < 420;
    if (this.dragMode === 'bottle') {
      if (quick && this.wasHeld) {
        this.bottle.release();
        this.audio.drop();
        this.ui.toast('饲料瓶放回去了', '');
      } else if (quick && !this.wasHeld) {
        this.ui.toast('拿起了饲料瓶 · 按住「倾倒」投喂', 'good');
      }
      this.bottle.shake(0.3);
    } else {
      this.rig.onPointerUp(e);
      if (this.rig.pointers.size > 0) { this.downInfo = null; return; }
      if (quick) {
        this.ndc(e);
        const f = this.pickFish();
        if (f) {
          this.selected = f;
          this.audio.click();
          this.haptic(10);
          this.ui.openDetail(f);
        } else {
          const cr = this.pickCritter();
          if (cr) {
            cr.poke(this.t);
            this.audio.bubble();
            this.sparks.burst(cr.pos.x, cr.pos.y + 0.4, cr.pos.z, 8, '#ffc247', 0.7);
            if (cr.meta) this.ui.toast(`${cr.meta.name}：${cr.meta.desc}`, 'good');
            else this.ui.toast('螃蟹举起了钳子打招呼', 'good');
          } else if (this.bottle.state === 'held') {
            this.bottle.release();
            this.autoHold = false;
            this.audio.drop();
          }
        }
      }
    }
    if (this.dragMode === 'cam' && this.rig.pointers.size === 0) this.canvas.classList.remove('grabbing');
    if (this.dragMode === 'bottle') this.canvas.classList.remove('grabbing');
    this.dragMode = null;
    this.downInfo = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  }

  onDouble(e) {
    if (!this.running || !this.fishes.length) return;
    this.ndc(e);
    let best = null, bd = 1e9;
    for (const f of this.fishes) {
      const d = this._ray.ray.distanceToPoint(f.pos);
      if (d < bd) { bd = d; best = f; }
    }
    if (best && bd < 4) this.focusFish(best);
  }

  /* ================= resize ================= */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = h > w ? 54 : 46;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h, this.pixelRatio || 1);
  }

  /* ================= main loop ================= */
  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    const st = this.state;
    const s = st.settings;

    for (const k of ['feed', 'play', 'clean']) if (this.cool[k] > 0) this.cool[k] = Math.max(0, this.cool[k] - dt);

    /* --- bottle tilt intent --- */
    let tilt = this.manualTilt;
    if (this.autoPour) {
      const ap = this.autoPour;
      ap.t += dt;
      const k = clamp(ap.t / 0.35, 0, 1);
      this._pourTarget.set(ap.x, waterTopY + 7.2, ap.z);
      this.bottle.setTarget(this._pourTarget);
      this.bottle.clampTarget();
      tilt = POUR_TILT * k;
      if (ap.t > ap.dur) {
        this.autoPour = null;
        this.bottle.release();
        this.bottle.setTilt(this.manualTilt);
        this.audio.drop();
      }
    } else if (this.pourHeld) {
      tilt = POUR_TILT;
    }
    this.bottle.setTilt(tilt);
    this.bottle.update(dt, t);

    /* --- world / day-night --- */
    this.world.update(dt, t);
    this.world.billboardRays(this.camera);
    if (this.world.night !== this.lastNight) {
      this.lastNight = this.world.night;
      if (this.world.night) this.ui.toast('夜深了，小鱼开始打盹', '');
    }

    /* --- food --- */
    this.food.update(dt, t, {
      onSplash: (x, z, sp) => {
        this.ripples.spawn(x, z, clamp(sp / 9, 0.3, 1.3));
        this.bubbles.burst(x, waterTopY - 0.25, z, 4, 0.35);
        this.audio.splash(clamp(sp / 11, 0.25, 1.4));
      },
      onDissolve: () => { st.clean = clamp(st.clean - 0.7, 0, 100); }
    });

    /* --- fish --- */
    const ctx = {
      sat: st.sat, mood: st.mood, night: this.world.night,
      cruise: 3.1, accel: 7.5, speedMul: s.speed / 100,
      foods: this.food.items, fishes: this.fishes,
      onEat: (f, fd) => this.onEat(f, fd)
    };
    for (const f of this.fishes) {
      f.update(dt, t, ctx);
      if (f.poopAt && t > f.poopAt) {
        f.poopAt = 0;
        if (this.waste.spawn(f.pos.x, f.pos.z)) {
          st.clean = clamp(st.clean - 5, 0, 100);
          this.audio.poop();
          this.ui.floatNum(f.pos, this.camera, this.vw, this.vh, '−5 水质', '#ff4d5e');
        }
      }
      if (Math.random() < dt * 0.12) this.bubbles.spawn(f.pos.x, f.pos.y + 0.2, f.pos.z, rand(0.1, 0.22), rand(0.8, 1.6));
    }

    /* --- critters --- */
    this.critters.update(dt, t, {
      foods: this.food.items, night: this.world.night,
      onScavenge: (fd) => this.onScavenge(fd),
      bubbles: (x, y, z, n) => this.bubbles.burst(x, y, z, n, 0.3)
    });

    /* --- ambient bubbles --- */
    this.bubbleAcc += dt * (s.bub / 100) * 14;
    while (this.bubbleAcc >= 1) {
      this.bubbleAcc -= 1;
      const bp = this.world.bubblerPos;
      this.bubbles.spawn(bp.x + rand(-0.35, 0.35), bp.y, bp.z + rand(-0.35, 0.35), rand(0.12, 0.34), rand(1.1, 2.4));
    }
    if (Math.random() < dt * (s.bub / 100) * 1.6) {
      this.bubbles.spawn(rand(-12, 12), sandY + 0.3, rand(-7, 7), rand(0.08, 0.2), rand(0.7, 1.4));
    }
    this.bubbles.update(dt, t);
    this.sparks.update(dt);
    this.ripples.update(dt);
    this.waste.update(dt);

    /* --- stats --- */
    st.tick(dt, this.waste.items.length);
    if (st.sat < 14 && Math.random() < dt * 0.06) this.ui.toast('小鱼快饿扁了 · 赶紧投喂', 'bad');
    else if (st.clean < 25 && Math.random() < dt * 0.04) this.ui.toast('水质很差了 · 点清洁换水', 'warn');

    /* --- thoughts --- */
    this.thoughtAt -= dt;
    if (this.thoughtAt <= 0 && this.fishes.length) {
      this.thoughtAt = rand(4.5, 9);
      const f = pick(this.fishes);
      this.ui.say(f, thoughtFor(f, st, this.world.night), t, 3.4);
    }

    /* --- camera --- */
    this.rig.update(dt, t);
    if (this.rig.preset === 'follow' && !this.rig.followObj && this.fishes.length) this.rig.setFollow(this.fishes[0]);

    /* --- save --- */
    st.flush(t);

    /* --- render --- */
    this.post.render(t, this.camera.position.y < waterTopY);
    if (this.wantShot) { this.wantShot = false; this.screenshot(); }

    /* --- HUD --- */
    this.ui.frame(dt, t, {
      state: st, fishCount: this.fishes.length, bottleCount: this.bottle.count,
      bottleHeld: this.bottle.state !== 'docked',
      tiltDeg: this.bottle.tilt * 180 / Math.PI,
      zoom01: this.rig.zoom01, dayT: this.world.dayT, night: this.world.night,
      day: Math.floor((Date.now() - st.created) / 86400000) + 1,
      wasteCount: this.waste.items.length, cool: this.cool, coolMax: COOL_MAX,
      camera: this.camera, w: this.vw, h: this.vh, fishes: this.fishes,
      selected: this.selected, tags: s.tags, thoughts: s.thought, t
    });
  }
}

const app = new App();
app.boot().catch((e) => {
  console.error(e);
  const m = document.getElementById('bootMsg');
  if (m) m.textContent = '初始化失败：' + (e && e.message ? e.message : e);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const reg = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') reg();
  else window.addEventListener('load', reg);
}