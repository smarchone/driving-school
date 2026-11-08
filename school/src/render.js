// Three.js world: road, Indian-street scenery, the learner's car, the ghost, traffic and assist markers.
import * as THREE from 'three';
import { pointAt, LANE, LANE_CENTER } from './road.js';
import { CAR } from './physics.js';
import { LEAD_LEN } from './sim.js';
import { buildWorld } from './worlds.js';

const HALF = LANE;          // road half-width
const SHOULDER = 2;

// Asset variants: how the world around the road looks. Physics and lessons are the same in every variant.
//   town  - Indian street: sky, ground, kerbs, buildings, trees, flyover walls
//   space - only the road, floating in pitch black
//   the rest - only the road, floating in a procedural world from src/worlds.js (picked in lab/worlds.html)
const VOID = { background: 0x000000, fog: null, ground: false, scenery: false };
export const VARIANTS = {
  town: { label: 'Town', background: 0xcfe0ea, fog: [70, 340], ground: true, scenery: true },
  space: { label: 'Space', ...VOID },
  clouds: { label: 'Clouds', ...VOID, world: 'clouds' },
  aurora: { label: 'Aurora', ...VOID, world: 'aurora' },
  lorenz: { label: 'Lorenz', ...VOID, world: 'lorenz' },
  neon: { label: 'Neon', ...VOID, world: 'neon' },
  glass: { label: 'Glass', ...VOID, world: 'glass' },
  ink: { label: 'Ink', ...VOID, world: 'ink' },
};
const TOWN_LIGHTS = { hemi: [0xe6f2ff, 0x6b5d45, 1.1], sun: [0xfff1dc, 1.4, [60, 100, 40]] };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// A flat strip along the road between lateral offsets d0..d1 and arc lengths s0..s1.
function ribbon(road, d0, d1, s0, s1, lift = 0.01, step = 1) {
  const pos = [], idx = [];
  let n = 0;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const a = pointAt(road, s, d0), b = pointAt(road, s, d1);
    pos.push(a.x, a.y + lift, a.z, b.x, b.y + lift, b.z);
    if (n > 0) { const k = (n - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A vertical wall along the road at offset d, from the ground (or road - depth) up to road + top.
function wall(road, d, top, s0, s1, toGround) {
  const pos = [], idx = [];
  let n = 0;
  for (let s = s0; s <= s1 + 1e-6; s += 1) {
    const p = pointAt(road, s, d);
    pos.push(p.x, toGround ? -0.05 : p.y, p.z, p.x, p.y + top, p.z);
    if (n > 0) { const k = (n - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const windowsTex = () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5b6470';
  for (let y = 14; y < h - 10; y += 30) for (let x = 12; x < w - 10; x += 28) g.fillRect(x, y, 14, 16);
});

function makeCar(color, ghost = false) {
  const g = new THREE.Group();
  const mat = ghost
    ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color });
  const glass = ghost ? mat : new THREE.MeshLambertMaterial({ color: 0x1d2630 });
  const tyre = ghost ? mat : new THREE.MeshLambertMaterial({ color: 0x151515 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.62, CAR.length), mat);
  body.position.y = 0.58;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.16, 0.56, 2.0), glass);
  cabin.position.set(0, 1.17, -0.25);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.2, 0.06, 1.8), mat);
  roof.position.set(0, 1.47, -0.3);
  const shell = new THREE.Group();
  shell.add(body, cabin, roof);
  for (const [x, z] of [[-0.75, 1.25], [0.75, 1.25], [-0.75, -1.25], [0.75, -1.25]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.3, z);
    shell.add(w);
  }
  g.add(shell);
  // What a driver sees of their own car: the bonnet.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(CAR.width - 0.3, 0.06, 1.1),
    ghost ? mat : new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) }));
  hood.position.set(0, 0.74, 1.6);
  hood.rotation.x = 0.16;
  hood.visible = false;
  g.add(hood);
  g.userData = { shell, hood };
  return g;
}

function makeAuto() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
  const green = new THREE.MeshLambertMaterial({ color: 0x2e7d4f });
  const black = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, LEAD_LEN), green);
  base.position.y = 0.6;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.12, LEAD_LEN - 0.3), yellow);
  canopy.position.set(0, 1.75, -0.1);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.08), black);
  back.position.set(0, 1.3, -LEAD_LEN / 2 + 0.1);
  const front = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.08), yellow);
  front.position.set(0, 1.3, LEAD_LEN / 2 - 0.4);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
  const l2 = light.clone();
  light.position.set(-0.45, 0.75, -LEAD_LEN / 2 - 0.01);
  l2.position.set(0.45, 0.75, -LEAD_LEN / 2 - 0.01);
  g.add(base, canopy, back, front, light, l2);
  for (const [x, z] of [[-0.6, -0.8], [0.6, -0.8], [0, 1.0]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12), black);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.24, z);
    g.add(w);
  }
  g.userData = { brake: [light, l2] };
  return g;
}

function placeOnRoad(obj, road, s, d, yaw = 0) {
  const p = pointAt(road, s, d);
  obj.position.set(p.x, p.y, p.z);
  obj.rotation.y = p.h + yaw;
  return obj;
}

export function createRenderer(canvas, variantName = 'town') {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 1200);
  scene.add(camera);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: 0x8c8a62 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  scene.add(ground);

  let variant = VARIANTS[variantName] || VARIANTS.town;
  let env = null, roadCenter = new THREE.Vector2();
  const t0 = performance.now();
  function applyVariant() {
    if (env) { scene.remove(env.group); env.dispose(); env = null; }
    if (variant.world) {
      env = buildWorld(variant.world, renderer);
      env.place(roadCenter);
      scene.add(env.group);
    }
    const L = env?.lights || TOWN_LIGHTS;
    hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
    sun.color.set(L.sun[0]); sun.intensity = L.sun[1]; sun.position.set(...L.sun[2]);
    const bg = new THREE.Color(variant.background);
    scene.background = bg;
    scene.fog = variant.fog ? new THREE.Fog(bg, ...variant.fog) : null;
    ground.visible = variant.ground;
  }
  applyVariant();

  // Dashboard silhouette fixed to the camera in cockpit view.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.32, 0.5), new THREE.MeshLambertMaterial({ color: 0x24272b }));
  dash.position.set(-0.2, -0.52, -0.75);
  dash.visible = false;
  camera.add(dash);

  const player = makeCar(0xd8473a);
  const ghost = makeCar(0x37d6c8, true);
  scene.add(player, ghost);

  // "You'd stop here" marker: a bar across the lane plus a floating label.
  const markBar = new THREE.Mesh(new THREE.PlaneGeometry(HALF - 0.7, 0.35), new THREE.MeshBasicMaterial({ color: 0x37d6c8, transparent: true, opacity: 0.95, depthWrite: false }));
  markBar.renderOrder = 2;
  const markLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  markLabel.scale.set(3.4, 0.85, 1);
  markLabel.renderOrder = 3;
  scene.add(markBar, markLabel);
  const labelCache = new Map();
  function labelTex(text, color) {
    const key = text + color;
    if (!labelCache.has(key)) {
      labelCache.set(key, canvasTex(512, 128, (g, w, h) => {
        g.fillStyle = 'rgba(10,14,19,0.82)';
        g.beginPath(); g.roundRect(8, 16, w - 16, h - 32, 26); g.fill();
        g.fillStyle = '#' + color.toString(16).padStart(6, '0');
        let size = 50;
        g.font = `bold ${size}px Inter, sans-serif`;
        while (g.measureText(text).width > w - 64 && size > 20) { size -= 2; g.font = `bold ${size}px Inter, sans-serif`; }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(text, w / 2, h / 2 + 2);
      }));
    }
    return labelCache.get(key);
  }

  let world = null;
  let lead = null;
  let assistObjs = [];
  let road = null;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camInit = false;
  const winTex = windowsTex();

  let current = null;
  function setVariant(name) {
    variant = VARIANTS[name] || VARIANTS.town;
    applyVariant();
    if (current) setMoment(...current);
  }

  function setMoment(moment, rd) {
    current = [moment, rd];
    road = rd;
    if (world) { scene.remove(world); world.traverse(o => { o.geometry?.dispose?.(); }); }
    world = new THREE.Group();
    assistObjs = [];
    // A looping road is stored as several identical laps; draw one.
    const L = Math.min(road.length, moment.lapLength ?? road.length);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of road.pts) { if (p.s > L) break; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    roadCenter.set((x0 + x1) / 2, (z0 + z1) / 2);
    env?.place(roadCenter);
    const add = (geo, color, opts = {}) => {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...opts }));
      world.add(m);
      return m;
    };
    const tarmac = add(ribbon(road, -HALF, HALF, 0, L, 0.0), 0x45484d);
    tarmac.renderOrder = 0;
    if (variant.scenery) {
      add(ribbon(road, -HALF - SHOULDER, -HALF, 0, L, -0.01), 0x9c8c6c);
      add(ribbon(road, HALF, HALF + SHOULDER, 0, L, -0.01), 0x9c8c6c);
    }
    const white = 0xf2f2ee;
    add(ribbon(road, -HALF + 0.12, -HALF + 0.27, 0, L, 0.02), white);
    add(ribbon(road, HALF - 0.27, HALF - 0.12, 0, L, 0.02), white);
    for (let s = 2; s < L - 3; s += 9) add(ribbon(road, -0.07, 0.07, s, s + 3, 0.02, 0.5), white);

    // Flyover: concrete sides and parapets wherever the road leaves the ground.
    const ranges = [];
    for (const p of road.pts) {
      if (p.s > L) break;
      const up = p.y > 0.2;
      const last = ranges[ranges.length - 1];
      if (up && last && last[1] >= p.s - 1) last[1] = p.s;
      else if (up) ranges.push([p.s, p.s]);
    }
    if (variant.scenery) for (const [a, b] of ranges) {
      const s0 = Math.max(0, a - 4), s1 = Math.min(L, b + 4);
      for (const d of [-HALF - SHOULDER, HALF + SHOULDER]) {
        add(wall(road, d, 0, s0, s1, true), 0xb9b4aa);
        add(wall(road, d, 0.85, s0, s1, false), 0xd6d1c6);
      }
    }

    const r = rng(7 + moment.n * 31);
    const palette = [0xe8c07d, 0xd98e73, 0x9fc5c8, 0xe6d3b3, 0xc9a0c9, 0xf2e2a8, 0xb7c99a, 0xe0a6a0];
    if (variant.scenery) for (const side of [-1, 1]) {
      for (let s = 4; s < L + 40; s += 9 + r() * 6) {
        const p = pointAt(road, Math.min(s, L), side * (11 + r() * 5));
        if (moment.road.segments.some(sg => sg.turn) && side < 0) {
          // keep the inside of the bend open so the driver can see through it
          const near = road.pts.find(q => q.k && Math.abs(q.s - s) < 40);
          if (near) continue;
        }
        const w = 6 + r() * 5, dpt = 7 + r() * 4, hgt = 5 + r() * 12;
        const mat = new THREE.MeshLambertMaterial({ color: palette[Math.floor(r() * palette.length)], map: winTex });
        winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, dpt), mat);
        b.position.set(p.x, hgt / 2 - 0.05, p.z);
        b.rotation.y = p.h;
        world.add(b);
      }
      for (let s = 10; s < L; s += 18 + r() * 14) {
        const p = pointAt(road, s, side * (HALF + SHOULDER + 1.2));
        const base = p.y > 0.5 ? null : p;
        if (!base) continue;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x6b4b2f }));
        trunk.position.set(p.x, 1.1, p.z);
        const top = new THREE.Mesh(new THREE.SphereGeometry(1.6 + r(), 8, 6), new THREE.MeshLambertMaterial({ color: 0x4f7a3a }));
        top.position.set(p.x, 3.2, p.z);
        world.add(trunk, top);
      }
    }

    for (const z of moment.zones) {
      if (z.type === 'stopLine') {
        add(ribbon(road, -HALF + 0.1, -0.1, z.s, z.s + 0.45, 0.025, 0.45), white);
        const tex = canvasTex(256, 128, (g, w, h) => {
          g.fillStyle = '#f2f2ee'; g.font = 'bold 92px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('STOP', w / 2, h / 2);
        });
        // Painted "STOP", readable from the approaching driver's seat.
        const q = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        const p = pointAt(road, z.s - 2.6, LANE_CENTER);
        q.position.set(p.x, p.y + 0.03, p.z);
        q.rotation.set(-Math.PI / 2, p.h + Math.PI, 0, 'YXZ');
        world.add(q);
      }
      if (z.type === 'brakeMark') {
        // Painted where the good run starts braking. When it slides under the bonnet: brake.
        const bar = add(ribbon(road, -HALF + 0.35, -0.35, z.s, z.s + 0.6, 0.028, 0.6), 0xf5b942);
        const tex = canvasTex(256, 128, (g, w, h) => {
          g.fillStyle = '#f5b942'; g.font = 'bold 84px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('BRAKE', w / 2, h / 2);
        });
        const q = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        const p = pointAt(road, z.s - 2.2, LANE_CENTER);
        q.position.set(p.x, p.y + 0.03, p.z);
        q.rotation.set(-Math.PI / 2, p.h + Math.PI, 0, 'YXZ');
        world.add(q);
        assistObjs.push(bar, q);
      }
      if (z.type === 'boards') {
        // Countdown boards on the kerb: real distances you can learn to judge by eye.
        for (const n of z.marks) {
          const p = pointAt(road, z.at - n, -HALF - 1.3);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
          pole.position.set(p.x, p.y + 0.8, p.z);
          const tex = canvasTex(192, 128, (g, w, h) => {
            g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, w, h);
            g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
            g.fillStyle = '#ffffff'; g.font = 'bold 64px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(`${n} m`, w / 2, h / 2 + 2);
          });
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ map: tex }));
          sign.position.set(p.x, p.y + 1.85, p.z);
          sign.rotation.y = p.h + Math.PI;
          world.add(pole, sign);
        }
      }
      if (z.type === 'stopBox') {
        const m = add(ribbon(road, -HALF + 0.35, -0.35, z.s0, z.s1, 0.03, 0.5), 0x3ee08f, { transparent: true, opacity: 0.38, depthWrite: false });
        assistObjs.push(m);
      }
      if (z.type === 'finish') {
        const g = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: 0x37d6c8, transparent: true, opacity: 0.85 });
        for (const d of [-HALF - 0.6, 0.6]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), mat);
          const p = pointAt(road, z.s, d);
          post.position.set(p.x, p.y + 1.6, p.z);
          g.add(post);
        }
        const p0 = pointAt(road, z.s, LANE_CENTER);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF + 1.2, 0.18, 0.18), mat);
        bar.position.set(p0.x, p0.y + 3.2, p0.z);
        bar.rotation.y = p0.h;
        g.add(bar);
        world.add(g);
        add(ribbon(road, -HALF + 0.3, -0.3, z.s, z.s + 0.3, 0.025, 0.3), 0x37d6c8);
      }
      if (z.type === 'speedSign') {
        const tex = canvasTex(128, 128, (g, w, h) => {
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
          g.lineWidth = 14; g.strokeStyle = '#d32f2f'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
          g.fillStyle = '#111'; g.font = 'bold 56px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(z.limit), 64, 68);
        });
        const p = pointAt(road, z.s, -HALF - 1.2);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        pole.position.set(p.x, p.y + 1.2, p.z);
        const sign = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ map: tex }));
        sign.position.set(p.x, p.y + 2.5, p.z);
        sign.rotation.y = p.h + Math.PI;
        world.add(pole, sign);
      }
    }

    if (lead) { scene.remove(lead); lead = null; }
    if (moment.lead) { lead = makeAuto(); scene.add(lead); }
    scene.add(world);
    camInit = false;
  }

  function poseCar(obj, f) {
    obj.position.set(f.x, f.y, f.z);
    const pitch = -Math.atan(f.grade || 0) * Math.cos(f.h - (f.roadH ?? f.h));
    obj.rotation.set(pitch, f.h, 0, 'YXZ');
  }

  // view: { car, ghost, lead, cam: 'cockpit'|'chase'|'orbit', assist, t }
  function render(view) {
    const { car, cam } = view;
    player.visible = !!car;
    if (car) {
      poseCar(player, car);
      const cockpit = cam === 'cockpit';
      player.userData.shell.visible = !cockpit;
      player.userData.hood.visible = cockpit;
      dash.visible = cockpit;
    }
    // Never put the camera inside the translucent ghost: hide it when it overlaps us.
    const near = car && view.ghost && Math.hypot(view.ghost.x - car.x, view.ghost.z - car.z) < (cam === 'cockpit' ? 5 : 1.5);
    ghost.visible = !!view.ghost && !near;
    if (view.ghost) poseCar(ghost, view.ghost);
    if (lead) {
      lead.visible = view.leadS != null;
      if (view.leadS != null) {
        placeOnRoad(lead, road, view.leadS, LANE_CENTER);
        for (const l of lead.userData.brake) l.material.color.setHex(view.leadBraking ? 0xff2a1a : 0x7a1a14);
      }
    }
    for (const o of assistObjs) o.visible = !!view.assist;
    const sm = view.stopMark;
    markBar.visible = markLabel.visible = !!(sm && road);
    if (sm && road) {
      const p = pointAt(road, sm.s, LANE_CENTER);
      markBar.position.set(p.x, p.y + 0.045, p.z);
      markBar.rotation.set(-Math.PI / 2, p.h, 0, 'YXZ');
      markBar.material.color.setHex(sm.color);
      markLabel.position.set(p.x, p.y + 1.25, p.z);
      // Keep the label a steady on-screen size whether the stop point is near or far.
      const dist = camera.position.distanceTo(markLabel.position);
      const k = Math.max(0.35, Math.min(1, dist / 22));
      markLabel.scale.set(3.4 * k, 0.85 * k, 1);
      markLabel.material.map = labelTex(sm.label, sm.color);
      markLabel.material.needsUpdate = true;
    }

    let pos, look;
    if (!car || cam === 'orbit') {
      const c = view.orbitAt || { x: 0, y: 0, z: 0, h: 0 };
      // Sway gently behind the start spot; stay over the road, clear of buildings.
      const a = c.h + Math.PI + Math.sin((view.t || 0) * 0.18) * 0.4;
      pos = new THREE.Vector3(c.x + Math.sin(a) * 11, c.y + 4.2, c.z + Math.cos(a) * 11);
      look = new THREE.Vector3(c.x + Math.sin(c.h) * 6, c.y + 0.8, c.z + Math.cos(c.h) * 6);
      camInit = false;
    } else {
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      const rx = -Math.cos(car.h), rz = Math.sin(car.h);
      const g = car.grade || 0;
      if (cam === 'cockpit') {
        // Right-hand drive: the driver sits right of centre.
        pos = new THREE.Vector3(car.x + rx * 0.36 - fx * 0.3, car.y + 1.28 + g * -0.3, car.z + rz * 0.36 - fz * 0.3);
        look = new THREE.Vector3(pos.x + fx * 20, pos.y - 0.7 + g * 20, pos.z + fz * 20);
        camPos.copy(pos); camLook.copy(look); camInit = true;
      } else {
        pos = new THREE.Vector3(car.x - fx * 7.5, car.y + 3.0, car.z - fz * 7.5);
        look = new THREE.Vector3(car.x + fx * 6, car.y + 1.0, car.z + fz * 6);
        if (!camInit) { camPos.copy(pos); camLook.copy(look); camInit = true; }
        camPos.lerp(pos, 0.12); camLook.lerp(look, 0.18);
        pos = camPos; look = camLook;
      }
    }
    // Shift the picture up when a bottom sheet covers the lower part of the screen.
    if (view.shiftUp) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      camera.setViewOffset(w, h, 0, h * view.shiftUp, w, h);
    } else if (camera.view) camera.clearViewOffset();
    camera.position.copy(pos);
    camera.lookAt(look);
    env?.frame(camera, (performance.now() - t0) / 1000);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  return { setMoment, setVariant, render, resize };
}
