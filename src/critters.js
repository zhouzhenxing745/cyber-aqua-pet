import * as THREE from '../vendor/three.module.js';
import { TAU, clamp, lerp, damp, rand, rnd, pick, noise1 } from './util.js';
import { BOUNDS, sandY, waterTopY, halfD, halfW } from './world.js';
import { glowTexture } from './textures.js';

/* ---------- tiny procedural textures ---------- */
function shellTex(base, spot, spot2) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, base); g.addColorStop(1, spot2);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = i % 3 ? spot : 'rgba(255,255,255,.16)';
    const r = 1 + Math.random() * 4;
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, r, 0, TAU); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hexTex(base, line) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = line; x.lineWidth = 5;
  const R = 30, h = R * Math.sin(Math.PI / 3);
  for (let row = -1; row < 7; row++) {
    for (let col = -1; col < 7; col++) {
      const cx = col * R * 1.5, cy = row * h * 2 + (col % 2 ? h : 0);
      x.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        const px = cx + Math.cos(a) * R * 0.92, py = cy + Math.sin(a) * R * 0.92;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath(); x.stroke();
      x.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.06})`; x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function flowerTex(base, petal, center) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  const flower = (cx, cy, r) => {
    x.fillStyle = petal;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      x.beginPath(); x.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.5, 0, TAU); x.fill();
    }
    x.fillStyle = center; x.beginPath(); x.arc(cx, cy, r * 0.34, 0, TAU); x.fill();
  };
  flower(32, 34, 14); flower(96, 82, 16); flower(90, 22, 11); flower(26, 98, 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const SEG = new THREE.CylinderGeometry(1, 0.82, 1, 7);
const BALL = new THREE.SphereGeometry(1, 14, 11);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const PLANE = new THREE.PlaneGeometry(1, 1, 1, 6);

function limb(mat, len, r0, r1) {
  const m = new THREE.Mesh(SEG, mat);
  m.scale.set(r0, len, r1);
  m.position.y = -len / 2;
  const g = new THREE.Group(); g.add(m);
  return g;
}

/* ============================================================
   CRAB — sideways walker, scavenges settled pellets
   ============================================================ */
export class Crab {
  constructor(scene) {
    this.kind = 'crab';
    this.group = new THREE.Group();
    scene.add(this.group);
    const tex = shellTex('#e8562a', 'rgba(120,26,10,.55)', '#a52f14');
    this.mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05, color: 0xffffff });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x8e2a12, roughness: 0.5 });
    this.eyeW = new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.25 });
    this.eyeB = new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.1 });

    const shell = new THREE.Mesh(BALL, this.mat);
    shell.scale.set(0.72, 0.34, 0.56);
    shell.castShadow = true;
    this.group.add(shell);
    this.shell = shell;
    const lip = new THREE.Mesh(BALL, this.dark);
    lip.scale.set(0.66, 0.16, 0.5); lip.position.y = -0.16;
    this.group.add(lip);

    this.stalks = [];
    for (const sx of [1, -1]) {
      const p = new THREE.Group(); p.position.set(sx * 0.2, 0.2, 0.4);
      const st = new THREE.Mesh(SEG, this.dark); st.scale.set(0.045, 0.24, 0.045); st.position.y = 0.12;
      const e = new THREE.Mesh(BALL, this.eyeW); e.scale.setScalar(0.1); e.position.y = 0.27;
      const b = new THREE.Mesh(BALL, this.eyeB); b.scale.setScalar(0.055); b.position.set(0, 0.28, 0.06);
      p.add(st, e, b); this.group.add(p); this.stalks.push(p);
    }

    this.claws = [];
    for (const sx of [1, -1]) {
      const root = new THREE.Group(); root.position.set(sx * 0.6, -0.02, 0.3);
      const arm = limb(this.mat, 0.42, 0.09, 0.075);
      arm.rotation.z = sx * 1.05; arm.rotation.x = -0.35;
      const hand = new THREE.Group(); hand.position.y = -0.42;
      const big = sx > 0 ? 1.25 : 0.95;
      const palm = new THREE.Mesh(BALL, this.mat); palm.scale.set(0.16 * big, 0.13 * big, 0.24 * big);
      palm.position.z = 0.14 * big;
      const fixed = new THREE.Mesh(CONE, this.mat);
      fixed.scale.set(0.07 * big, 0.26 * big, 0.07 * big);
      fixed.rotation.x = Math.PI / 2; fixed.position.set(0, -0.05 * big, 0.34 * big);
      const moving = new THREE.Group(); moving.position.set(0, 0.05 * big, 0.22 * big);
      const jaw = new THREE.Mesh(CONE, this.dark);
      jaw.scale.set(0.065 * big, 0.24 * big, 0.065 * big);
      jaw.rotation.x = Math.PI / 2; jaw.position.z = 0.12 * big;
      moving.add(jaw);
      hand.add(palm, fixed, moving);
      arm.add(hand); root.add(arm); this.group.add(root);
      this.claws.push({ root, arm, hand, moving, sx, big });
    }

    this.legs = [];
    for (const sx of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const root = new THREE.Group();
        root.position.set(sx * 0.5, -0.08, 0.24 - i * 0.22);
        const upper = limb(this.dark, 0.34, 0.05, 0.04);
        upper.rotation.z = sx * 1.15;
        const lower = limb(this.dark, 0.34, 0.04, 0.022);
        lower.position.y = -0.34; lower.rotation.z = -sx * 1.5;
        upper.add(lower); root.add(upper); this.group.add(root);
        this.legs.push({ root, upper, lower, sx, i, phase: (i * 0.5 + (sx > 0 ? 0 : 0.25)) * Math.PI });
      }
    }

    this.pos = new THREE.Vector3(rand(-8, 8), sandY + 0.36, rand(-5, 5));
    this.target = this.pos.clone();
    this.dir = 1;
    this.walk = 0;
    this.state = 'walk';
    this.stateUntil = 0;
    this.food = null;
    this.alert = 0;
    this.seed = rnd() * 50;
    this.group.position.copy(this.pos);
    this.radius = 0.9;
  }

  poke(t) { this.alert = 1; this.state = 'wave'; this.stateUntil = t + 1.6; }

  update(dt, t, ctx) {
    if (this.food && (this.food.eaten || !ctx.foods.includes(this.food))) this.food = null;
    if (!this.food && t > this.stateUntil) {
      let best = null, bd = 1e9;
      for (const f of ctx.foods) {
        if (!f.settled || f.claimed) continue;
        const d = (f.pos.x - this.pos.x) ** 2 + (f.pos.z - this.pos.z) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
      if (best && bd < 90) { this.food = best; best.claimed = true; this.state = 'seek'; }
    }

    let moving = false;
    if (this.food) {
      this.target.set(this.food.pos.x, sandY + 0.36, this.food.pos.z);
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d < 0.7) {
        ctx.onScavenge(this.food);
        this.food = null; this.state = 'eat'; this.stateUntil = t + 1.1;
      } else moving = true;
    } else if (this.state === 'eat' || this.state === 'wave') {
      moving = false;
      if (t > this.stateUntil) this.state = 'walk';
    } else {
      if (t > this.stateUntil || Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 0.6) {
        if (Math.random() < 0.3) { this.state = 'idle'; this.stateUntil = t + rand(1.4, 3.4); }
        else {
          this.state = 'walk'; this.stateUntil = t + rand(3, 7);
          this.target.set(rand(BOUNDS.minX + 1, BOUNDS.maxX - 1), sandY + 0.36, rand(BOUNDS.minZ + 1, BOUNDS.maxZ - 1));
        }
      }
      moving = this.state === 'walk';
    }

    const speed = (this.food ? 2.5 : 1.35) * (ctx.night ? 0.45 : 1);
    if (moving) {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1e-5;
      this.pos.x += (dx / d) * speed * dt;
      this.pos.z += (dz / d) * speed * dt;
      this.dir = damp(this.dir, Math.sign(dx) || this.dir, 5, dt);
      this.walk += dt * speed * 3.4;
    } else {
      this.walk += dt * 0.7;
    }
    this.pos.x = clamp(this.pos.x, BOUNDS.minX + 0.6, BOUNDS.maxX - 0.6);
    this.pos.z = clamp(this.pos.z, BOUNDS.minZ + 0.6, BOUNDS.maxZ - 0.6);
    this.pos.y = sandY + 0.36 + Math.abs(Math.sin(this.walk * 2)) * (moving ? 0.035 : 0.008);
    this.group.position.copy(this.pos);

    const yaw = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
    const want = moving ? yaw + Math.PI / 2 * this.dir : Math.sin(t * 0.3 + this.seed) * 0.5;
    this.group.rotation.y = damp(this.group.rotation.y, want, 4, dt);
    this.group.rotation.z = Math.sin(this.walk) * (moving ? 0.05 : 0.012);

    for (const l of this.legs) {
      const s = Math.sin(this.walk + l.phase);
      const lift = moving ? Math.max(0, s) : 0;
      l.root.rotation.y = s * (moving ? 0.42 : 0.06);
      l.upper.rotation.z = l.sx * (1.15 - lift * 0.34);
      l.lower.rotation.z = -l.sx * (1.5 - lift * 0.5);
    }
    this.alert = damp(this.alert, 0, 1.6, dt);
    for (let i = 0; i < this.stalks.length; i++) {
      const p = this.stalks[i];
      p.rotation.x = -0.1 + Math.sin(t * 1.3 + i * 2 + this.seed) * 0.16 - this.alert * 0.3;
      p.rotation.z = Math.sin(t * 0.9 + i) * 0.2;
      p.scale.y = 1 + this.alert * 0.35;
    }
    for (const c of this.claws) {
      const wave = this.state === 'wave' ? Math.sin(t * 9) * 0.5 + 0.6 : 0;
      const eat = this.state === 'eat' ? Math.abs(Math.sin(t * 12)) : 0;
      c.root.rotation.x = damp(c.root.rotation.x, -0.2 - this.alert * 0.9 - wave * 0.7, 8, dt);
      c.root.rotation.y = c.sx * (0.2 + wave * 0.3);
      c.moving.rotation.x = -0.15 - Math.max(wave, eat) * 0.7 - Math.abs(Math.sin(t * 1.7 + c.sx)) * 0.1;
    }
    this.shell.scale.y = 0.34 + Math.sin(t * 2.1 + this.seed) * 0.012;
  }

  dispose() { this.mat.dispose(); this.dark.dispose(); this.eyeW.dispose(); this.eyeB.dispose(); if (this.group.parent) this.group.parent.remove(this.group); }
}

/* ============================================================
   SHRIMP — translucent hopper
   ============================================================ */
export class Shrimp {
  constructor(scene, tint) {
    this.kind = 'shrimp';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.72,
      emissive: new THREE.Color(tint), emissiveIntensity: 0.18
    });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x1a1016, roughness: 0.2 });
    this.segs = [];
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      const m = new THREE.Mesh(BALL, this.mat);
      const r = lerp(0.15, 0.055, k);
      m.scale.set(r, r * 0.9, r * 1.25);
      m.position.set(0, -Math.sin(k * 1.5) * 0.1, -i * 0.15);
      this.group.add(m); this.segs.push(m);
    }
    const head = new THREE.Mesh(BALL, this.mat);
    head.scale.set(0.16, 0.14, 0.22); head.position.z = 0.16;
    this.group.add(head);
    const rostrum = new THREE.Mesh(CONE, this.mat);
    rostrum.scale.set(0.035, 0.24, 0.035); rostrum.rotation.x = Math.PI / 2 - 0.3; rostrum.position.set(0, 0.06, 0.34);
    this.group.add(rostrum);
    for (const sx of [1, -1]) {
      const e = new THREE.Mesh(BALL, this.dark); e.scale.setScalar(0.04); e.position.set(sx * 0.1, 0.07, 0.26);
      this.group.add(e);
    }
    this.antennae = [];
    for (const sx of [1, -1]) {
      for (let j = 0; j < 2; j++) {
        const p = new THREE.Group(); p.position.set(sx * 0.06, 0.04, 0.3);
        const a = new THREE.Mesh(SEG, this.mat);
        const len = 0.6 + j * 0.3;
        a.scale.set(0.012, len, 0.012); a.position.y = -len / 2;
        p.add(a); p.rotation.x = -Math.PI / 2 + 0.3; p.rotation.z = sx * (0.3 + j * 0.25);
        this.group.add(p); this.antennae.push({ p, sx, j });
      }
    }
    this.fan = [];
    for (let i = -1; i <= 1; i++) {
      const f = new THREE.Mesh(PLANE, this.mat);
      f.material = this.mat;
      f.scale.set(0.14, 0.2, 1);
      f.position.set(i * 0.08, -0.12, -1.06);
      f.rotation.set(-Math.PI / 2 + 0.4, 0, i * 0.4);
      this.group.add(f); this.fan.push(f);
    }
    this.legs = [];
    for (let i = 0; i < 5; i++) {
      for (const sx of [1, -1]) {
        const l = limb(this.mat, 0.14, 0.014, 0.01);
        l.position.set(sx * 0.08, -0.08, 0.1 - i * 0.14);
        l.rotation.z = sx * 0.6;
        this.group.add(l); this.legs.push({ l, sx, i });
      }
    }
    this.pos = new THREE.Vector3(rand(-10, 10), sandY + rand(0.4, 3), rand(-6, 6));
    this.target = this.pos.clone();
    this.hopAt = rand(1, 4);
    this.hop = 0;
    this.seed = rnd() * 60;
    this.radius = 0.5;
    this.group.position.copy(this.pos);
  }

  update(dt, t, ctx) {
    this.hopAt -= dt;
    if (this.hopAt <= 0) {
      this.hopAt = rand(2.2, 6);
      this.hop = 1;
      this.target.set(
        clamp(this.pos.x + rand(-4, 4), BOUNDS.minX + 1, BOUNDS.maxX - 1),
        clamp(this.pos.y + rand(-1.2, 1.6), sandY + 0.35, waterTopY - 1.4),
        clamp(this.pos.z + rand(-3, 3), BOUNDS.minZ + 1, BOUNDS.maxZ - 1)
      );
    }
    this.hop = damp(this.hop, 0, 2.2, dt);
    const dx = this.target.x - this.pos.x, dy = this.target.y - this.pos.y, dz = this.target.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const sp = (0.35 + this.hop * 4.2) * (ctx.night ? 0.5 : 1);
    if (d > 0.15) {
      this.pos.x += (dx / d) * sp * dt;
      this.pos.y += (dy / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
      const yaw = Math.atan2(dx, dz);
      this.group.rotation.y = damp(this.group.rotation.y, yaw + (this.hop > 0.3 ? Math.PI : 0), 6, dt);
      this.group.rotation.x = damp(this.group.rotation.x, clamp(-dy / Math.max(1, d), -0.6, 0.6) * (this.hop > 0.3 ? -1 : 1), 5, dt);
    }
    this.pos.y += Math.sin(t * 1.6 + this.seed) * 0.004;
    this.group.position.copy(this.pos);
    const curl = this.hop * 0.5;
    for (let i = 0; i < this.segs.length; i++) {
      const k = i / 6;
      this.segs[i].position.y = -Math.sin(k * 1.5 + curl * 2) * 0.1 - curl * k * 0.18;
      this.segs[i].rotation.x = curl * k * 0.7 + Math.sin(t * 3 + i * 0.5) * 0.03;
    }
    for (const f of this.fan) f.rotation.x = -Math.PI / 2 + 0.4 + curl * 1.1;
    for (const a of this.antennae) {
      a.p.rotation.z = a.sx * (0.3 + a.j * 0.25) + Math.sin(t * 2.2 + a.j * 2 + this.seed) * 0.22;
      a.p.rotation.x = -Math.PI / 2 + 0.3 + Math.sin(t * 1.7 + a.sx) * 0.16;
    }
    for (const l of this.legs) l.l.rotation.x = Math.sin(t * 7 + l.i * 0.8 + l.sx) * 0.35;
  }

  dispose() { this.mat.dispose(); this.dark.dispose(); if (this.group.parent) this.group.parent.remove(this.group); }
}

/* ============================================================
   SNAIL — glass-wall crawler
   ============================================================ */
export class Snail {
  constructor(scene) {
    this.kind = 'snail';
    this.group = new THREE.Group();
    scene.add(this.group);
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const k = i / 60, a = k * TAU * 2.6, r = 0.06 + k * 0.3;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, k * 0.22 - 0.1));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const shellGeo = new THREE.TubeGeometry(curve, 90, 0.075, 8, false);
    this.shellMat = new THREE.MeshStandardMaterial({ map: shellTex('#f0b64a', 'rgba(120,60,10,.5)', '#b06a1c'), roughness: 0.3, metalness: 0.1 });
    const shell = new THREE.Mesh(shellGeo, this.shellMat);
    shell.position.set(0, 0.24, -0.05);
    shell.castShadow = true;
    this.group.add(shell);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.55 });
    const body = new THREE.Mesh(BALL, this.bodyMat);
    body.scale.set(0.16, 0.11, 0.42); body.position.set(0, 0.02, 0.1);
    this.group.add(body);
    const foot = new THREE.Mesh(BALL, this.bodyMat);
    foot.scale.set(0.2, 0.05, 0.46); foot.position.set(0, -0.06, 0.08);
    this.group.add(foot);
    this.tentacles = [];
    for (const sx of [1, -1]) {
      const p = new THREE.Group(); p.position.set(sx * 0.07, 0.08, 0.44);
      const st = new THREE.Mesh(SEG, this.bodyMat); st.scale.set(0.018, 0.16, 0.018); st.position.y = 0.08;
      const e = new THREE.Mesh(BALL, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.2 }));
      e.scale.setScalar(0.032); e.position.y = 0.17;
      p.add(st, e); p.rotation.x = -0.6;
      this.group.add(p); this.tentacles.push({ p, sx });
    }
    this.u = rnd(); this.v = rnd() * 0.6 + 0.2;
    this.wall = pick([0, 1]);
    this.speed = rand(0.006, 0.012);
    this.dirU = Math.random() < 0.5 ? 1 : -1;
    this.dirV = Math.random() < 0.5 ? 1 : -1;
    this.seed = rnd() * 40;
    this.radius = 0.5;
    this.place();
  }

  place() {
    const x = lerp(-halfW + 1.4, halfW - 1.4, this.u);
    const y = lerp(sandY + 0.5, waterTopY - 1, this.v);
    if (this.wall === 0) { this.group.position.set(x, y, halfD - 0.42); this.group.rotation.set(0, 0, 0); }
    else { this.group.position.set(-halfW + 0.42, y, lerp(-halfD + 1.4, halfD - 1.4, this.u)); this.group.rotation.set(0, Math.PI / 2, 0); }
  }

  update(dt, t) {
    this.u += this.dirU * this.speed * dt;
    this.v += this.dirV * this.speed * 0.6 * dt;
    if (this.u > 1 || this.u < 0) { this.dirU *= -1; this.u = clamp(this.u, 0, 1); }
    if (this.v > 0.95 || this.v < 0.05) { this.dirV *= -1; this.v = clamp(this.v, 0.05, 0.95); }
    this.place();
    const ang = Math.atan2(this.dirV * 0.6, this.dirU);
    this.group.rotation.z = damp(this.group.rotation.z, this.wall === 0 ? ang - Math.PI / 2 : 0, 2, dt);
    for (const tt of this.tentacles) {
      tt.p.rotation.x = -0.6 + Math.sin(t * 1.4 + tt.sx * 2 + this.seed) * 0.25;
      tt.p.rotation.z = tt.sx * 0.2 + Math.sin(t * 1.1 + this.seed) * 0.15;
    }
  }

  dispose() { this.shellMat.dispose(); this.bodyMat.dispose(); if (this.group.parent) this.group.parent.remove(this.group); }
}

/* ============================================================
   GUESTS
   ============================================================ */
export const GUESTS = {
  sponge: { name: '海绵宝宝', latin: 'SPONGEBOB', color: '#ffe135', icon: 'i-bowl', desc: '黄色方块海绵，白衬衫红领带，住在菠萝屋里。' },
  star: { name: '派大星', latin: 'PATRICK', color: '#ff8fb8', icon: 'i-star', desc: '粉色海星，绿底紫花短裤，海绵宝宝的好朋友。' },
  octo: { name: '章鱼哥', latin: 'SQUIDWARD', color: '#7fd4c1', icon: 'i-octo', desc: '青绿章鱼，长鼻子半睁眼，一心想吹竖笛。' },
  horse: { name: '海马君', latin: 'SEAHORSE', color: '#7dff5c', icon: 'i-horse', desc: '直立游泳，背鳍每秒扇 30 下。' },
  jelly: { name: '水母', latin: 'JELLYFISH', color: '#ff7fbf', icon: 'i-sparkle', desc: '粉色斑点水母，比基尼海滩的经典居民。' },
  turtle: { name: '龟爷爷', latin: 'TURTLE', color: '#4fe08a', icon: 'i-turtle', desc: '慢悠悠划水，偶尔上浮换气。' }
};
export const GUEST_KEYS = Object.keys(GUESTS);

class Guest {
  constructor(scene, key) {
    this.kind = 'guest';
    this.key = key;
    this.meta = GUESTS[key];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pos = new THREE.Vector3(rand(-8, 8), rand(sandY + 1.5, waterTopY - 2), rand(-5, 5));
    this.target = this.pos.clone();
    this.seed = rnd() * 80;
    this.retargetAt = 0;
    this.radius = 1.1;
    this.mats = [];
    this.pulse = 0;
  }
  mat(o) { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; }
  retarget(t, lo, hi) {
    this.target.set(rand(BOUNDS.minX + 2, BOUNDS.maxX - 2), rand(lo, hi), rand(BOUNDS.minZ + 2, BOUNDS.maxZ - 2));
    this.retargetAt = t + rand(4, 9);
  }
  moveTo(dt, speed) {
    const d = this.target.clone().sub(this.pos);
    const len = d.length();
    if (len > 0.2) {
      d.multiplyScalar(1 / len);
      this.pos.addScaledVector(d, Math.min(speed, len) * dt);
      const yaw = Math.atan2(d.x, d.z);
      this.group.rotation.y = damp(this.group.rotation.y, yaw, 2.5, dt);
      this.group.rotation.x = damp(this.group.rotation.x, clamp(-d.y, -0.5, 0.5), 2, dt);
    }
    this.group.position.copy(this.pos);
    return len;
  }
  poke(t) { this.pulse = 1; this.retargetAt = t; }
  dispose() {
    for (const m of this.mats) m.dispose();
    this.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.userData.own) o.geometry.dispose(); });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

class Sponge extends Guest {
  constructor(scene) {
    super(scene, 'sponge');
    const tex = shellTex('#ffe135', 'rgba(196,146,12,.5)', '#f2b62c');
    const yellow = this.mat({ map: tex, roughness: 0.8 });
    const skin = this.mat({ color: 0xffe135, roughness: 0.7 });
    const white = this.mat({ color: 0xf6f6f2, roughness: 0.5 });
    const black = this.mat({ color: 0x141414, roughness: 0.35 });
    const brown = this.mat({ color: 0x8a5a2b, roughness: 0.6 });
    const red = this.mat({ color: 0xe23b2e, roughness: 0.5 });
    const blue = this.mat({ color: 0x3f8fe0, roughness: 0.25 });

    const bodyGeo = new THREE.BoxGeometry(1.34, 1.42, 0.94, 3, 3, 2);
    bodyGeo.userData.own = true;
    const body = new THREE.Mesh(bodyGeo, yellow);
    body.position.y = 1.16; body.castShadow = true;
    this.group.add(body); this.body = body;

    const pore = this.mat({ color: 0xd99a16, roughness: 0.9 });
    for (let i = 0; i < 12; i++) {
      const h = new THREE.Mesh(BALL, pore);
      h.scale.setScalar(rand(0.05, 0.11));
      const side = i % 3, yy = rand(0.62, 1.78), zz = rand(-0.34, 0.34);
      if (side === 0) h.position.set(0.67, yy, zz);
      else if (side === 1) h.position.set(-0.67, yy, zz);
      else h.position.set(rand(-0.5, 0.5), yy, -0.47);
      this.group.add(h);
    }

    const pants = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.4, 0.98), brown);
    pants.geometry.userData.own = true; pants.position.y = 0.56; this.group.add(pants);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.0), black);
    belt.geometry.userData.own = true; belt.position.y = 0.78; this.group.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), this.mat({ color: 0xffd23f, roughness: 0.3, metalness: 0.4 }));
    buckle.geometry.userData.own = true; buckle.position.set(0, 0.78, 0.5); this.group.add(buckle);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.26, 0.98), white);
    shirt.geometry.userData.own = true; shirt.position.y = 0.94; this.group.add(shirt);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), white);
    collar.geometry.userData.own = true; collar.position.set(0, 1.06, 0.46); this.group.add(collar);
    const tie = new THREE.Mesh(CONE, red);
    tie.scale.set(0.12, 0.34, 0.06); tie.rotation.x = Math.PI; tie.position.set(0, 0.86, 0.5);
    this.group.add(tie);

    this.eyes = [];
    for (const sx of [1, -1]) {
      const g = new THREE.Group(); g.position.set(sx * 0.28, 1.52, 0.46);
      const w = new THREE.Mesh(BALL, white); w.scale.set(0.25, 0.27, 0.16);
      const ir = new THREE.Mesh(BALL, blue); ir.scale.setScalar(0.115); ir.position.set(0, 0, 0.12);
      const pu = new THREE.Mesh(BALL, black); pu.scale.setScalar(0.055); pu.position.set(0, 0, 0.2);
      g.add(w, ir, pu);
      for (let l = 0; l < 3; l++) {
        const la = new THREE.Mesh(SEG, black);
        la.scale.set(0.012, 0.13, 0.012);
        la.position.set((l - 1) * 0.09, 0.29, 0.02);
        la.rotation.z = (l - 1) * 0.35;
        g.add(la);
      }
      this.group.add(g); this.eyes.push(g);
    }
    const nose = new THREE.Mesh(CONE, skin);
    nose.scale.set(0.085, 0.24, 0.085); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.3, 0.56);
    this.group.add(nose);
    const smileGeo = new THREE.TorusGeometry(0.3, 0.026, 8, 22, Math.PI);
    smileGeo.userData.own = true;
    const smile = new THREE.Mesh(smileGeo, this.mat({ color: 0x5a2d12, roughness: 0.5 }));
    smile.rotation.z = Math.PI; smile.position.set(0, 1.2, 0.48);
    this.group.add(smile);
    for (const sx of [1, -1]) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.05), white);
      tooth.geometry.userData.own = true; tooth.position.set(sx * 0.055, 1.02, 0.49);
      this.group.add(tooth);
    }
    const freck = this.mat({ color: 0xe2603f, roughness: 0.6 });
    for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(BALL, freck); f.scale.setScalar(0.028);
      f.position.set(sx * (0.42 + (i % 2) * 0.06), 1.24 + (i - 1) * 0.07, 0.47);
      this.group.add(f);
    }

    this.arms = [];
    for (const sx of [1, -1]) {
      const shoulder = new THREE.Group(); shoulder.position.set(sx * 0.68, 1.02, 0);
      const sleeve = new THREE.Mesh(SEG, white); sleeve.scale.set(0.09, 0.14, 0.09); sleeve.position.y = -0.05;
      const arm = limb(skin, 0.5, 0.05, 0.04); arm.position.y = -0.12;
      const hand = new THREE.Mesh(BALL, skin); hand.scale.setScalar(0.075); hand.position.y = -0.62;
      shoulder.add(sleeve, arm, hand);
      this.group.add(shoulder); this.arms.push(shoulder);
    }
    this.legs = [];
    for (const sx of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.3, 0.4, 0);
      const leg = limb(skin, 0.3, 0.05, 0.045);
      const sock = new THREE.Mesh(SEG, white); sock.scale.set(0.055, 0.1, 0.055); sock.position.y = -0.3;
      const shoe = new THREE.Mesh(BALL, black); shoe.scale.set(0.11, 0.07, 0.17); shoe.position.set(0, -0.36, 0.04);
      hip.add(leg, sock, shoe);
      this.group.add(hip); this.legs.push(hip);
    }
    this.pos.set(rand(-8, 8), sandY + 0.02, rand(-5, 5));
    this.target.copy(this.pos);
    this.group.position.copy(this.pos);
    this.radius = 1.1;
    this.waveAt = rand(5, 10); this.wave = 0;
  }
  update(dt, t, ctx) {
    if (t > this.retargetAt) {
      this.target.set(rand(BOUNDS.minX + 1.5, BOUNDS.maxX - 1.5), sandY + 0.02, rand(BOUNDS.minZ + 1.5, BOUNDS.maxZ - 1.5));
      this.retargetAt = t + rand(5, 11);
    }
    const d = this.target.clone().sub(this.pos); d.y = 0;
    const len = d.length();
    const moving = len > 0.15;
    if (moving) {
      d.multiplyScalar(1 / len);
      this.pos.addScaledVector(d, Math.min(0.85, len) * dt);
      this.group.rotation.y = damp(this.group.rotation.y, Math.atan2(d.x, d.z), 3, dt);
    }
    const hop = moving ? Math.abs(Math.sin(t * 7 + this.seed)) * 0.07 : 0;
    this.group.position.set(this.pos.x, sandY + 0.02 + hop, this.pos.z);
    const br = 1 + Math.sin(t * 2.2 + this.seed) * 0.03 + this.pulse * 0.12;
    this.body.scale.set(1 / Math.sqrt(br), br, 1 / Math.sqrt(br));
    this.waveAt -= dt;
    if (this.waveAt <= 0) { this.waveAt = rand(7, 14); this.wave = 1.6; }
    this.wave = Math.max(0, this.wave - dt);
    const swing = moving ? Math.sin(t * 7 + this.seed) * 0.5 : Math.sin(t * 1.4 + this.seed) * 0.1;
    this.arms[0].rotation.x = swing;
    if (this.wave > 0) {
      this.arms[1].rotation.z = -2.3 + Math.sin(t * 12) * 0.35;
      this.arms[1].rotation.x = 0;
    } else {
      this.arms[1].rotation.z = damp(this.arms[1].rotation.z, 0, 4, dt);
      this.arms[1].rotation.x = -swing;
    }
    this.legs[0].rotation.x = moving ? -swing * 0.7 : 0;
    this.legs[1].rotation.x = moving ? swing * 0.7 : 0;
    const bl = Math.max(0, Math.sin(t * 0.6 + this.seed) - 0.97) * 30;
    for (const e of this.eyes) e.scale.y = 1 - Math.min(0.9, bl);
    this.pulse = damp(this.pulse, 0, 2, dt);
    if (ctx.bubbles && Math.random() < dt * 0.8) ctx.bubbles(this.pos.x, this.pos.y + 2.0, this.pos.z, 1);
  }
}

class Star extends Guest {
  constructor(scene) {
    super(scene, 'star');
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + Math.PI / 2;
      const r = i % 2 ? 0.52 : 1.08;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? shape.lineTo(x, y) : shape.moveTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.14, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 6 });
    geo.userData.own = true;
    geo.center();
    const pink = this.mat({ map: shellTex('#ff8fb8', 'rgba(206,64,116,.45)', '#f06292'), roughness: 0.6 });
    const body = new THREE.Mesh(geo, pink);
    body.castShadow = true;
    this.group.add(body); this.body = body;

    const white = this.mat({ color: 0xf6f6f2, roughness: 0.4 });
    const black = this.mat({ color: 0x141414, roughness: 0.3 });
    const lidM = this.mat({ color: 0xf06292, roughness: 0.6 });
    this.eyes = [];
    for (const sx of [1, -1]) {
      const g = new THREE.Group(); g.position.set(sx * 0.2, 0.42, 0.34);
      const w = new THREE.Mesh(BALL, white); w.scale.set(0.15, 0.17, 0.1);
      const pu = new THREE.Mesh(BALL, black); pu.scale.setScalar(0.06); pu.position.set(0, -0.02, 0.08);
      const lid = new THREE.Mesh(BALL, lidM); lid.scale.set(0.17, 0.1, 0.11); lid.position.set(0, 0.1, 0.02);
      g.add(w, pu, lid); this.group.add(g); this.eyes.push(g);
    }
    const smileGeo = new THREE.TorusGeometry(0.16, 0.022, 8, 18, Math.PI);
    smileGeo.userData.own = true;
    const smile = new THREE.Mesh(smileGeo, this.mat({ color: 0x8a2f4f, roughness: 0.5 }));
    smile.rotation.z = Math.PI; smile.position.set(0, 0.14, 0.42);
    this.group.add(smile);
    const shorts = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.5, 0.86), this.mat({ map: flowerTex('#3fae4a', '#8e44ad', '#f1c40f'), roughness: 0.7 }));
    shorts.geometry.userData.own = true; shorts.position.y = -0.5;
    this.group.add(shorts);

    this.pos.set(rand(-8, 8), sandY + 1.32, rand(-5, 5));
    this.target.copy(this.pos);
    this.group.position.copy(this.pos);
    this.radius = 1.15;
  }
  update(dt, t, ctx) {
    if (t > this.retargetAt) {
      this.target.set(rand(BOUNDS.minX + 1.5, BOUNDS.maxX - 1.5), sandY + 1.32, rand(BOUNDS.minZ + 1.5, BOUNDS.maxZ - 1.5));
      this.retargetAt = t + rand(7, 15);
    }
    const d = this.target.clone().sub(this.pos); d.y = 0;
    const len = d.length();
    const moving = len > 0.12;
    if (moving) {
      d.multiplyScalar(1 / len);
      this.pos.addScaledVector(d, Math.min(0.5, len) * dt);
      this.group.rotation.y = damp(this.group.rotation.y, Math.atan2(d.x, d.z), 1.6, dt);
    }
    this.group.position.set(this.pos.x, sandY + 1.32 + (moving ? Math.abs(Math.sin(t * 4 + this.seed)) * 0.04 : 0), this.pos.z);
    this.group.rotation.z = Math.sin(t * (moving ? 4 : 1.1) + this.seed) * (moving ? 0.1 : 0.04);
    const br = 1 + Math.sin(t * 1.7 + this.seed) * 0.035 + this.pulse * 0.14;
    this.body.scale.set(br, 1 / Math.sqrt(br), br);
    const bl = Math.max(0, Math.sin(t * 0.45 + this.seed) - 0.96) * 26;
    for (const e of this.eyes) e.scale.y = 1 - Math.min(0.85, bl);
    this.pulse = damp(this.pulse, 0, 2, dt);
    if (ctx.bubbles && Math.random() < dt * 0.4) ctx.bubbles(this.pos.x, this.pos.y + 1.0, this.pos.z, 1);
  }
}

class Octo extends Guest {
  constructor(scene) {
    super(scene, 'octo');
    const teal = this.mat({ color: 0x7fd4c1, roughness: 0.45 });
    const tealDark = this.mat({ color: 0x5fb8a4, roughness: 0.5 });
    const shirt = this.mat({ color: 0x9c6b3f, roughness: 0.7 });
    const white = this.mat({ color: 0xf2f2ec, roughness: 0.35 });
    const pupil = this.mat({ color: 0x8a3324, roughness: 0.25 });
    const head = new THREE.Mesh(BALL, teal);
    head.scale.set(0.6, 0.76, 0.58); head.position.y = 1.42; head.castShadow = true;
    this.group.add(head); this.head = head;
    const nose = new THREE.Mesh(SEG, teal);
    nose.scale.set(0.1, 0.72, 0.1); nose.position.set(0, 1.24, 0.5); nose.rotation.x = 1.45;
    this.group.add(nose); this.nose = nose;
    this.eyes = [];
    for (const sx of [1, -1]) {
      const g = new THREE.Group(); g.position.set(sx * 0.23, 1.56, 0.5);
      const w = new THREE.Mesh(BALL, white); w.scale.set(0.18, 0.22, 0.12);
      const pu = new THREE.Mesh(BALL, pupil); pu.scale.setScalar(0.07); pu.position.set(0, -0.03, 0.1);
      const lid = new THREE.Mesh(BALL, teal); lid.scale.set(0.2, 0.13, 0.13); lid.position.set(0, 0.12, 0.02);
      g.add(w, pu, lid); this.group.add(g); this.eyes.push(g);
      const brow = new THREE.Mesh(SEG, tealDark);
      brow.scale.set(0.03, 0.2, 0.03); brow.position.set(sx * 0.23, 1.8, 0.52); brow.rotation.z = sx * 1.2;
      this.group.add(brow);
    }
    const torso = new THREE.Mesh(SEG, shirt);
    torso.scale.set(0.36, 0.55, 0.32); torso.position.y = 0.82;
    this.group.add(torso);
    const collar = new THREE.Mesh(SEG, shirt);
    collar.scale.set(0.3, 0.12, 0.28); collar.position.y = 1.08;
    this.group.add(collar);
    this.limbs = [];
    const mk = (x, y, z, len, segs, r0) => {
      const root = new THREE.Group(); root.position.set(x, y, z);
      let parent = root; const chain = [];
      for (let j = 0; j < segs; j++) {
        const s = new THREE.Group();
        const r = lerp(r0, r0 * 0.4, j / (segs - 1));
        const mesh = new THREE.Mesh(SEG, teal);
        mesh.scale.set(r, len, r); mesh.position.y = -len / 2;
        s.add(mesh); s.position.y = j === 0 ? 0 : -len;
        parent.add(s); parent = s; chain.push(s);
      }
      this.group.add(root); this.limbs.push({ root, chain });
    };
    mk(0.36, 0.98, 0, 0.22, 4, 0.07);
    mk(-0.36, 0.98, 0, 0.22, 4, 0.07);
    mk(0.2, 0.56, 0.14, 0.18, 3, 0.08);
    mk(-0.2, 0.56, 0.14, 0.18, 3, 0.08);
    mk(0.2, 0.56, -0.14, 0.18, 3, 0.08);
    mk(-0.2, 0.56, -0.14, 0.18, 3, 0.08);
    this.pos.set(rand(-8, 8), sandY + 0.02, rand(-5, 5));
    this.target.copy(this.pos);
    this.group.position.copy(this.pos);
    this.radius = 1.1;
  }
  update(dt, t, ctx) {
    if (t > this.retargetAt) this.retarget(t, sandY + 0.02, sandY + 0.02);
    const d = this.target.clone().sub(this.pos); d.y = 0;
    const len = d.length();
    const moving = len > 0.15;
    if (moving) {
      d.multiplyScalar(1 / len);
      this.pos.addScaledVector(d, Math.min(0.4, len) * dt);
      this.group.rotation.y = damp(this.group.rotation.y, Math.atan2(d.x, d.z), 1.8, dt);
    }
    this.group.position.set(this.pos.x, sandY + 0.02, this.pos.z);
    this.head.scale.y = 0.76 + Math.sin(t * 1.3 + this.seed) * 0.02;
    this.nose.rotation.x = 1.45 + Math.sin(t * 1.1 + this.seed) * 0.08;
    for (let i = 0; i < this.limbs.length; i++) {
      const L = this.limbs[i];
      const isArm = i < 2;
      for (let j = 0; j < L.chain.length; j++) {
        const s = L.chain[j];
        const w = Math.sin(t * (moving ? 3.2 : 1.4) - j * 0.6 + i * 0.9 + this.seed);
        s.rotation.x = (isArm ? 0.1 : 0.05) + w * (isArm ? 0.18 : 0.22);
        s.rotation.z = Math.cos(t * 1.2 - j * 0.5 + i) * 0.12;
      }
    }
    const bl = Math.max(0, Math.sin(t * 0.35 + this.seed) - 0.95) * 22;
    for (const e of this.eyes) e.scale.y = 1 - Math.min(0.8, bl);
    this.pulse = damp(this.pulse, 0, 2, dt);
    if (ctx.bubbles && Math.random() < dt * 0.5) ctx.bubbles(this.pos.x, this.pos.y + 2.1, this.pos.z, 1);
  }
}

class Seahorse extends Guest {
  constructor(scene) {
    super(scene, 'horse');
    const m = this.mat({ map: shellTex('#7dff5c', 'rgba(20,110,40,.5)', '#2fa84f'), roughness: 0.45, emissive: 0x1d6b2a, emissiveIntensity: 0.15 });
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      const y = lerp(1.0, -1.0, k);
      const z = Math.sin(k * 2.4) * 0.34 - k * 0.1;
      pts.push(new THREE.Vector3(0, y, z));
    }
    for (let i = 1; i <= 14; i++) {
      const a = i / 14 * Math.PI * 1.7;
      pts.push(new THREE.Vector3(0, -1.0 - Math.sin(a) * 0.34 + i * 0.012, -0.34 + (1 - Math.cos(a)) * 0.3));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 60, 0.17, 10, false);
    geo.userData.own = true;
    const body = new THREE.Mesh(geo, m);
    body.castShadow = true;
    this.group.add(body);
    const head = new THREE.Mesh(BALL, m);
    head.scale.set(0.2, 0.24, 0.26); head.position.set(0, 1.05, 0.16);
    this.group.add(head);
    const snout = new THREE.Mesh(CONE, m);
    snout.scale.set(0.075, 0.4, 0.075); snout.rotation.x = Math.PI / 2 + 0.25; snout.position.set(0, 1.0, 0.44);
    this.group.add(snout);
    const crown = new THREE.Mesh(CONE, this.mat({ color: 0xffd23f, roughness: 0.4 }));
    crown.scale.set(0.1, 0.22, 0.1); crown.position.set(0, 1.32, 0.06);
    this.group.add(crown);
    const eb = this.mat({ color: 0x10200f, roughness: 0.15 });
    for (const sx of [1, -1]) {
      const e = new THREE.Mesh(BALL, eb); e.scale.setScalar(0.055); e.position.set(sx * 0.15, 1.12, 0.28);
      this.group.add(e);
    }
    const finMat = this.mat({ color: 0xd6ffb8, roughness: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide, emissive: 0x7dff5c, emissiveIntensity: 0.3 });
    const dorsal = new THREE.Mesh(PLANE, finMat);
    dorsal.scale.set(0.34, 0.6, 1); dorsal.position.set(0, 0.25, -0.3); dorsal.rotation.y = Math.PI / 2;
    this.group.add(dorsal); this.dorsal = dorsal;
    this.pos.set(rand(-8, 8), rand(sandY + 2, waterTopY - 2.5), rand(-5, 5));
    this.group.position.copy(this.pos);
    this.radius = 1;
  }
  update(dt, t) {
    if (t > this.retargetAt) this.retarget(t, sandY + 2, waterTopY - 2.5);
    this.moveTo(dt, 0.75);
    this.group.rotation.x = damp(this.group.rotation.x, Math.sin(t * 1.2 + this.seed) * 0.1, 3, dt);
    this.group.rotation.z = Math.sin(t * 1.6 + this.seed) * 0.08;
    this.group.position.y = this.pos.y + Math.sin(t * 2.2 + this.seed) * 0.12;
    this.dorsal.scale.x = 0.34 * (0.7 + Math.abs(Math.sin(t * 26)) * 0.6);
    this.dorsal.rotation.z = Math.sin(t * 26) * 0.25;
    this.pulse = damp(this.pulse, 0, 2, dt);
  }
}

class Jelly extends Guest {
  constructor(scene) {
    super(scene, 'jelly');
    this.glow = glowTexture('#ffc2e0', 'rgba(255,120,190,0)');
    const m = this.mat({
      map: shellTex('#ffb3d9', 'rgba(226,64,140,.6)', '#ff8fc6'), roughness: 0.2, metalness: 0,
      transparent: true, opacity: 0.82, emissive: 0xff5fa8, emissiveIntensity: 0.5,
      side: THREE.DoubleSide, depthWrite: false
    });
    const bellGeo = new THREE.SphereGeometry(0.85, 26, 18, 0, TAU, 0, Math.PI * 0.56);
    bellGeo.userData.own = true;
    const bell = new THREE.Mesh(bellGeo, m);
    bell.castShadow = false;
    this.group.add(bell); this.bell = bell;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.83, 0.05, 8, 30), this.mat({ color: 0xff3d8b, emissive: 0xff3d8b, emissiveIntensity: 1.0, transparent: true, opacity: 0.8 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.16;
    this.group.add(rim); this.rim = rim;
    const tm = this.mat({ color: 0xffc2e0, transparent: true, opacity: 0.55, emissive: 0xff5fa8, emissiveIntensity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    this.tents = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const root = new THREE.Group();
      root.position.set(Math.cos(a) * 0.4, -0.18, Math.sin(a) * 0.4);
      let parent = root; const chain = [];
      for (let j = 0; j < 8; j++) {
        const s = new THREE.Group();
        const p = new THREE.Mesh(PLANE, tm);
        p.scale.set(0.12, 0.36, 1); p.position.y = -0.18;
        s.add(p); s.position.y = j === 0 ? 0 : -0.34;
        parent.add(s); parent = s; chain.push(s);
      }
      this.group.add(root); this.tents.push({ chain, i });
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xff7fbf, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.setScalar(3.2);
    this.group.add(sprite); this.sprite = sprite;
    this.radius = 1.2;
  }
  update(dt, t) {
    if (t > this.retargetAt) this.retarget(t, sandY + 2.5, waterTopY - 1.6);
    const p = (Math.sin(t * 1.5 + this.seed) + 1) / 2;
    const push = Math.pow(p, 3);
    this.moveTo(dt, 0.3 + push * 1.5);
    this.pos.y += (0.25 + push * 0.9) * dt * 0.5;
    this.pos.y = clamp(this.pos.y, sandY + 2, waterTopY - 1.2);
    this.group.position.copy(this.pos);
    this.group.rotation.x = damp(this.group.rotation.x, 0, 2, dt);
    const s = 1 + push * 0.22;
    this.bell.scale.set(1 / Math.sqrt(s), s * 0.92, 1 / Math.sqrt(s));
    this.rim.scale.setScalar(1 / Math.sqrt(s));
    this.rim.position.y = -0.16 * s;
    for (const tt of this.tents) {
      for (let j = 0; j < tt.chain.length; j++) {
        tt.chain[j].rotation.x = Math.sin(t * 1.5 - j * 0.55 + tt.i * 0.6 + this.seed) * 0.22 - push * 0.18;
        tt.chain[j].rotation.z = Math.cos(t * 1.2 - j * 0.5 + tt.i) * 0.16;
      }
    }
    this.sprite.material.opacity = 0.25 + push * 0.3;
    this.sprite.scale.setScalar(3.0 + push * 0.8);
    this.pulse = damp(this.pulse, 0, 2, dt);
  }
  dispose() { this.glow.dispose(); this.sprite.material.dispose(); super.dispose(); }
}

class Turtle extends Guest {
  constructor(scene) {
    super(scene, 'turtle');
    const shellM = this.mat({ map: hexTex('#3f7a45', 'rgba(16,40,20,.85)'), roughness: 0.5 });
    const skinM = this.mat({ color: 0x6fa86a, roughness: 0.6 });
    const shell = new THREE.Mesh(BALL, shellM);
    shell.scale.set(1.0, 0.5, 1.25); shell.castShadow = true;
    this.group.add(shell); this.shell = shell;
    const belly = new THREE.Mesh(BALL, this.mat({ color: 0xe4d9a8, roughness: 0.6 }));
    belly.scale.set(0.9, 0.28, 1.12); belly.position.y = -0.24;
    this.group.add(belly);
    const head = new THREE.Mesh(BALL, skinM);
    head.scale.set(0.28, 0.24, 0.36); head.position.set(0, 0.02, 1.35);
    this.group.add(head); this.head = head;
    const eb = this.mat({ color: 0x101a10, roughness: 0.15 });
    for (const sx of [1, -1]) {
      const e = new THREE.Mesh(BALL, eb); e.scale.setScalar(0.055); e.position.set(sx * 0.16, 0.1, 1.58);
      this.group.add(e);
    }
    this.flippers = [];
    for (const sx of [1, -1]) {
      for (const front of [1, -1]) {
        const p = new THREE.Group();
        p.position.set(sx * 0.85, -0.1, front * 0.7);
        const f = new THREE.Mesh(BALL, skinM);
        const len = front > 0 ? 0.95 : 0.55;
        f.scale.set(len, 0.1, 0.34);
        f.position.x = sx * len * 0.6;
        f.rotation.y = sx * front * 0.3;
        p.add(f); this.group.add(p);
        this.flippers.push({ p, sx, front });
      }
    }
    const tail = new THREE.Mesh(CONE, skinM);
    tail.scale.set(0.1, 0.34, 0.1); tail.rotation.x = -Math.PI / 2; tail.position.set(0, -0.05, -1.35);
    this.group.add(tail);
    this.breathAt = rand(8, 18);
    this.radius = 1.5;
  }
  update(dt, t) {
    this.breathAt -= dt;
    if (this.breathAt <= 0) {
      this.breathAt = rand(14, 26);
      this.target.set(rand(BOUNDS.minX + 2, BOUNDS.maxX - 2), waterTopY - 0.9, rand(BOUNDS.minZ + 2, BOUNDS.maxZ - 2));
      this.retargetAt = t + 6;
    } else if (t > this.retargetAt) {
      this.retarget(t, sandY + 1.6, waterTopY - 2.2);
    }
    this.moveTo(dt, 1.15);
    for (const f of this.flippers) {
      const ph = t * 1.7 + (f.front > 0 ? 0 : Math.PI) + (f.sx > 0 ? 0 : 0.5);
      f.p.rotation.z = f.sx * Math.sin(ph) * 0.55;
      f.p.rotation.y = Math.cos(ph) * 0.22;
    }
    this.head.position.z = 1.35 + Math.sin(t * 0.8 + this.seed) * 0.08;
    this.shell.scale.y = 0.5 + Math.sin(t * 1.1 + this.seed) * 0.015;
    this.pulse = damp(this.pulse, 0, 2, dt);
  }
}

const BUILDERS = { sponge: Sponge, star: Star, octo: Octo, horse: Seahorse, jelly: Jelly, turtle: Turtle };
export function makeGuest(scene, key) {
  const B = BUILDERS[key] || Sponge;
  return new B(scene);
}

/* ============================================================
   manager
   ============================================================ */
export class Critters {
  constructor(scene) {
    this.scene = scene;
    this.crab = new Crab(scene);
    this.shrimp = [new Shrimp(scene, 0xff8fa8), new Shrimp(scene, 0xffd08a)];
    this.snail = new Snail(scene);
    this.guests = [];
    this.all = [this.crab, ...this.shrimp, this.snail];
  }

  addGuest(key) {
    if (this.guests.length >= 3) return null;
    if (this.guests.some((g) => g.key === key)) return null;
    const g = makeGuest(this.scene, key);
    this.guests.push(g);
    return g;
  }

  removeGuest(key) {
    const i = this.guests.findIndex((g) => g.key === key);
    if (i < 0) return false;
    this.guests[i].dispose();
    this.guests.splice(i, 1);
    return true;
  }

  guestKeys() { return this.guests.map((g) => g.key); }

  pickables() {
    const out = [{ obj: this.crab, group: this.crab.group }];
    for (const g of this.guests) out.push({ obj: g, group: g.group });
    return out;
  }

  update(dt, t, ctx) {
    this.crab.update(dt, t, ctx);
    for (const s of this.shrimp) s.update(dt, t, ctx);
    this.snail.update(dt, t);
    for (const g of this.guests) g.update(dt, t, ctx);
  }

  dispose() {
    this.crab.dispose();
    for (const s of this.shrimp) s.dispose();
    this.snail.dispose();
    for (const g of this.guests) g.dispose();
    this.guests.length = 0;
  }
}