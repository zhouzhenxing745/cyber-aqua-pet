import { clamp, rand } from './util.js';

const NOTES = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5 };

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.7;
    this.ready = false;
    this._noise = null;
    this._lastPour = 0;
    this._lastBub = 0;
  }

  unlock() {
    if (this.ready) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(c.destination);

    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    this._noise = buf;
    this.ready = true;
    if (c.state === 'suspended') c.resume();
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  _env(node, t, a, d, peak) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur = 0.18, type = 'sine', peak = 0.2, delay = 0, glide = 0) {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + dur);
    const g = c.createGain();
    this._env(g, t, 0.008, dur, peak);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.06);
  }

  noise(dur = 0.2, peak = 0.2, f0 = 900, f1 = 300, q = 1.2, delay = 0, type = 'bandpass') {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this._noise;
    s.playbackRate.value = rand(0.85, 1.2);
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, 0.01, dur, peak);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, rand(0, 1.2)); s.stop(t + dur + 0.08);
  }

  click() { this.tone(880, 0.05, 'triangle', 0.09); this.tone(1320, 0.04, 'sine', 0.05, 0.02); }
  tick() { this.tone(1500, 0.03, 'square', 0.035); }
  toggle(on) { this.tone(on ? 660 : 440, 0.09, 'triangle', 0.09, 0, on ? 1.5 : 0.7); }
  err() { this.tone(180, 0.16, 'sawtooth', 0.1, 0, 0.7); this.tone(120, 0.2, 'square', 0.06, 0.05, 0.8); }

  pour(rate) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this._lastPour < 0.055) return;
    this._lastPour = now;
    this.noise(0.07, 0.05 + rate * 0.05, rand(2400, 4200), rand(900, 1500), 0.9, 0, 'highpass');
  }

  splash(power = 1) {
    const p = clamp(power, 0.2, 2);
    this.noise(0.26, 0.14 * p, 2600, 320, 0.8);
    this.tone(rand(420, 620), 0.12, 'sine', 0.06 * p, 0.01, 1.8);
  }

  bubble() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this._lastBub < 0.09) return;
    this._lastBub = now;
    this.tone(rand(500, 900), 0.09, 'sine', 0.045, 0, 2.4);
  }

  eat() {
    this.tone(NOTES.E5, 0.07, 'sine', 0.11, 0, 1.25);
    this.tone(NOTES.A5, 0.09, 'sine', 0.08, 0.05, 1.2);
    this.noise(0.06, 0.05, 1800, 600, 1.5);
  }

  play() {
    [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6].forEach((n, i) => this.tone(n, 0.22, 'triangle', 0.1, i * 0.07, 1.02));
  }

  clean() {
    this.noise(0.5, 0.12, 400, 3200, 0.7, 0, 'bandpass');
    [0, 1, 2, 3].forEach(i => this.tone(rand(700, 1200), 0.1, 'sine', 0.05, 0.08 + i * 0.09, 2.2));
  }

  levelUp() {
    [NOTES.C5, NOTES.E5, NOTES.G5, NOTES.C6, NOTES.E5 * 2].forEach((n, i) => {
      this.tone(n, 0.3, 'triangle', 0.11, i * 0.085);
      this.tone(n * 2, 0.2, 'sine', 0.04, i * 0.085 + 0.01);
    });
  }

  spawn() { this.tone(NOTES.G4, 0.14, 'sine', 0.09, 0, 1.6); this.tone(NOTES.D5, 0.18, 'triangle', 0.07, 0.07, 1.3); }
  release() { this.tone(NOTES.A4, 0.2, 'sine', 0.08, 0, 0.6); this.tone(NOTES.E4, 0.26, 'triangle', 0.06, 0.08, 0.7); }
  refill() { this.noise(0.42, 0.11, 1200, 2600, 0.8); this.tone(NOTES.C5, 0.16, 'triangle', 0.08, 0.3); }
  grab() { this.tone(300, 0.07, 'triangle', 0.07, 0, 1.35); }
  drop() { this.tone(220, 0.1, 'sine', 0.06, 0, 0.8); this.noise(0.1, 0.04, 900, 300, 1); }
  shake() { this.noise(0.14, 0.08, 3000, 1200, 0.6, 0, 'highpass'); }
  poop() { this.tone(140, 0.14, 'sawtooth', 0.05, 0, 0.6); }
}