// Detectors: the instructor's rules, one per kind of mistake.
//
// Every frame, each detector updates its stats (always, in every moment), then raises events only when it is on:
// `always: true` detectors are on everywhere; the rest are switched on by a moment's `detect` list.
// Stats feed the moment's pass criteria; events feed live cues, the debrief and the session log.
//
// A detector: { id, about, always?, events: [types it raises], stats: {initial values}, init?(ins, sim), observe(x) }
// observe gets x = { f, S, sim, ins, M, frames, elapsed, on, emit(event) }.
// To add a mistake: add a detector here, then name it in the moments that should coach it.

import { LANE_CENTER } from './road.js';

export const LURCH = 2.6;     // m/s² forward jolt
export const HARSH = 5.0;     // m/s² braking
export const OVERREV = 3800;  // rpm while the clutch slips at low speed
export const LANE_OUT = 0.9;  // m off the lane centre

// Why did it stall? Looks at the last 0.75 s.
function diagnoseStall(frames) {
  const n = frames.length, f = frames[n - 1];
  const back = frames[Math.max(0, n - 45)];
  const recent = frames.slice(Math.max(0, n - 45));
  const braking = recent.some(x => x.brk > 0.15);
  const thr = recent.reduce((a, x) => a + x.thr, 0) / recent.length;
  if (braking && back.v > 0.8) {
    return { cue: 'Stalled. The clutch went down too late. Clutch fully down to restart.', title: 'Stalled while slowing down', tip: 'Press the clutch down before the car slows to walking pace. Brake and clutch go together at the end of a stop.' };
  }
  const maxClu = recent.reduce((a, x) => Math.max(a, x.clu), 0);
  if (maxClu - f.clu > 0.25) {
    return { cue: 'Stalled. The clutch came up too fast. Clutch fully down to restart.', title: 'Clutch came up too fast', tip: 'Lift the clutch to the bite point, then pause. Let the car start rolling before you lift any further.' };
  }
  if (thr < 0.04) {
    return { cue: 'Stalled. It needed a little more gas. Clutch fully down to restart.', title: 'Not enough gas', tip: 'Add a little gas, about a quarter of the pedal, as the clutch reaches the bite point.' };
  }
  return { cue: 'Stalled. Clutch fully down to restart.', title: 'Stalled', tip: 'Ease the clutch up more slowly and keep a little gas on until it is fully up.' };
}

// The order matters only for the order of events raised on the same frame.
export const DETECTORS = [
  {
    id: 'stall', always: true, events: ['stall'],
    about: 'The engine stalled. Works out why: clutch up too fast, clutch down too late, or not enough gas.',
    stats: { stalls: 0, firstStall: null },
    init: (ins, sim) => { ins.prevRunning = sim.car.running; },
    observe(x) {
      const { f, S, ins } = x;
      if (ins.prevRunning && !f.running) {
        S.stalls++;
        if (S.firstStall === null) S.firstStall = f.t;
        const dx = diagnoseStall(x.frames);
        x.emit({ type: 'stall', severity: 'major', title: dx.title, tip: dx.tip, cue: dx.cue, cooldown: 0.5 });
      }
      ins.prevRunning = f.running;
    },
  },
  {
    id: 'lurch', events: ['lurch'],
    about: `A forward jolt over ${LURCH} m/s², usually the clutch lifted too fast through the bite point.`,
    stats: { maxAccel: 0 },
    observe(x) {
      const { f, S } = x;
      if (x.elapsed > 0.3 && f.a > S.maxAccel) S.maxAccel = f.a;
      if (x.on && x.elapsed > 0.3 && f.a > LURCH) {
        x.emit({ type: 'lurch', severity: 'minor', title: 'The car jerked forward', tip: 'Lift the clutch more slowly through the bite point.', cue: 'Easy. Slower on the clutch.' });
      }
    },
  },
  {
    id: 'harsh', events: ['harsh'],
    about: `Braking harder than ${HARSH} m/s².`,
    stats: { maxDecel: 0 },
    observe(x) {
      const { f, S } = x;
      if (x.elapsed > 0.3 && f.v > 0.3 && -f.a > S.maxDecel) S.maxDecel = -f.a;
      if (x.on && f.v > 1 && -f.a > HARSH) {
        x.emit({ type: 'harsh', severity: 'minor', title: 'Harsh braking', tip: 'Start braking earlier so you can press more gently.', cue: 'Too hard on the brake. Ease off and press more gently.' });
      }
    },
  },
  {
    id: 'overrev', always: true, events: ['overrev'],
    about: `Over ${OVERREV} rpm while the clutch slips at low speed (manual only). Also tracks peak throttle.`,
    stats: { maxThr: 0, overrevs: 0 },
    observe(x) {
      const { f, S, sim } = x;
      if (f.thr > S.maxThr) S.maxThr = f.thr;
      if (!sim.car.auto && f.running && f.rpm > OVERREV && f.e > 0.02 && f.e < 0.9 && Math.abs(f.v) < 4) {
        S.overrevs++;
        x.emit({ type: 'overrev', severity: 'minor', title: 'Too many revs on the clutch', tip: 'You only need a little gas to move off. High revs while the clutch slips wears it out.', cue: 'Too many revs. Ease off the gas; a quarter is plenty.', cooldown: 4 });
      }
    },
  },
  {
    id: 'lane', events: ['lane'],
    about: `More than ${LANE_OUT} m off the centre of the left lane: into the other lane, or off the road edge.`,
    stats: { maxLaneDev: 0 },
    observe(x) {
      const { f, S } = x;
      const dev = Math.abs(f.d - LANE_CENTER);
      if (dev > S.maxLaneDev) S.maxLaneDev = dev;
      if (x.on && dev > LANE_OUT) {
        const right = f.d > LANE_CENTER;
        x.emit({ type: 'lane', severity: 'minor', title: right ? 'Drifted into the other lane' : 'Drifted off the road edge', tip: 'Look far ahead to where you want to go; your hands follow your eyes.', cue: right ? 'You are drifting right. Steer gently back to the left lane.' : 'Too close to the edge. Steer gently back to the right.', cooldown: 4 });
      }
    },
  },
  {
    id: 'rollback', events: ['rollback'],
    about: 'Rolling backwards more than 30 cm, usually on a slope while pulling away. ins.rollRun is the current roll in metres.',
    stats: { rollback: 0 },
    init: ins => { ins.rollRun = 0; },
    observe(x) {
      const { f, S, ins, frames } = x;
      if (f.v < -0.02) {
        ins.rollRun += -f.v * (f.t - frames[frames.length - 2].t);
        if (ins.rollRun > S.rollback) S.rollback = ins.rollRun;
        if (x.on && ins.rollRun > 0.3) {
          x.emit({ type: 'rollback', severity: 'major', title: 'Rolled backwards', tip: 'Keep the brake on until you feel the car pull against it at the bite point, then swap brake for gas.', cue: 'Rolling back! Press the brake.', cooldown: 5 });
        }
      } else if (f.v > 0.05) {
        ins.rollRun = 0;
      }
    },
  },
  {
    id: 'crash', always: true, events: ['crash'],
    about: 'Touched the vehicle ahead. Ends a single run; in a long run the car just stops against it. Also tracks the gap.',
    stats: { minGap: Infinity, maxGap: 0, crashed: false },
    observe(x) {
      const { f, S, ins, M } = x;
      if (f.gap === null) return;
      if (f.gap < S.minGap) S.minGap = f.gap;
      if (x.elapsed > 4 && f.gap > S.maxGap) S.maxGap = f.gap;
      if (f.gap <= 0) {
        S.crashed = true;
        x.emit({ type: 'crash', severity: 'major', title: 'Bumped the vehicle ahead', tip: 'Leave a gap you could walk through. Clutch down and brake early when traffic stops.', cue: 'Bump! Brake now.' });
        if (!M.continuous) ins.hardEnd = { completed: false, reason: 'You bumped the auto ahead' };
      }
    },
  },
  {
    id: 'tailgate', events: ['tailgate'],
    about: 'Closer than 1.5 m to the vehicle ahead while moving.',
    stats: {},
    observe(x) {
      const { f } = x;
      if (x.on && f.gap !== null && f.gap > 0 && f.gap < 1.5 && f.v > 0.2) {
        x.emit({ type: 'tailgate', severity: 'minor', title: 'Too close to the vehicle ahead', tip: 'Keep at least a car length or so in slow traffic.', cue: 'Too close to the auto. Ease off and let the gap grow.', cooldown: 4 });
      }
    },
  },
  {
    id: 'speed-zone', always: true, events: [],
    about: 'Top speed inside the moment\'s speedZone { s0, s1 }, if it has one.',
    stats: { maxSpeedZone: 0 },
    observe(x) {
      const { f, S, M } = x;
      if (M.speedZone && f.s > M.speedZone.s0 && f.s < M.speedZone.s1 && f.v > S.maxSpeedZone) S.maxSpeedZone = f.v;
    },
  },
  {
    id: 'grind', always: true, events: ['grind'],
    about: 'Changed gear without the clutch down. Raised by the gearbox (sim.shiftGear), not per frame.',
    stats: { grinds: 0 },
    observe() {},
  },
];

export const DETECTOR = Object.fromEntries(DETECTORS.map(d => [d.id, d]));
