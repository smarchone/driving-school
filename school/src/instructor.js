// Deterministic instructor: rule-based detectors over telemetry frames.
// Same input -> same feedback, every time. An AI layer can explain these later (M2).

import { LANE_CENTER } from './road.js';

export const LURCH = 2.6;     // m/s² forward jolt
export const HARSH = 5.0;     // m/s² braking
const OVERREV = 3800;

export function createInstructor(moment, sim) {
  return {
    stats: {
      stalls: 0, firstStall: null, maxAccel: 0, maxDecel: 0, maxLaneDev: 0,
      rollback: 0, minGap: Infinity, maxGap: 0, crashed: false, maxSpeedZone: 0,
      overrevs: 0, grinds: 0, maxThr: 0,
    },
    rollRun: 0,
    events: [],
    cooldown: {},
    once: {},
    lastCueT: -99,
    prevRunning: sim.car.running,
    startT: sim.t,
    startS: sim.proj.s,
    hardEnd: null,
  };
}

function pushCue(ins, sim, f, text, priority) {
  if (!priority && f.t - ins.lastCueT < 2.5) return false;
  ins.lastCueT = f.t;
  sim.cues.push({ t: f.t, text, priority: !!priority });
  return true;
}

export function addEvent(ins, sim, f, ev) {
  const cd = ins.cooldown[ev.type];
  if (cd !== undefined && f.t - cd < (ev.cooldown ?? 3)) return;
  ins.cooldown[ev.type] = f.t;
  ins.events.push({ t: f.t, frame: sim.frames.length - 1, type: ev.type, severity: ev.severity, title: ev.title, tip: ev.tip });
  if (ev.cue) pushCue(ins, sim, f, ev.cue, true);
}

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

export function observe(ins, sim, f) {
  const M = sim.moment, S = ins.stats, frames = sim.frames, n = frames.length;
  const on = M.detect;
  const elapsed = f.t - ins.startT;
  if (n > 6) {
    const p = frames[n - 7];
    f.a = (f.v - p.v) / (f.t - p.t);
  }

  if (ins.prevRunning && !f.running) {
    S.stalls++;
    if (S.firstStall === null) S.firstStall = f.t;
    const dx = diagnoseStall(frames);
    addEvent(ins, sim, f, { type: 'stall', severity: 'major', title: dx.title, tip: dx.tip, cue: dx.cue, cooldown: 0.5 });
  }
  ins.prevRunning = f.running;

  if (elapsed > 0.3) {
    if (f.a > S.maxAccel) S.maxAccel = f.a;
    if (f.v > 0.3 && -f.a > S.maxDecel) S.maxDecel = -f.a;
  }
  if (on.includes('lurch') && elapsed > 0.3 && f.a > LURCH) {
    addEvent(ins, sim, f, { type: 'lurch', severity: 'minor', title: 'The car jerked forward', tip: 'Lift the clutch more slowly through the bite point.', cue: 'Easy. Slower on the clutch.' });
  }
  if (on.includes('harsh') && f.v > 1 && -f.a > HARSH) {
    addEvent(ins, sim, f, { type: 'harsh', severity: 'minor', title: 'Harsh braking', tip: 'Start braking earlier so you can press more gently.', cue: 'Too hard on the brake. Ease off and press more gently.' });
  }
  if (f.thr > S.maxThr) S.maxThr = f.thr;
  if (!sim.car.auto && f.running && f.rpm > OVERREV && f.e > 0.02 && f.e < 0.9 && Math.abs(f.v) < 4) {
    S.overrevs++;
    addEvent(ins, sim, f, { type: 'overrev', severity: 'minor', title: 'Too many revs on the clutch', tip: 'You only need a little gas to move off. High revs while the clutch slips wears it out.', cue: 'Too many revs. Ease off the gas; a quarter is plenty.', cooldown: 4 });
  }
  const dev = Math.abs(f.d - LANE_CENTER);
  if (dev > S.maxLaneDev) S.maxLaneDev = dev;
  if (on.includes('lane') && dev > 0.9) {
    addEvent(ins, sim, f, { type: 'lane', severity: 'minor', title: f.d > LANE_CENTER ? 'Drifted into the other lane' : 'Drifted off the road edge', tip: 'Look far ahead to where you want to go; your hands follow your eyes.', cue: f.d > LANE_CENTER ? 'You are drifting right. Steer gently back to the left lane.' : 'Too close to the edge. Steer gently back to the right.', cooldown: 4 });
  }
  if (f.v < -0.02) {
    ins.rollRun += -f.v * (f.t - frames[n - 2].t);
    if (ins.rollRun > S.rollback) S.rollback = ins.rollRun;
    if (on.includes('rollback') && ins.rollRun > 0.3) {
      addEvent(ins, sim, f, { type: 'rollback', severity: 'major', title: 'Rolled backwards', tip: 'Keep the brake on until you feel the car pull against it at the bite point, then swap brake for gas.', cue: 'Rolling back! Press the brake.', cooldown: 5 });
    }
  } else if (f.v > 0.05) {
    ins.rollRun = 0;
  }
  if (f.gap !== null) {
    if (f.gap < S.minGap) S.minGap = f.gap;
    if (elapsed > 4 && f.gap > S.maxGap) S.maxGap = f.gap;
    if (f.gap <= 0) {
      S.crashed = true;
      addEvent(ins, sim, f, { type: 'crash', severity: 'major', title: 'Bumped the vehicle ahead', tip: 'Leave a gap you could walk through. Clutch down and brake early when traffic stops.', cue: 'Bump! Brake now.' });
      if (!M.continuous) ins.hardEnd = { completed: false, reason: 'You bumped the auto ahead' };
    } else if (on.includes('tailgate') && f.gap < 1.5 && f.v > 0.2) {
      addEvent(ins, sim, f, { type: 'tailgate', severity: 'minor', title: 'Too close to the vehicle ahead', tip: 'Keep at least a car length or so in slow traffic.', cue: 'Too close to the auto. Ease off and let the gap grow.', cooldown: 4 });
    }
  }
  if (M.speedZone && f.s > M.speedZone.s0 && f.s < M.speedZone.s1 && f.v > S.maxSpeedZone) S.maxSpeedZone = f.v;
  if (M.measure) M.measure(S, f, sim, ins);

  for (const c of M.cues || []) {
    if (c.once && ins.once[c.id]) continue;
    const cd = ins.cooldown['cue:' + c.id];
    if (cd !== undefined && f.t - cd < 6) continue;
    if (c.when(f, sim, ins)) {
      if (pushCue(ins, sim, f, c.text)) {
        ins.once[c.id] = true;
        ins.cooldown['cue:' + c.id] = f.t;
      }
    }
  }
}

export function noteGrind(sim) {
  const f = sim.frames[sim.frames.length - 1];
  sim.ins.stats.grinds++;
  addEvent(sim.ins, sim, f, { type: 'grind', severity: 'minor', title: 'Changed gear without the clutch', tip: 'Press the clutch fully down before every gear change.', cue: 'Press the clutch fully down before changing gear.' });
}

export function evaluate(sim) {
  const ins = sim.ins, M = sim.moment;
  const S = { ...ins.stats, duration: sim.t - ins.startT, end: sim.ended };
  const criteria = M.criteria.map(c => ({ id: c.id, label: c.label, ok: !!c.test(S), detail: c.detail ? c.detail(S) : '', tip: c.tip }));
  const completed = !!sim.ended?.completed;
  const passed = completed && criteria.every(c => c.ok);
  const firstFail = criteria.find(c => !c.ok);
  const firstMajor = ins.events.find(e => e.severity === 'major');
  let headline, tip;
  if (passed) {
    headline = M.praise;
    const minor = ins.events.find(e => e.severity === 'minor');
    tip = minor ? minor.tip : 'Now try it with assists off. Passing without help is what counts.';
  } else if (!completed) {
    // Lead with the mistake that caused it, not the symptom ("ran out of time").
    headline = firstMajor && sim.ended?.reason === 'Ran out of time' ? firstMajor.title : (sim.ended?.reason || 'Not finished');
    tip = (firstMajor || ins.events[0])?.tip || firstFail?.tip || M.steps[0];
  } else {
    headline = 'Almost. ' + (firstFail.fail || firstFail.label);
    const related = ins.events.find(e => (firstFail.events || []).includes(e.type));
    tip = related?.tip || firstFail.tip;
  }
  return { passed, completed, criteria, events: ins.events, headline, tip, stats: S, practice: sim.practice };
}
