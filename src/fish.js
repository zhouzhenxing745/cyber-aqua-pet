import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp, rand, pick, rnd, TAU, noise1 } from './util.js';
import { fishSkin, finTexture } from './textures.js';

/* ============================================================
   parametric body: elliptical rings from nose(+Z) to tail(-Z)
   ============================================================ */
const STD = [
  [0.00, 0.03, 0.04], [0.05, 0.30, 0.44], [0.13, 0.63, 0.80], [0.25, 0.89, 1.00],
  [0.38, 1.00, 0.99], [0.52, 0.95, 0.88], [0.66, 0.78, 0.70], [0.79, 0.52, 0.47],
  [0.90, 0.28, 0.28], [1.00, 0.15, 0.17]
];

function buildBody(L, W, H, profile, rings = 26, segs = 16) {
  const pos = [], uv = [], idx = [];
  const noseZ = L * 0.5, tailZ = -L * 0.5;
  const sample = (t) => {
    let i = 0;
    while (i < profile.length - 2 && profile[i + 1][0] < t) i++;
    const a = profile[i], b = profile[i + 1];
    const k = clamp((t - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
    const s = k * k * (3 - 2 * k);
    return [lerp(a[1], b[1], s) * W, lerp(a[2], b[2], s) * H];
  };
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const z = lerp(noseZ, tailZ, t);
    const [w, h] = sample(t);
    for (let j = 0; j < segs; j++) {
      const a = Math.PI / 2 - (j / segs) * TAU;
      pos.push(Math.cos(a) * w, Math.sin(a) * h, z);
      uv.push(t, 1 - j / segs);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = i * segs + j, b = i * segs + j2, c = (i + 1) * segs + j, d = (i + 1) * segs + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const noseI = pos.length / 3;
  pos.push(0, 0, noseZ + W * 0.06); uv.push(0, 0.5);
  for (let j = 0; j < segs; j++) idx.push(noseI, j, (j + 1) % segs);
  const tailI = pos.length / 3;
  pos.push(0, 0, tailZ); uv.push(1, 0.5);
  const base = (rings - 1) * segs;
  for (let j = 0; j < segs; j++) idx.push(tailI, base + (j + 1) % segs, base + j);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function shapeGeo(pts, close = true) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else s.lineTo(p[0], p[1]);
  }
  if (close) s.closePath();
  return new THREE.ShapeGeometry(s, 10);
}

const CAUDAL = shapeGeo([[0, 0.17], [0.98, 0.92], [0.60, 0.16], [0.60, -0.16], [0.98, -0.92], [0, -0.17]]);
const CAUDAL_FAN = shapeGeo([[0, 0.14], [0.55, 0.95, 1.05, 0.55], [1.15, 0, 1.05, -0.55], [0.55, -0.95, 0, -0.14]]);
const DORSAL = shapeGeo([[0, 0], [0.22, 0.62, 0.52, 0.5], [0.95, 0.12, 1.05, 0]]);
const PECT = shapeGeo([[0, 0], [0.62, 0.34, 0.86, 0.06], [0.72, -0.26, 0, -0.16]]);
const FILAMENT = shapeGeo([[0, 0], [0.1, -0.9, 0.02, -1.7], [-0.06, -1.6, -0.08, 0]]);

/* ============================================================
   species
   ============================================================ */
export const SPECIES = {
  koi: {
    name: '锦鲤', latin: 'KOI', L: 2.7, W: 0.52, H: 0.62, tail: 1.25, fan: true, dorsal: 1.0,
    speed: 0.92, trait: '温顺 · 贪吃',
    skin: { base: '#ff8a4c', dorsal: '#d94f1e', belly: '#fff4e6', lateral: '#ffa76b', accent: '#ff6a2a', accent2: '#2a2a33', pattern: 'koi' }
  },
  clown: {
    name: '小丑鱼', latin: 'CLOWN', L: 1.75, W: 0.40, H: 0.55, tail: 0.85, dorsal: 0.8,
    speed: 1.12, trait: '活泼 · 好奇',
    skin: { base: '#ff7a1f', dorsal: '#d94e08', belly: '#ffd9a8', lateral: '#ff9440', accent: '#fff6ec', accent2: '#181410', pattern: 'bands' }
  },
  tang: {
    name: '蓝吊', latin: 'TANG', L: 2.05, W: 0.34, H: 0.78, tail: 0.9, dorsal: 1.15,
    speed: 1.05, trait: '机敏 · 爱游',
    skin: { base: '#2f6dff', dorsal: '#12309e', belly: '#8fc4ff', lateral: '#3f86ff', accent: '#ffd23f', accent2: '#0a1030', pattern: 'tang' }
  },
  gold: {
    name: '琉金', latin: 'GOLD', L: 1.95, W: 0.62, H: 0.74, tail: 1.5, fan: true, dorsal: 1.1,
    speed: 0.8, trait: '慵懒 · 优雅',
    profile: [[0, 0.03, 0.05], [0.06, 0.42, 0.56], [0.16, 0.78, 0.92], [0.3, 1.0, 1.0], [0.45, 0.98, 0.96], [0.6, 0.82, 0.78], [0.75, 0.55, 0.5], [0.88, 0.3, 0.28], [1, 0.16, 0.18]],
    skin: { base: '#ff9d2e', dorsal: '#e05a10', belly: '#ffe9c4', lateral: '#ffb85c', accent: '#fff0d0', accent2: '#c94a08', pattern: 'plain' }
  },
  angel: {
    name: '神仙鱼', latin: 'ANGEL', L: 1.55, W: 0.22, H: 0.95, tail: 0.8, dorsal: 2.0, anal: 1.9, filaments: true,
    speed: 0.78, trait: '安静 · 高冷',
    profile: [[0, 0.05, 0.06], [0.08, 0.42, 0.5], [0.2, 0.8, 0.92], [0.36, 1.0, 1.0], [0.52, 0.94, 0.94], [0.68, 0.7, 0.66], [0.84, 0.4, 0.34], [1, 0.18, 0.16]],
    skin: { base: '#dfe9f2', dorsal: '#8fa4b8', belly: '#ffffff', lateral: '#eef5fb', accent: '#ffd98a', accent2: '#1d2430', pattern: 'bars' }
  },
  guppy: {
    name: '孔雀鱼', latin: 'GUPPY', L: 1.25, W: 0.24, H: 0.34, tail: 1.7, fan: true, dorsal: 0.7,
    speed: 1.2, trait: '灵动 · 炫彩',
    skin: { base: '#37d6c0', dorsal: '#1a8f9e', belly: '#d8fff4', lateral: '#5ce8d4', accent: '#ff3d8b', accent2: '#a06bff', pattern: 'spots' }
  },
  neon: {
    name: '霓虹灯', latin: 'NEON', L: 0.82, W: 0.15, H: 0.22, tail: 0.7, dorsal: 0.55, school: true,
    speed: 1.35, trait: '群游 · 胆小',
    skin: { base: '#b9d9e8', dorsal: '#5c7f96', belly: '#f2fbff', lateral: '#cfe8f4', accent: '#22e3ff', accent2: '#ff3d5e', pattern: 'neon', scales: false }
  },
  puffer: {
    name: '河豚', latin: 'PUFFER', L: 1.5, W: 0.66, H: 0.66, tail: 0.6, dorsal: 0.5, spikes: true,
    speed: 0.66, trait: '憨厚 · 慢热',
    profile: [[0, 0.06, 0.08], [0.08, 0.5, 0.55], [0.2, 0.85, 0.9], [0.36, 1.0, 1.0], [0.54, 0.98, 0.98], [0.7, 0.82, 0.82], [0.85, 0.5, 0.5], [1, 0.2, 0.2]],
    skin: { base: '#f2d271', dorsal: '#b8912f', belly: '#fff8e0', lateral: '#f7e09a', accent: '#6b5a2a', accent2: '#3a3018', pattern: 'spots' }
  },
  arowana: {
    name: '金龙鱼', latin: 'AROWANA', L: 3.3, W: 0.36, H: 0.5, tail: 0.85, dorsal: 1.4, rearDorsal: true,
    speed: 0.98, trait: '威严 · 巡游',
    profile: [[0, 0.05, 0.08], [0.06, 0.44, 0.6], [0.16, 0.78, 0.94], [0.3, 0.96, 1.0], [0.5, 1.0, 0.98], [0.68, 0.92, 0.86], [0.84, 0.66, 0.6], [1, 0.26, 0.26]],
    skin: { base: '#e8c34a', dorsal: '#8f6b12', belly: '#fff2c0', lateral: '#f5d868', accent: '#fff0a8', accent2: '#6b4d0a', pattern: 'plain' }
  },
  ray: {
    name: '珍珠魟', latin: 'RAY', L: 1.9, W: 1.15, H: 0.2, tail: 0.4, dorsal: 0, wings: true,
    speed: 0.7, trait: '底栖 · 温柔',
    profile: [[0, 0.06, 0.2], [0.1, 0.55, 0.85], [0.24, 0.92, 1.0], [0.4, 1.0, 0.95], [0.58, 0.82, 0.7], [0.74, 0.5, 0.45], [0.88, 0.22, 0.25], [1, 0.08, 0.1]],
    skin: { base: '#4a4038', dorsal: '#241d18', belly: '#f0e6d8', lateral: '#5c5048', accent: '#f5e2b8', accent2: '#1a1410', pattern: 'spots' }
  }
};
export const SPECIES_KEYS = Object.keys(SPECIES);

/* shared caches */
const geoCache = new Map();
const skinCache = new Map();
let finTex = null;

function speciesGeo(key) {
  if (geoCache.has(key)) return geoCache.get(key);
  const sp = SPECIES[key];
  const g = buildBody(sp.L, sp.W, sp.H, sp.profile || STD, key === 'neon' ? 16 : 26, key === 'neon' ? 10 : 16);
  geoCache.set(key, g);
  return g;
}
function speciesSkin(key) {
  if (skinCache.has(key)) return skinCache.get(key);
  const t = fishSkin(Object.assign({ seed: key.length * 977 + 13 }, SPECIES[key].skin));
  skinCache.set(key, t);
  return t;
}

const EYE_W = new THREE.SphereGeometry(0.15, 12, 10);
const EYE_P = new THREE.SphereGeometry(0.085, 10, 8);
const EYE_H = new THREE.SphereGeometry(0.032, 6, 5);
const SPIKE = new THREE.ConeGeometry(0.045, 0.2, 5);
const MOUTH = new THREE.SphereGeometry(0.1, 10, 8);

const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0 });
const eyeDarkMat = new THREE.MeshStandardMaterial({ color: 0x0a141c, roughness: 0.15, metalness: 0.1 });
const eyeHiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x5c2430, roughness: 0.6 });

const NAMES = ['小蓝', '阿橘', '泡泡', '闪电', '奶糖', '墨墨', '珊瑚', '月牙', '柚子', '海苔', '团子', '波妞', '星尘', '布丁', '浪花', '琥珀'];

let uid = 0;

export class Fish {
  constructor(key, bounds, opts = {}) {
    const sp = SPECIES[key] || SPECIES.koi;
    this.id = ++uid;
    this.key = key;
    this.sp = sp;
    this.bounds = bounds;
    this.name = opts.name || pick(NAMES);
    this.born = opts.born || Date.now();
    this.eaten = 0;
    this.growth = opts.growth || 0;

    this.group = new THREE.Group();
    this.uniforms = { uPhase: { value: rnd() * TAU }, uAmp: { value: 0.06 }, uLen: { value: sp.L } };

    const skin = speciesSkin(key);
    this.bodyMat = new THREE.MeshStandardMaterial({
      map: skin, roughness: 0.42, metalness: key === 'arowana' ? 0.45 : 0.08,
      emissive: new THREE.Color(sp.skin.base), emissiveIntensity: 0.06
    });
    this.injectBend(this.bodyMat);
    this.body = new THREE.Mesh(speciesGeo(key), this.bodyMat);
    this.body.castShadow = true;
    this.group.add(this.body);

    if (!finTex) finTex = finTexture();
    this.finMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(sp.skin.accent || sp.skin.base),
      map: finTex, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
      roughness: 0.5, metalness: 0.05, depthWrite: false,
      emissive: new THREE.Color(sp.skin.base), emissiveIntensity: 0.14
    });

    this.tailPivot = new THREE.Group();
    this.tailPivot.position.set(0, 0, -sp.L * 0.5);
    const tailGeo = sp.fan ? CAUDAL_FAN : CAUDAL;
    const tail = new THREE.Mesh(tailGeo, this.finMat);
    tail.rotation.y = Math.PI / 2;
    tail.scale.setScalar(sp.tail);
    if (sp.fan) {
      const tail2 = new THREE.Mesh(tailGeo, this.finMat);
      tail2.rotation.y = Math.PI / 2;
      tail2.rotation.x = 0.42;
      tail2.scale.setScalar(sp.tail * 0.86);
      this.tailPivot.add(tail2);
    }
    this.tailPivot.add(tail);
    this.group.add(this.tailPivot);

    if (sp.dorsal > 0) {
      const d = new THREE.Mesh(DORSAL, this.finMat);
      d.rotation.y = Math.PI / 2;
      d.scale.set(sp.L * 0.42, sp.H * sp.dorsal, 1);
      d.position.set(0, sp.H * 0.82, sp.rearDorsal ? -sp.L * 0.24 : sp.L * 0.06);
      this.group.add(d);
      this.dorsal = d;
    }
    if (sp.anal || sp.dorsal > 0) {
      const a = new THREE.Mesh(DORSAL, this.finMat);
      a.rotation.y = Math.PI / 2;
      a.rotation.x = Math.PI;
      a.scale.set(sp.L * (sp.anal ? 0.4 : 0.24), sp.H * (sp.anal || 0.5), 1);
      a.position.set(0, -sp.H * 0.8, -sp.L * 0.16);
      this.group.add(a);
    }
    if (sp.filaments) {
      this.filaments = [];
      for (const sx of [1, -1]) {
        const f = new THREE.Mesh(FILAMENT, this.finMat);
        f.scale.set(sp.L * 0.5, sp.H * 0.9, 1);
        f.position.set(sx * sp.W * 0.4, -sp.H * 0.7, sp.L * 0.05);
        this.group.add(f);
        this.filaments.push(f);
      }
      const top = new THREE.Mesh(FILAMENT, this.finMat);
      top.rotation.z = Math.PI;
      top.scale.set(sp.L * 0.4, sp.H * 0.7, 1);
      top.position.set(0, sp.H * 0.9, sp.L * 0.1);
      this.group.add(top);
    }

    this.pectorals = [];
    const wingScale = sp.wings ? sp.W * 1.5 : sp.L * 0.3;
    for (const sx of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * sp.W * (sp.wings ? 0.55 : 0.82), -sp.H * 0.16, sp.L * 0.16);
      const fin = new THREE.Mesh(PECT, this.finMat);
      fin.scale.set(wingScale, wingScale * (sp.wings ? 0.85 : 0.6), 1);
      if (sx < 0) fin.scale.x *= -1;
      pivot.rotation.y = sx * (sp.wings ? 0.1 : 0.5);
      pivot.add(fin);
      this.group.add(pivot);
      this.pectorals.push({ pivot, sx, fin });
    }

    if (sp.spikes) {
      const up = new THREE.Vector3(0, 1, 0);
      const d = new THREE.Vector3();
      for (let i = 0; i < 30; i++) {
        const u = rnd() * 2 - 1, th = rnd() * TAU, sr = Math.sqrt(Math.max(0, 1 - u * u));
        d.set(Math.cos(th) * sr, u, Math.sin(th) * sr);
        if (d.z > 0.72) continue;
        const s = new THREE.Mesh(SPIKE, this.bodyMat);
        s.position.set(d.x * sp.W * 0.96, d.y * sp.H * 0.96, d.z * sp.L * 0.46);
        s.quaternion.setFromUnitVectors(up, d);
        this.body.add(s);
      }
    }

    this.eyes = [];
    const eyeY = sp.wings ? sp.H * 0.9 : sp.H * 0.3;
    const eyeX = sp.wings ? sp.W * 0.3 : sp.W * 0.78;
    const eyeZ = sp.L * (sp.wings ? 0.28 : 0.33);
    const eyeScale = clamp(sp.L * 0.62, 0.5, 1.25);
    for (const sx of [1, -1]) {
      const e = new THREE.Group();
      e.position.set(sx * eyeX, eyeY, eyeZ);
      e.scale.setScalar(eyeScale);
      const w = new THREE.Mesh(EYE_W, eyeWhiteMat);
      const p = new THREE.Mesh(EYE_P, eyeDarkMat);
      p.position.set(sx * 0.055, 0, 0.085);
      const h = new THREE.Mesh(EYE_H, eyeHiMat);
      h.position.set(sx * 0.02 + 0.04, 0.055, 0.125);
      e.add(w, p, h);
      this.group.add(e);
      this.eyes.push(e);
    }

    this.mouth = new THREE.Mesh(MOUTH, mouthMat);
    this.mouth.position.set(0, -sp.H * 0.14, sp.L * 0.47);
    this.mouth.scale.set(sp.W * 0.7, sp.H * 0.32, 0.5);
    this.group.add(this.mouth);
    this.mouthBase = this.mouth.scale.clone();

    this.baseScale = opts.scale || 1;
    this.group.scale.setScalar(this.baseScale);

    /* motion state */
    this.pos = new THREE.Vector3(rand(bounds.minX, bounds.maxX), rand(bounds.minY + 1, bounds.maxY - 1), rand(bounds.minZ, bounds.maxZ));
    this.vel = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1));
    this.heading = new THREE.Vector3(0, 0, 1);
    this.target = this.pos.clone();
    this.wanderAt = 0;
    this.food = null;
    this.state = 'cruise';
    this.stateUntil = 0;
    this.eatAt = 0;
    this.blinkAt = rand(1, 5);
    this.blink = 1;
    this.phase = rnd() * TAU;
    this.speedFactor = sp.speed * rand(0.9, 1.12);
    this.radius = Math.max(sp.W, sp.H) * this.baseScale + 0.3;
    this.mouthOpen = 0;
    this.roll = 0;
    this.pitch = 0;
    this.seed = rnd() * 100;
    this.schoolId = opts.schoolId || null;
    this.group.position.copy(this.pos);
  }

  injectBend(mat) {
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPhase = u.uPhase;
      sh.uniforms.uAmp = u.uAmp;
      sh.uniforms.uLen = u.uLen;
      sh.vertexShader = 'uniform float uPhase;\nuniform float uAmp;\nuniform float uLen;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float zn = clamp((transformed.z + uLen * 0.5) / uLen, 0.0, 1.0);',
        'float bw = pow(1.0 - zn, 1.7);',
        'transformed.x += sin(uPhase - zn * 4.4) * uAmp * bw;',
        'transformed.y += cos(uPhase * 0.8 - zn * 3.0) * uAmp * 0.14 * bw;'
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'fishbend';
  }

  get scaleNow() { return this.baseScale * (1 + this.growth * 0.28); }

  dispose() {
    this.bodyMat.dispose();
    this.finMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /* ---------- steering ---------- */
  pickTarget(t, ctx) {
    const b = this.bounds;
    const night = ctx.night;
    if (night && this.state !== 'chase') {
      this.target.set(rand(b.minX + 1, b.maxX - 1), rand(b.minY + 0.4, b.minY + 2.2), rand(b.minZ + 1, b.maxZ - 1));
      this.wanderAt = t + rand(5, 9);
      return;
    }
    const band = this.sp.wings ? 0.16 : (this.key === 'arowana' ? 0.82 : 0.55);
    const yMid = lerp(b.minY, b.maxY, band);
    this.target.set(
      rand(b.minX + 0.5, b.maxX - 0.5),
      clamp(yMid + rand(-1, 1) * (b.maxY - b.minY) * 0.34, b.minY + 0.4, b.maxY - 0.4),
      rand(b.minZ + 0.5, b.maxZ - 0.5)
    );
    this.wanderAt = t + rand(2.4, 5.2);
  }

  findFood(ctx) {
    const hunger = 1 - ctx.sat / 100;
    const radius = 5 + hunger * 11;
    let best = null, bd = 1e9;
    for (const f of ctx.foods) {
      if (f.eaten || f.claimed) continue;
      if (this.sp.wings && !f.settled) continue;
      if (!this.sp.wings && f.settled && f.pos.y < this.bounds.minY + 0.6 && this.key !== 'koi' && this.key !== 'gold') continue;
      const d = this.pos.distanceTo(f.pos);
      if (d > radius) continue;
      if (d < bd) { bd = d; best = f; }
    }
    if (best) { best.claimed = this.id; this.food = best; }
    return best;
  }

  update(dt, t, ctx) {
    const b = this.bounds;
    const sp = this.sp;

    if (this.food && (this.food.eaten || !ctx.foods.includes(this.food))) { this.food = null; }
    if (!this.food && ctx.foods.length && t > this.eatAt) this.findFood(ctx);

    /* state machine */
    let cap, reason;
    const night = ctx.night;
    if (t < this.stateUntil && this.state === 'dash') { cap = ctx.cruise * 2.7; reason = 'dash'; }
    else if (t < this.stateUntil && this.state === 'flee') { cap = ctx.cruise * 2.3; reason = 'flee'; }
    else if (this.food) { this.state = 'chase'; cap = ctx.cruise * (1.5 + (1 - ctx.sat / 100) * 0.7); reason = 'chase'; }
    else if (night) { this.state = 'rest'; cap = ctx.cruise * 0.3; reason = 'rest'; }
    else { this.state = 'cruise'; cap = ctx.cruise * (0.55 + (ctx.sat / 100) * 0.45) * (0.7 + ctx.mood / 250); reason = 'cruise'; }
    this.accelReason = reason;
    cap *= this.speedFactor * ctx.speedMul;

    /* goal */
    let gx, gy, gz;
    if (this.food) {
      const lead = clamp(this.pos.distanceTo(this.food.pos) / Math.max(1, cap), 0, 0.55);
      gx = this.food.pos.x + this.food.vel.x * lead;
      gy = this.food.pos.y + this.food.vel.y * lead;
      gz = this.food.pos.z + this.food.vel.z * lead;
    } else {
      if (t > this.wanderAt || this.pos.distanceTo(this.target) < 1.4) this.pickTarget(t, ctx);
      gx = this.target.x; gy = this.target.y; gz = this.target.z;
    }

    let dx = gx - this.pos.x, dy = gy - this.pos.y, dz = gz - this.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const arrive = this.food ? 0.5 : 2.4;
    const ease = clamp(d / arrive, 0, 1);
    const desired = cap * (this.food ? 0.35 + 0.65 * ease : ease * ease * (3 - 2 * ease));
    let ax = (dx / d) * desired - this.vel.x;
    let ay = (dy / d) * desired - this.vel.y;
    let az = (dz / d) * desired - this.vel.z;

    /* separation from neighbours */
    let sx = 0, sy = 0, sz = 0, cx = 0, cy = 0, cz = 0, alx = 0, aly = 0, alz = 0, n = 0;
    for (const o of ctx.fishes) {
      if (o === this) continue;
      const ox = this.pos.x - o.pos.x, oy = this.pos.y - o.pos.y, oz = this.pos.z - o.pos.z;
      const dd = ox * ox + oy * oy + oz * oz;
      const sep = (this.radius + o.radius) * 1.5;
      if (dd < sep * sep && dd > 1e-5) {
        const inv = 1 / Math.sqrt(dd);
        const w = (1 - Math.sqrt(dd) / sep) * 5.5;
        sx += ox * inv * w; sy += oy * inv * w; sz += oz * inv * w;
      }
      if (this.schoolId && o.schoolId === this.schoolId && dd < 36) {
        cx += o.pos.x; cy += o.pos.y; cz += o.pos.z;
        alx += o.vel.x; aly += o.vel.y; alz += o.vel.z;
        n++;
      }
    }
    ax += sx; ay += sy * 0.7; az += sz;
    if (n > 0) {
      ax += ((cx / n - this.pos.x) * 0.55 + (alx / n - this.vel.x) * 0.5);
      ay += ((cy / n - this.pos.y) * 0.4 + (aly / n - this.vel.y) * 0.35);
      az += ((cz / n - this.pos.z) * 0.55 + (alz / n - this.vel.z) * 0.5);
    }

    /* soft wall steering */
    const m = this.radius + 0.8;
    const push = 9;
    if (this.pos.x < b.minX + m) ax += (b.minX + m - this.pos.x) * push;
    if (this.pos.x > b.maxX - m) ax -= (this.pos.x - (b.maxX - m)) * push;
    if (this.pos.z < b.minZ + m) az += (b.minZ + m - this.pos.z) * push;
    if (this.pos.z > b.maxZ - m) az -= (this.pos.z - (b.maxZ - m)) * push;
    const floor = sp.wings ? b.minY + 0.25 : b.minY + m * 0.5;
    if (this.pos.y < floor) ay += (floor - this.pos.y) * push;
    if (this.pos.y > b.maxY - m * 0.6) ay -= (this.pos.y - (b.maxY - m * 0.6)) * push;

    /* gentle current */
    ax += noise1(t * 0.12 + this.seed) * 0.5;
    az += noise1(t * 0.11 + this.seed + 40) * 0.5;

    const am = Math.hypot(ax, ay, az);
    const maxA = ctx.accel * dt * (reason === 'chase' || reason === 'dash' ? 1.5 : 1);
    const k = am > maxA ? maxA / am : 1;
    this.vel.x += ax * k; this.vel.y += ay * k; this.vel.z += az * k;
    this.pos.addScaledVector(this.vel, dt);

    this.pos.x = clamp(this.pos.x, b.minX + 0.2, b.maxX - 0.2);
    this.pos.y = clamp(this.pos.y, b.minY + 0.12, b.maxY - 0.12);
    this.pos.z = clamp(this.pos.z, b.minZ + 0.2, b.maxZ - 0.2);

    /* orientation */
    const spd = this.vel.length();
    if (spd > 0.08) {
      const inv = 1 / spd;
      this.heading.x = damp(this.heading.x, this.vel.x * inv, 6, dt);
      this.heading.y = damp(this.heading.y, this.vel.y * inv, 5, dt);
      this.heading.z = damp(this.heading.z, this.vel.z * inv, 6, dt);
      this.heading.normalize();
    }
    this.group.position.copy(this.pos);
    _q.setFromUnitVectors(FWD, this.heading);
    this.group.quaternion.slerp(_q, 1 - Math.exp(-9 * dt));
    const targetRoll = clamp(-ax * 0.035, -0.5, 0.5);
    this.roll = damp(this.roll, targetRoll, 4, dt);
    this.group.rotateZ(this.roll);
    if (sp.wings) this.group.rotateX(Math.sin(t * 1.4 + this.seed) * 0.04);

    /* swim animation */
    const frac = clamp(spd / Math.max(0.5, ctx.cruise), 0, 2.2);
    const freq = (1.1 + frac * 2.3) * (sp.wings ? 0.55 : 1) * (reason === 'rest' ? 0.4 : 1);
    this.phase += freq * TAU * dt;
    const amp = (0.045 + frac * 0.075) * sp.L * (reason === 'rest' ? 0.4 : 1);
    this.uniforms.uPhase.value = this.phase;
    this.uniforms.uAmp.value = damp(this.uniforms.uAmp.value, amp, 6, dt);
    this.tailPivot.rotation.y = Math.sin(this.phase - 4.4) * (0.24 + frac * 0.3);
    this.tailPivot.rotation.x = Math.cos(this.phase * 0.7) * 0.06;
    for (const p of this.pectorals) {
      if (sp.wings) {
        p.pivot.rotation.z = Math.sin(this.phase * 0.9 + p.sx * 0.4) * 0.42 * p.sx;
        p.fin.rotation.y = Math.sin(this.phase * 0.9) * 0.14;
      } else {
        p.pivot.rotation.z = (Math.sin(this.phase * 1.3 + p.sx) * 0.34 - 0.18) * p.sx;
      }
    }
    if (this.filaments) for (let i = 0; i < this.filaments.length; i++) this.filaments[i].rotation.x = Math.sin(this.phase * 0.6 + i) * 0.16;
    if (sp.spikes) {
      const puff = 1 + (this.state === 'flee' ? 0.16 : 0) + Math.sin(t * 1.1 + this.seed) * 0.025;
      this.body.scale.setScalar(damp(this.body.scale.x, puff, 3, dt));
    }

    /* blink */
    this.blinkAt -= dt;
    if (this.blinkAt < 0) { this.blinkAt = rand(2.2, 6.5); this.blink = 0.1; }
    this.blink = damp(this.blink, night ? 0.12 : 1, 12, dt);
    for (const e of this.eyes) e.scale.y = this.blink * clamp(sp.L * 0.62, 0.5, 1.25);

    /* mouth + eating */
    let wantOpen = 0;
    if (this.food) {
      const fd = this.pos.distanceTo(this.food.pos);
      wantOpen = clamp(1 - fd / 2.2, 0, 1);
      if (fd < this.radius + 0.42 && t > this.eatAt) {
        this.eatAt = t + 0.42;
        ctx.onEat(this, this.food);
        this.food = null;
        wantOpen = 1;
      }
    }
    this.mouthOpen = damp(this.mouthOpen, wantOpen, 12, dt);
    this.mouth.scale.set(
      this.mouthBase.x * (1 + this.mouthOpen * 0.5),
      this.mouthBase.y * (1 + this.mouthOpen * 2.4),
      this.mouthBase.z * (1 + this.mouthOpen * 0.8)
    );

    /* mood / hunger tint */
    const sad = ctx.sat < 25;
    this.bodyMat.emissiveIntensity = damp(this.bodyMat.emissiveIntensity, sad ? 0.015 : 0.075, 2, dt);
    this.finMat.opacity = damp(this.finMat.opacity, sad ? 0.6 : 0.85, 2, dt);

    /* growth */
    const g = clamp(this.eaten / 40, 0, 1);
    this.growth = damp(this.growth, g, 0.6, dt);
    this.group.scale.setScalar(this.scaleNow);
    this.radius = Math.max(sp.W, sp.H) * this.scaleNow + 0.3;
  }

  dash(t, dur) { this.state = 'dash'; this.stateUntil = t + dur; this.wanderAt = t; }
  flee(t, from) {
    this.state = 'flee'; this.stateUntil = t + 1.1;
    const d = this.pos.clone().sub(from);
    if (d.lengthSq() < 1e-4) d.set(rand(-1, 1), 0.2, rand(-1, 1));
    d.normalize().multiplyScalar(6);
    this.target.copy(this.pos).add(d);
    this.target.x = clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.y = clamp(this.target.y, this.bounds.minY, this.bounds.maxY);
    this.target.z = clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
    this.wanderAt = t + 1.2;
    this.food = null;
  }
}

const FWD = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

export function randomSpecies() {
  return pick(SPECIES_KEYS.filter((k) => k !== 'neon'));
}