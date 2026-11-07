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

console.log(failed ? `\n${failed} failing` : '\nall good');
process.exit(failed ? 1 : 0);
