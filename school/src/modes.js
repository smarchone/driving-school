// Modes: how a visit to a moment runs. The moment is what you drive; the mode is the shape of the visit:
// one test run and a debrief, a practice session of reps, or a free drive that ends when you say so.
// main.js shows screens and runs the clock; everything that differs between modes lives here, as plain data
// and functions with no DOM, so new modes (task-based drives, long drives...) are new entries in MODES.
//
// A mode:
//   id            session kind written to the log
//   about         one line, for tools and agents
//   reps          true: the visit is a series of reps ("Rep n", quieter after the first rep)
//   ends          'debrief' (single run, replay) or 'summary' (Finish / Esc ends the visit with a summary)
//   button(m)     label of the brief's main button when this is the moment's first mode
//   briefPass(m)  { title, items } for the brief's "what counts" list
//   start(base, { assist, clock }) -> run state: { mode, base, moment, assist, continuous, ... }
//                 assist null means the learner's own setting is used (and changed by the assist chip)
//   runKind(run)  kind of each run in the session log
//   frame(run, sim, i, clock) -> rep | null        once per new telemetry frame while driving
//   runEnded(run, sim) -> { rep?, then: 'debrief' | 'next' | 'end' }
//   timeUp(run, clock) -> bool
//   bar(run, sim, clock) -> { time, count, dots | null }     the practice bar, for modes that end in a summary
//   finish(run, ctx) -> summary   ctx = { sim, clock, progress, events }; also records progress

import { practiceOf, practiceMins } from './moments.js';
import { createPractice, repFromReport, SEGMENTERS, practiceSummary } from './practice.js';
import { recordPractice, recordFree } from './progress.js';

const clockText = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const passList = m => ({ title: 'A clean rep', items: m.criteria.map(c => c.label) });

const test = {
  id: 'test',
  about: 'One run with the learner\'s assist setting, then a replay debrief with pass/fail.',
  reps: false,
  ends: 'debrief',
  button: () => 'Test yourself',
  briefPass: passList,
  start: base => ({ mode: test, base, moment: base, assist: null, continuous: false }),
  runKind: () => 'test',
  frame: () => null,
  runEnded: () => ({ then: 'debrief' }),
  timeUp: () => false,
};

const practice = {
  id: 'practice',
  about: 'Reps of one moment for a few minutes. Help fades after clean reps and comes back after misses.',
  reps: true,
  ends: 'summary',
  button: m => `Practise · ${practiceMins(m)} min →`,
  briefPass: passList,
  start(base, { assist, clock }) {
    const m = practiceOf(base);
    const seg = m.continuous ? SEGMENTERS[m.practice?.segment || 'stop-go'] : null;
    return {
      mode: practice, base, moment: m, continuous: !!m.continuous, ...createPractice(assist),
      startedAt: clock, endsAt: clock + practiceMins(base) * 60,
      seg, segState: seg?.create(),
    };
  },
  runKind: run => (run.continuous ? 'practice-continuous' : 'practice-rep'),
  frame: (run, sim, i) => (run.seg ? run.seg.frame(run.segState, sim, i) : null),
  runEnded: (run, sim) => (run.continuous ? { then: 'end' } : { rep: repFromReport(sim.report), then: 'next' }),
  timeUp: (run, clock) => clock >= run.endsAt,
  bar: (run, sim, clock) => ({
    time: `${clockText(Math.max(0, run.endsAt - clock))} left`,
    count: `${run.reps.length} reps · ${run.reps.filter(r => r.clean).length} clean`,
    dots: run.reps,
  }),
  finish(run, { clock, progress }) {
    recordPractice(progress, run.base.id, run);
    return practiceSummary(run, run.base.title, Math.max(1, Math.round((clock - run.startedAt) / 60)));
  },
};

const drivenKm = sim => {
  const fr = sim?.frames;
  return fr && fr.length ? (fr[fr.length - 1].s - fr[0].s) / 1000 : 0;
};

const free = {
  id: 'free',
  about: 'Drive at your own pace with no score or timer. The instructor only speaks when something goes wrong.',
  reps: false,
  ends: 'summary',
  button: () => 'Drive →',
  briefPass: () => ({ title: 'Your instructor', items: ['Stays quiet unless something goes wrong', 'No score, no timer', 'Every drive is logged; download it at the end'] }),
  start: (base, { assist, clock }) => ({ mode: free, base, moment: base, continuous: true, ...createPractice(assist), startedAt: clock, endsAt: Infinity }),
  runKind: () => 'practice-continuous',
  frame: () => null,
  runEnded: () => ({ then: 'end' }),
  timeUp: () => false,
  bar: (run, sim, clock) => ({ time: clockText(clock - run.startedAt), count: `${drivenKm(sim).toFixed(2)} km`, dots: null }),
  finish(run, { sim, clock, progress, events }) {
    const km = drivenKm(sim);
    const secs = Math.max(1, clock - run.startedAt);
    recordFree(progress, run.base.id, km);
    // What came up on the drive, most frequent first.
    const by = {};
    for (const e of events) (by[e.title] = by[e.title] || { n: 0, tip: e.tip, major: e.severity === 'major' }).n++;
    const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
    const next = rows.length ? rows[0][1].tip : 'Clean drive. Next time, try it with assists off.';
    return {
      eyebrow: 'Drive done',
      title: `Free drive · ${Math.max(1, Math.round(secs / 60))} min`,
      stats: [[km.toFixed(1), 'km'], [Math.round(km / (secs / 3600)), 'km/h average'], [events.length, 'findings']],
      dots: null,
      trendTitle: 'What came up',
      trend: rows.length ? rows.map(([t, x]) => ({ cls: x.major ? 'down' : '', label: t, value: `×${x.n}` })) : [{ cls: 'up', label: 'Nothing came up', value: 'clean drive' }],
      next,
      again: 'Drive again',
      test: false,
      say: `${km.toFixed(1)} kilometres. ${next}`,
    };
  },
};

export const MODES = { test, practice, free };
