// Aids: driving help built from the moment's `target` ({ kind, s, label, ... }), the place the driver is aiming for.
// The kind picks the aid here. Every aid gives the "m to <label>" readout; an aid may also add a marker on the
// road (full assist only) and marks on the debrief chart.
//
// An aid: { about, toGo(f, T) -> m left, mark?(f, T) -> { s, color, label } | null, chartMarks?(T, s0, moment) -> [...] }

import { CAR } from './physics.js';

const NOSE = CAR.length / 2;
const COMFORT = 1.5; // m/s², the same gentle braking the BRAKE mark is placed for

export const AIDS = {
  // Stop with the front bumper at T.s. T.brakeAt: m before the line where the good run starts braking.
  stop: {
    about: 'Stop with the front bumper at s. Shows a "you\'d stop here" marker and, on the chart, where to brake.',
    toGo: (f, T) => T.s - (f.s + NOSE),
    // Where will the car stop? Before braking: if you braked gently now. While braking: at your current braking.
    mark(f, T) {
      const nose = f.s + NOSE;
      const rem = T.s - nose;
      if (f.v < 0.3 || rem < -3 || rem > 90) return null;
      const decel = -f.a;
      const braking = f.brk > 0.05 && decel > 0.4;
      const at = nose + (f.v * f.v) / (2 * (braking ? decel : COMFORT));
      if (!braking) {
        const late = at >= T.s - 0.5;
        return { s: at, color: late ? 0xf5b942 : 0x37d6c8, label: late ? 'Brake now!' : 'if you brake now' };
      }
      if (at > T.s + 0.3) return { s: at, color: 0xff6b6b, label: 'Over the line: brake more' };
      if (T.s - at > 3) return { s: at, color: 0xf5b942, label: 'Short: ease off a little' };
      return { s: at, color: 0x3ee08f, label: "You'll stop here ✓" };
    },
    chartMarks(T, s0, m) {
      if (m.align !== 'distance') return [];
      return [
        { x: T.s - T.brakeAt - NOSE - s0, label: 'brake here', color: '#f5b942' },
        { x: T.s - NOSE - s0, label: 'line', color: '#e9edf2' },
      ];
    },
  },
  // Reach a point on the road (a bend, a junction).
  distance: {
    about: 'Reach the point s. Shows how far there is to go.',
    toGo: (f, T) => T.s - f.s,
  },
};

// The HUD readout: metres to the target, or null when there is none or it is far away / behind.
export function readout(m, f) {
  const T = m?.target, A = T && AIDS[T.kind];
  if (!A) return null;
  const toGo = A.toGo(f, T);
  if (!(toGo > -1 && toGo < 150)) return null;
  return { m: Math.max(0, Math.round(toGo)), label: `m to ${T.label.toLowerCase()}`, soon: T.brakeAt !== undefined && toGo <= T.brakeAt + 2 && toGo > 0 };
}
export const roadMark = (m, f) => { const T = m?.target; return T && AIDS[T.kind]?.mark ? AIDS[T.kind].mark(f, T) : null; };
export const chartMarks = (m, s0) => { const T = m.target; return T && AIDS[T.kind]?.chartMarks ? AIDS[T.kind].chartMarks(T, s0, m) : []; };
