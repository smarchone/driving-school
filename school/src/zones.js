// Zones: things painted on or placed beside the road for a moment (moment.zones = [{ type, ... }]).
// The renderer looks each zone's type up here and calls build(kit, zone).
//
// A zone type: { about, fields, build(kit, z) }
// kit = { THREE, road, pointAt, add(geo, color, opts) -> mesh, ribbon(road, d0, d1, s0, s1, lift, step),
//         canvasTex(w, h, draw), place(obj), assist(...objs), HALF, LANE_CENTER, WHITE }
// `assist` marks objects that only show with full assist. This file imports nothing from three.js, so tools
// (check.mjs, a coding agent) can list the zone types without a browser.

export const ZONES = {
  stopLine: {
    about: 'A white stop line across the left lane with STOP painted before it.',
    fields: { s: 'm, where the line is' },
    build(k, z) {
      k.add(k.ribbon(k.road, -k.HALF + 0.1, -0.1, z.s, z.s + 0.45, 0.025, 0.45), k.WHITE);
      const tex = k.canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#f2f2ee'; g.font = 'bold 92px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('STOP', w / 2, h / 2);
      });
      // Painted "STOP", readable from the approaching driver's seat.
      k.place(paint(k, tex, z.s - 2.6));
    },
  },
  brakeMark: {
    about: 'An amber BRAKE mark where the good run starts braking. Full assist only.',
    fields: { s: 'm, where braking should start' },
    build(k, z) {
      // When it slides under the bonnet: brake.
      const bar = k.add(k.ribbon(k.road, -k.HALF + 0.35, -0.35, z.s, z.s + 0.6, 0.028, 0.6), 0xf5b942);
      const tex = k.canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#f5b942'; g.font = 'bold 84px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('BRAKE', w / 2, h / 2);
      });
      const q = k.place(paint(k, tex, z.s - 2.2));
      k.assist(bar, q);
    },
  },
  boards: {
    about: 'Blue countdown boards on the kerb, so the learner can judge real distances by eye.',
    fields: { at: 'm, the point they count down to', marks: 'm before it, e.g. [50, 30, 10]' },
    build(k, z) {
      const { THREE } = k;
      for (const n of z.marks) {
        const p = k.pointAt(k.road, z.at - n, -k.HALF - 1.3);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        pole.position.set(p.x, p.y + 0.8, p.z);
        const tex = k.canvasTex(192, 128, (g, w, h) => {
          g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, w, h);
          g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
          g.fillStyle = '#ffffff'; g.font = 'bold 64px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(`${n} m`, w / 2, h / 2 + 2);
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ map: tex }));
        sign.position.set(p.x, p.y + 1.85, p.z);
        sign.rotation.y = p.h + Math.PI;
        k.place(pole); k.place(sign);
      }
    },
  },
  stopBox: {
    about: 'A green box on the road: the target area to stop in. Full assist only.',
    fields: { s0: 'm, start', s1: 'm, end' },
    build(k, z) {
      k.assist(k.add(k.ribbon(k.road, -k.HALF + 0.35, -0.35, z.s0, z.s1, 0.03, 0.5), 0x3ee08f, { transparent: true, opacity: 0.38, depthWrite: false }));
    },
  },
  finish: {
    about: 'A teal gate over the left lane: the end of the moment.',
    fields: { s: 'm, where the gate is' },
    build(k, z) {
      const { THREE } = k;
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x37d6c8, transparent: true, opacity: 0.85 });
      for (const d of [-k.HALF - 0.6, 0.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.18), mat);
        const p = k.pointAt(k.road, z.s, d);
        post.position.set(p.x, p.y + 1.6, p.z);
        g.add(post);
      }
      const p0 = k.pointAt(k.road, z.s, k.LANE_CENTER);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(k.HALF + 1.2, 0.18, 0.18), mat);
      bar.position.set(p0.x, p0.y + 3.2, p0.z);
      bar.rotation.y = p0.h;
      g.add(bar);
      k.place(g);
      k.add(k.ribbon(k.road, -k.HALF + 0.3, -0.3, z.s, z.s + 0.3, 0.025, 0.3), 0x37d6c8);
    },
  },
  speedSign: {
    about: 'A round speed-limit sign on the kerb.',
    fields: { s: 'm, where the sign stands', limit: 'km/h' },
    build(k, z) {
      const { THREE } = k;
      const tex = k.canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
        g.lineWidth = 14; g.strokeStyle = '#d32f2f'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#111'; g.font = 'bold 56px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(z.limit), 64, 68);
      });
      const p = k.pointAt(k.road, z.s, -k.HALF - 1.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
      pole.position.set(p.x, p.y + 1.2, p.z);
      const sign = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ map: tex }));
      sign.position.set(p.x, p.y + 2.5, p.z);
      sign.rotation.y = p.h + Math.PI;
      k.place(pole); k.place(sign);
    },
  },
};

// A word painted flat on the left lane at s, facing the approaching driver.
function paint(k, tex, s) {
  const { THREE } = k;
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  const p = k.pointAt(k.road, s, k.LANE_CENTER);
  q.position.set(p.x, p.y + 0.03, p.z);
  q.rotation.set(-Math.PI / 2, p.h + Math.PI, 0, 'YXZ');
  return q;
}
