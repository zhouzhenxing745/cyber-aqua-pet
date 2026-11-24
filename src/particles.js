import * as THREE from '../vendor/three.module.js';
import { clamp, rand, rnd, TAU, noise1 } from './util.js';
import { glowTexture, bubbleTexture } from './textures.js';
import { waterTopY, sandY } from './world.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/* ============================================================
   food pellets — real instanced physics
   ============================================================ */
export class FoodSystem {
  constructor(scene, max = 260) {
    this.max = max;
    this.items = [];
    const geo = new THREE.SphereGeometry(0.19, 8, 6);
    geo.scale(1, 0.82, 1.12);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffab2e, roughness: 0.55, metalness: 0.05,
      emissive: 0xff7a10, emissiveIntensity: 0.55
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.scene = scene;
  }
  spawn(x, y, z, vx, vy, vz) {
    if (this.items.length >= this.max) return null;
    const f = {
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(vx || 0, vy || 0, vz || 0),
      settled: false, eaten: false, claimed: 0,
      born: performance.now() / 1000, settleAt: 0,
      spin: rnd() * TAU, spinV: rand(-4, 4), scale: rand(0.82, 1.2),
      wet: y < waterTopY
    };
    this.items.push(f);
    return f;
  }
  remove(f) {
    const i = this.items.indexOf(f);
    if (i >= 0) this.items.splice(i, 1);
    f.eaten = true;
  }
  clear() { this.items.length = 0; this.mesh.count = 0; }
  update(dt, t, hooks) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const f = items[i];
      if (f.eaten) { items.splice(i, 1); continue; }
      if (!f.settled) {
        const above = f.pos.y > waterTopY;
        if (above) {
          f.vel.y -= 20 * dt;
          f.vel.multiplyScalar(1 - 0.15 * dt);
        } else {
          if (!f.wet) { f.wet = true; hooks.onSplash && hooks.onSplash(f.pos.x, f.pos.z, f.vel.length()); }
          f.vel.y -= 2.6 * dt;
          f.vel.y += 0.55 * dt;                       /* slight buoyancy */
          const drag = 1 - clamp(1.9 * dt, 0, 0.9);
          f.vel.x *= drag; f.vel.z *= drag;
          f.vel.y *= 1 - clamp(1.1 * dt, 0, 0.9);
          f.vel.x += noise1(t * 0.5 + f.pos.z * 0.3) * 0.32 * dt;
          f.vel.z += noise1(t * 0.47 + f.pos.x * 0.3 + 20) * 0.32 * dt;
        }
        f.pos.addScaledVector(f.vel, dt);
        f.spin += f.spinV * dt;
        if (f.pos.y <= sandY + 0.16) {
          f.pos.y = sandY + 0.16;
          f.settled = true; f.settleAt = t;
          f.vel.set(0, 0, 0);
          hooks.onSettle && hooks.onSettle(f);
        }
      } else if (t - f.settleAt > 24) {
        hooks.onDissolve && hooks.onDissolve(f);
        items.splice(i, 1);
        continue;
      }
    }
    this.mesh.count = items.length;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      _e.set(f.spin * 0.4, f.spin, f.spin * 0.25);
      _q.setFromEuler(_e);
      _s.setScalar(f.scale);
      _m.compose(f.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (items.length) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================
   GPU point sprites: bubbles + sparkles
   ============================================================ */
const PT_VERT = `
attribute float aSize; attribute float aAlpha;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
  vA = aAlpha;
  gl_Position = projectionMatrix * mv;
}`;
const PT_FRAG = `
uniform sampler2D uMap; uniform vec3 uColor;
varying float vA;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a * vA < 0.01) discard;
  gl_FragColor = vec4(uColor * t.rgb + uColor * 0.25, t.a * vA);
}`;

class PointPool {
  constructor(scene, max, map, color, blending) {
    this.max = max;
    this.items = [];
    this.posArr = new Float32Array(max * 3);
    this.sizeArr = new Float32Array(max);
    this.alphaArr = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uColor: { value: new THREE.Color(color) } },
      vertexShader: PT_VERT, fragmentShader: PT_FRAG,
      transparent: true, depthWrite: false, blending: blending || THREE.NormalBlending
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }
  flush() {
    const n = Math.min(this.items.length, this.max);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      this.posArr[i * 3] = it.pos.x; this.posArr[i * 3 + 1] = it.pos.y; this.posArr[i * 3 + 2] = it.pos.z;
      this.sizeArr[i] = it.size;
      this.alphaArr[i] = it.alpha;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class BubbleSystem extends PointPool {
  constructor(scene, max = 320) {
    super(scene, max, bubbleTexture(), '#cdf3ff', THREE.NormalBlending);
  }
  spawn(x, y, z, size, speed) {
    if (this.items.length >= this.max) return;
    this.items.push({
      pos: new THREE.Vector3(x, y, z),
      vy: speed || rand(1.1, 2.4),
      drift: rand(-0.5, 0.5), driftZ: rand(-0.5, 0.5),
      size: size || rand(0.35, 1.1), alpha: rand(0.5, 0.95),
      seed: rnd() * 10, wob: rand(1.4, 3.2)
    });
  }
  burst(x, y, z, n, spread) {
    for (let i = 0; i < n; i++) this.spawn(x + rand(-spread, spread), y + rand(-spread * 0.4, spread * 0.4), z + rand(-spread, spread), rand(0.25, 0.8), rand(1.4, 3));
  }
  update(dt, t) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      b.pos.y += b.vy * dt;
      b.pos.x += (b.drift + Math.sin(t * b.wob + b.seed) * 0.45) * dt;
      b.pos.z += (b.driftZ + Math.cos(t * b.wob * 0.8 + b.seed) * 0.4) * dt;
      b.vy += 0.35 * dt;
      b.size += 0.06 * dt;
      if (b.pos.y > waterTopY - 0.1) {
        b.alpha -= dt * 5;
        if (b.alpha <= 0 || b.pos.y > waterTopY + 0.4) { this.items.splice(i, 1); continue; }
      }
    }
    this.flush();
  }
  clear() { this.items.length = 0; this.flush(); }
}

export class SparkSystem extends PointPool {
  constructor(scene, max = 260) {
    super(scene, max, glowTexture(), '#ffd98a', THREE.AdditiveBlending);
  }
  burst(x, y, z, n, color, power) {
    if (color) this.mat.uniforms.uColor.value.set(color);
    for (let i = 0; i < n; i++) {
      if (this.items.length >= this.max) break;
      const a = rnd() * TAU, e = rand(-1, 1), r = Math.sqrt(Math.max(0, 1 - e * e));
      const sp = (power || 3) * rand(0.4, 1.2);
      this.items.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(Math.cos(a) * r * sp, e * sp + 1, Math.sin(a) * r * sp),
        size: rand(0.5, 1.5), alpha: 1, life: rand(0.5, 1.1), age: 0
      });
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i];
      s.age += dt;
      if (s.age > s.life) { this.items.splice(i, 1); continue; }
      s.vel.y -= 1.4 * dt;
      s.vel.multiplyScalar(1 - clamp(1.6 * dt, 0, 0.9));
      s.pos.addScaledVector(s.vel, dt);
      s.alpha = 1 - s.age / s.life;
      s.size *= 1 - 0.5 * dt;
    }
    this.flush();
  }
  clear() { this.items.length = 0; this.flush(); }
}

/* ============================================================
   surface ripples
   ============================================================ */
export class RippleSystem {
  constructor(scene, max = 12) {
    this.pool = [];
    const geo = new THREE.RingGeometry(0.72, 1, 40);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = waterTopY + 0.05;
      m.visible = false;
      m.renderOrder = 11;
      scene.add(m);
      this.pool.push({ mesh: m, mat, age: 0, life: 0, power: 1 });
    }
  }
  spawn(x, z, power) {
    const r = this.pool.find((p) => p.life <= 0) || this.pool[0];
    r.mesh.position.set(x, waterTopY + 0.05, z);
    r.mesh.visible = true;
    r.age = 0; r.life = 1.15; r.power = power || 1;
  }
  update(dt) {
    for (const r of this.pool) {
      if (r.life <= 0) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) { r.life = 0; r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const s = (0.4 + k * 3.4) * r.power;
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = (1 - k) * 0.55;
    }
  }
  clear() { for (const r of this.pool) { r.life = 0; r.mesh.visible = false; r.mat.opacity = 0; } }
}

/* ============================================================
   waste
   ============================================================ */
export class WasteSystem {
  constructor(scene, max = 8) {
    this.max = max;
    this.items = [];
    const geo = new THREE.SphereGeometry(0.3, 8, 6);
    geo.scale(1, 0.55, 1.3);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
  spawn(x, z) {
    if (this.items.length >= this.max) return false;
    this.items.push({ pos: new THREE.Vector3(x, sandY + 0.14, z), rot: rnd() * TAU, scale: rand(0.8, 1.25), age: 0 });
    return true;
  }
  clearAll() { this.items.length = 0; this.mesh.count = 0; }
  update(dt) {
    this.mesh.count = this.items.length;
    for (let i = 0; i < this.items.length; i++) {
      const w = this.items[i];
      w.age += dt;
      _e.set(0, w.rot, 0);
      _q.setFromEuler(_e);
      _s.setScalar(w.scale);
      _m.compose(w.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (this.items.length) this.mesh.instanceMatrix.needsUpdate = true;
  }
}