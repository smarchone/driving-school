// Headless sanity check: each moment's expert must pass its own criteria,
// and a few scripted "bad drivers" must trigger the right feedback.
// Run: node school/tools/check.mjs
import { MOMENTS, lessons } from '../src/moments.js';
import { runReference, createSim, stepSim, DT } from '../src/sim.js';

let failed = 0;
const kmh = v => (v * 3.6).toFixed(1);

for (const m of [...lessons('manual'), ...lessons('auto')]) {
  const t0 = performance.now();
  const ref = runReference(m);
  const ms = (performance.now() - t0).toFixed(0);
  const r = ref.report;
  const ok = r && r.passed;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${m.id.padEnd(11)} ${r ? r.stats.duration.toFixed(1) : '-'}s  ${ms}ms  ${r?.headline}`);
  if (r) for (const c of r.criteria) console.log(`        ${c.ok ? '✓' : '✗'} ${c.label} ${c.detail}`);
  if (r && r.events.length) console.log('        events:', r.events.map(e => `${e.type}@${e.t.toFixed(1)}`).join(' '));
  console.log('        modes:', ref.log.map(l => `${l.mode}@${l.t.toFixed(1)}`).join(' '));
  const S = r?.stats;
  if (S) console.log(`        maxAccel ${S.maxAccel.toFixed(2)} maxDecel ${S.maxDecel.toFixed(2)} lane ${S.maxLaneDev.toFixed(2)} roll ${S.rollback.toFixed(2)} gap ${S.minGap.toFixed(1)}..${S.maxGap.toFixed(1)} zoneV ${kmh(S.maxSpeedZone)} stopGap ${S.stopGap?.toFixed(2)}`);
}

// Bad driver: dump the clutch in moving-off -> must stall and diagnose it.
function drive(m, fn, seconds = 10) {
  const sim = createSim(m);
  while (!sim.ended && sim.t < seconds) stepSim(sim, fn(sim.t, sim));
  return sim;
}
const dump = drive(MOMENTS[0], t => ({ steer: 0, throttle: 0, brake: 0, clutch: t < 0.5 ? 1 : 0 }), 3);
const stall = dump.ins.events.find(e => e.type === 'stall');
console.log(stall ? `PASS  dump-clutch -> "${stall.title}"` : 'FAIL  dump-clutch did not stall');
if (!stall || stall.title !== 'Clutch came up too fast') failed++;

// Bad driver: release brake on the hill with clutch down -> rolls back.
const roll = drive(MOMENTS[4], t => ({ steer: 0, throttle: 0, brake: t < 0.5 ? 0.5 : 0, clutch: 1 }), 6);
console.log(roll.report && roll.report.stats.rollback > 0.3 ? `PASS  hill-release -> ${roll.report.headline}` : 'FAIL  hill-release no rollback');
if (!(roll.report && roll.report.stats.rollback > 0.3)) failed++;

// Bad driver: stop line, braking without the clutch -> stall while slowing.
const noClutch = drive(MOMENTS[1], (t, sim) => ({ steer: 0, throttle: 0, brake: sim.proj.s > 80 ? 0.25 : 0, clutch: 0 }), 30);
const s2 = noClutch.ins.events.find(e => e.type === 'stall');
console.log(s2 ? `PASS  no-clutch-stop -> "${s2.title}"` : 'FAIL  no-clutch-stop did not stall');
if (!s2 || s2.title !== 'Stalled while slowing down') failed++;

// Automatic, hill: lift off the brake and hesitate before the gas -> rolls back.
const slow = drive(lessons('auto')[4], t => ({ steer: 0, throttle: t > 2.5 ? 0.4 : 0, brake: t < 0.5 ? 0.5 : 0, clutch: 0 }), 12);
const rb = slow.ins.stats.rollback;
console.log(rb > 0.3 ? `PASS  auto-hill-hesitate -> rolled back ${(rb * 100).toFixed(0)} cm` : `FAIL  auto-hill-hesitate rolled back only ${(rb * 100).toFixed(0)} cm`);
if (!(rb > 0.3)) failed++;
// Automatic never stalls, even braking to a stop with no clutch.
const st = drive(lessons('auto')[1], (t, sim) => ({ steer: 0, throttle: 0, brake: sim.proj.s > 80 ? 0.25 : 0, clutch: 0 }), 30);
console.log(st.ins.stats.stalls === 0 ? 'PASS  auto-stop -> no stall' : 'FAIL  auto stalled');
if (st.ins.stats.stalls) failed++;

// Session log: frames, findings and reps line up, and slices/summaries work.
{
  const { createSession } = await import('../src/session.js');
  const S = createSession({ lesson: 'moving-off', gearbox: 'manual', kind: 'test' });
  // run 1: a clutch dump (stall), run 2: the good run
  for (const fn of [t => ({ steer: 0, throttle: 0, brake: 0, clutch: t < 0.5 ? 1 : 0 }), null]) {
    const m = MOMENTS[0];
    const sim = createSim(m);
    S.beginRun(sim, 'test');
    const ctx = {};
    while (!sim.ended && sim.t < (fn ? 4 : 40)) { stepSim(sim, fn ? fn(sim.t) : m.expert(sim, ctx, DT)); if (sim.step % 16 === 0) S.sync(sim); }
    S.sync(sim);
    S.endRun(sim.report || { passed: false, completed: false, criteria: [], stats: sim.ins.stats });
  }
  const stall = S.events.find(e => e.type === 'stall');
  const around = stall && S.around(stall, 1, 0.2, ['T', 'clu', 'rpm']);
  const sum = S.summary();
  const ok = S.runs.length === 2 && S.runs[1].frameStart === S.runs[0].frameEnd
    && stall && S.frames.T[stall.frame] === stall.T && around.T.length > 30 && around.rpm.at(-1) === 0
    && S.frames.T.every((T, i) => i === 0 || T > S.frames.T[i - 1]) && JSON.stringify(sum).length < 20000;
  console.log(ok ? `PASS  session -> ${S.length()} frames, ${S.runs.length} runs, ${S.events.length} findings, summary ${JSON.stringify(sum).length} bytes`
    : 'FAIL  session log inconsistent');
  if (!ok) failed++;
}

// Registries: every id a moment names must exist, and frames must match the telemetry schema.
{
  const { FREE, forTransmission, practiceOf } = await import('../src/moments.js');
  const { DETECTOR } = await import('../src/detectors.js');
  const { ZONES } = await import('../src/zones.js');
  const { AIDS } = await import('../src/aids.js');
  const { MODES } = await import('../src/modes.js');
  const { SEGMENTERS } = await import('../src/practice.js');
  const { FRAME } = await import('../src/telemetry.js');
  const bad = [];
  for (const m of [...lessons('manual'), ...lessons('auto'), forTransmission(FREE, 'manual'), forTransmission(FREE, 'auto')]) {
    for (const id of m.detect || []) if (!DETECTOR[id]) bad.push(`${m.id}: detector "${id}"`);
    for (const z of m.zones || []) if (!ZONES[z.type]) bad.push(`${m.id}: zone "${z.type}"`);
    if (m.target && !AIDS[m.target.kind]) bad.push(`${m.id}: target kind "${m.target.kind}"`);
    for (const id of m.modes || []) if (!MODES[id]) bad.push(`${m.id}: mode "${id}"`);
    if (m.practice?.segment && !SEGMENTERS[m.practice.segment]) bad.push(`${m.id}: segment "${m.practice.segment}"`);
    if (practiceOf(m).transmission !== m.transmission) bad.push(`${m.id}: practice version has the wrong gearbox`);
  }
  const { snap, ...f } = createSim(MOMENTS[0]).frames[0];
  const keys = Object.keys(f).sort().join(), schema = Object.keys(FRAME).sort().join();
  if (keys !== schema) bad.push(`frame fields [${keys}] differ from telemetry.js [${schema}]`);
  console.log(bad.length ? `FAIL  registries:\n        ${bad.join('\n        ')}` : 'PASS  registries -> every detector, zone, aid, mode and segmenter named by a moment exists; frames match telemetry.js');
  if (bad.length) failed++;
}

console.log(failed ? `\n${failed} failing` : '\nall good');
process.exit(failed ? 1 : 0);
