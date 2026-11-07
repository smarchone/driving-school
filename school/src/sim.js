// Deterministic simulation of one moment: car + traffic + instructor + recording.
// Fixed 960 Hz physics, a telemetry frame every 16 steps (60 Hz).
// Every frame carries a snapshot, so any point can become a retry checkpoint.

import { buildRoad, pointAt, project, LANE_CENTER } from './road.js';
import { createCar, stepCar, CAR, RPM } from './physics.js';
import { createInstructor, observe, evaluate, noteGrind } from './instructor.js';

export const DT = 1 / 960;
export const FRAME_STEPS = 16;
export const FRAME_DT = DT * FRAME_STEPS;
export const LEAD_LEN = 2.8;
export const NEUTRAL = { steer: 0, throttle: 0, brake: 0, clutch: 0 };

export function roadOf(moment) {
  if (!moment._road) moment._road = buildRoad(moment.road);
  return moment._road;
}

export function createSim(moment, snap = null) {
  const road = roadOf(moment);
  const sim = { moment, road, t: 0, step: 0, frames: [], cues: [], ended: null, report: null, practice: !!snap, input: NEUTRAL };
  if (snap) {
    sim.car = { ...snap.car };
    sim.lead = snap.lead ? { ...snap.lead } : null;
    sim.t = snap.t;
  } else {
    const st = moment.start;
    const p = pointAt(road, st.s, LANE_CENTER);
    sim.car = createCar({ x: p.x, z: p.z, h: p.h, v: st.v || 0, gear: st.gear ?? 1, auto: moment.transmission === 'auto' });
    sim.lead = moment.lead ? { s: moment.lead.s0, v: 0, phase: 0, pt: 0, done: false } : null;
  }
  sim.proj = project(road, sim.car.x, sim.car.z);
  sim.ins = createInstructor(moment, sim);
  record(sim, snap?.input || NEUTRAL);
  return sim;
}

function record(sim, inp) {
  const c = sim.car, p = sim.proj, L = sim.lead;
  const f = {
    t: sim.t, s: p.s, d: p.d, x: c.x, z: c.z, h: c.h, y: p.y, grade: p.grade,
    v: c.v, rpm: c.running ? c.omegaE * RPM : 0, running: c.running, gear: c.gear, e: c.e, tc: c.tc,
    thr: inp.throttle, brk: inp.brake, clu: inp.clutch, steer: inp.steer,
    leadS: L ? L.s : null, leadV: L ? L.v : null,
    gap: L ? L.s - p.s - (CAR.length + LEAD_LEN) / 2 : null,
    a: 0,
    // Long practice sessions keep frames light (no restorable snapshot per frame).
    snap: sim.moment.continuous ? null : { car: { ...c }, lead: L ? { ...L } : null, t: sim.t, input: { ...inp } },
  };
  sim.frames.push(f);
  return f;
}

function stepLead(L, script, dt) {
  if (!L.done) {
    L.pt += dt;
    if (L.pt >= script[L.phase].dur) {
      L.phase++;
      L.pt = 0;
      if (L.phase >= script.length) L.done = true;
    }
  }
  const target = L.done ? 0 : script[L.phase].v;
  L.v += Math.max(-2.2 * dt, Math.min(1.2 * dt, target - L.v));
  L.s += L.v * dt;
}

export function shiftGear(sim, dir) {
  if (sim.ended || sim.car.auto) return false;
  if (sim.input.clutch < 0.6) { noteGrind(sim); return false; }
  sim.car.gear = Math.max(0, Math.min(5, sim.car.gear + dir));
  return true;
}

export function stepSim(sim, inp) {
  if (sim.ended) return;
  sim.input = inp;
  const c = sim.car;
  const p = sim.proj;
  const slope = Math.sin(Math.atan(p.grade)) * Math.cos(c.h - p.h);
  stepCar(c, inp, DT, slope);
  if (sim.lead) {
    stepLead(sim.lead, sim.moment.lead.script, DT);
    // Continuous practice: a bump doesn't end anything, the car just stops against the auto.
    if (sim.moment.continuous && sim.lead.s - p.s - (CAR.length + LEAD_LEN) / 2 < 0.02 && c.v > sim.lead.v) c.v = sim.lead.v;
  }
  sim.t += DT;
  sim.step++;
  if (sim.step % 4 === 0) sim.proj = project(sim.road, c.x, c.z, p.i);
  if (sim.step % FRAME_STEPS === 0) {
    sim.proj = project(sim.road, c.x, c.z, sim.proj.i);
    const f = record(sim, inp);
    observe(sim.ins, sim, f);
    const M = sim.moment;
    const end = sim.ins.hardEnd
      || M.end(f, sim)
      || (sim.t - sim.ins.startT > M.timeLimit ? { completed: false, reason: 'Ran out of time' } : null);
    if (end) {
      sim.ended = end;
      sim.report = evaluate(sim);
    }
  }
}

// Run the moment's expert driver headlessly: this is the reference (ghost) run.
export function runReference(moment) {
  const sim = createSim(moment);
  const ctx = {};
  const limit = moment.timeLimit + 2;
  while (!sim.ended && sim.t < limit) stepSim(sim, moment.expert(sim, ctx, DT));
  return { frames: sim.frames, report: sim.report, log: ctx.log || [] };
}
