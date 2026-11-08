// Deterministic instructor: runs the detectors (detectors.js) over each telemetry frame, then the moment's own
// measure() and live cues. Same input -> same feedback, every time. evaluate() turns it all into the report.
// The rules live in detectors.js; what a lesson coaches and passes on lives in its moment (moments.js).

import { DETECTORS, LURCH, HARSH } from './detectors.js';

export { LURCH, HARSH };

export function createInstructor(moment, sim) {
  const ins = {
    stats: Object.assign({}, ...DETECTORS.map(d => d.stats)),
    events: [],
    cooldown: {},
    once: {},
    lastCueT: -99,
    startT: sim.t,
    startS: sim.proj.s,
    hardEnd: null,
  };
  for (const d of DETECTORS) d.init?.(ins, sim);
  return ins;
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

export function observe(ins, sim, f) {
  const M = sim.moment, S = ins.stats, on = M.detect || [];
  const x = { f, S, sim, ins, M, frames: sim.frames, elapsed: f.t - ins.startT, on: false, emit: ev => addEvent(ins, sim, f, ev) };
  for (const d of DETECTORS) {
    x.on = !!d.always || on.includes(d.id);
    d.observe(x);
  }
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
