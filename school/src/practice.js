// Practice: many reps of one moment, with no menus in between. After each rep the instructor says one line,
// and the help fades as the reps come out clean. Pure logic, no DOM: modes.js runs it, main.js shows it.
//
// A rep: { clean, checks: [{ id, label, ok, tip }], tip?, stats? | R?, range?: [frameA, frameB] }

export const ASSIST_ORDER = ['full', 'cues', 'off'];
export const FADE_AFTER = 3;    // clean reps in a row -> one step less help
export const RETURN_AFTER = 2;  // misses in a row -> one step more help
export const PASS_STREAK = 5;   // clean reps in a row that count as passing the moment

export function createPractice(assist) {
  return { assist, reps: [], streak: 0, fails: 0, bestStreak: 0, offStreak: 0, bestStreakNoAssist: 0 };
}

// A finished single run (a reset rep) as a rep.
export function repFromReport(r) {
  const checks = r.criteria.map(c => ({ id: c.id, label: c.label, ok: c.ok, tip: c.tip }));
  if (!r.completed) checks.push({ id: 'finish', label: 'Finished the moment', ok: false, tip: r.tip });
  return { clean: r.passed, checks, tip: r.tip, stats: r.stats };
}

// Score a rep: update the streaks and the assist level, and return the instructor's one line.
export function scoreRep(P, rep) {
  const prev = P.reps[P.reps.length - 1];
  P.reps.push({ ...rep, assist: P.assist });
  let line;
  if (rep.clean) {
    P.streak++; P.fails = 0;
    P.bestStreak = Math.max(P.bestStreak, P.streak);
    P.offStreak = P.assist === 'off' ? P.offStreak + 1 : 0;
    P.bestStreakNoAssist = Math.max(P.bestStreakNoAssist, P.offStreak);
    line = P.streak >= 3 ? `Clean again. ${P.streak} in a row.` : prev && !prev.clean ? 'Better! That one was clean.' : 'Clean. Again.';
    if (P.streak % FADE_AFTER === 0 && P.assist !== 'off') {
      P.assist = ASSIST_ORDER[ASSIST_ORDER.indexOf(P.assist) + 1];
      line += P.assist === 'cues' ? ' Ghost off now, just my voice.' : ' Now on your own, no help.';
    }
  } else {
    P.streak = 0; P.offStreak = 0; P.fails++;
    // Coach the thing that keeps going wrong, not just the latest slip.
    const recent = P.reps.slice(-4);
    const misses = id => recent.filter(r => r.checks.some(c => c.id === id && !c.ok)).length;
    const failed = rep.checks.filter(c => !c.ok).sort((x, y) => misses(y.id) - misses(x.id));
    const focus = failed[0];
    line = misses(focus.id) >= 2 || !rep.tip ? focus.tip : rep.tip;
    if (P.fails >= RETURN_AFTER && P.assist !== 'full') {
      P.assist = ASSIST_ORDER[ASSIST_ORDER.indexOf(P.assist) - 1];
      P.fails = 0;
      line += ' Help is back on.';
    }
  }
  return line;
}

// Rep splitters for continuous practice (moment.practice.segment): cut one long run into reps.
// A splitter: { about, create() -> state, frame(state, sim, i) -> rep | null }, called once per telemetry frame.
export const SEGMENTERS = {
  'stop-go': {
    about: 'Traffic: a rep runs from the vehicle ahead moving off until you are stopped behind it again.',
    create: () => ({ phase: 'wait', stillT: 0, from: 0, t0: 0 }),
    frame(st, sim, i) {
      const f = sim.frames[i];
      let rep = null;
      if (st.phase === 'wait') {
        if (f.leadV > 0.3) { st.phase = 'rep'; st.from = i; st.t0 = f.t; }
      } else if (st.phase === 'rep') {
        if (f.leadV === 0) { st.phase = 'settle'; st.stillT = 0; }
      } else if (st.phase === 'settle') {
        st.stillT = f.v === 0 ? st.stillT + 1 / 60 : 0;
        if (st.stillT > 0.6 || f.leadV > 0.3) {
          rep = stopGoRep(sim, st.from, i, st.t0);
          if (f.leadV > 0.3) { st.phase = 'rep'; st.from = i; st.t0 = f.t; } else st.phase = 'wait';
        }
      }
      return rep;
    },
  },
};

// Score frames a..b of a stop-go rep against the moment's repChecks.
function stopGoRep(sim, a, b, t0) {
  const frames = sim.frames;
  const R = { stalls: 0, minGap: Infinity, crash: false, maxAccel: 0, reaction: Infinity };
  for (let k = a; k <= b; k++) {
    const f = frames[k];
    if (k > a && frames[k - 1].running && !f.running) R.stalls++;
    if (f.gap !== null) { R.minGap = Math.min(R.minGap, f.gap); if (f.gap <= 0.05) R.crash = true; }
    if (f.t - t0 > 0.3) R.maxAccel = Math.max(R.maxAccel, f.a);
    if (R.reaction === Infinity && f.v > 0.3) R.reaction = f.t - t0;
  }
  const m = sim.moment, auto = m.transmission === 'auto';
  const checks = m.repChecks.filter(c => !(auto && c.manual))
    .map(c => ({ id: c.id, label: c.label, ok: !!c.test(R), tip: auto && c.autoTip ? c.autoTip : c.tip }));
  return { clean: checks.every(c => c.ok), checks, R, range: [a, b] };
}

// End of a practice session: the numbers, and how each habit changed from the first half to the second.
export function practiceSummary(P, title, minutes) {
  const n = P.reps.length, clean = P.reps.filter(r => r.clean).length;
  const half = Math.floor(n / 2);
  const ids = [...new Set(P.reps.flatMap(r => r.checks.map(c => c.id)))];
  const missCount = (reps, id) => reps.filter(r => r.checks.some(c => c.id === id && !c.ok)).length;
  const lines = ids.map(id => {
    const label = P.reps.flatMap(r => r.checks).find(c => c.id === id).label;
    return { label, a: missCount(P.reps.slice(0, half), id), b: missCount(P.reps.slice(half), id) };
  }).filter(x => x.a + x.b > 0);
  const trend = n < 4 ? [{ cls: 'muted', text: 'Do a few more reps to see a trend.' }]
    : lines.length ? lines.map(x => ({ cls: x.b < x.a ? 'up' : x.b > x.a ? 'down' : '', label: x.label, value: `${x.a} miss${x.a === 1 ? '' : 'es'} → ${x.b}`, note: 'first half → second half' }))
    : [{ cls: 'up', label: 'Everything', value: 'clean all session' }];
  const late = P.reps.slice(half);
  const worst = lines.sort((x, y) => y.b - x.b)[0];
  const tip = worst && worst.b > 0 ? P.reps.flatMap(r => r.checks).find(c => c.label === worst.label && !c.ok)?.tip : null;
  const next = tip || (late.length ? 'Clean at the end. Next time, start with assists off, or test yourself.' : 'Keep going: reps are how this gets easy.');
  return {
    eyebrow: 'Practice done',
    title: `${minutes} min of ${title.toLowerCase()}`,
    stats: [[n, 'reps'], [clean, 'clean'], [P.bestStreak, 'best streak']],
    dots: P.reps.map(r => ({ ok: r.clean, title: r.clean ? 'clean' : r.checks.filter(c => !c.ok).map(c => c.label).join(', ') })),
    dotsEmpty: 'No reps finished.',
    trendTitle: 'How it changed',
    trend,
    next,
    again: 'Keep practising',
    test: true,
    say: `${n} reps, ${clean} clean. ${next}`,
  };
}
