import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, damp, rand, randInt, pick, chance, rnd, TAU } from './util.js';
import { sandTexture, causticTexture, rockTexture, glowTexture } from './textures.js';

export const TANK = { W: 30, H: 20, D: 20 };
const WATER_RATIO = 0.80;
export const halfW = TANK.W / 2, halfH = TANK.H / 2, halfD = TANK.D / 2;
export const waterTopY = -halfH + TANK.H * WATER_RATIO;
export const sandY = -halfH + 1.2;
export const BOUNDS = {
  minX: -halfW + 1.6, maxX: halfW - 1.6,
  minZ: -halfD + 1.6, maxZ: halfD - 1.6,
  minY: sandY + 0.5, maxY: waterTopY - 0.7
};

const GLASS_VERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vW = (modelMatrix * vec4(position,1.0)).xyz;
  gl_Position = projectionMatrix * mv;
}`;
const GLASS_FRAG = `
uniform vec3 uTint; uniform vec3 uRim; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main(){
  float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.6);
  float edge = smoothstep(0.0, 1.2, abs(vW.y - ${waterTopY.toFixed(2)}));
  vec3 col = mix(uTint, uRim, f);
  float a = uOpacity * (0.10 + f * 0.85);
  gl_FragColor = vec4(col, a);
}`;

const SURF_VERT = `
uniform float uTime; uniform float uWave;
varying vec3 vW; varying vec3 vN; varying vec2 vUv2;
float h(vec2 p){
  return sin(p.x*0.55 + uTime*1.1)*0.16
       + sin(p.y*0.72 - uTime*0.85)*0.13
       + sin((p.x+p.y)*0.34 + uTime*0.6)*0.10
       + sin(p.x*1.7 - p.y*1.3 + uTime*2.1)*0.045;
}
void main(){
  vec3 p = position;
  vec2 q = vec2(p.x, p.y);
  float amp = uWave;
  p.z += h(q)*amp;
  float e = 0.35;
  float hx = h(q+vec2(e,0.0))*amp - h(q-vec2(e,0.0))*amp;
  float hy = h(q+vec2(0.0,e))*amp - h(q-vec2(0.0,e))*amp;
  vec3 n = normalize(vec3(-hx/(2.0*e), -hy/(2.0*e), 1.0));
  vN = normalize(mat3(modelMatrix) * n);
  vec4 wp = modelMatrix * vec4(p,1.0);
  vW = wp.xyz; vUv2 = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SURF_FRAG = `
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSun; uniform float uTime; uniform float uOpacity; uniform sampler2D uCaustic;
varying vec3 vW; varying vec3 vN; varying vec2 vUv2;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float f = pow(clamp(1.0 - abs(dot(N,V)), 0.0, 1.0), 3.0);
  vec3 L = normalize(vec3(0.25,1.0,0.35));
  vec3 H = normalize(L+V);
  float spec = pow(max(dot(N,H),0.0), 90.0);
  float spark = texture2D(uCaustic, vW.xz*0.09 + vec2(uTime*0.02, -uTime*0.015)).r;
  vec3 col = mix(uDeep, uShallow, f*0.85 + 0.15);
  col += uSun * spec * 1.6;
  col += uShallow * spark * 0.35;
  float edge = smoothstep(0.0,0.06,vUv2.x)*smoothstep(1.0,0.94,vUv2.x)*smoothstep(0.0,0.06,vUv2.y)*smoothstep(1.0,0.94,vUv2.y);
  float foam = (1.0-edge)*0.5;
  col += vec3(0.7,0.95,1.0)*foam;
  gl_FragColor = vec4(col, uOpacity*(0.30+f*0.55) + foam*0.35);
}`;

const RAY_FRAG = `
uniform float uTime; uniform vec3 uColor; uniform float uStrength; uniform float uSeed;
varying vec2 vUv2;
void main(){
  float x = vUv2.x*2.0-1.0;
  float lat = pow(clamp(1.0-abs(x), 0.0, 1.0), 2.2);
  float vert = smoothstep(0.0,0.22,vUv2.y)*smoothstep(1.0,0.35,vUv2.y);
  float flick = 0.62 + 0.38*sin(uTime*0.7 + uSeed + vUv2.y*3.0);
  float a = lat*vert*flick*uStrength;
  gl_FragColor = vec4(uColor, a);
}`;
const RAY_VERT = `varying vec2 vUv2; void main(){ vUv2=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

const WEED_VERT = `
uniform float uTime; uniform float uSway; uniform float uSeed;
varying vec2 vUv2; varying float vShade;
void main(){
  vUv2 = uv;
  vec3 p = position;
  float k = uv.y;
  float s = sin(uTime*1.25 + uSeed + k*2.2) * uSway * k*k;
  float s2 = cos(uTime*0.83 + uSeed*1.7 + k*1.6) * uSway * 0.55 * k*k;
  p.x += s; p.z += s2;
  vShade = 0.65 + 0.35*k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
}`;
const WEED_FRAG = `
uniform vec3 uBase; uniform vec3 uTip;
varying vec2 vUv2; varying float vShade;
void main(){
  float edge = smoothstep(0.0,0.12,vUv2.x)*smoothstep(1.0,0.88,vUv2.x);
  vec3 col = mix(uBase,uTip,vUv2.y)*vShade;
  float vein = smoothstep(0.46,0.5,vUv2.x)*smoothstep(0.54,0.5,vUv2.x);
  col += vec3(0.1,0.3,0.12)*vein;
  gl_FragColor = vec4(col, edge*0.96);
}`;

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = 'mid';
    this.lightMul = 1;
    this.waveMul = 0.6;
    this.raysOn = true;
    this.waterColor = new THREE.Color('#12657f');
    this.dayT = 8;
    this.cycle = true;
    this.dayLength = 6;
    this.night = false;

    this.causticTex = causticTexture();
    this.glowTex = glowTexture();
    this.rockTex = rockTexture('#9c948a', 'rgba(58,52,44,.42)');

    this.buildEnvironment();
    this.buildTank();
    this.buildWater();
    this.buildSand();
    this.buildLights();
    this.buildRays();
    this.decor = new THREE.Group();
    scene.add(this.decor);
    this.scatterDecor();
    this.buildGrid();
  }

  buildEnvironment() {
    const geo = new THREE.SphereGeometry(160, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#0d4a63') }, uBot: { value: new THREE.Color('#020a11') },
        uGlow: { value: new THREE.Color('#12657f') }, uTime: { value: 0 }
      },
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; uniform vec3 uGlow; uniform float uTime; varying vec3 vP;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        void main(){
          vec3 d = normalize(vP);
          float k = clamp(d.y*0.5+0.5, 0.0, 1.0);
          vec3 c = mix(uBot, uTop, pow(k,1.5));
          float horizon = exp(-pow((k-0.40)*4.0, 2.0));
          c += uGlow * horizon * 0.6;
          float band = sin(d.x*3.1 + uTime*0.05) * sin(d.z*2.3 - uTime*0.04);
          c += uGlow * max(0.0, band) * smoothstep(0.45,0.95,k) * 0.12;
          vec2 g = d.xz*90.0 + d.y*40.0;
          vec2 cell = floor(g); vec2 f = fract(g)-0.5;
          float sp = hash(cell);
          float tw = 0.5+0.5*sin(uTime*0.9 + sp*40.0);
          c += vec3(0.30,0.70,0.85) * smoothstep(0.24,0.0,length(f)) * step(0.986, sp) * tw * 0.5 * smoothstep(0.08,0.5,k);
          gl_FragColor = vec4(c,1.0);
        }`
    });
    this.envMat = mat;
    this.env = new THREE.Mesh(geo, mat);
    this.env.renderOrder = -10;
    this.scene.add(this.env);
    this.scene.fog = new THREE.FogExp2(0x0a3346, 0.0125);
  }

  buildTank() {
    this.glassMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uTint: { value: new THREE.Color('#7fd8ef') }, uRim: { value: new THREE.Color('#bff4ff') }, uOpacity: { value: 0.5 } },
      vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG
    });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(TANK.W, TANK.H, TANK.D), this.glassMat);
    glass.renderOrder = 8;
    this.scene.add(glass);
    this.glass = glass;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b4d5e, roughness: 0.34, metalness: 0.75, emissive: 0x0a2a3a, emissiveIntensity: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x22e3ff, roughness: 0.3, metalness: 0.4, emissive: 0x22e3ff, emissiveIntensity: 0.9 });
    this.trimMat = trimMat;
    const frame = new THREE.Group();
    const bar = (sx, sy, sz, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat || frameMat);
      m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = true;
      frame.add(m); return m;
    };
    for (const y of [halfH - 0.3, -halfH + 0.3]) {
      bar(TANK.W + 0.6, 0.6, 0.6, 0, y, -halfD);
      bar(TANK.W + 0.6, 0.6, 0.6, 0, y, halfD);
      bar(0.6, 0.6, TANK.D + 0.6, -halfW, y, 0);
      bar(0.6, 0.6, TANK.D + 0.6, halfW, y, 0);
    }
    for (const x of [-halfW, halfW]) for (const z of [-halfD, halfD]) bar(0.55, TANK.H, 0.55, x, 0, z);
    for (const z of [-halfD, halfD]) bar(TANK.W - 1, 0.12, 0.12, 0, halfH - 0.66, z, trimMat);
    this.scene.add(frame);
    this.frame = frame;

    /* stand */
    const standMat = new THREE.MeshStandardMaterial({ color: 0x0c2531, roughness: 0.6, metalness: 0.3 });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(TANK.W + 2.4, 1.6, TANK.D + 2.4), standMat);
    stand.position.y = -halfH - 0.8;
    stand.receiveShadow = true;
    this.scene.add(stand);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(TANK.W + 3, 0.22, TANK.D + 3), trimMat);
    lip.position.y = -halfH - 1.62;
    this.scene.add(lip);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x04121a, roughness: 0.9, metalness: 0.05 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -halfH - 1.75;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  buildWater() {
    this.surfUniforms = {
      uTime: { value: 0 }, uWave: { value: 0.6 },
      uShallow: { value: new THREE.Color('#8fe8ff') },
      uDeep: { value: new THREE.Color('#0d4a63') },
      uSun: { value: new THREE.Color('#fff0d0') },
      uOpacity: { value: 0.62 },
      uCaustic: { value: this.causticTex }
    };
    const surf = new THREE.Mesh(
      new THREE.PlaneGeometry(TANK.W - 0.4, TANK.D - 0.4, 56, 40),
      new THREE.ShaderMaterial({
        uniforms: this.surfUniforms, vertexShader: SURF_VERT, fragmentShader: SURF_FRAG,
        transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false
      })
    );
    surf.rotation.x = -Math.PI / 2;
    surf.position.y = waterTopY;
    surf.renderOrder = 6;
    this.scene.add(surf);
    this.surface = surf;

    const volMat = new THREE.MeshBasicMaterial({ color: this.waterColor, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.BackSide, fog: false });
    const vol = new THREE.Mesh(new THREE.BoxGeometry(TANK.W - 0.5, waterTopY - sandY, TANK.D - 0.5), volMat);
    vol.position.y = (sandY + waterTopY) / 2;
    vol.renderOrder = 7;
    this.scene.add(vol);
    this.volMat = volMat;
  }

  buildSand() {
    const geo = new THREE.PlaneGeometry(TANK.W - 0.5, TANK.D - 0.5, 48, 34);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, Math.sin(x * 0.4) * 0.16 + Math.cos(y * 0.5) * 0.14 + Math.sin((x + y) * 0.9) * 0.07);
    }
    geo.computeVertexNormals();
    this.sandUniforms = {
      uCaustic: { value: this.causticTex },
      uTime: { value: 0 },
      uStrength: { value: 0.85 },
      uCausticColor: { value: new THREE.Color('#9fe8ff') }
    };
    const mat = new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 0.95, metalness: 0.02, color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.sandUniforms);
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D uCaustic; uniform float uTime; uniform float uStrength; uniform vec3 uCausticColor; varying vec3 vWPos;\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', [
        '#include <map_fragment>',
        'vec2 c1 = vWPos.xz*0.055 + vec2(uTime*0.013, uTime*0.009);',
        'vec2 c2 = vWPos.xz*0.079 - vec2(uTime*0.010, uTime*0.016);',
        'float ca = texture2D(uCaustic,c1).r * texture2D(uCaustic,c2).r;',
        'diffuseColor.rgb += uCausticColor * ca * uStrength * 2.2;'
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'sandcaustic';
    const sand = new THREE.Mesh(geo, mat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = sandY;
    sand.receiveShadow = true;
    this.scene.add(sand);
    this.sand = sand;
    this.sandMat = mat;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0x9fe0ff, 0x3a2f1c, 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff2d8, 2.1);
    this.key.position.set(9, 30, 12);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    const sc = this.key.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 18; sc.bottom = -14; sc.near = 6; sc.far = 70;
    this.key.shadow.bias = -0.0009;
    this.key.shadow.normalBias = 0.035;
    this.scene.add(this.key);
    this.scene.add(this.key.target);
    this.key.target.position.set(0, -2, 0);

    this.rim = new THREE.DirectionalLight(0xff3d8b, 0.55);
    this.rim.position.set(-16, 6, -18);
    this.scene.add(this.rim);

    this.fill = new THREE.DirectionalLight(0x22e3ff, 0.5);
    this.fill.position.set(-12, 4, 16);
    this.scene.add(this.fill);

    this.topGlow = new THREE.PointLight(0x8fe8ff, 22, 44, 2);
    this.topGlow.position.set(0, waterTopY - 1, 0);
    this.scene.add(this.topGlow);

    this.sandGlow = new THREE.PointLight(0xffab2e, 8, 26, 2);
    this.sandGlow.position.set(6, sandY + 2, 4);
    this.scene.add(this.sandGlow);
  }

  buildRays() {
    this.rayGroup = new THREE.Group();
    this.rays = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 7; i++) {
      const u = {
        uTime: { value: 0 }, uColor: { value: new THREE.Color('#9fe8ff') },
        uStrength: { value: 0.16 }, uSeed: { value: rnd() * 10 }
      };
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: u, vertexShader: RAY_VERT, fragmentShader: RAY_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
      }));
      const w = rand(2.2, 5.2);
      m.scale.set(w, waterTopY - sandY + 3, 1);
      m.position.set(rand(-halfW + 3, halfW - 3), (waterTopY + sandY) / 2 + 1, rand(-halfD + 3, halfD - 3));
      m.renderOrder = 9;
      this.rayGroup.add(m);
      this.rays.push({ mesh: m, u, baseX: m.position.x, baseZ: m.position.z, seed: rnd() * 10 });
    }
    this.scene.add(this.rayGroup);
  }

  buildGrid() {
    this.grid = new THREE.GridHelper(TANK.W, 15, 0x22e3ff, 0x14607c);
    this.grid.position.y = sandY + 0.04;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.32;
    this.grid.visible = false;
    this.scene.add(this.grid);
  }

  /* ---------- decor ---------- */
  clearDecor() {
    const kill = [];
    this.decor.traverse((o) => { if (o.isMesh) kill.push(o); });
    for (const m of kill) {
      if (m.geometry && m.geometry.userData.own) m.geometry.dispose();
      if (m.material && m.material.userData && m.material.userData.own) m.material.dispose();
    }
    this.decor.clear();
    this.weeds = [];
    this.bubblerPos = new THREE.Vector3(-9, sandY + 0.3, -5);
  }

  scatterDecor() {
    this.clearDecor();
    const rockMat = new THREE.MeshStandardMaterial({ map: this.rockTex, color: 0xd6cec2, roughness: 0.92, metalness: 0.04 });
    const darkRockMat = new THREE.MeshStandardMaterial({ map: this.rockTex, color: 0xaea69a, roughness: 0.95 });
    const coralMats = ['#ff3d8b', '#ffab2e', '#a06bff', '#22e3ff', '#7dff5c'].map((c) =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.62, metalness: 0.05, emissive: new THREE.Color(c), emissiveIntensity: 0.22 }));

    const spots = [];
    const place = (minDist) => {
      for (let k = 0; k < 60; k++) {
        const x = rand(BOUNDS.minX + 1, BOUNDS.maxX - 1), z = rand(BOUNDS.minZ + 1, BOUNDS.maxZ - 1);
        let ok = true;
        for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < minDist) { ok = false; break; }
        if (ok) { spots.push({ x, z }); return { x, z }; }
      }
      return null;
    };

    /* rocks */
    for (let i = 0; i < randInt(4, 6); i++) {
      const s = place(4.2); if (!s) continue;
      const r = rand(0.9, 2.1);
      const g = new THREE.SphereGeometry(r, 14, 10);
      const p = g.attributes.position;
      const ph = rnd() * TAU, ph2 = rnd() * TAU;
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
        const n = 1 + 0.16 * Math.sin(x * 2.1 + ph) * Math.cos(z * 1.7 + ph2) + 0.10 * Math.sin(y * 2.6 + ph);
        p.setXYZ(v, x * n, y * n * 0.72, z * n);
      }
      g.computeVertexNormals();
      g.userData.own = true;
      const m = new THREE.Mesh(g, chance(0.5) ? rockMat : darkRockMat);
      m.position.set(s.x, sandY + r * 0.34, s.z);
      m.rotation.y = rnd() * TAU;
      m.castShadow = true; m.receiveShadow = true;
      this.decor.add(m);
    }

    /* branching coral */
    for (let i = 0; i < randInt(3, 5); i++) {
      const s = place(4.6); if (!s) continue;
      const mat = pick(coralMats);
      const g = new THREE.Group();
      const branch = (parent, len, rad, depth, dir) => {
        const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, 7, 1);
        geo.userData.own = true;
        const m = new THREE.Mesh(geo, mat);
        m.position.y = len / 2;
        m.castShadow = true;
        const pivot = new THREE.Group();
        pivot.rotation.set(dir.x, dir.y, dir.z);
        pivot.add(m);
        parent.add(pivot);
        const tip = new THREE.Group();
        tip.position.y = len;
        pivot.add(tip);
        if (depth > 0) {
          const n = randInt(2, 3);
          for (let k = 0; k < n; k++) {
            branch(tip, len * rand(0.55, 0.78), rad * 0.68, depth - 1,
              new THREE.Euler(rand(-0.7, 0.7), rnd() * TAU, rand(-0.7, 0.7)));
          }
        } else {
          const bulbGeo = new THREE.SphereGeometry(rad * 1.25, 8, 6);
          bulbGeo.userData.own = true;
          const bulb = new THREE.Mesh(bulbGeo, mat);
          tip.add(bulb);
        }
      };
      branch(g, rand(1.1, 1.9), rand(0.16, 0.26), 2, new THREE.Euler(rand(-0.2, 0.2), rnd() * TAU, rand(-0.2, 0.2)));
      g.position.set(s.x, sandY + 0.1, s.z);
      g.scale.setScalar(rand(0.85, 1.5));
      this.decor.add(g);
    }

    /* seaweed clumps */
    this.weeds = [];
    const weedColors = [['#1f7a3c', '#7dff5c'], ['#126b5e', '#4fe0b0'], ['#2a6b1f', '#a8ff5c'], ['#7a3c1f', '#ffab2e']];
    for (let i = 0; i < randInt(7, 11); i++) {
      const s = place(3.1); if (!s) continue;
      const [base, tip] = pick(weedColors);
      const blades = randInt(4, 8);
      const clump = new THREE.Group();
      for (let b = 0; b < blades; b++) {
        const h = rand(2.4, 6.4), w = rand(0.34, 0.72);
        const geo = new THREE.PlaneGeometry(w, h, 1, 10);
        geo.translate(0, h / 2, 0);
        const pp = geo.attributes.position;
        for (let v = 0; v < pp.count; v++) {
          const k = pp.getY(v) / h;
          pp.setX(v, pp.getX(v) * (1 - k * 0.72));
        }
        geo.userData.own = true;
        const u = { uTime: { value: 0 }, uSway: { value: rand(0.25, 0.6) }, uSeed: { value: rnd() * 10 }, uBase: { value: new THREE.Color(base) }, uTip: { value: new THREE.Color(tip) } };
        const mat = new THREE.ShaderMaterial({
          uniforms: u, vertexShader: WEED_VERT, fragmentShader: WEED_FRAG,
          transparent: true, side: THREE.DoubleSide, depthWrite: true
        });
        mat.userData.own = true;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(rand(-0.7, 0.7), 0, rand(-0.7, 0.7));
        m.rotation.y = rnd() * TAU;
        m.castShadow = false;
        clump.add(m);
        this.weeds.push(u);
      }
      clump.position.set(s.x, sandY + 0.05, s.z);
      this.decor.add(clump);
    }

    /* bubbler stone */
    const bs = place(3.4) || { x: -9, z: -5 };
    const stoneGeo = new THREE.CylinderGeometry(0.7, 0.9, 0.5, 12);
    stoneGeo.userData.own = true;
    const stone = new THREE.Mesh(stoneGeo, darkRockMat);
    stone.position.set(bs.x, sandY + 0.24, bs.z);
    stone.castShadow = true; stone.receiveShadow = true;
    this.decor.add(stone);
    this.bubblerPos = new THREE.Vector3(bs.x, sandY + 0.5, bs.z);

    /* driftwood arch */
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9, metalness: 0.02 });
    const ws = place(5) || { x: 8, z: 5 };
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.4, 0, 0), new THREE.Vector3(-1.2, 1.9, 0.4),
      new THREE.Vector3(0.6, 2.4, -0.3), new THREE.Vector3(2.2, 0.9, 0.2), new THREE.Vector3(2.8, 0, 0)
    ]);
    const woodGeo = new THREE.TubeGeometry(curve, 26, 0.32, 7, false);
    woodGeo.userData.own = true;
    const wood = new THREE.Mesh(woodGeo, woodMat);
    wood.position.set(ws.x, sandY + 0.1, ws.z);
    wood.rotation.y = rnd() * TAU;
    wood.castShadow = true; wood.receiveShadow = true;
    this.decor.add(wood);

    /* pebbles */
    const pebGeo = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(pebGeo, chance(0.5) ? rockMat : darkRockMat);
      const r = rand(0.16, 0.44);
      m.scale.set(r, r * rand(0.45, 0.7), r * rand(0.8, 1.2));
      m.position.set(rand(BOUNDS.minX, BOUNDS.maxX), sandY + r * 0.24, rand(BOUNDS.minZ, BOUNDS.maxZ));
      m.rotation.y = rnd() * TAU;
      m.receiveShadow = true;
      this.decor.add(m);
    }
  }

  /* ---------- live parameters ---------- */
  setWaterColor(hex) {
    this.waterColor.set(hex);
    this.volMat.color.copy(this.waterColor);
    this.surfUniforms.uDeep.value.copy(this.waterColor).multiplyScalar(0.8);
    this.scene.fog.color.copy(this.waterColor).multiplyScalar(0.55);
    this.envMat.uniforms.uGlow.value.copy(this.waterColor);
  }
  setLight(v) { this.lightMul = v; }
  setWave(v) { this.waveMul = v; }
  setRays(on) { this.raysOn = on; this.rayGroup.visible = on; this.sandUniforms.uStrength.value = on ? 0.85 : 0.12; }
  setGrid(on) { this.grid.visible = on; }
  setQuality(q) {
    this.quality = q;
    const shadows = q !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.key.castShadow = shadows;
    this.key.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    this.rayGroup.visible = this.raysOn && q !== 'low';
    this.surface.geometry.dispose();
    this.surface.geometry = new THREE.PlaneGeometry(TANK.W - 0.4, TANK.D - 0.4, q === 'high' ? 72 : q === 'mid' ? 48 : 24, q === 'high' ? 52 : q === 'mid' ? 34 : 18);
    this.scene.traverse((o) => { if (o.isMesh && o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  }

  update(dt, t) {
    if (this.cycle) {
      this.dayT = (this.dayT + (dt / (this.dayLength * 60)) * 24) % 24;
    }
    const h = this.dayT;
    /* sun elevation: 6→18 daytime */
    const sun = clamp(Math.sin(((h - 6) / 12) * Math.PI), -1, 1);
    const day = clamp(sun * 1.6 + 0.25, 0, 1);
    this.night = day < 0.22;
    const dusk = clamp(1 - Math.abs(sun) * 3.2, 0, 1);

    const L = this.lightMul;
    this.key.intensity = (0.35 + day * 2.0) * L;
    this.key.color.setRGB(
      lerp(0.45, 1.0, day) + dusk * 0.25,
      lerp(0.55, 0.95, day) + dusk * 0.05,
      lerp(0.95, 0.85, day) - dusk * 0.15
    );
    const ang = ((h - 6) / 12) * Math.PI;
    this.key.position.set(Math.cos(ang) * 16, 12 + Math.max(0.15, sun) * 22, 10 + Math.sin(ang) * 6);
    this.hemi.intensity = (0.18 + day * 0.5) * L;
    this.hemi.color.setRGB(lerp(0.22, 0.62, day), lerp(0.32, 0.88, day), lerp(0.62, 1.0, day));
    this.rim.intensity = (0.28 + (1 - day) * 0.75) * L;
    this.fill.intensity = (0.22 + day * 0.35) * L;
    this.topGlow.intensity = (8 + day * 20) * L;
    this.sandGlow.intensity = (4 + day * 7) * L;
    this.trimMat.emissiveIntensity = 0.5 + (1 - day) * 1.1;

    this.envMat.uniforms.uTop.value.setRGB(lerp(0.004, 0.014, day), lerp(0.012, 0.070, day), lerp(0.028, 0.115, day));
    this.envMat.uniforms.uTime.value = t;
    this.scene.fog.density = 0.011 + (1 - day) * 0.006;

    this.surfUniforms.uTime.value = t;
    this.surfUniforms.uWave.value = this.waveMul * 1.3;
    this.surfUniforms.uSun.value.setRGB(1, lerp(0.75, 0.95, day), lerp(0.55, 0.85, day));
    this.surfUniforms.uOpacity.value = 0.34 + day * 0.22;
    this.sandUniforms.uTime.value = t;
    this.sandUniforms.uStrength.value = (this.raysOn ? 0.85 : 0.12) * (0.25 + day * 0.9) * L;
    this.sandUniforms.uCausticColor.value.setRGB(lerp(0.35, 0.62, day), lerp(0.55, 0.91, day), lerp(0.9, 1.0, day));

    if (this.rayGroup.visible) {
      for (const r of this.rays) {
        r.u.uTime.value = t;
        r.u.uStrength.value = (0.05 + day * 0.17) * L;
        r.u.uColor.value.setRGB(lerp(0.4, 0.62, day), lerp(0.6, 0.91, day), 1.0);
        r.mesh.position.x = r.baseX + Math.sin(t * 0.13 + r.seed) * 1.1;
        r.mesh.position.z = r.baseZ + Math.cos(t * 0.11 + r.seed) * 0.9;
      }
    }
    for (const u of this.weeds) u.uTime.value = t;
    this.glassMat.uniforms.uOpacity.value = 0.22 + day * 0.14;
  }

  billboardRays(camera) {
    if (!this.rayGroup.visible) return;
    for (const r of this.rays) {
      r.mesh.rotation.y = Math.atan2(camera.position.x - r.mesh.position.x, camera.position.z - r.mesh.position.z);
    }
  }
}