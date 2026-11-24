import * as THREE from '../vendor/three.module.js';

const QUAD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = `
uniform sampler2D tSrc; uniform float uThreshold; uniform float uSoft;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126,0.7152,0.0722));
  float k = smoothstep(uThreshold, uThreshold + uSoft, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  s += (texture2D(tSrc, vUv + uDir*1.3846).rgb + texture2D(tSrc, vUv - uDir*1.3846).rgb) * 0.316216;
  s += (texture2D(tSrc, vUv + uDir*3.2308).rgb + texture2D(tSrc, vUv - uDir*3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D tScene; uniform sampler2D tB0; uniform sampler2D tB1; uniform sampler2D tB2;
uniform float uBloom; uniform float uVignette; uniform float uTime; uniform float uAberr; uniform float uUnder;
varying vec2 vUv;
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d,d);
  vec2 off = d * uAberr * (0.4 + r2*2.0);
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;
  vec3 bl = texture2D(tB0, uv).rgb * 0.55 + texture2D(tB1, uv).rgb * 0.32 + texture2D(tB2, uv).rgb * 0.24;
  col += bl * uBloom;
  col = mix(col, col * vec3(0.72,0.95,1.12) + vec3(0.0,0.012,0.03), uUnder);
  col = aces(col * 1.06);
  float vig = 1.0 - uVignette * smoothstep(0.18, 0.86, r2*1.7);
  col *= vig;
  float g = fract(sin(dot(uv*vec2(1234.5,6789.1) + uTime, vec2(12.9898,78.233))) * 43758.5453);
  col += (g - 0.5) * 0.016;
  col = pow(max(col, 0.0), vec3(1.0/2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.bloom = 0.7;
    this.enabled = true;
    this.quality = 'mid';

    const type = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, opts);
    const mk = () => new THREE.WebGLRenderTarget(2, 2, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.levels = [];
    for (let i = 0; i < 3; i++) this.levels.push({ a: mk(), b: mk(), scale: 1 / (2 << i) });

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: 0.62 }, uSoft: { value: 0.45 } },
      vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tB0: { value: this.levels[0].a.texture },
        tB1: { value: this.levels[1].a.texture },
        tB2: { value: this.levels[2].a.texture },
        uBloom: { value: 0.7 }, uVignette: { value: 0.42 }, uTime: { value: 0 },
        uAberr: { value: 0.0016 }, uUnder: { value: 0 }
      },
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false
    });
    this.w = 2; this.h = 2;
  }

  setSize(w, h, pixelRatio) {
    const W = Math.max(2, Math.floor(w * pixelRatio));
    const H = Math.max(2, Math.floor(h * pixelRatio));
    this.w = W; this.h = H;
    this.rtScene.setSize(W, H);
    for (const l of this.levels) {
      const lw = Math.max(2, Math.floor(W * l.scale));
      const lh = Math.max(2, Math.floor(H * l.scale));
      l.a.setSize(lw, lh); l.b.setSize(lw, lh);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.brightMat.uniforms.uThreshold.value = q === 'low' ? 0.8 : 0.62;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(t, underwater) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    if (this.bloom > 0.001 && this.quality !== 'low') {
      this.brightMat.uniforms.tSrc.value = this.rtScene.texture;
      this.pass(this.brightMat, this.levels[0].a);
      for (let i = 0; i < this.levels.length; i++) {
        const l = this.levels[i];
        if (i > 0) {
          this.blurMat.uniforms.tSrc.value = this.levels[i - 1].a.texture;
          this.blurMat.uniforms.uDir.value.set(1 / l.a.width, 0);
          this.pass(this.blurMat, l.a);
        }
        this.blurMat.uniforms.tSrc.value = l.a.texture;
        this.blurMat.uniforms.uDir.value.set(1 / l.a.width, 0);
        this.pass(this.blurMat, l.b);
        this.blurMat.uniforms.tSrc.value = l.b.texture;
        this.blurMat.uniforms.uDir.value.set(0, 1 / l.a.height);
        this.pass(this.blurMat, l.a);
      }
    }

    const u = this.compMat.uniforms;
    u.uBloom.value = this.quality === 'low' ? 0 : this.bloom;
    u.uTime.value = t;
    u.uUnder.value = underwater ? 1 : 0;
    u.uVignette.value = underwater ? 0.6 : 0.42;
    this.pass(this.compMat, null);
    r.setRenderTarget(null);
  }

  dispose() {
    this.rtScene.dispose();
    for (const l of this.levels) { l.a.dispose(); l.b.dispose(); }
    this.brightMat.dispose(); this.blurMat.dispose(); this.compMat.dispose();
    this.quad.geometry.dispose();
  }
}