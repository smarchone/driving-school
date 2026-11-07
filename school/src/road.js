// Road geometry: a centreline sampled every DS metres.
// Conventions (match three.js): forward = (sin h, cos h) in (x, z); right = (-cos h, sin h).
// A right turn decreases heading h. Lateral offset d is positive to the right.
// India drives on the left, so our lane centre is at d = -LANE/2.

export const DS = 0.5;
export const LANE = 3.5;
export const LANE_CENTER = -LANE / 2;

export function buildRoad(spec) {
  const pts = [];
  let x = 0, z = 0, h = 0, y = 0, s = 0;
  let grade = spec.startGrade ?? 0;
  pts.push({ s, x, z, h, y, grade, k: 0 });
  for (const seg of spec.segments) {
    const n = Math.max(1, Math.round(seg.len / DS));
    const len = n * DS;
    const k = seg.turn ? (seg.turn * Math.PI / 180) / len : 0; // right positive
    const g0 = grade;
    const g1 = seg.grade ?? grade;
    const blend = Math.min(len, seg.blend ?? 8);
    for (let i = 1; i <= n; i++) {
      const local = i * DS;
      grade = local < blend ? g0 + (g1 - g0) * (local / blend) : g1;
      const hMid = h - k * DS / 2;
      h -= k * DS;
      x += Math.sin(hMid) * DS;
      z += Math.cos(hMid) * DS;
      y += grade * DS;
      s += DS;
      pts.push({ s, x, z, h, y, grade, k });
    }
    grade = g1;
  }
  return { pts, length: s, width: spec.width ?? 2 * LANE };
}

function sampleIndex(road, s) {
  return Math.max(0, Math.min(road.pts.length - 2, Math.floor(s / DS)));
}

// World pose of a point at arc length s, lateral offset d.
export function pointAt(road, s, d = 0) {
  const i = sampleIndex(road, s);
  const p = road.pts[i];
  const along = s - p.s;
  const fx = Math.sin(p.h), fz = Math.cos(p.h);
  const rx = -Math.cos(p.h), rz = Math.sin(p.h);
  return {
    x: p.x + fx * along + rx * d,
    z: p.z + fz * along + rz * d,
    y: p.y + p.grade * along,
    h: p.h - p.k * along,
    grade: p.grade,
  };
}

// Project a world point onto the centreline. `hint` is the previous sample index.
export function project(road, x, z, hint = -1) {
  const pts = road.pts;
  let lo = 0, hi = pts.length - 1;
  if (hint >= 0) { lo = Math.max(0, hint - 40); hi = Math.min(pts.length - 1, hint + 40); }
  let best = lo, bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const dx = x - pts[i].x, dz = z - pts[i].z;
    const dd = dx * dx + dz * dz;
    if (dd < bestD) { bestD = dd; best = i; }
  }
  const p = pts[best];
  const dx = x - p.x, dz = z - p.z;
  const along = dx * Math.sin(p.h) + dz * Math.cos(p.h);
  const d = dx * -Math.cos(p.h) + dz * Math.sin(p.h);
  return { i: best, s: p.s + along, d, h: p.h, grade: p.grade, y: p.y + p.grade * along };
}
