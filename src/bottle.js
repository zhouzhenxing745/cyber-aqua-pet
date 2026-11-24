import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp, rand, rnd, TAU, smoothstep } from './util.js';
import { labelTexture } from './textures.js';
import { waterTopY, halfW, halfD } from './world.js';

const CAPACITY = 60;
const RG = 0.16;            /* grain radius */
const BODY_R = 1.25;
const BODY_BOT = -1.9;
const SHOULDER_Y = 1.35;
const NECK_Y = 2.0;
const NECK_R = 0.52;
const MOUTH_Y = 2.56;

function innerRadius(y) {
  if (y <= SHOULDER_Y) return BODY_R;
  if (y >= NECK_Y) return NECK_R;
  return lerp(BODY_R, NECK_R, (y - SHOULDER_Y) / (NECK_Y - SHOULDER_Y));
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

export class Bottle {
  constructor(scene, onPour) {
    this.onPour = onPour;
    this.capacity = CAPACITY;
    this.group = new THREE.Group();
    this.dock = new THREE.Vector3(0, waterTopY + 6.4, 0);
    this.group.position.copy(this.dock);
    this.state = 'docked';
    this.tilt = 0;
    this.targetTilt = 0;
    this.spin = 0;
    this.target = this.dock.clone();
    this.prevPos = this.dock.clone();
    this.worldVel = new THREE.Vector3();
    this.shakeEnergy = 0;
    this.returnFrom = new THREE.Vector3();
    this.returnT = 0;
    this.capOpen = 0;
    this.pourAccum = 0;

    /* ---- shell ---- */
    const profile = [
      [0.001, BODY_BOT - 0.05], [BODY_R * 0.86, BODY_BOT - 0.05], [BODY_R, BODY_BOT + 0.16],
      [BODY_R, SHOULDER_Y], [BODY_R * 0.86, 1.62], [NECK_R + 0.08, 1.92],
      [NECK_R, NECK_Y], [NECK_R, MOUTH_Y], [NECK_R + 0.07, MOUTH_Y + 0.04]
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const shellGeo = new THREE.LatheGeometry(profile, 28);
    this.shellMat = new THREE.MeshStandardMaterial({
      color: 0xbfeaff, transparent: true, opacity: 0.24, roughness: 0.06, metalness: 0.1,
      side: THREE.DoubleSide, depthWrite: false
    });
    this.shell = new THREE.Mesh(shellGeo, this.shellMat);
    this.shell.renderOrder = 5;
    this.group.add(this.shell);

    this.rimMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: { uColor: { value: new THREE.Color('#7af1ff') } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main(){ float f=pow(clamp(1.0-abs(dot(normalize(vN),normalize(vV))),0.0,1.0),2.2); gl_FragColor=vec4(uColor, f*0.55); }'
    });
    const rim = new THREE.Mesh(shellGeo, this.rimMat);
    rim.scale.setScalar(1.015);
    rim.renderOrder = 6;
    this.group.add(rim);

    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(BODY_R + 0.012, BODY_R + 0.012, 1.55, 28, 1, true),
      new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide })
    );
    label.position.y = -0.42;
    this.group.add(label);

    /* ---- flip cap ---- */
    this.capPivot = new THREE.Group();
    this.capPivot.position.set(0, MOUTH_Y + 0.02, -NECK_R - 0.06);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffab2e, roughness: 0.35, metalness: 0.25, emissive: 0xff7a10, emissiveIntensity: 0.28 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(NECK_R + 0.13, NECK_R + 0.13, 0.46, 18), capMat);
    cap.position.set(0, 0.23, NECK_R + 0.06);
    cap.castShadow = true;
    this.capPivot.add(cap);
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(NECK_R + 0.14, 0.045, 6, 20), capMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.set(0, 0.1, NECK_R + 0.06);
    this.capPivot.add(ridge);
    this.group.add(this.capPivot);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(NECK_R + 0.05, 0.06, 8, 20), capMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = MOUTH_Y - 0.08;
    this.group.add(collar);

    /* ---- grains ---- */
    this.grains = [];
    const gGeo = new THREE.SphereGeometry(RG, 8, 6);
    gGeo.scale(1, 0.85, 1.1);
    const gMat = new THREE.MeshStandardMaterial({ color: 0xffb84d, roughness: 0.5, metalness: 0.05, emissive: 0xff8c1a, emissiveIntensity: 0.7 });
    this.grainMesh = new THREE.InstancedMesh(gGeo, gMat, CAPACITY);
    this.grainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grainMesh.frustumCulled = false;
    this.grainMesh.castShadow = true;
    this.group.add(this.grainMesh);
    this.refill(true);

    this.hitMeshes = [this.shell, label, cap, collar];
    scene.add(this.group);
  }

  get count() { return this.grains.length; }

  refill(instant) {
    this.grains.length = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const layer = Math.floor(i / 10);
      const k = i % 10;
      const a = (k / 10) * TAU + layer * 0.31;
      const rr = (k % 3 === 0 ? 0.3 : k % 3 === 1 ? 0.66 : 0.98) * (BODY_R - RG * 1.4);
      this.grains.push({
        p: new THREE.Vector3(Math.cos(a) * rr, BODY_BOT + RG + 0.06 + layer * RG * 1.85, Math.sin(a) * rr),
        v: new THREE.Vector3(),
        rot: rnd() * TAU
      });
    }
    if (instant) for (let i = 0; i < 40; i++) this.stepGrains(1 / 60, 0);
    this.syncGrains();
  }

  grab() {
    if (this.state === 'held') return;
    this.state = 'held';
    this.target.copy(this.group.position);
    this.prevPos.copy(this.group.position);
  }
  release() {
    if (this.state !== 'held') return;
    this.state = 'returning';
    this.returnFrom.copy(this.group.position);
    this.returnT = 0;
    this.targetTilt = 0;
  }
  setTarget(v) { this.target.copy(v); }
  setTilt(rad) { this.targetTilt = clamp(rad, 0, Math.PI * 0.94); }
  shake(amount) { this.shakeEnergy = Math.min(2.4, this.shakeEnergy + amount); }

  stepGrains(dt, tilt) {
    const g = this.grains;
    const n = g.length;
    if (!n) return;
    /* gravity expressed in bottle-local space */
    _q.copy(this.group.quaternion).invert();
    _v.copy(DOWN).applyQuaternion(_q).multiplyScalar(15);
    const agit = this.shakeEnergy;
    const capOpen = tilt > 0.42;

    for (let i = 0; i < n; i++) {
      const a = g[i];
      a.v.x += _v.x * dt; a.v.y += _v.y * dt; a.v.z += _v.z * dt;
      if (agit > 0.01) {
        a.v.x += (rnd() - 0.5) * agit * 9 * dt;
        a.v.y += (rnd() - 0.5) * agit * 9 * dt;
        a.v.z += (rnd() - 0.5) * agit * 9 * dt;
      }
      const drag = 1 - clamp(1.4 * dt, 0, 0.6);
      a.v.multiplyScalar(drag);
      a.p.addScaledVector(a.v, dt);
      a.rot += a.v.length() * dt * 2;
    }

    /* grain ↔ grain */
    const D = RG * 2, D2 = D * D;
    for (let i = 0; i < n; i++) {
      const a = g[i];
      for (let j = i + 1; j < n; j++) {
        const b = g[j];
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= D2 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const overlap = (D - d) * 0.5;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        a.p.x -= nx * overlap; a.p.y -= ny * overlap; a.p.z -= nz * overlap;
        b.p.x += nx * overlap; b.p.y += ny * overlap; b.p.z += nz * overlap;
        const rvx = b.v.x - a.v.x, rvy = b.v.y - a.v.y, rvz = b.v.z - a.v.z;
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn < 0) {
          const imp = vn * 0.42;
          a.v.x += nx * imp; a.v.y += ny * imp; a.v.z += nz * imp;
          b.v.x -= nx * imp; b.v.y -= ny * imp; b.v.z -= nz * imp;
        }
      }
    }

    /* walls + mouth */
    for (let i = n - 1; i >= 0; i--) {
      const a = g[i];
      const floor = BODY_BOT + RG;
      if (a.p.y < floor) { a.p.y = floor; if (a.v.y < 0) a.v.y *= -0.16; a.v.x *= 0.86; a.v.z *= 0.86; }
      const maxR = Math.max(0.02, innerRadius(a.p.y) - RG);
      const rr = Math.hypot(a.p.x, a.p.z);
      if (rr > maxR) {
        const s = maxR / rr;
        a.p.x *= s; a.p.z *= s;
        const nx = a.p.x / maxR, nz = a.p.z / maxR;
        const vn = a.v.x * nx + a.v.z * nz;
        if (vn > 0) { a.v.x -= nx * vn * 1.2; a.v.z -= nz * vn * 1.2; }
        a.v.y *= 0.94;
      }
      if (capOpen && a.p.y > MOUTH_Y - RG * 0.2) {
        this.emit(a);
        g.splice(i, 1);
      }
    }
  }

  emit(a) {
    this.group.updateMatrixWorld();
    _v.copy(a.p).applyMatrix4(this.group.matrixWorld);
    _v2.copy(a.v).applyQuaternion(this.group.quaternion).add(this.worldVel);
    if (_v2.length() < 0.6) {
      _v2.set(0, 1, 0).applyQuaternion(this.group.quaternion).multiplyScalar(1.4);
    }
    this.onPour(_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z);
  }

  syncGrains() {
    const n = this.grains.length;
    this.grainMesh.count = n;
    for (let i = 0; i < n; i++) {
      const a = this.grains[i];
      _e.set(a.rot * 0.5, a.rot, a.rot * 0.3);
      _q.setFromEuler(_e);
      _m.compose(a.p, _q, _one);
      this.grainMesh.setMatrixAt(i, _m);
    }
    if (n) this.grainMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, t) {
    this.prevPos.copy(this.group.position);

    if (this.state === 'docked') {
      this.group.position.x = damp(this.group.position.x, this.dock.x, 4, dt);
      this.group.position.z = damp(this.group.position.z, this.dock.z, 4, dt);
      this.group.position.y = this.dock.y + Math.sin(t * 1.1) * 0.22;
      this.spin += dt * 0.32;
      this.group.rotation.set(0, this.spin, Math.sin(t * 0.7) * 0.05);
      this.tilt = damp(this.tilt, 0, 6, dt);
    } else if (this.state === 'held') {
      this.group.position.x = damp(this.group.position.x, this.target.x, 14, dt);
      this.group.position.y = damp(this.group.position.y, this.target.y, 14, dt);
      this.group.position.z = damp(this.group.position.z, this.target.z, 14, dt);
      this.tilt = damp(this.tilt, this.targetTilt, 8, dt);
      const wob = Math.sin(t * 9) * 0.02 * (1 + this.shakeEnergy);
      this.group.rotation.set(wob * 0.6, damp(this.group.rotation.y, 0, 6, dt), this.tilt + wob);
    } else {
      this.returnT = Math.min(1, this.returnT + dt / 0.7);
      const k = smoothstep(this.returnT);
      this.group.position.lerpVectors(this.returnFrom, this.dock, k);
      this.tilt = damp(this.tilt, 0, 9, dt);
      this.group.rotation.set(0, this.spin, this.tilt);
      if (this.returnT >= 1) this.state = 'docked';
    }

    this.worldVel.copy(this.group.position).sub(this.prevPos).divideScalar(Math.max(1e-4, dt));
    this.shakeEnergy = Math.max(0, this.shakeEnergy - dt * 3.2);

    this.capOpen = damp(this.capOpen, this.tilt > 0.36 ? 1 : 0, 10, dt);
    this.capPivot.rotation.x = -this.capOpen * 2.5;

    const sub = 2;
    for (let s = 0; s < sub; s++) this.stepGrains(dt / sub, this.tilt);
    this.syncGrains();

    this.shellMat.opacity = 0.2 + this.capOpen * 0.06;
    this.rimMat.uniforms.uColor.value.setRGB(0.48 + this.capOpen * 0.5, 0.95, 1.0);
  }

  /* keep the held bottle inside a sane volume */
  clampTarget() {
    this.target.x = clamp(this.target.x, -halfW - 4, halfW + 4);
    this.target.z = clamp(this.target.z, -halfD - 4, halfD + 4);
    this.target.y = clamp(this.target.y, waterTopY + 1.2, waterTopY + 12);
  }
}