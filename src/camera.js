import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp, easeInOut } from './util.js';
import { waterTopY, halfH } from './world.js';

const R_MIN = 9, R_MAX = 92;
const PHI_MIN = 0.10, PHI_MAX = 1.78;

export const PRESETS = {
  free: { theta: 0.72, phi: 1.06, radius: 39, target: [0, -1.0, 0] },
  front: { theta: 0.0, phi: 1.33, radius: 37, target: [0, -1.2, 0] },
  top: { theta: 0.55, phi: 0.20, radius: 42, target: [0, -1, 0] },
  side: { theta: Math.PI / 2, phi: 1.36, radius: 35, target: [0, -1.2, 0] },
  under: { theta: 0.42, phi: 1.70, radius: 12, target: [0, waterTopY - 2.4, 0] },
  follow: { theta: 0.9, phi: 1.16, radius: 13, target: [0, 0, 0] }
};

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.theta = PRESETS.free.theta;
    this.phi = PRESETS.free.phi;
    this.radius = PRESETS.free.radius;
    this.dTheta = this.theta; this.dPhi = this.phi; this.dRadius = this.radius;
    this.target = new THREE.Vector3(...PRESETS.free.target);
    this.dTarget = this.target.clone();
    this.sensitivity = 1;
    this.autoRotate = false;
    this.autoSpeed = 0.12;
    this.preset = 'free';
    this.followObj = null;
    this.pointers = new Map();
    this.pinchDist = 0;
    this.tween = null;
    this.interacting = false;
    this.idleAt = 0;
    this._v = new THREE.Vector3();
    this.onUserInput = null;
  }

  setPreset(name, instant) {
    const p = PRESETS[name];
    if (!p) return;
    this.preset = name;
    const end = {
      theta: name === 'follow' ? this.dTheta : p.theta,
      phi: p.phi, radius: p.radius,
      target: new THREE.Vector3(...p.target)
    };
    /* shortest angular path */
    let d = end.theta - this.theta;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    end.theta = this.theta + d;
    if (instant) {
      this.theta = this.dTheta = end.theta;
      this.phi = this.dPhi = end.phi;
      this.radius = this.dRadius = end.radius;
      this.target.copy(end.target); this.dTarget.copy(end.target);
      this.tween = null;
    } else {
      this.tween = {
        t: 0, dur: 0.95,
        from: { theta: this.theta, phi: this.phi, radius: this.radius, target: this.target.clone() },
        to: end
      };
    }
  }

  setFollow(obj) { this.followObj = obj; }
  setSensitivity(v) { this.sensitivity = v; }
  setAutoRotate(on) { this.autoRotate = on; }
  get zoom01() { return clamp((R_MAX - this.dRadius) / (R_MAX - R_MIN), 0, 1); }
  set zoom01(v) { this.dRadius = lerp(R_MAX, R_MIN, clamp(v, 0, 1)); this.tween = null; }

  cancelTween() { this.tween = null; }
  cancelAll() { this.pointers.clear(); this.interacting = false; this.pinchDist = 0; }

  onPointerDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.interacting = true;
    this.tween = null;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (this.onUserInput) this.onUserInput();
  }

  onPointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const rect = this.dom.getBoundingClientRect();
    const scale = (Math.PI * 1.35) / Math.max(240, rect.height);

    if (this.pointers.size === 1) {
      this.dTheta -= dx * scale * this.sensitivity;
      this.dPhi = clamp(this.dPhi - dy * scale * this.sensitivity, PHI_MIN, PHI_MAX);
      if (this.preset === 'follow') this.preset = 'free';
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) {
        const ratio = this.pinchDist / Math.max(1, d);
        this.dRadius = clamp(this.dRadius * ratio, R_MIN, R_MAX);
      }
      this.pinchDist = d;
      /* two-finger drag pans the look-at point */
      const panK = this.dRadius * 0.0016 * this.sensitivity;
      const right = this._v.set(Math.cos(this.theta), 0, -Math.sin(this.theta));
      this.dTarget.addScaledVector(right, -dx * panK * 0.5);
      this.dTarget.y = clamp(this.dTarget.y + dy * panK * 0.5, -halfH, waterTopY + 4);
      this.dTarget.x = clamp(this.dTarget.x, -14, 14);
      this.dTarget.z = clamp(this.dTarget.z, -12, 12);
      if (this.preset === 'follow') this.preset = 'free';
    }
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.interacting = false;
  }

  onWheel(e) {
    this.tween = null;
    const k = Math.exp(clamp(e.deltaY, -240, 240) * 0.0011);
    this.dRadius = clamp(this.dRadius * k, R_MIN, R_MAX);
    if (this.onUserInput) this.onUserInput();
  }

  update(dt, t) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = easeInOut(tw.t);
      this.theta = lerp(tw.from.theta, tw.to.theta, k);
      this.phi = lerp(tw.from.phi, tw.to.phi, k);
      this.radius = lerp(tw.from.radius, tw.to.radius, k);
      this.target.lerpVectors(tw.from.target, tw.to.target, k);
      this.dTheta = this.theta; this.dPhi = this.phi; this.dRadius = this.radius;
      this.dTarget.copy(this.target);
      if (tw.t >= 1) this.tween = null;
    } else {
      if (this.autoRotate && !this.interacting) this.dTheta += this.autoSpeed * dt;
      if (this.followObj && this.preset === 'follow') {
        this.dTarget.copy(this.followObj.pos);
        this.dTheta += dt * 0.05;
      }
      this.theta = damp(this.theta, this.dTheta, 9, dt);
      this.phi = damp(this.phi, this.dPhi, 9, dt);
      this.radius = damp(this.radius, this.dRadius, 8, dt);
      this.target.x = damp(this.target.x, this.dTarget.x, 7, dt);
      this.target.y = damp(this.target.y, this.dTarget.y, 7, dt);
      this.target.z = damp(this.target.z, this.dTarget.z, 7, dt);
    }

    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const x = this.target.x + this.radius * sp * Math.sin(this.theta);
    const y = this.target.y + this.radius * cp;
    const z = this.target.z + this.radius * sp * Math.cos(this.theta);
    this.camera.position.set(x, Math.max(y, -halfH - 1.0), z);
    this.camera.lookAt(this.target);
  }
}