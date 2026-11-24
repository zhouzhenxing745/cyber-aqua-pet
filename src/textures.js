import * as THREE from '../vendor/three.module.js';
import { mulberry32, TAU } from './util.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(canvas, repeatX, repeatY) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeatX || repeatY) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
  }
  t.needsUpdate = true;
  return t;
}

/* ============================================================
   fish skin — x: nose→tail, y: dorsal→belly→dorsal
   ============================================================ */
export function fishSkin(cfg) {
  const W = 512, H = 256;
  const c = cv(W, H), g = c.getContext('2d');
  const r = mulberry32(cfg.seed || 7);

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, cfg.dorsal);
  grad.addColorStop(0.16, cfg.base);
  grad.addColorStop(0.34, cfg.lateral || cfg.base);
  grad.addColorStop(0.50, cfg.belly);
  grad.addColorStop(0.66, cfg.lateral || cfg.base);
  grad.addColorStop(0.84, cfg.base);
  grad.addColorStop(1.00, cfg.dorsal);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  /* head shading + gill line */
  const hg = g.createLinearGradient(0, 0, W * 0.2, 0);
  hg.addColorStop(0, 'rgba(0,0,0,.24)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hg; g.fillRect(0, 0, W * 0.2, H);
  g.strokeStyle = 'rgba(0,0,0,.20)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W * 0.19, H * 0.14); g.quadraticCurveTo(W * 0.24, H * 0.5, W * 0.19, H * 0.86); g.stroke();

  const blob = (x, y, rx, ry, col, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot || 0);
    g.fillStyle = col; g.beginPath();
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const k = 0.72 + r() * 0.5;
      const px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill(); g.restore();
  };

  switch (cfg.pattern) {
    case 'koi': {
      g.fillStyle = cfg.belly; g.fillRect(0, 0, W, H);
      const gg = g.createLinearGradient(0, 0, 0, H);
      gg.addColorStop(0, 'rgba(120,140,160,.30)'); gg.addColorStop(0.5, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(120,140,160,.30)');
      g.fillStyle = gg; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        blob(r() * W, H * (0.16 + r() * 0.68), 34 + r() * 62, 26 + r() * 44, i % 3 === 2 ? cfg.accent2 : cfg.accent, r() * TAU);
      }
      for (let i = 0; i < 16; i++) blob(r() * W, r() * H, 3 + r() * 7, 3 + r() * 6, 'rgba(24,24,30,.72)', 0);
      break;
    }
    case 'bands': {
      const bands = [[0.16, 0.09], [0.44, 0.11], [0.78, 0.08]];
      for (const [bx, bw] of bands) {
        g.fillStyle = cfg.accent2;
        g.beginPath();
        for (let y = 0; y <= H; y += 8) g.lineTo(W * (bx - bw / 2) + Math.sin(y * 0.05) * 7, y);
        for (let y = H; y >= 0; y -= 8) g.lineTo(W * (bx + bw / 2) + Math.sin(y * 0.05 + 1) * 7, y);
        g.closePath(); g.fill();
        g.fillStyle = cfg.accent;
        g.beginPath();
        for (let y = 0; y <= H; y += 8) g.lineTo(W * (bx - bw / 2 + 0.014) + Math.sin(y * 0.05) * 7, y);
        for (let y = H; y >= 0; y -= 8) g.lineTo(W * (bx + bw / 2 - 0.014) + Math.sin(y * 0.05 + 1) * 7, y);
        g.closePath(); g.fill();
      }
      break;
    }
    case 'bars': {
      g.globalAlpha = 0.82;
      for (let i = 0; i < 4; i++) {
        const bx = W * (0.2 + i * 0.19);
        g.fillStyle = cfg.accent2;
        g.beginPath();
        g.moveTo(bx - 13, 0); g.lineTo(bx + 13, 0); g.lineTo(bx + 22, H); g.lineTo(bx - 22, H);
        g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'neon': {
      const stripe = (y0, y1, col) => {
        const sg = g.createLinearGradient(0, y0, 0, y1);
        sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, col); sg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sg; g.fillRect(W * 0.08, y0, W * 0.86, y1 - y0);
      };
      stripe(H * 0.20, H * 0.34, cfg.accent);
      stripe(H * 0.66, H * 0.80, cfg.accent);
      stripe(H * 0.34, H * 0.44, cfg.accent2);
      stripe(H * 0.56, H * 0.66, cfg.accent2);
      break;
    }
    case 'spots': {
      for (let i = 0; i < 46; i++) {
        const x = r() * W, y = r() * H, rad = 3 + r() * 9;
        g.fillStyle = i % 4 === 0 ? cfg.accent2 : cfg.accent;
        g.globalAlpha = 0.5 + r() * 0.45;
        g.beginPath(); g.ellipse(x, y, rad, rad * 0.8, 0, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'tang': {
      g.fillStyle = cfg.accent2;
      g.beginPath();
      g.moveTo(W * 0.22, H * 0.18);
      g.bezierCurveTo(W * 0.62, H * 0.10, W * 0.80, H * 0.34, W * 0.70, H * 0.52);
      g.bezierCurveTo(W * 0.60, H * 0.70, W * 0.34, H * 0.62, W * 0.26, H * 0.44);
      g.closePath(); g.fill();
      const tg = g.createLinearGradient(W * 0.82, 0, W, 0);
      tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(1, cfg.accent);
      g.fillStyle = tg; g.fillRect(W * 0.82, 0, W * 0.18, H);
      break;
    }
    default: break;
  }

  /* scale micro-pattern */
  if (cfg.scales !== false) {
    g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 1.4;
    const sw = 15, sh = 11;
    for (let y = 0; y < H + sh; y += sh) {
      for (let x = ((y / sh) % 2) * (sw / 2); x < W + sw; x += sw) {
        g.beginPath(); g.arc(x, y, sw * 0.55, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
      }
    }
    g.strokeStyle = 'rgba(0,0,0,.10)';
    for (let y = 0; y < H + sh; y += sh) {
      for (let x = ((y / sh) % 2) * (sw / 2); x < W + sw; x += sw) {
        g.beginPath(); g.arc(x, y + 1.4, sw * 0.55, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
      }
    }
  }

  /* lateral sheen */
  const sheen = g.createLinearGradient(0, H * 0.24, 0, H * 0.42);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,.22)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, H * 0.24, W, H * 0.18);
  const sheen2 = sheen;
  g.save(); g.translate(0, H); g.scale(1, -1); g.fillStyle = sheen2; g.fillRect(0, H * 0.24, W, H * 0.18); g.restore();

  return tex(c);
}

/* translucent fin membrane with rays */
export function finTexture() {
  const W = 128, H = 128;
  const c = cv(W, H), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(255,255,255,.92)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,.16)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.6;
  for (let i = 0; i <= 9; i++) {
    const y = (i / 9) * H;
    g.beginPath(); g.moveTo(0, H / 2); g.quadraticCurveTo(W * 0.5, y * 0.85 + H * 0.07, W, y); g.stroke();
  }
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* tileable sand */
export function sandTexture() {
  const S = 512;
  const c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = '#d9c08a'; g.fillRect(0, 0, S, S);
  const r = mulberry32(99);
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S, rad = 0.6 + r() * 2.1;
    const l = r();
    g.fillStyle = l < 0.34 ? 'rgba(120,96,58,.34)' : l < 0.7 ? 'rgba(255,240,206,.42)' : 'rgba(178,150,102,.3)';
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S;
    g.strokeStyle = 'rgba(150,124,80,.16)'; g.lineWidth = 2 + r() * 4;
    g.beginPath(); g.moveTo(x, y);
    g.bezierCurveTo(x + 40, y + 18, x + 80, y - 18, x + 130, y + 6);
    g.stroke();
  }
  return tex(c, 3, 2);
}

/* tileable caustic interference pattern (grayscale, additive) */
export function causticTexture() {
  const S = 256;
  const c = cv(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * TAU, v = (y / S) * TAU;
      let s = 0;
      s += Math.sin(u * 3 + Math.sin(v * 2) * 1.6);
      s += Math.sin(v * 4 + Math.sin(u * 3) * 1.4);
      s += Math.sin((u + v) * 2.5);
      s += Math.sin(Math.hypot(Math.sin(u * 2), Math.cos(v * 2)) * 6);
      let k = Math.abs(s) / 4;
      k = Math.pow(1 - k, 5.5);
      const val = Math.min(255, k * 340);
      const i = (y * S + x) * 4;
      d[i] = val; d[i + 1] = val; d[i + 2] = val; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, 1, 1);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* soft radial glow for additive sprites */
export function glowTexture(inner, outer) {
  const S = 128;
  const c = cv(S, S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner || 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, outer || 'rgba(255,255,255,.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* bubble: bright rim + specular dot */
export function bubbleTexture() {
  const S = 128;
  const c = cv(S, S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0, 'rgba(190,240,255,0.03)');
  grad.addColorStop(0.72, 'rgba(190,240,255,0.16)');
  grad.addColorStop(0.92, 'rgba(225,250,255,0.78)');
  grad.addColorStop(1, 'rgba(225,250,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath(); g.ellipse(S * 0.36, S * 0.32, S * 0.09, S * 0.06, -0.6, 0, TAU); g.fill();
  const t = tex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* bottle label */
export function labelTexture() {
  const W = 512, H = 256;
  const c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#0b2c3c'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#12657f'); grad.addColorStop(0.5, '#0a2a3a'); grad.addColorStop(1, '#14607c');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#ffab2e'; g.lineWidth = 8; g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = '#ffab2e';
  g.font = 'bold 62px "PingFang SC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('AQUA FEED', W / 2, H * 0.36);
  g.fillStyle = '#7af1ff';
  g.font = 'bold 34px "PingFang SC", sans-serif';
  g.fillText('深 海 营 养 颗 粒', W / 2, H * 0.63);
  g.fillStyle = 'rgba(122,241,255,.55)';
  g.font = '22px monospace';
  g.fillText('NET 60 PELLETS · PROTEIN 42%', W / 2, H * 0.83);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = 'rgba(255,171,46,.75)';
    g.beginPath(); g.arc(30 + i * 18, H - 30, 4, 0, TAU); g.fill();
  }
  return tex(c);
}

/* rock / coral surface */
export function rockTexture(base, dark) {
  const S = 256;
  const c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const r = mulberry32(4242);
  for (let i = 0; i < 2400; i++) {
    const x = r() * S, y = r() * S, rad = 1 + r() * 6;
    g.fillStyle = r() < 0.5 ? dark : 'rgba(255,255,255,.07)';
    g.globalAlpha = 0.14 + r() * 0.3;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  return tex(c, 2, 2);
}

/* CSS film grain */
export function grainDataURL() {
  const S = 96;
  const c = cv(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const r = mulberry32(8);
  for (let i = 0; i < S * S; i++) {
    const v = 120 + r() * 135;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}