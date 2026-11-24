import * as THREE from '../vendor/three.module.js';
import { clamp, fmtClock, dayPhaseName } from './util.js';
import { SPECIES } from './fish.js';
import { GUESTS, GUEST_KEYS } from './critters.js';
import { FISH_MAX, GUEST_MAX, xpNeed } from './state.js';
import { grainDataURL } from './textures.js';

const $ = (id) => document.getElementById(id);
const CAM_ORDER = ['free', 'front', 'top', 'side', 'under', 'follow'];
const CAM_LABEL = { free: '自由环绕', front: '正面全景', top: '俯瞰水面', side: '侧面剖面', under: '水下潜视', follow: '跟随小鱼' };

export class UI {
  constructor(api) {
    this.api = api;
    this.el = {
      gl: $('gl'), fx: $('fxLayer'), grain: $('grain'),
      petChip: $('petChip'), petName: $('petName'), petSub: $('petSub'), xpRing: $('xpRing'),
      clockChip: $('clockChip'), clockIcon: $('clockIcon'), clockText: $('clockText'),
      btnSound: $('btnSound'), soundIcon: $('soundIcon'), btnHelp: $('btnHelp'), btnSettings: $('btnSettings'),
      fillSat: $('fillSat'), valSat: $('valSat'), fillMood: $('fillMood'), valMood: $('valMood'),
      fillClean: $('fillClean'), valClean: $('valClean'),
      camRail: $('camRail'), btnAutoRot: $('btnAutoRot'), zoom: $('zoomSlider'),
      bottleHud: $('bottleHud'), bottleCount: $('bottleCount'), bottleBar: $('bottleBar'),
      btnPour: $('btnPour'), btnRefill: $('btnRefill'),
      console: $('console'), ctlTilt: $('ctlTilt'), sTilt: $('sTilt'), vTilt: $('vTilt'),
      sLight: $('sLight'), vLight: $('vLight'), sWave: $('sWave'), vWave: $('vWave'),
      sBub: $('sBub'), vBub: $('vBub'), sSpeed: $('sSpeed'), vSpeed: $('vSpeed'),
      sGlow: $('sGlow'), vGlow: $('vGlow'),
      fishMinus: $('fishMinus'), fishPlus: $('fishPlus'), vFish: $('vFish'),
      cWater: $('cWater'), tCycle: $('tCycle'), tGrid: $('tGrid'), tThought: $('tThought'),
      segQuality: $('segQuality'), btnRandom: $('btnRandom'), btnShot: $('btnShot'), btnResetScene: $('btnResetScene'),
      btnFeed: $('btnFeed'), btnPlay: $('btnPlay'), btnClean: $('btnClean'), btnFish: $('btnFish'), btnGuest: $('btnGuest'),
      poopBadge: $('poopBadge'), toast: $('toast'), banner: $('banner'), bannerT: $('bannerT'), bannerS: $('bannerS'),
      scrim: $('scrim'),
      sheetSettings: $('sheetSettings'), sheetGuests: $('sheetGuests'), sheetFish: $('sheetFish'),
      sheetDetail: $('sheetDetail'), sheetHelp: $('sheetHelp'), sheetInstall: $('sheetInstall'),
      sVolume: $('sVolume'), sSens: $('sSens'), sDayLen: $('sDayLen'),
      tHaptic: $('tHaptic'), tTags: $('tTags'), tRays: $('tRays'),
      btnInstall: $('btnInstall'), btnReset: $('btnReset'),
      guestGrid: $('guestGrid'), guestSlots: $('guestSlots'), btnGuestRandom: $('btnGuestRandom'),
      fishGrid: $('fishGrid'), fishSlots: $('fishSlots'), btnAddFish: $('btnAddFish'), btnSchool: $('btnSchool'),
      fhHero: $('fhHero'), fhName: $('fhName'), fhSpecies: $('fhSpecies'), fhAge: $('fhAge'),
      fhSize: $('fhSize'), fhEaten: $('fhEaten'), fhTrait: $('fhTrait'),
      fhFocus: $('fhFocus'), fhFeed: $('fhFeed'), fhRelease: $('fhRelease'),
      boot: $('boot'), bootBar: $('bootBar'), bootMsg: $('bootMsg'), bootStart: $('bootStart')
    };
    this.gauges = Array.from(document.querySelectorAll('.gauge'));
    this.camBtns = Array.from(document.querySelectorAll('.cam-btn[data-cam]'));
    this.coolEls = {
      feed: this.el.btnFeed.querySelector('.cool'),
      play: this.el.btnPlay.querySelector('.cool'),
      clean: this.el.btnClean.querySelector('.cool')
    };
    this.overlays = new Map();
    this.detailFish = null;
    this.openSheetEl = null;
    this._toastTimer = 0;
    this._bannerTimer = 0;
    this._resetArmed = 0;
    this._tiltDrag = false;
    this._zoomDrag = false;
    this._hudAt = 0;
    this._v = new THREE.Vector3();
    this._deferredPrompt = null;
    this.el.grain.style.setProperty('--grain-url', `url("${grainDataURL()}")`);
    this.bind();
  }

  /* ---------------- binding ---------------- */
  bind() {
    const a = this.api, e = this.el;

    const tap = (el, fn) => {
      if (!el) return;
      el.addEventListener('click', (ev) => { ev.preventDefault(); fn(ev); });
    };

    tap(e.petChip, () => this.openSheet(e.sheetFish));
    tap(e.btnHelp, () => { a.sfx('click'); this.openSheet(e.sheetHelp); });
    tap(e.btnSettings, () => { a.sfx('click'); this.openSheet(e.sheetSettings); });
    tap(e.btnSound, () => a.toggleSound());

    for (const b of this.camBtns) tap(b, () => a.setCam(b.dataset.cam));
    tap(e.btnAutoRot, () => a.toggleAutoRot());

    e.zoom.addEventListener('pointerdown', () => { this._zoomDrag = true; });
    window.addEventListener('pointerup', () => { this._zoomDrag = false; this._tiltDrag = false; });
    e.zoom.addEventListener('input', () => a.setZoom(Number(e.zoom.value) / 100));

    const slider = (el, out, key, fmt) => {
      el.addEventListener('input', () => {
        const v = Number(el.value);
        out.textContent = fmt ? fmt(v) : String(v);
        a.setParam(key, v);
      });
      el.addEventListener('change', () => a.sfx('tick'));
    };
    slider(e.sLight, e.vLight, 'light');
    slider(e.sWave, e.vWave, 'wave');
    slider(e.sBub, e.vBub, 'bub');
    slider(e.sSpeed, e.vSpeed, 'speed');
    slider(e.sGlow, e.vGlow, 'glow');
    e.sTilt.addEventListener('pointerdown', () => { this._tiltDrag = true; });
    e.sTilt.addEventListener('input', () => {
      const v = Number(e.sTilt.value);
      e.vTilt.textContent = v + '°';
      a.setParam('tilt', v);
    });

    tap(e.fishMinus, () => a.removeLastFish());
    tap(e.fishPlus, () => a.addFish());
    e.cWater.addEventListener('input', () => a.setParam('waterColor', e.cWater.value));

    const toggle = (el, key) => tap(el, () => a.setParam(key, !el.classList.contains('on')));
    toggle(e.tCycle, 'cycle');
    toggle(e.tGrid, 'grid');
    toggle(e.tThought, 'thought');
    toggle(e.tHaptic, 'haptic');
    toggle(e.tTags, 'tags');
    toggle(e.tRays, 'rays');

    for (const b of e.segQuality.querySelectorAll('button')) tap(b, () => a.setParam('quality', b.dataset.q));

    tap(e.btnRandom, () => a.randomizeScene());
    tap(e.btnShot, () => a.screenshot());
    tap(e.btnResetScene, () => a.resetScene());

    tap(e.btnFeed, () => a.feed());
    tap(e.btnPlay, () => a.play());
    tap(e.btnClean, () => a.clean());
    tap(e.btnFish, () => { a.sfx('click'); this.renderFishGrid(); this.openSheet(e.sheetFish); });
    tap(e.btnGuest, () => { a.sfx('click'); this.renderGuestGrid(); this.openSheet(e.sheetGuests); });

    const pourDown = (ev) => { ev.preventDefault(); e.btnPour.classList.add('held'); a.pourStart(); };
    const pourUp = () => { if (e.btnPour.classList.contains('held')) { e.btnPour.classList.remove('held'); a.pourEnd(); } };
    e.btnPour.addEventListener('pointerdown', pourDown);
    e.btnPour.addEventListener('pointerup', pourUp);
    e.btnPour.addEventListener('pointercancel', pourUp);
    e.btnPour.addEventListener('pointerleave', pourUp);
    tap(e.btnRefill, () => a.refill());

    e.sVolume.addEventListener('input', () => a.setParam('volume', Number(e.sVolume.value)));
    e.sSens.addEventListener('input', () => a.setParam('sens', Number(e.sSens.value) / 100));
    e.sDayLen.addEventListener('input', () => a.setParam('dayLen', Number(e.sDayLen.value)));

    tap(e.btnInstall, () => this.doInstall());
    tap(e.btnReset, () => {
      const now = performance.now();
      if (now < this._resetArmed) { this._resetArmed = 0; e.btnReset.textContent = '重新养一缸鱼'; a.resetAll(); }
      else {
        this._resetArmed = now + 3500;
        e.btnReset.textContent = '确认清空？再点一次';
        a.sfx('err');
        setTimeout(() => { if (performance.now() >= this._resetArmed) { e.btnReset.textContent = '重新养一缸鱼'; this._resetArmed = 0; } }, 3600);
      }
    });

    tap(e.btnAddFish, () => { a.addFish(); this.renderFishGrid(); });
    tap(e.btnSchool, () => { a.addSchool(); this.renderFishGrid(); });
    tap(e.btnGuestRandom, () => { a.randomGuest(); this.renderGuestGrid(); });

    e.fhName.addEventListener('change', () => {
      if (this.detailFish) a.renameFish(this.detailFish, e.fhName.value.trim() || this.detailFish.name);
    });
    tap(e.fhFocus, () => { if (this.detailFish) { a.focusFish(this.detailFish); this.closeSheets(); } });
    tap(e.fhFeed, () => { if (this.detailFish) { a.feedFish(this.detailFish); this.closeSheets(); } });
    tap(e.fhRelease, () => { if (this.detailFish) { a.releaseFish(this.detailFish); this.closeSheets(); } });

    for (const s of document.querySelectorAll('.sheet')) {
      for (const b of s.querySelectorAll('[data-close]')) tap(b, () => this.closeSheets());
    }
    tap(e.scrim, () => this.closeSheets());

    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { if (ev.key === 'Escape') ev.target.blur(); return; }
      const k = ev.key.toLowerCase();
      if (k === 'escape') { this.closeSheets(); return; }
      if (k === 'f') a.feed();
      else if (k === 'p') a.play();
      else if (k === 'c') a.clean();
      else if (k === 'r') a.toggleAutoRot();
      else if (k === ' ') { ev.preventDefault(); if (!ev.repeat) { e.btnPour.classList.add('held'); a.pourStart(); } }
      else if (k >= '1' && k <= '6') a.setCam(CAM_ORDER[Number(k) - 1]);
      else if (k === 'h') this.openSheet(e.sheetHelp);
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.key === ' ') { e.btnPour.classList.remove('held'); a.pourEnd(); }
    });
    window.addEventListener('blur', () => { e.btnPour.classList.remove('held'); a.pourEnd(); });

    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      this._deferredPrompt = ev;
      e.btnInstall.textContent = '立即安装到桌面';
    });
    window.addEventListener('appinstalled', () => {
      this._deferredPrompt = null;
      e.btnInstall.textContent = '已安装 ✓';
      this.toast('已安装到主屏幕，离线也能玩', 'good');
    });

    document.addEventListener('visibilitychange', () => { if (document.hidden) { e.btnPour.classList.remove('held'); a.pourEnd(); } });
    window.addEventListener('contextmenu', (ev) => { if (ev.target === e.gl) ev.preventDefault(); });
  }

  /* ---------------- boot ---------------- */
  boot(p, msg) {
    this.el.bootBar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
    if (msg) this.el.bootMsg.textContent = msg;
  }
  bootReady() { this.el.bootStart.classList.add('ready'); this.el.bootMsg.textContent = '准备就绪'; }
  bootHide() { this.el.boot.classList.add('gone'); }
  bootError(msg) {
    this.el.bootMsg.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'boot-err';
    d.textContent = msg;
    this.el.bootMsg.appendChild(d);
    this.el.bootStart.classList.remove('ready');
  }

  /* ---------------- feedback ---------------- */
  toast(msg, kind, actLabel, actFn) {
    const t = this.el.toast;
    t.textContent = msg;
    t.className = 'on' + (kind ? ' ' + kind : '');
    if (actLabel && actFn) {
      const b = document.createElement('button');
      b.className = 'toast-act';
      b.textContent = actLabel;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); actFn(); this.hideToast(); });
      t.appendChild(b);
    }
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.hideToast(), actLabel ? 5200 : 2600);
  }
  hideToast() { this.el.toast.className = ''; }

  banner(title, sub) {
    this.el.bannerT.textContent = title;
    this.el.bannerS.textContent = sub || '';
    this.el.banner.classList.remove('on');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('on');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('on'), 2200);
  }

  floatNum(pos, camera, w, h, text, color) {
    this._v.copy(pos).project(camera);
    if (this._v.z > 1) return;
    const d = document.createElement('div');
    d.className = 'float-num';
    d.textContent = text;
    d.style.color = color || '#ffab2e';
    d.style.left = ((this._v.x * 0.5 + 0.5) * w) + 'px';
    d.style.top = ((-this._v.y * 0.5 + 0.5) * h) + 'px';
    this.el.fx.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  /* ---------------- sheets ---------------- */
  openSheet(el) {
    if (!el) return;
    this.closeSheets(true);
    this.openSheetEl = el;
    el.classList.add('on');
    this.el.scrim.classList.add('on');
    this.api.sfx('click');
    const body = el.querySelector('.sheet-body');
    if (body) body.scrollTop = 0;
  }
  closeSheets(silent) {
    for (const s of document.querySelectorAll('.sheet.on')) s.classList.remove('on');
    this.el.scrim.classList.remove('on');
    this.openSheetEl = null;
    if (!silent) this.api.sfx('tick');
  }
  get sheetOpen() { return !!this.openSheetEl; }

  /* ---------------- grids ---------------- */
  card(color, icon, name, sub, tag, onClick) {
    const b = document.createElement('button');
    b.className = 'g-card';
    b.style.setProperty('--gc', color);
    b.innerHTML = `<span class="g-orb"><svg aria-hidden="true"><use href="#${icon}"/></svg></span><b></b><small></small><span class="g-tag"></span>`;
    b.querySelector('b').textContent = name;
    b.querySelector('small').textContent = sub;
    b.querySelector('.g-tag').textContent = tag;
    b.addEventListener('click', onClick);
    return b;
  }

  renderFishGrid() {
    const g = this.el.fishGrid;
    g.innerHTML = '';
    const fishes = this.api.fishes;
    this.el.fishSlots.textContent = `${fishes.length} / ${FISH_MAX}`;
    if (!fishes.length) {
      const p = document.createElement('p');
      p.style.cssText = 'grid-column:1/-1;font-size:12px;color:#8fa9b8;line-height:1.9;text-align:center;margin:6px 0';
      p.textContent = '鱼缸空空的，添加一条小鱼吧。';
      g.appendChild(p);
    }
    for (const f of fishes) {
      const sp = SPECIES[f.key];
      g.appendChild(this.card(sp.skin.base, 'i-fish', f.name, sp.latin, `吃了 ${f.eaten}`, () => this.openDetail(f)));
    }
    if (fishes.length < FISH_MAX) {
      const c = this.card('#22e3ff', 'i-dice', '随机领一条', 'RANDOM', '试试手气', () => {
        this.api.addFish();
        this.renderFishGrid();
      });
      c.style.opacity = '.86';
      g.appendChild(c);
    }
    this.el.btnAddFish.disabled = fishes.length >= FISH_MAX;
    this.el.btnSchool.disabled = fishes.length + 6 > FISH_MAX;
  }

  renderGuestGrid() {
    const g = this.el.guestGrid;
    g.innerHTML = '';
    const active = this.api.guestKeys();
    this.el.guestSlots.textContent = `${active.length} / ${GUEST_MAX}`;
    for (const key of GUEST_KEYS) {
      const m = GUESTS[key];
      const on = active.includes(key);
      const full = !on && active.length >= GUEST_MAX;
      const c = this.card(m.color, m.icon, m.name, m.latin, on ? '在做客 ✓' : full ? '缸满了' : '邀请', () => {
        this.api.toggleGuest(key);
        this.renderGuestGrid();
      });
      if (on) c.style.borderColor = m.color;
      if (full) c.style.opacity = '.45';
      g.appendChild(c);
    }
  }

  openDetail(f) {
    this.detailFish = f;
    const sp = SPECIES[f.key];
    this.el.fhHero.style.setProperty('--gc', sp.skin.base);
    this.el.fhName.value = f.name;
    this.el.fhSpecies.textContent = `${sp.name} · ${sp.latin}`;
    const days = Math.max(1, Math.floor((Date.now() - f.born) / 86400000) + 1);
    this.el.fhAge.textContent = `${days} 天`;
    this.el.fhSize.textContent = `${(sp.L * f.scaleNow * 4.2).toFixed(1)} cm`;
    this.el.fhEaten.textContent = `${f.eaten} 粒`;
    this.el.fhTrait.textContent = sp.trait;
    this.openSheet(this.el.sheetDetail);
  }

  /* ---------------- settings sync ---------------- */
  applySettings(s) {
    const e = this.el;
    e.sLight.value = s.light; e.vLight.textContent = s.light;
    e.sWave.value = s.wave; e.vWave.textContent = s.wave;
    e.sBub.value = s.bub; e.vBub.textContent = s.bub;
    e.sSpeed.value = s.speed; e.vSpeed.textContent = s.speed;
    e.sGlow.value = s.glow; e.vGlow.textContent = s.glow;
    e.cWater.value = s.waterColor;
    e.sVolume.value = Math.round(s.volume * 100);
    e.sSens.value = Math.round(s.sens * 100);
    e.sDayLen.value = s.dayLen;
    this.setToggle(e.tCycle, s.cycle);
    this.setToggle(e.tGrid, s.grid);
    this.setToggle(e.tThought, s.thought);
    this.setToggle(e.tHaptic, s.haptic);
    this.setToggle(e.tTags, s.tags);
    this.setToggle(e.tRays, s.rays);
    this.setToggle(e.btnAutoRot, s.autoRot);
    for (const b of e.segQuality.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === s.quality);
    this.setCamActive(s.cam);
    this.setSound(!s.muted);
  }
  setToggle(el, on) { el.classList.toggle('on', !!on); el.setAttribute('aria-checked', on ? 'true' : 'false'); }
  setCamActive(name) { for (const b of this.camBtns) b.classList.toggle('on', b.dataset.cam === name); }
  setSound(on) {
    this.el.soundIcon.setAttribute('href', on ? '#i-sound' : '#i-mute');
    this.el.btnSound.classList.toggle('off', !on);
    this.el.btnSound.setAttribute('aria-label', on ? '关闭声音' : '打开声音');
  }

  async doInstall() {
    if (this._deferredPrompt) {
      this._deferredPrompt.prompt();
      try { await this._deferredPrompt.userChoice; } catch (e) { /* dismissed */ }
      this._deferredPrompt = null;
      return;
    }
    this.openSheet(this.el.sheetInstall);
  }

  /* ---------------- per-frame ---------------- */
  frame(dt, t, info) {
    const e = this.el, st = info.state;
    if (t > this._hudAt) {
      this._hudAt = t + 0.12;
      this.gauge(e.fillSat, e.valSat, st.sat, 0);
      this.gauge(e.fillMood, e.valMood, st.mood, 1);
      this.gauge(e.fillClean, e.valClean, st.clean, 2);
      e.vFish.textContent = info.fishCount;
      e.bottleCount.textContent = info.bottleCount;
      e.bottleBar.style.width = (info.bottleCount / 60 * 100) + '%';
      e.btnPour.disabled = info.bottleCount <= 0;
      e.btnRefill.disabled = info.bottleCount >= 60;
      e.bottleHud.classList.toggle('active', info.bottleHeld);
      e.ctlTilt.classList.toggle('hot', info.tiltDeg > 8);
      if (!this._tiltDrag) { e.sTilt.value = Math.round(info.tiltDeg); e.vTilt.textContent = Math.round(info.tiltDeg) + '°'; }
      if (!this._zoomDrag) e.zoom.value = Math.round(info.zoom01 * 100);
      e.clockText.textContent = `${fmtClock(info.dayT)} ${dayPhaseName(info.dayT)}`;
      e.clockIcon.setAttribute('href', info.night ? '#i-moon' : '#i-sun');
      e.clockChip.classList.toggle('night', info.night);
      e.petName.textContent = st.tankName;
      e.petSub.textContent = `LV.${st.level} · ${info.fishCount} 条 · DAY ${info.day}`;
      const need = xpNeed(st.level);
      e.xpRing.setAttribute('stroke-dashoffset', String(110 * (1 - clamp(st.xp / need, 0, 1))));
      const poop = info.wasteCount;
      e.poopBadge.hidden = poop === 0;
      e.poopBadge.textContent = poop;
      e.btnClean.classList.toggle('need', poop > 0);
      if (this.detailFish && this.openSheetEl === e.sheetDetail) {
        e.fhEaten.textContent = `${this.detailFish.eaten} 粒`;
        e.fhSize.textContent = `${(SPECIES[this.detailFish.key].L * this.detailFish.scaleNow * 4.2).toFixed(1)} cm`;
      }
    }
    for (const k of ['feed', 'play', 'clean']) {
      const c = info.cool[k];
      const el = this.coolEls[k];
      el.style.transform = `scaleY(${c > 0 ? clamp(c / info.coolMax[k], 0, 1) : 0})`;
      const btn = k === 'feed' ? e.btnFeed : k === 'play' ? e.btnPlay : e.btnClean;
      btn.disabled = c > 0;
    }
    this.syncOverlays(info);
  }

  gauge(fill, val, v, i) {
    const n = Math.round(v);
    fill.style.width = clamp(v, 0, 100) + '%';
    if (val.textContent !== String(n)) val.textContent = n;
    this.gauges[i].classList.toggle('low', v < 25);
  }

  syncOverlays(info) {
    const { camera, w, h, fishes, selected, tags, thoughts } = info;
    const seen = new Set();
    for (const f of fishes) {
      seen.add(f.id);
      let o = this.overlays.get(f.id);
      if (!o) {
        const tag = document.createElement('div');
        tag.className = 'name-tag';
        const bub = document.createElement('div');
        bub.className = 'bubble-thought';
        this.el.fx.appendChild(tag);
        this.el.fx.appendChild(bub);
        o = { tag, bub, text: '', until: 0 };
        this.overlays.set(f.id, o);
      }
      this._v.copy(f.pos);
      this._v.y += f.radius + 0.55;
      this._v.project(camera);
      const vis = this._v.z < 1 && this._v.x > -1.25 && this._v.x < 1.25 && this._v.y > -1.3 && this._v.y < 1.3;
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      const showTag = vis && (tags || selected === f);
      o.tag.classList.toggle('on', showTag);
      o.tag.classList.toggle('sel', selected === f);
      if (showTag) {
        if (o.tag.textContent !== f.name) o.tag.textContent = f.name;
        o.tag.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
      }
      const showBub = vis && thoughts && o.until > info.t;
      o.bub.classList.toggle('on', showBub);
      if (showBub) {
        if (o.text !== o.bub.textContent) o.bub.textContent = o.text;
        o.bub.style.transform = `translate3d(${x.toFixed(1)}px,${(y - 16).toFixed(1)}px,0) translate(-50%,-100%)`;
      }
    }
    for (const [id, o] of this.overlays) {
      if (!seen.has(id)) { o.tag.remove(); o.bub.remove(); this.overlays.delete(id); }
    }
  }

  say(f, text, t, dur) {
    let o = this.overlays.get(f.id);
    if (!o) {
      const tag = document.createElement('div'); tag.className = 'name-tag';
      const bub = document.createElement('div'); bub.className = 'bubble-thought';
      this.el.fx.appendChild(tag); this.el.fx.appendChild(bub);
      o = { tag, bub, text: '', until: 0 };
      this.overlays.set(f.id, o);
    }
    o.text = text;
    o.until = t + (dur || 3);
  }

  clearOverlays() {
    for (const [, o] of this.overlays) { o.tag.remove(); o.bub.remove(); }
    this.overlays.clear();
  }
}

export { CAM_ORDER, CAM_LABEL };