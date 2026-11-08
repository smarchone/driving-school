// World taste test: candidate looks for the void around the road, side by side, on the real free-drive loop.
// Nothing here is wired into the game. Each world is self-contained so the picked ones can be lifted into render.js.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { buildRoad, pointAt, LANE, LANE_CENTER } from '../src/road.js';

const $ = s => document.querySelector(s);
const HALF = LANE;

// ------------------------------------------------------------------ road (the free-drive loop)
const R = 25, ARC = R * Math.PI / 2;
const LAP = [
  { len: 160 }, { len: ARC, turn: -90 },
  { len: 60 }, { len: 50, grade: 0.06 }, { len: 30, grade: 0 }, { len: 50, grade: -0.06 }, { len: 20, grade: 0 },
  { len: ARC, turn: -90 },
  { len: 160 }, { len: ARC, turn: -90 },
  { len: 210 }, { len: ARC, turn: -90 },
];
const road = buildRoad({ segments: [...LAP, ...LAP] });
const LAP_LEN = LAP.reduce((a, g) => a + Math.max(1, Math.round(g.len / 0.5)) * 0.5, 0);
const center = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of road.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return new THREE.Vector2((x0 + x1) / 2, (z0 + z1) / 2);
})();

function strip(d0, d1, s0, s1, lift, step, y0 = 0, y1 = 0) {
  const pos = [], idx = [];
  let n = 0;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const a = pointAt(road, s, d0), b = pointAt(road, s, d1);
    pos.push(a.x, a.y + lift + y0, a.z, b.x, b.y + lift + y1, b.z);
    if (n > 0) { const k = (n - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function makeRoad() {
  const g = new THREE.Group();
  const add = (geo, color) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })); g.add(m); return m; };
  add(strip(-HALF, HALF, 0, LAP_LEN, 0, 1), 0x45484d);
  // a thin slab edge so the road reads as a floating object, not a sheet of paper
  add(strip(-HALF, -HALF, 0, LAP_LEN, 0, 1, -0.35, 0), 0x2a2c30);
  add(strip(HALF, HALF, 0, LAP_LEN, 0, 1, 0, -0.35), 0x2a2c30);
  add(strip(-HALF, HALF, 0, LAP_LEN, -0.35, 1), 0x1c1d20);
  const white = 0xf2f2ee;
  add(strip(-HALF + 0.12, -HALF + 0.27, 0, LAP_LEN, 0.02, 1), white);
  add(strip(HALF - 0.27, HALF - 0.12, 0, LAP_LEN, 0.02, 1), white);
  for (let s = 2; s < LAP_LEN - 3; s += 9) add(strip(-0.07, 0.07, s, s + 3, 0.02, 0.5), white);
  return g;
}

function makeCar() {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: 0xd8473a });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1d2630 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x151515 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.62, 3.8), paint); body.position.y = 0.58;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.56, 2.0), glass); cabin.position.set(0, 1.17, -0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.06, 1.8), paint); roof.position.set(0, 1.47, -0.3);
  g.add(body, cabin, roof);
  for (const [x, z] of [[-0.75, 1.25], [0.75, 1.25], [-0.75, -1.25], [0.75, -1.25]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14), tyre);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.3, z); g.add(w);
  }
  const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  for (const x of [-0.6, 0.6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), tail); l.position.set(x, 0.72, -1.91); g.add(l); }
  return g;
}

// ------------------------------------------------------------------ shader building blocks
const HEAD = /* glsl */`
precision highp float;
uniform float uTime;
#define PI 3.14159265359
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
vec3 cosPal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318 * (c * t + d)); }
`;
const DOME_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLOOR_VS = /* glsl */`
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// A sky sphere around the camera; `frag` sees `vec3 d` (unit view direction) and writes `col`.
function dome(frag, uniforms = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 }, ...uniforms },
    vertexShader: DOME_VS,
    fragmentShader: HEAD + `varying vec3 vDir;\n${frag.decl || ''}\nvoid main() { vec3 d = normalize(vDir); vec3 col = vec3(0.0);\n${frag.body}\ngl_FragColor = vec4(col, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2400, 96, 48), mat);
  m.renderOrder = -10; m.frustumCulled = false; m.userData.follow = 'all';
  return m;
}
// An endless plane at height y under the road; `frag` sees `vec3 vWorld`, `float dist` (to the camera) and writes `col`.
function floor(y, frag, uniforms = {}, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, ...uniforms },
    vertexShader: FLOOR_VS, transparent: !!opts.transparent, depthWrite: !opts.transparent,
    fragmentShader: HEAD + `varying vec3 vWorld;\n${frag.decl || ''}\nvoid main() { float dist = length(vWorld.xz - cameraPosition.xz); vec3 col = vec3(0.0); float alpha = 1.0;\n${frag.body}\ngl_FragColor = vec4(col, alpha); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), mat);
  m.position.y = y; m.frustumCulled = false; m.userData.follow = 'xz';
  return m;
}

function stars(n = 5000, tint = [1, 1, 1]) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 9;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * 2200, u * 2200, Math.sin(a) * s * 2200], i * 3);
    const b = 0.35 + Math.pow(r(), 3) * 0.9;
    col.set([b * tint[0], b * tint[1], b * tint[2]], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6 * Math.min(devicePixelRatio, 2), sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true }));
  p.renderOrder = -9; p.frustumCulled = false; p.userData.follow = 'all';
  return p;
}

// Tileable water normals from a sum of waves with whole-number frequencies (no texture download).
function waterNormals() {
  const N = 256, data = new Uint8Array(N * N * 4);
  const waves = [];
  let seed = 3;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 14; i++) waves.push([Math.round(r() * 24 - 12) || 1, Math.round(r() * 24 - 12) || 2, 0.004 + r() * 0.01 / (1 + i * 0.3), r() * 6.28]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let dx = 0, dy = 0;
    for (const [fx, fy, a, ph] of waves) { const arg = 2 * Math.PI * (fx * x + fy * y) / N + ph; const c = Math.cos(arg) * a * 2 * Math.PI; dx += c * fx; dy += c * fy; }
    const l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    data[i] = (-dx / l * 0.5 + 0.5) * 255; data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ the worlds
// setup(ctx) adds objects to ctx.layer, sets lights/background, and may return { update(t, dt) }.
const WORLDS = [
  {
    id: 'dusk', group: 'Atmosphere', name: 'Dusk over water', feel: 'Golden hour, calm sea, long shadows. three.js Sky + Water.',
    setup({ layer, renderer, sun, hemi, scene }) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.5;
      scene.background = new THREE.Color(0x000000);
      const sky = new Sky(); sky.scale.setScalar(2600); sky.userData.follow = 'all';
      const u = sky.material.uniforms;
      u.turbidity.value = 10; u.rayleigh.value = 3.2; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
      const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(87), THREE.MathUtils.degToRad(15));
      u.sunPosition.value.copy(sunDir);
      const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
        textureWidth: 512, textureHeight: 512, waterNormals: waterNormals(), sunDirection: sunDir.clone(),
        sunColor: 0xffc890, waterColor: 0x06202c, distortionScale: 1.6, size: 8, fog: false,
      });
      water.rotation.x = -Math.PI / 2; water.position.set(center.x, -6, center.y);
      layer.add(sky, water);
      sun.position.copy(sunDir).multiplyScalar(100); sun.color.set(0xffa860); sun.intensity = 5;
      hemi.color.set(0xa8b8e8); hemi.groundColor.set(0x6a4a38); hemi.intensity = 4.5;
      return { update(t, dt) { water.material.uniforms.time.value += dt * 0.5; } };
    },
  },
  {
    id: 'clouds', group: 'Atmosphere', name: 'Above the clouds', feel: 'A rolling sea of cloud below, warm low sun. Calm, airy.',
    setup({ layer, sun, hemi }) {
      const HOR = 'vec3(1.0, 0.74, 0.58)';
      layer.add(dome({ body: `
        float e = d.y;
        vec3 zen = vec3(0.16, 0.27, 0.52);
        col = mix(${HOR}, zen, pow(clamp(e, 0.0, 1.0), 0.5));
        vec3 sd = normalize(vec3(0.35, 0.07, -1.0));
        float s = max(dot(d, sd), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (smoothstep(0.9993, 0.9996, s) * 2.0 + pow(s, 14.0) * 0.4 + pow(s, 3.0) * 0.08);
        if (e < 0.0) col = ${HOR} * 0.92;` }));
      layer.add(floor(-24, { body: `
        vec2 p = vWorld.xz * 0.0075;
        float t = uTime;
        float n = fbm(vec3(p.x + t * 0.006, p.y, t * 0.01));
        float n2 = fbm(vec3(p * 3.3 + vec2(t * 0.01, 0.0), t * 0.02));
        float h = n * 0.85 + n2 * 0.25;
        float dens = smoothstep(0.42, 0.78, h);
        // light the tops from the sun side: compare with a sample nudged toward the sun
        float hs = fbm(vec3(p.x + t * 0.006 + 0.03, p.y - 0.08, t * 0.01)) * 0.85 + n2 * 0.25;
        float lit = clamp((h - hs) * 5.0 + 0.5, 0.0, 1.0);
        vec3 shade = mix(vec3(0.34, 0.38, 0.58), vec3(0.74, 0.68, 0.76), dens);
        col = mix(shade, vec3(1.0, 0.88, 0.76), lit * dens);
        col = mix(col, ${HOR} * 0.92, 1.0 - exp(-dist / 1100.0));` }));
      sun.position.set(35, 7, -100); sun.color.set(0xffd6a8); sun.intensity = 2.2;
      hemi.color.set(0xbcd0ff); hemi.groundColor.set(0xffc9a8); hemi.intensity = 1.0;
    },
  },
  {
    id: 'aurora', group: 'Atmosphere', name: 'Aurora', feel: 'Night, stars, slow curtains of green and violet light.',
    setup({ layer, sun, hemi }) {
      layer.add(stars(6000, [0.85, 0.92, 1.0]));
      const d = dome({ body: `
        float e = d.y;
        col = mix(vec3(0.012, 0.03, 0.06), vec3(0.0, 0.004, 0.015), clamp(e * 1.4, 0.0, 1.0));
        if (e > 0.0) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 28; i++) {
            float fi = float(i) / 28.0;
            float H = 1.0 + fi * 1.4;
            vec2 p = d.xz * (H / (e + 0.06));
            float t = uTime * 0.05;
            float curve = p.y + 2.2 * sin(p.x * 0.12 + t * 2.0) + 2.0 * vnoise(vec3(p.x * 0.2, t, 3.0)) - 9.0;
            float band = exp(-abs(curve) * 0.9);
            float rays = 0.35 + 0.65 * vnoise(vec3(p.x * 4.0 + t * 3.0, 0.0, 1.0));
            vec3 c = mix(vec3(0.15, 1.0, 0.55), vec3(0.55, 0.25, 1.0), smoothstep(0.25, 0.9, fi));
            acc += c * band * rays * (1.0 - fi) * 0.09;
          }
          col += acc * smoothstep(0.0, 0.08, e);
        }`, });
      layer.add(d);
      // a dark mirror far below catches a hint of the glow
      layer.add(floor(-30, { body: `col = vec3(0.004, 0.012, 0.02) + vec3(0.02, 0.09, 0.06) * exp(-dist / 400.0);` }));
      sun.position.set(-40, 60, 30); sun.color.set(0x9fe8ff); sun.intensity = 0.7;
      hemi.color.set(0x7aa8b8); hemi.groundColor.set(0x0a0a20); hemi.intensity = 0.7;
    },
  },
  {
    id: 'escher', group: 'Math', name: 'Hyperbolic dome', feel: 'A {7,3} Poincaré-disk tiling, endlessly flowing. Escher, modern.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({
        decl: `
          vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
          vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }`,
        body: `
          vec2 z = d.xz / (1.0 + abs(d.y));
          float rim = length(z);
          // a slow hyperbolic drift (Möbius transform keeps the disk)
          vec2 w = 0.45 * vec2(cos(uTime * 0.045), sin(uTime * 0.031));
          z = cdiv(z - w, vec2(1.0, 0.0) - cmul(vec2(w.x, -w.y), z));
          const float P = 7.0, Q = 3.0;
          float a = PI / P, b = PI / Q;
          float s = sqrt(cos(b) * cos(b) - sin(a) * sin(a));
          vec2 c = vec2(cos(b) / s, 0.0);
          float r = sin(a) / s;
          float n = 0.0;
          for (int i = 0; i < 48; i++) {
            float ang = atan(z.y, z.x);
            float k = floor(ang / (2.0 * a) + 0.5);
            float ca = cos(-k * 2.0 * a), sa = sin(-k * 2.0 * a);
            z = vec2(ca * z.x - sa * z.y, sa * z.x + ca * z.y);
            z.y = abs(z.y);
            vec2 q = z - c;
            float dd = dot(q, q);
            if (dd < r * r) { z = c + q * (r * r / dd); n += 1.0; } else break;
          }
          float edge = length(z - c) - r;
          float fw = fwidth(edge) * 1.2 + 1e-5;
          float line = 1.0 - smoothstep(0.0, fw * 1.5, abs(edge));
          float spoke = 1.0 - smoothstep(0.0, fwidth(z.y) * 1.2 + 1e-5, z.y);
          float parity = mod(n, 2.0);
          vec3 A = vec3(0.04, 0.07, 0.16), B = vec3(0.0, 0.32, 0.38);
          col = mix(A, B, parity);
          col *= 0.65 + 0.35 * exp(-n * 0.18);
          col += vec3(0.0, 0.12, 0.14) * exp(-length(z) * 4.0) * parity;
          col = mix(col, vec3(1.0, 0.78, 0.42), line * 0.95);
          col = mix(col, vec3(0.5, 0.75, 0.8), spoke * 0.12);
          col *= smoothstep(1.0, 0.86, rim);
          col *= 0.35 + 0.65 * smoothstep(0.0, 0.25, abs(d.y));` }));
      sun.position.set(20, 80, 10); sun.color.set(0xfff0d0); sun.intensity = 1.2;
      hemi.color.set(0x8ad8e0); hemi.groundColor.set(0x101830); hemi.intensity = 0.8;
    },
  },
  {
    id: 'julia', group: 'Math', name: 'Julia sea', feel: 'You drive over a living Julia set the size of a city, morphing slowly.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `col = vec3(0.01, 0.0, 0.02) + vec3(0.06, 0.02, 0.08) * pow(1.0 - abs(d.y), 6.0);` }));
      layer.add(floor(-45, { decl: 'uniform vec2 uCenter;', body: `
        float ang = uTime * 0.008;
        vec2 q = (vWorld.xz - uCenter) * 0.0022;
        q = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
        float ph = uTime * 0.035;
        vec2 c = 0.7885 * vec2(cos(2.6 + 0.18 * sin(ph)), sin(2.6 + 0.18 * sin(ph)));
        vec2 z = q, dz = vec2(1.0, 0.0); float n = 0.0, m2 = 0.0;
        for (int i = 0; i < 200; i++) {
          dz = 2.0 * vec2(z.x * dz.x - z.y * dz.y, z.x * dz.y + z.y * dz.x);
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          m2 = dot(z, z); if (m2 > 1e4) break; n += 1.0;
        }
        float pix = length(fwidth(q)) + 1e-6;
        float de = n >= 199.0 ? 0.0 : 0.5 * sqrt(m2 / dot(dz, dz)) * log(m2);
        float mu = n - log2(log2(max(m2, 1.0001)));
        vec3 hue = cosPal(mu * 0.012 + 0.6, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.1, 0.2));
        float core = 1.0 - smoothstep(0.0, pix * 1.5, de);
        float glow = exp(-de / (pix * 28.0));
        col = vec3(0.02, 0.0, 0.04) + hue * glow * 0.55 + vec3(1.0, 0.95, 1.0) * core * 0.9;
        col *= exp(-dist / 1300.0);`, }, { uCenter: { value: center } }));
      sun.position.set(-20, 70, 40); sun.color.set(0xffe4f0); sun.intensity = 1.1;
      hemi.color.set(0xd0a0ff); hemi.groundColor.set(0x301040); hemi.intensity = 0.8;
    },
  },
  {
    id: 'lorenz', group: 'Math', name: 'Lorenz attractor', feel: 'Half a million points tracing chaos, hung in the dark around the loop.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `col = vec3(0.0, 0.0, 0.004) + vec3(0.012, 0.01, 0.03) * (1.0 - abs(d.y));` }));
      const N = 500000;
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      let x = 0.1, y = 0, z = 0;
      const dt = 0.0035, S = 10, Rr = 28, B = 8 / 3;
      for (let i = 0; i < 3000; i++) { const dx = S * (y - x), dy = x * (Rr - z) - y, dz = x * y - B * z; x += dx * dt; y += dy * dt; z += dz * dt; }
      const c = new THREE.Color();
      for (let i = 0; i < N; i++) {
        const dx = S * (y - x), dy = x * (Rr - z) - y, dz = x * y - B * z;
        x += dx * dt; y += dy * dt; z += dz * dt;
        pos[i * 3] = x * 24; pos[i * 3 + 1] = (z - 25) * 24; pos[i * 3 + 2] = y * 24;
        const sp = Math.min(1, Math.hypot(dx, dy, dz) / 260);
        c.setHSL(0.58 - sp * 0.5, 0.9, 0.35 + sp * 0.3);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6 * Math.min(devicePixelRatio, 2), sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      const holder = new THREE.Group();
      holder.position.set(center.x, 60, center.y);
      holder.rotation.x = 0.0;
      holder.add(pts);
      layer.add(holder);
      sun.position.set(0, 80, 0); sun.color.set(0xb0c8ff); sun.intensity = 1.0;
      hemi.color.set(0x7090ff); hemi.groundColor.set(0x100818); hemi.intensity = 0.7;
      return { update(t) { holder.rotation.y = t * 0.02; } };
    },
  },
  {
    id: 'nebula', group: 'Math', name: 'Fractal nebula (baked)', feel: 'The current Fractal look, computed once into a cube map. Cheap at any size.',
    setup({ layer, renderer, sun, hemi }) {
      const bake = new THREE.Scene();
      bake.add(dome({ body: `
        float t = 3.0;
        vec3 origin = vec3(0.83 + t * 0.012, 0.47, 0.31);
        float fade = 1.0;
        for (int k = 0; k < 12; k++) {
          float zz = 0.25 + float(k) * 0.14;
          vec3 p = origin + d * zz;
          p = abs(vec3(0.9) - mod(p, vec3(1.8)));
          float acc = 0.0, last = 0.0;
          for (int i = 0; i < 14; i++) { p = abs(p) / dot(p, p) - 0.54; float l = length(p); acc += abs(l - last); last = l; }
          float g = pow(acc * 0.032, 2.6);
          col += cosPal(0.55 + float(k) * 0.075 + acc * 0.004, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.63, 0.97)) * g * fade;
          fade *= 0.82;
        }
        col = 1.0 - exp(-col * 0.8);
        col = pow(col, vec3(1.35));` }));
      const rt = new THREE.WebGLCubeRenderTarget(2048, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      new THREE.CubeCamera(1, 3000, rt).update(renderer, bake);
      bake.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      const sky = dome({ decl: 'uniform samplerCube uCube;', body: 'col = textureCube(uCube, d).rgb;' }, { uCube: { value: rt.texture } });
      layer.add(sky);
      sun.position.set(30, 60, -20); sun.color.set(0xffe0f0); sun.intensity = 1.0;
      hemi.color.set(0xd090ff); hemi.groundColor.set(0x201030); hemi.intensity = 0.8;
      return { update(t) { sky.rotation.y = t * 0.006; sky.rotation.x = Math.sin(t * 0.004) * 0.2; }, dispose() { rt.dispose(); } };
    },
  },
  {
    id: 'synth', group: 'Art', name: 'Neon grid', feel: 'Synthwave: striped sun, violet sky, an endless glowing grid.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `
        float e = d.y;
        vec3 top = vec3(0.03, 0.0, 0.09), mid = vec3(0.32, 0.03, 0.4), hor = vec3(1.0, 0.32, 0.42);
        col = mix(hor, mix(mid, top, smoothstep(0.12, 0.55, e)), smoothstep(0.0, 0.14, e));
        if (e < 0.0) col = vec3(0.03, 0.0, 0.06);
        vec3 sd = normalize(vec3(0.0, 0.13, -1.0));
        float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
        float R = 0.17;
        col += vec3(1.0, 0.3, 0.55) * exp(-ang * 7.0) * 0.5;
        if (ang < R && e > 0.0) {
          float yy = (d.y - sd.y) / R;
          vec3 sc = mix(vec3(1.0, 0.18, 0.55), vec3(1.0, 0.86, 0.25), clamp(yy * 0.7 + 0.5, 0.0, 1.0));
          float cut = yy < 0.15 ? step(fract(yy * 7.0 + uTime * 0.12), (0.15 - yy) * 0.55) : 0.0;
          float aa = smoothstep(R, R - 0.004, ang);
          col = mix(col, sc, aa * (1.0 - cut));
        }
        float az = atan(d.x, -d.z);
        float m = 0.015 + 0.07 * pow(abs(sin(az * 2.0 + 0.6)), 2.0) * (0.55 + 0.6 * vnoise(vec3(az * 7.0, 0.0, 0.0))) + 0.015 * vnoise(vec3(az * 40.0, 0.0, 0.0));
        if (e > 0.0 && e < m) {
          col = mix(vec3(0.05, 0.0, 0.1), col, 0.12);
          col += vec3(1.0, 0.25, 0.8) * smoothstep(0.004, 0.0, m - e) * 0.8;
        }` }));
      layer.add(floor(-5, { body: `
        vec2 g = vWorld.xz / 14.0;
        vec2 gw = fwidth(g);
        vec2 gl = abs(fract(g - 0.5) - 0.5) / (gw * 1.4);
        float line = 1.0 - min(min(gl.x, gl.y), 1.0);
        float glow = exp(-min(gl.x, gl.y) * 0.12) * 0.35;
        float fade = exp(-dist / 650.0);
        vec3 neon = mix(vec3(1.0, 0.15, 0.75), vec3(0.15, 0.85, 1.0), 0.5 + 0.5 * sin(uTime * 0.2 + vWorld.x * 0.002));
        col = vec3(0.03, 0.0, 0.06) + neon * (line + glow) * fade;
        col = mix(col, vec3(0.55, 0.08, 0.3), 1.0 - exp(-dist / 1600.0));` }));
      sun.position.set(0, 30, -100); sun.color.set(0xff70c0); sun.intensity = 1.8;
      hemi.color.set(0x8060ff); hemi.groundColor.set(0xff3080); hemi.intensity = 0.8;
    },
  },
  {
    id: 'moire', group: 'Art', name: 'Interference', feel: 'Op-art. Two ripple fields crossing into moving moiré. Black and bone.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `
        vec3 p1 = normalize(vec3(sin(uTime * 0.05), 0.45, cos(uTime * 0.05)));
        vec3 p2 = normalize(vec3(-cos(uTime * 0.037), 0.15 + 0.3 * sin(uTime * 0.021), sin(uTime * 0.037)));
        float a1 = acos(clamp(dot(d, p1), -1.0, 1.0)), a2 = acos(clamp(dot(d, p2), -1.0, 1.0));
        float f1 = abs(fract(a1 * 24.0) - 0.5), f2 = abs(fract(a2 * 24.0) - 0.5);
        float w1 = fwidth(a1 * 24.0) + 1e-4, w2 = fwidth(a2 * 24.0) + 1e-4;
        float l1 = smoothstep(0.17 + w1, 0.17 - w1, f1), l2 = smoothstep(0.17 + w2, 0.17 - w2, f2);
        float v = max(l1, l2) - l1 * l2;
        col = mix(vec3(0.03), vec3(0.92, 0.9, 0.85), v);
        col = mix(col, vec3(0.92, 0.22, 0.16), smoothstep(0.05, 0.04, a1) + smoothstep(0.05, 0.04, a2));
        col *= 0.25 + 0.75 * smoothstep(-0.5, 0.15, d.y);` }));
      sun.position.set(20, 60, 30); sun.color.set(0xffffff); sun.intensity = 1.6;
      hemi.color.set(0xffffff); hemi.groundColor.set(0x222222); hemi.intensity = 0.7;
    },
  },
  {
    id: 'glass', group: 'Art', name: 'Stained glass', feel: 'A cathedral of Voronoi glass, each pane breathing with light.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `
        vec3 p = d * 6.5;
        vec3 ip = floor(p), fp = fract(p);
        float d1 = 8.0, d2 = 8.0; vec3 id = ip;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
          vec3 o = vec3(float(x), float(y), float(z));
          vec3 r = o + hash33(ip + o) * 0.85 + 0.075 - fp;
          float dd = dot(r, r);
          if (dd < d1) { d2 = d1; d1 = dd; id = ip + o; } else if (dd < d2) { d2 = dd; }
        }
        float edge = sqrt(d2) - sqrt(d1);
        vec3 h = hash33(id + 7.0);
        vec3 glass = h.x < 0.22 ? vec3(0.62, 0.06, 0.1) : h.x < 0.44 ? vec3(0.06, 0.16, 0.55) : h.x < 0.6 ? vec3(0.85, 0.52, 0.1)
                   : h.x < 0.72 ? vec3(0.05, 0.36, 0.22) : h.x < 0.82 ? vec3(0.32, 0.1, 0.42) : vec3(0.78, 0.74, 0.62);
        glass *= 0.85 + 0.3 * h.z;
        float pulse = 0.7 + 0.3 * sin(uTime * 0.4 + h.y * 6.283);
        float fw = fwidth(edge) + 1e-4;
        float lead = smoothstep(0.035, 0.035 + fw * 1.5, edge);
        col = glass * pulse * (0.45 + 0.55 * smoothstep(0.0, 0.5, edge));
        col += glass * 0.35 * (1.0 - smoothstep(0.035, 0.18, edge));
        col *= lead;
        col *= 0.35 + 0.75 * smoothstep(-0.6, 0.8, d.y);` }));
      sun.position.set(0, 90, 0); sun.color.set(0xffe8c0); sun.intensity = 1.2;
      hemi.color.set(0xff9fd0); hemi.groundColor.set(0x2040a0); hemi.intensity = 0.9;
    },
  },
  {
    id: 'ink', group: 'Art', name: 'Marbled ink', feel: 'Domain-warped noise: suminagashi paper, teal and rust, drifting.',
    setup({ layer, sun, hemi }) {
      layer.add(dome({ body: `
        vec3 p = d * 1.7 + vec3(0.0, 0.0, uTime * 0.006);
        vec2 q = vec2(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)));
        vec2 r = vec2(fbm(p + vec3(4.0 * q, 0.0) + vec3(1.7, 9.2, uTime * 0.012)), fbm(p + vec3(4.0 * q, 0.0) + vec3(8.3, 2.8, 1.1)));
        float f = fbm(p + vec3(4.0 * r, 0.0));
        col = mix(vec3(0.05, 0.13, 0.17), vec3(0.93, 0.86, 0.72), clamp(f * f * 2.6, 0.0, 1.0));
        col = mix(col, vec3(0.0, 0.36, 0.42), clamp(length(q) * 0.7 - 0.25, 0.0, 1.0) * 0.75);
        col = mix(col, vec3(0.72, 0.28, 0.12), clamp(r.x * r.x * 1.6 - 0.2, 0.0, 1.0) * 0.8);
        col *= 0.55 + 0.45 * smoothstep(-0.7, 0.4, d.y);` }));
      sun.position.set(30, 70, -30); sun.color.set(0xfff0dd); sun.intensity = 1.5;
      hemi.color.set(0xe8dcc0); hemi.groundColor.set(0x0e3a40); hemi.intensity = 0.9;
    },
  },
];

// ------------------------------------------------------------------ app
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.2, 3000);
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
scene.add(hemi, sun);
const roadMesh = makeRoad();
const car = makeCar();
scene.add(roadMesh, car);

let layer = null, live = null, cur = 0;
const params = new URLSearchParams(location.search);
const state = { cam: params.get('cam') || 'chase', res: 0, paused: false, s: 30, t: 0 };
const RES = [{ label: 'native', ratio: () => Math.min(devicePixelRatio, 2) }, { label: '2× (4K test)', ratio: () => 2 }, { label: '3× (stress)', ratio: () => 3 }];
let picks = new Set();
try { picks = new Set(JSON.parse(localStorage.getItem('ds.lab.picks') || '[]')); } catch { /* storage unavailable */ }
const savePicks = () => { try { localStorage.setItem('ds.lab.picks', JSON.stringify([...picks])); } catch { /* storage unavailable */ } };

function disposeLayer() {
  if (!layer) return;
  live?.dispose?.();
  scene.remove(layer);
  layer.traverse(o => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { for (const v of Object.values(m.uniforms || {})) v.value?.isTexture && v.value.dispose(); m.map?.dispose?.(); m.dispose(); }
  });
  layer = null; live = null;
}

function select(i) {
  cur = (i + WORLDS.length) % WORLDS.length;
  const w = WORLDS[cur];
  disposeLayer();
  renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
  scene.background = new THREE.Color(0x000000);
  layer = new THREE.Group();
  scene.add(layer);
  live = w.setup({ layer, renderer, scene, sun, hemi, camera }) || {};
  // tone mapping is compiled into each material
  scene.traverse(o => { const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => (x.needsUpdate = true)); });
  $('#title').innerHTML = `<b>${w.name}</b><span>${w.feel}</span>`;
  history.replaceState(null, '', `?w=${w.id}${state.cam !== 'chase' ? '&cam=' + state.cam : ''}`);
  drawList();
}

function drawList() {
  let html = '', g = '';
  WORLDS.forEach((w, i) => {
    if (w.group !== g) { g = w.group; html += `<div class="grp">${g}</div>`; }
    html += `<div class="row ${i === cur ? 'on' : ''}" data-i="${i}"><div class="t"><b>${w.name}</b><small>${w.feel}</small></div>`
      + `<button class="heart ${picks.has(w.id) ? 'on' : ''}" data-h="${w.id}" title="Pick (H)">${picks.has(w.id) ? '♥' : '♡'}</button></div>`;
  });
  $('#list').innerHTML = html;
}
$('#list').addEventListener('click', e => {
  const h = e.target.closest('[data-h]');
  if (h) { togglePick(h.dataset.h); return; }
  const r = e.target.closest('[data-i]');
  if (r) select(+r.dataset.i);
});
function togglePick(id) { picks.has(id) ? picks.delete(id) : picks.add(id); savePicks(); drawList(); }

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }
function setCam() { state.cam = state.cam === 'chase' ? 'cockpit' : 'chase'; $('#b-cam').textContent = 'View: ' + (state.cam === 'chase' ? 'chase' : 'driver'); car.visible = state.cam === 'chase'; select(cur); }
function setRes() { state.res = (state.res + 1) % RES.length; $('#b-res').textContent = 'Res: ' + RES[state.res].label; resize(); }
function setPause() { state.paused = !state.paused; $('#b-pause').textContent = state.paused ? 'Drive car' : 'Pause car'; }
$('#b-cam').onclick = setCam;
$('#b-res').onclick = setRes;
$('#b-pause').onclick = setPause;
$('#b-copy').onclick = async () => {
  const names = WORLDS.filter(w => picks.has(w.id)).map(w => `${w.name} (${w.id})`);
  const text = names.length ? 'Picks: ' + names.join(', ') : 'No picks yet';
  try { await navigator.clipboard.writeText(text); toast('Copied: ' + text); } catch { toast(text); }
};
addEventListener('keydown', e => {
  if (e.code === 'ArrowDown' || e.code === 'KeyJ') { select(cur + 1); e.preventDefault(); }
  if (e.code === 'ArrowUp' || e.code === 'KeyK') { select(cur - 1); e.preventDefault(); }
  if (e.code === 'KeyH') togglePick(WORLDS[cur].id);
  if (e.code === 'KeyC' || e.code === 'KeyV') setCam();
  if (e.code === 'KeyR') setRes();
  if (e.code === 'KeyP' || e.code === 'Space') setPause();
  if (e.code === 'KeyU') $('#panel').classList.toggle('hide');
});

function resize() {
  renderer.setPixelRatio(RES[state.res].ratio());
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camInit = false, last = performance.now(), frames = 0, fpsT = last, fps = 60, worst = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  worst = Math.max(worst, now - last);
  last = now;
  state.t += dt;
  if (!state.paused) state.s = (state.s + dt * 11) % LAP_LEN;
  const p = pointAt(road, state.s, LANE_CENTER);
  car.position.set(p.x, p.y, p.z);
  car.rotation.set(-Math.atan(p.grade || 0), p.h, 0, 'YXZ');
  const fx = Math.sin(p.h), fz = Math.cos(p.h), rx = -Math.cos(p.h), rz = Math.sin(p.h);
  let pos, look;
  if (state.cam === 'cockpit') {
    pos = new THREE.Vector3(p.x + rx * 0.36 - fx * 0.3, p.y + 1.28, p.z + rz * 0.36 - fz * 0.3);
    look = new THREE.Vector3(pos.x + fx * 20, pos.y - 0.7 + (p.grade || 0) * 20, pos.z + fz * 20);
    camPos.copy(pos); camLook.copy(look);
  } else {
    pos = new THREE.Vector3(p.x - fx * 7.5, p.y + 3.0, p.z - fz * 7.5);
    look = new THREE.Vector3(p.x + fx * 6, p.y + 1.0, p.z + fz * 6);
    if (!camInit) { camPos.copy(pos); camLook.copy(look); camInit = true; }
    camPos.lerp(pos, 0.08); camLook.lerp(look, 0.12);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  layer?.traverse(o => {
    if (o.userData.follow === 'all') o.position.copy(camera.position);
    else if (o.userData.follow === 'xz') { o.position.x = camera.position.x; o.position.z = camera.position.z; }
    if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = state.t;
  });
  live?.update?.(state.t, dt);
  renderer.render(scene, camera);

  frames++;
  if (now - fpsT > 500) {
    fps = frames * 1000 / (now - fpsT);
    frames = 0; fpsT = now;
    const px = renderer.domElement.width * renderer.domElement.height;
    const cls = fps >= 55 ? '' : fps >= 40 ? 'warn' : 'bad';
    $('#hud').innerHTML = `<div class="fps ${cls}">${fps.toFixed(0)} fps</div>worst ${worst.toFixed(0)} ms<br>${renderer.domElement.width}×${renderer.domElement.height} · ${(px / 1e6).toFixed(1)} MP`;
    worst = 0;
  }
  requestAnimationFrame(frame);
}

resize();
const start = WORLDS.findIndex(w => w.id === params.get('w'));
car.visible = state.cam === 'chase';
$('#b-cam').textContent = 'View: ' + (state.cam === 'chase' ? 'chase' : 'driver');
select(start >= 0 ? start : 0);
requestAnimationFrame(frame);
window.lab = { WORLDS, select, state, renderer, scene, camera, center, THREE };
