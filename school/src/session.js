// Session log: one in-memory place where every run, rep, instructor finding and telemetry frame lands.
// It is the plug-in point for analysis (rule-based or LLM agents): read summary() for a compact brief,
// call slice() for raw telemetry around a moment, or toJSON() for everything. Not persisted (yet).

export const SCHEMA_VERSION = 1;

// Telemetry columns, with units. `T` is session time (continuous across runs); `t` is time within a run.
export const FIELDS = {
  T: 's, session time',
  t: 's, run time',
  run: 'index into runs[]',
  s: 'm along the road centreline',
  d: 'm from the road centreline, + right (our lane centre is -1.75)',
  v: 'm/s, + forward',
  a: 'm/s², smoothed over 0.1 s',
  rpm: 'engine rpm, 0 = stalled',
  gear: '0 = neutral, 1-5',
  running: 'engine on (bool)',
  e: 'clutch engagement 0 (open) .. 1 (locked); always 1 in automatic',
  thr: 'gas pedal 0..1',
  brk: 'brake pedal 0..1',
  clu: 'clutch pedal 0 (up) .. 1 (down)',
  steer: 'wheel -1 (full left) .. 1 (full right)',
  gap: 'm bumper to bumper to the vehicle ahead, null if none',
  leadV: 'm/s of the vehicle ahead, null if none',
};
const COLS = Object.keys(FIELDS);

const round = (x, k = 3) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** k) / 10 ** k : x);

export function createSession(meta) {
  const frames = Object.fromEntries(COLS.map(c => [c, []]));
  const S = {
    schemaVersion: SCHEMA_VERSION,
    fields: FIELDS,
    meta: { ...meta, startedAt: new Date().toISOString() },
    runs: [],      // { n, kind, startT, frameStart, frameEnd, report? }
    reps: [],      // { n, run, clean, assist, checks, metrics, frameStart, frameEnd, T0, T1 }
    events: [],    // { T, run, rep, type, severity, title, tip, frame }
    frames,
    ref: null,     // the good run's frames, in the same per-run shape (array of objects)
  };
  let clock = 0;   // session time at the start of the current run
  let synced = 0;  // frames of the current sim already copied
  let evSynced = 0;

  S.length = () => frames.T.length;

  // A new run (a test attempt, a practice rep, or a retry from a replay point).
  S.beginRun = (sim, kind) => {
    if (S.runs.length) clock = frames.T.length ? frames.T[frames.T.length - 1] + 1 / 60 : clock;
    S.runs.push({ n: S.runs.length, kind, startT: clock, runT0: sim.frames[0].t, frameStart: frames.T.length, frameEnd: frames.T.length });
    synced = 0;
    evSynced = 0;
  };

  // Copy any new frames and instructor findings from the running sim.
  S.sync = (sim, repN = null) => {
    const run = S.runs[S.runs.length - 1];
    if (!run) return;
    const src = sim.frames;
    for (let i = synced; i < src.length; i++) {
      const f = src[i];
      frames.T.push(round(run.startT + (f.t - run.runT0)));
      frames.run.push(run.n);
      for (const c of COLS) if (c !== 'T' && c !== 'run') frames[c].push(c === 'running' ? f.running : round(f[c] ?? null));
    }
    synced = src.length;
    run.frameEnd = frames.T.length;
    const evs = sim.ins.events;
    for (let i = evSynced; i < evs.length; i++) {
      const e = evs[i];
      S.events.push({ T: round(run.startT + (e.t - run.runT0)), run: run.n, rep: repN, type: e.type, severity: e.severity, title: e.title, tip: e.tip, frame: run.frameStart + e.frame });
    }
    evSynced = evs.length;
  };

  S.endRun = report => {
    const run = S.runs[S.runs.length - 1];
    if (!run || !report) return;
    run.report = {
      passed: report.passed, completed: report.completed, headline: report.headline, tip: report.tip,
      checks: report.criteria.map(c => ({ id: c.id, label: c.label, ok: c.ok, detail: c.detail })),
      metrics: pickMetrics(report.stats),
    };
  };

  // A practice rep. frameStart/frameEnd are session frame indices.
  S.addRep = (rep, frameStart, frameEnd) => {
    const n = S.reps.length;
    S.reps.push({
      n, run: S.runs.length - 1, clean: rep.clean, assist: rep.assist,
      checks: rep.checks.map(c => ({ id: c.id, label: c.label, ok: c.ok })),
      metrics: pickMetrics(rep.R || rep.stats || {}),
      frameStart, frameEnd, T0: frames.T[frameStart] ?? null, T1: frames.T[Math.max(frameStart, frameEnd - 1)] ?? null,
    });
    for (const e of S.events) if (e.rep === null && e.frame >= frameStart && e.frame < frameEnd) e.rep = n;
  };

  // Raw telemetry between two session times, as columns (only the fields asked for, or all).
  S.slice = (T0, T1, fields = COLS) => {
    const out = Object.fromEntries(fields.map(c => [c, []]));
    for (let i = 0; i < frames.T.length; i++) {
      const T = frames.T[i];
      if (T < T0) continue;
      if (T > T1) break;
      for (const c of fields) out[c].push(frames[c][i]);
    }
    return out;
  };

  // The telemetry around one instructor finding: `before`/`after` seconds either side.
  S.around = (event, before = 3, after = 1, fields) => S.slice(event.T - before, event.T + after, fields);

  // A compact brief for an LLM: context, reps, findings, and how each habit is trending. No raw frames.
  S.summary = () => {
    const reps = S.reps;
    const half = Math.floor(reps.length / 2);
    const ids = [...new Set(reps.flatMap(r => r.checks.map(c => c.id)))];
    const misses = (rs, id) => rs.filter(r => r.checks.some(c => c.id === id && !c.ok)).length;
    const counts = {};
    for (const e of S.events) counts[e.type] = (counts[e.type] || 0) + 1;
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: S.meta,
      duration_s: round(frames.T.length ? frames.T[frames.T.length - 1] : 0, 1),
      runs: S.runs.map(r => ({ n: r.n, kind: r.kind, passed: r.report?.passed, headline: r.report?.headline, metrics: r.report?.metrics })),
      reps: reps.map(r => ({ n: r.n, clean: r.clean, assist: r.assist, missed: r.checks.filter(c => !c.ok).map(c => c.id), metrics: r.metrics })),
      trend: reps.length < 4 ? null : ids.map(id => ({ check: id, missesFirstHalf: misses(reps.slice(0, half), id), missesSecondHalf: misses(reps.slice(half), id) })),
      eventCounts: counts,
      events: S.events.slice(-60).map(e => ({ T: e.T, rep: e.rep, type: e.type, severity: e.severity, title: e.title })),
      telemetry: { frames: frames.T.length, hz: 60, fields: FIELDS, howToGet: 'session.slice(T0, T1, fields) or session.around(event)' },
    };
  };

  S.toJSON = () => ({ schemaVersion: SCHEMA_VERSION, fields: FIELDS, meta: S.meta, runs: S.runs, reps: S.reps, events: S.events, frames });
  return S;
}

// Numeric metrics only, rounded, Infinity dropped.
function pickMetrics(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = round(v, 2);
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
