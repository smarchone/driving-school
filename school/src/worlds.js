// Worlds: what surrounds the road in the non-town variants (picked in school/lab/worlds.html).
// Each world is procedural (no downloads) and sized to hold 60 fps at 4K on an M1: the cheap ones are drawn live per
// pixel; the expensive ones are drawn into a cube map once (ink) or one cube face per frame (aurora).
//
// buildWorld(name, renderer) -> { group, lights, place(center), frame(camera, t), dispose() }
import * as THREE from 'three';

const DOME_R = 1100; // inside the camera's far plane (1200)

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
`;
const DOME_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLOOR_VS = /* glsl */`
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

// A sky sphere centred on the camera; `body` sees `vec3 d` (unit view direction) and sets `col`.
function dome(body, { decl = '', uniforms = {} } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 }, ...uniforms },
    vertexShader: DOME_VS,
    fragmentShader: `${HEAD}varying vec3 vDir;\n${decl}\nvoid main() { vec3 d = normalize(vDir); vec3 col = vec3(0.0);\n${body}\ngl_FragColor = vec4(col, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 96, 48), mat);
  m.renderOrder = -10; m.frustumCulled = false; m.userData.follow = 'all';
  return m;
}

// An endless plane at height y under the road; `body` sees `vWorld` and `dist` (to the camera, horizontally) and sets `col`.
function floor(y, body) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: FLOOR_VS,
    fragmentShader: `${HEAD}varying vec3 vWorld;\nvoid main() { float dist = length(vWorld.xz - cameraPosition.xz); vec3 col = vec3(0.0);\n${body}\ngl_FragColor = vec4(col, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2), mat);
  m.position.y = y; m.frustumCulled = false; m.userData.follow = 'xz';
  return m;
}

function stars(n, tint) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 9;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * (DOME_R - 50), u * (DOME_R - 50), Math.sin(a) * s * (DOME_R - 50)], i * 3);
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

// Draw a dome shader into a cube map and show the cube map instead. `live`: re-render one face per frame, so the
// pattern still moves but each frame pays for 1/6 of a small cube instead of every screen pixel.
function bakedDome(renderer, body, { size, live }) {
  const src = dome(body);
  const bake = new THREE.Scene();
  bake.add(src);
  const rt = new THREE.WebGLCubeRenderTarget(size, live ? {} : { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(1, DOME_R * 2, rt);
  const tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, bake);
  renderer.toneMapping = tm;
  const show = dome('col = textureCube(uCube, d).rgb;', { decl: 'uniform samplerCube uCube;', uniforms: { uCube: { value: rt.texture } } });
  let face = 0;
  return {
    mesh: show,
    update(t) {
      if (!live) return;
      src.material.uniforms.uTime.value = t;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt, face);
      renderer.render(bake, cam.children[face]);
      renderer.setRenderTarget(prev);
      face = (face + 1) % 6;
    },
    dispose() { rt.dispose(); src.geometry.dispose(); src.material.dispose(); },
  };
}

// The Lorenz attractor is half a million points; integrate it once per page.
let lorenzGeo = null;
function lorenzGeometry() {
  if (lorenzGeo) return lorenzGeo;
  const N = 500000, K = 24;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let x = 0.1, y = 0, z = 0;
  const dt = 0.0035, S = 10, R = 28, B = 8 / 3;
  for (let i = 0; i < 3000; i++) { const dx = S * (y - x), dy = x * (R - z) - y, dz = x * y - B * z; x += dx * dt; y += dy * dt; z += dz * dt; }
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const dx = S * (y - x), dy = x * (R - z) - y, dz = x * y - B * z;
    x += dx * dt; y += dy * dt; z += dz * dt;
    pos[i * 3] = x * K; pos[i * 3 + 1] = (z - 25) * K; pos[i * 3 + 2] = y * K;
    const sp = Math.min(1, Math.hypot(dx, dy, dz) / 260);
    c.setHSL(0.58 - sp * 0.5, 0.9, 0.35 + sp * 0.3);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  lorenzGeo = new THREE.BufferGeometry();
  lorenzGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  lorenzGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  lorenzGeo.userData.keep = true;
  return lorenzGeo;
}

// Each world: lights { hemi: [sky, ground, intensity], sun: [color, intensity, [x, y, z]] } and build(group, renderer).
const WORLDS = {
  clouds: {
    lights: { hemi: [0xbcd0ff, 0xffc9a8, 1.0], sun: [0xffd6a8, 2.2, [35, 7, -100]] },
    build(group) {
      const HOR = 'vec3(0.92, 0.68, 0.53)';
      group.add(dome(`
        float e = d.y;
        col = mix(${HOR}, vec3(0.16, 0.27, 0.52), pow(clamp(e, 0.0, 1.0), 0.5));
        vec3 sd = normalize(vec3(0.35, 0.07, -1.0));
        float s = max(dot(d, sd), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (smoothstep(0.9993, 0.9996, s) * 2.0 + pow(s, 14.0) * 0.4 + pow(s, 3.0) * 0.08);
        if (e < 0.0) col = ${HOR};`));
      group.add(floor(-24, `
        vec2 p = vWorld.xz * 0.0075;
        float t = uTime;
        float n = fbm(vec3(p.x + t * 0.006, p.y, t * 0.01));
        float n2 = fbm(vec3(p * 3.3 + vec2(t * 0.01, 0.0), t * 0.02));
        float h = n * 0.85 + n2 * 0.25;
        float dens = smoothstep(0.42, 0.78, h);
        float hs = fbm(vec3(p.x + t * 0.006 + 0.03, p.y - 0.08, t * 0.01)) * 0.85 + n2 * 0.25;
        float lit = clamp((h - hs) * 5.0 + 0.5, 0.0, 1.0);
        vec3 shade = mix(vec3(0.34, 0.38, 0.58), vec3(0.74, 0.68, 0.76), dens);
        col = mix(shade, vec3(1.0, 0.88, 0.76), lit * dens);
        col = mix(col, ${HOR}, max(1.0 - exp(-dist / 900.0), smoothstep(700.0, 1150.0, dist)));`));
    },
  },
  aurora: {
    lights: { hemi: [0x7aa8b8, 0x0a0a20, 0.7], sun: [0x9fe8ff, 0.7, [-40, 60, 30]] },
    build(group, renderer) {
      group.add(stars(6000, [0.85, 0.92, 1.0]));
      const sky = bakedDome(renderer, `
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
        }`, { size: 1024, live: true });
      // stars are drawn after the sky so they sit on top of it
      sky.mesh.renderOrder = -11;
      group.add(sky.mesh);
      group.add(floor(-30, `col = vec3(0.004, 0.012, 0.02) + vec3(0.02, 0.09, 0.06) * exp(-dist / 400.0);
        col = mix(col, vec3(0.012, 0.03, 0.06), smoothstep(600.0, 1150.0, dist));`));
      return sky;
    },
  },
  lorenz: {
    lights: { hemi: [0x7090ff, 0x100818, 0.7], sun: [0xb0c8ff, 1.0, [0, 80, 0]] },
    build(group) {
      group.add(dome('col = vec3(0.0, 0.0, 0.004) + vec3(0.012, 0.01, 0.03) * (1.0 - abs(d.y));'));
      const pts = new THREE.Points(lorenzGeometry(), new THREE.PointsMaterial({
        size: 1.6 * Math.min(devicePixelRatio, 2), sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const holder = new THREE.Group();
      holder.add(pts);
      group.add(holder);
      return {
        place(c) { holder.position.set(c.x, 60, c.y); },
        update(t) { holder.rotation.y = t * 0.02; },
      };
    },
  },
  neon: {
    lights: { hemi: [0x8060ff, 0xff3080, 0.8], sun: [0xff70c0, 1.8, [0, 30, -100]] },
    build(group) {
      const HAZE = 'vec3(0.55, 0.08, 0.3)';
      group.add(dome(`
        float e = d.y;
        vec3 top = vec3(0.03, 0.0, 0.09), mid = vec3(0.32, 0.03, 0.4), hor = vec3(1.0, 0.32, 0.42);
        col = mix(hor, mix(mid, top, smoothstep(0.12, 0.55, e)), smoothstep(0.0, 0.14, e));
        if (e < 0.0) col = mix(${HAZE}, vec3(0.03, 0.0, 0.06), smoothstep(0.0, -0.08, e));
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
        }`));
      group.add(floor(-5, `
        vec2 g = vWorld.xz / 14.0;
        vec2 gw = fwidth(g);
        vec2 gl = abs(fract(g - 0.5) - 0.5) / (gw * 1.4);
        float line = 1.0 - min(min(gl.x, gl.y), 1.0);
        float glow = exp(-min(gl.x, gl.y) * 0.12) * 0.35;
        float fade = exp(-dist / 650.0);
        vec3 neon = mix(vec3(1.0, 0.15, 0.75), vec3(0.15, 0.85, 1.0), 0.5 + 0.5 * sin(uTime * 0.2 + vWorld.x * 0.002));
        col = vec3(0.03, 0.0, 0.06) + neon * (line + glow) * fade;
        col = mix(col, ${HAZE}, max(1.0 - exp(-dist / 1600.0), smoothstep(700.0, 1150.0, dist)));`));
    },
  },
  glass: {
    lights: { hemi: [0xff9fd0, 0x2040a0, 0.9], sun: [0xffe8c0, 1.2, [0, 90, 0]] },
    build(group) {
      group.add(dome(`
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
        col *= 0.35 + 0.75 * smoothstep(-0.6, 0.8, d.y);`));
    },
  },
  ink: {
    lights: { hemi: [0xe8dcc0, 0x0e3a40, 0.9], sun: [0xfff0dd, 1.5, [30, 70, -30]] },
    build(group, renderer) {
      const sky = bakedDome(renderer, `
        vec3 p = d * 1.7;
        vec2 q = vec2(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)));
        vec2 r = vec2(fbm(p + vec3(4.0 * q, 0.0) + vec3(1.7, 9.2, 0.0)), fbm(p + vec3(4.0 * q, 0.0) + vec3(8.3, 2.8, 1.1)));
        float f = fbm(p + vec3(4.0 * r, 0.0));
        col = mix(vec3(0.05, 0.13, 0.17), vec3(0.93, 0.86, 0.72), clamp(f * f * 2.6, 0.0, 1.0));
        col = mix(col, vec3(0.0, 0.36, 0.42), clamp(length(q) * 0.7 - 0.25, 0.0, 1.0) * 0.75);
        col = mix(col, vec3(0.72, 0.28, 0.12), clamp(r.x * r.x * 1.6 - 0.2, 0.0, 1.0) * 0.8);
        col *= 0.55 + 0.45 * smoothstep(-0.7, 0.4, d.y);`, { size: 2048, live: false });
      group.add(sky.mesh);
      // the marbling is baked; a slow turn of the whole sky keeps it drifting
      return { update(t) { sky.mesh.rotation.y = t * 0.006; }, dispose: sky.dispose };
    },
  },
};

export function buildWorld(name, renderer) {
  const def = WORLDS[name];
  if (!def) return null;
  const group = new THREE.Group();
  const hooks = def.build(group, renderer) || {};
  const follow = [], timed = [];
  group.traverse(o => {
    if (o.userData.follow) follow.push(o);
    if (o.material?.uniforms?.uTime) timed.push(o.material.uniforms.uTime);
  });
  return {
    group,
    lights: def.lights,
    place(center) { hooks.place?.(center); },
    frame(camera, t) {
      for (const o of follow) {
        if (o.userData.follow === 'all') o.position.copy(camera.position);
        else { o.position.x = camera.position.x; o.position.z = camera.position.z; }
      }
      for (const u of timed) u.value = t;
      hooks.update?.(t);
    },
    dispose() {
      hooks.dispose?.();
      group.traverse(o => {
        if (!o.geometry?.userData.keep) o.geometry?.dispose();
        o.material?.dispose?.();
      });
    },
  };
}
