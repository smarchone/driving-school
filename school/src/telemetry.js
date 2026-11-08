// Telemetry: the one list of what a frame holds. A frame is recorded every 1/60 s (sim.js).
// `save: true` fields go into the session log (session.js), in this order; the rest are only for the live run
// (drawing the car, lesson rules). Add a field here first, then fill it in sim.js record().

export const HZ = 60;

export const FRAME = {
  // saved in the session log
  t: { unit: 's, run time', save: true },
  s: { unit: 'm along the road centreline', save: true },
  d: { unit: 'm from the road centreline, + right (our lane centre is -1.75)', save: true },
  v: { unit: 'm/s, + forward', save: true },
  a: { unit: 'm/s², smoothed over 0.1 s', save: true },
  rpm: { unit: 'engine rpm, 0 = stalled', save: true },
  gear: { unit: '0 = neutral, 1-5', save: true },
  running: { unit: 'engine on (bool)', save: true },
  e: { unit: 'clutch engagement 0 (open) .. 1 (locked); always 1 in automatic', save: true },
  thr: { unit: 'gas pedal 0..1', save: true },
  brk: { unit: 'brake pedal 0..1', save: true },
  clu: { unit: 'clutch pedal 0 (up) .. 1 (down)', save: true },
  steer: { unit: 'wheel -1 (full left) .. 1 (full right)', save: true },
  ind: { unit: 'indicator: -1 left, 0 off, 1 right', save: true },
  gap: { unit: 'm bumper to bumper to the vehicle ahead, null if none', save: true },
  leadV: { unit: 'm/s of the vehicle ahead, null if none', save: true },
  // live only
  x: { unit: 'm, world position' },
  z: { unit: 'm, world position' },
  h: { unit: 'rad, heading' },
  y: { unit: 'm, road height' },
  grade: { unit: 'road slope, rise over run' },
  tc: { unit: 'N·m passed through the clutch' },
  leadS: { unit: 'm along the road of the vehicle ahead, null if none' },
};

export const SAVED = Object.keys(FRAME).filter(k => FRAME[k].save);
