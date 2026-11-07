// Driving School M0: brief -> (demo) -> get set -> drive with assist -> debrief playback -> retry.
import { MOMENTS, lessons, practiceOf, practiceMins } from './moments.js';
import { createSim, stepSim, shiftGear, runReference, roadOf, DT, FRAME_DT } from './sim.js';
import { pointAt, LANE_CENTER } from './road.js';
import { CAR } from './physics.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createChart } from './chart.js';
import { loadProgress, recordAttempt, recordPractice, resetProgress, loadSettings, saveSettings } from './progress.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kmh = v => Math.round(Math.abs(v) * 3.6);

const input = createInput();
const audio = createAudio();
const view = createRenderer($('#view'));
const settings = loadSettings();
audio.voice = settings.voice;
audio.sound = settings.sound;
let progress = loadProgress();

// The ladder for the chosen gearbox (manual or automatic).
const LESSONS = () => lessons(settings.transmission);

const refs = new Map();
function refOf(m) {
  const key = m.id + (m.continuous ? '#practice' : '');
  if (!refs.has(key)) refs.set(key, runReference(m));
  return refs.get(key);
}
// Assist level in force: a practice session adapts it rep by rep; otherwise the learner's setting.
const assist = () => (app.practice ? app.practice.assist : settings.assist);

const app = {
  mode: 'setup', moment: null, sim: null, ref: null, clock: 0,
  acc: 0, cueTimer: 0, banner: 0, poseHeld: 0, countdown: null, snap: null,
  demoI: 0, demoLog: 0, play: 0, playing: false, speed: 1, playUntil: null, wiz: null,
};

// ---------------------------------------------------------------- screens
function show(name) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
  $('#scrim').classList.toggle('on', ['setup', 'ladder', 'brief'].includes(name));
}
function hud(on, opts = {}) {
  $('#hud').hidden = !on;
  $('#getset').hidden = !opts.getset;
  $('#banner').hidden = true;
  $('#stall').hidden = true;
  $('#hud-hint').textContent = opts.hint ?? (app.practice ? 'Esc finish' : input.mode === 'wheel' ? '✕ retry · Esc exit' : 'R retry · Esc exit');
  $('#pbar').hidden = !app.practice;
}
function nextUp() {
  return LESSONS().find(m => !progress[m.id]?.passed) || LESSONS()[LESSONS().length - 1];
}

// ---------------------------------------------------------------- setup
function openSetup() {
  app.mode = 'setup';
  show('setup');
  hud(false);
  $('#wizard').hidden = true;
  $('#setup-actions').hidden = false;
  const m = nextUp();
  view.setMoment(m, roadOf(m));
  app.orbit = pointAt(roadOf(m), m.start.s, LANE_CENTER);
  app.orbitCar = refOf(m).frames[0];
}
$('#setup-go').onclick = () => { audio.unlock(); openLadder(); };
$('#setup-kb').onclick = () => { audio.unlock(); input.mode = 'keyboard'; openLadder(); };
$('#setup-cal').onclick = () => startWizard();
$('#setup-flip').onclick = () => { input.flipPedals(); $('#setup-note').textContent = 'Pedals flipped and saved. Released should read 0, pressed should fill the bar.'; };

function updateSetup() {
  const pad = input.getPad();
  const inp = app.lastInput;
  $('#setup-status').textContent = pad
    ? `Found: ${pad.id.replace(/\(.*?\)/g, '').trim() || 'wheel'}. ${input.custom ? 'Using your calibration.' : 'Using G29 defaults.'}`
    : 'Press any button on your wheel so the browser can see it. No wheel? Use the keyboard.';
  if (inp) {
    $('#lv-steer').style.left = `${50 + inp.steer * 50}%`;
    $('#lv-clu').style.width = `${inp.clutch * 100}%`;
    $('#lv-brk').style.width = `${inp.brake * 100}%`;
    $('#lv-thr').style.width = `${inp.throttle * 100}%`;
    // Nobody rests on gas and brake together: both near full means the pedals read upside down.
    app.flipT = inp.throttle > 0.9 && inp.brake > 0.9 ? (app.flipT || 0) + 1 : 0;
    $('#setup-warn').hidden = !(app.flipT > 30);
    if (inp.ev.shift) $('#lv-gear').textContent = inp.ev.shift > 0 ? 'gear up ✓' : 'gear down ✓';
  }
}

// Calibration: watch raw axes/buttons and pick out whatever the learner moves.
const WIZ = [
  { key: 'steer', title: 'Turn the wheel a quarter turn to the right', hint: 'Start with the wheel centred and your feet off the pedals.' },
  { key: 'thr', title: 'Press the gas pedal all the way down, then let go', hint: 'Right pedal.' },
  { key: 'brk', title: 'Press the brake hard, then let go', hint: 'Middle pedal.' },
  { key: 'clu', title: 'Press the clutch all the way down, then let go', hint: 'Left pedal.', skip: true },
  { key: 'up', title: 'Pull the paddle you want for gear up', hint: 'Usually the right paddle.' },
  { key: 'down', title: 'Pull the paddle you want for gear down', hint: 'Usually the left paddle.' },
  { key: 'ok', title: 'Press the button you want for OK and Retry', hint: 'For example ✕. You will use it to start and retry without letting go of the wheel.', skip: true },
];
function startWizard() {
  if (!input.getPad()) { $('#setup-status').textContent = 'Press any button on your wheel first, then try again.'; return; }
  app.wiz = { i: 0, map: { ok: [] }, used: new Set() };
  $('#wizard').hidden = false;
  $('#setup-actions').hidden = true;
  wizStep();
}
function wizStep() {
  const w = app.wiz, st = WIZ[w.i];
  w.base = input.rawAxes();
  w.min = [...w.base]; w.max = [...w.base];
  w.btn = input.rawButtons();
  w.hold = 0;
  $('#wiz-step').textContent = `Step ${w.i + 1} of ${WIZ.length}`;
  $('#wiz-title').textContent = st.title;
  $('#wiz-hint').textContent = st.hint;
  $('#wiz-skip').hidden = !st.skip;
}
function wizNext(result) {
  const w = app.wiz, st = WIZ[w.i];
  if (st.key === 'ok') w.map.ok = result === null ? [0, 1, 2, 3] : [result];
  else w.map[st.key] = result;
  w.i++;
  if (w.i >= WIZ.length) {
    input.useMapping(w.map);
    app.wiz = null;
    $('#wizard').hidden = true;
    $('#setup-actions').hidden = false;
    $('#setup-note').textContent = 'Saved. Check the bars follow your wheel and pedals.';
    return;
  }
  wizStep();
}
$('#wiz-skip').onclick = () => wizNext(null);
$('#wiz-cancel').onclick = () => { app.wiz = null; $('#wizard').hidden = true; $('#setup-actions').hidden = false; };

function tickWizard(dt) {
  const w = app.wiz;
  if (!w) return;
  const st = WIZ[w.i];
  const ax = input.rawAxes(), bt = input.rawButtons();
  if (st.key === 'up' || st.key === 'down' || st.key === 'ok') {
    const i = bt.findIndex((b, k) => b && !w.btn[k] && !(st.key !== 'ok' && w.used.has('b' + k)));
    w.btn = bt;
    if (i >= 0) { w.used.add('b' + i); wizNext(i); }
    return;
  }
  ax.forEach((v, i) => { w.min[i] = Math.min(w.min[i], v); w.max[i] = Math.max(w.max[i], v); });
  const free = ax.map((_, i) => i).filter(i => !w.used.has('a' + i));
  if (st.key === 'steer') {
    const i = free.reduce((b, i) => (Math.abs(ax[i] - w.base[i]) > Math.abs((ax[b] ?? 0) - (w.base[b] ?? 0)) ? i : b), free[0]);
    if (Math.abs(ax[i] - w.base[i]) > 0.25) {
      w.used.add('a' + i);
      wizNext({ axis: i, center: w.base[i], sign: Math.sign(ax[i] - w.base[i]) });
    }
    return;
  }
  // pedal: the axis with the largest travel that has come back to rest
  const i = free.reduce((b, i) => (w.max[i] - w.min[i] > w.max[b] - w.min[b] ? i : b), free[0]);
  const range = w.max[i] - w.min[i];
  const atMax = Math.abs(ax[i] - w.max[i]) < 0.08, atMin = Math.abs(ax[i] - w.min[i]) < 0.08;
  if (range > 0.8 && (atMax || atMin)) {
    w.hold += dt;
    if (w.hold > 0.5) {
      const rest = atMax ? w.max[i] : w.min[i];
      let full = atMax ? w.min[i] : w.max[i];
      if (st.key === 'brk') full = rest + (full - rest) * 0.85; // hard press = full braking
      w.used.add('a' + i);
      wizNext({ axis: i, rest, full });
    }
  } else w.hold = 0;
}

// ---------------------------------------------------------------- ladder
function openLadder() {
  app.mode = 'ladder';
  audio.hush();
  show('ladder');
  hud(false);
  const nu = nextUp();
  view.setMoment(nu, roadOf(nu));
  app.orbit = pointAt(roadOf(nu), nu.start.s, LANE_CENTER);
  app.orbitCar = refOf(nu).frames[0];
  $('#ladder-wheel').textContent = input.mode === 'wheel' ? 'Wheel ✓ · setup' : 'Keyboard · wheel setup';
  $('#ladder-gearbox').textContent = settings.transmission === 'auto' ? 'Gearbox: automatic' : 'Gearbox: manual';
  const ol = $('#ladder');
  ol.innerHTML = '';
  LESSONS().forEach((m, i) => {
    const p = progress[m.id];
    const prevPassed = i === 0 || progress[LESSONS()[i - 1].id]?.passed;
    const li = document.createElement('li');
    li.className = 'rung' + (p?.passed ? ' passed' : '') + (m === nu && !p?.passed ? ' next' : '') + (!prevPassed && !p?.passed ? ' locked' : '');
    const prac = p?.practice ? ` · ${p.practice.reps} reps` : '';
    const status = (p?.passed ? (p.passedNoAssist ? 'Mastered ★' : 'Passed ✓') : m === nu ? 'Next up' : !prevPassed ? 'Later' : p ? 'In progress' : 'Ready') + prac;
    li.innerHTML = `<div class="num">${p?.passed ? '✓' : m.n}</div><div><div class="t"></div><div class="s"></div></div><div class="st">${status}</div>`;
    li.querySelector('.t').textContent = m.title;
    li.querySelector('.s').textContent = m.skill;
    li.onclick = () => { audio.unlock(); openBrief(m); };
    ol.appendChild(li);
  });
}
$('#ladder-wheel').onclick = () => openSetup();
$('#ladder-gearbox').onclick = () => {
  settings.transmission = settings.transmission === 'auto' ? 'manual' : 'auto';
  saveSettings(settings);
  openLadder();
};
$('#ladder-reset').onclick = () => { if (confirm('Clear all lesson progress?')) { progress = resetProgress(); openLadder(); } };

// ---------------------------------------------------------------- brief
function openBrief(m) {
  app.mode = 'brief';
  app.practice = null;
  app.moment = m;
  app.ref = refOf(m);
  view.setMoment(m, roadOf(m));
  app.orbit = pointAt(roadOf(m), m.start.s, LANE_CENTER);
  app.orbitCar = app.ref.frames[0];
  show('brief');
  hud(false);
  $('#brief-eyebrow').textContent = `Moment ${m.n} of ${LESSONS().length} · ${m.skill}${m.transmission === 'auto' ? ' · automatic' : ''}`;
  $('#brief-title').textContent = m.title;
  $('#brief-why').textContent = m.why;
  $('#brief-goal').textContent = m.goal;
  $('#brief-steps').innerHTML = '';
  for (const s of m.steps) { const li = document.createElement('li'); li.textContent = s; $('#brief-steps').appendChild(li); }
  $('#brief-pass').innerHTML = '';
  for (const c of m.criteria) { const li = document.createElement('li'); li.textContent = c.label; $('#brief-pass').appendChild(li); }
  $('#brief-practice').textContent = `Practise · ${practiceMins(m)} min →`;
  audio.say(`${m.title}. ${m.goal}`);
}
$('#brief-demo').onclick = () => startDemo();
$('#brief-drive').onclick = () => { app.practice = null; startGetset(); };
$('#brief-practice').onclick = () => startPractice();
$('#brief-back').onclick = () => openLadder();

// ---------------------------------------------------------------- demo (pre-viz)
function startDemo() {
  audio.unlock();
  app.mode = 'demo';
  app.ref = refOf(app.moment);
  app.play = 0;
  app.demoLog = 0;
  show(null);
  hud(true, { hint: 'Enter / ✕ skip demo' });
  setHudText('Demo · watch the ghost pedals');
  renderSteps(null);
  setAssistUI(true);
  showCue('Watch the pedals, bottom right.', false, 2.5);
}

function tickDemo(dt) {
  const ref = app.ref.frames;
  app.play += dt / FRAME_DT;
  const i = Math.min(ref.length - 1, Math.floor(app.play));
  const f = ref[i];
  const log = app.ref.log;
  while (app.demoLog < log.length && log[app.demoLog].t <= f.t) {
    const say = app.moment.demo?.[log[app.demoLog].mode];
    if (say) { showCue(say, false, 3.2); audio.say(say); }
    app.demoLog++;
  }
  updateHud(f, { clu: f.clu, brk: f.brk, thr: f.thr }, true);
  audio.engine(f.rpm, f.thr);
  app.viewState = { car: f, ghost: null, leadS: f.leadS, leadBraking: f.leadV < 0.3, cam: 'chase', assist: true, stopMark: stopMarkFor(f) };
  if (i >= ref.length - 1) {
    app.play += 0; // hold the last frame briefly
    app.demoEnd = (app.demoEnd || 0) + dt;
    if (app.demoEnd > 1.2) { app.demoEnd = 0; audio.engine(0); openBrief(app.moment); }
  }
}

// ---------------------------------------------------------------- get set
function startGetset(snap = null) {
  audio.unlock();
  audio.hush();
  const m = app.moment;
  app.ref = refOf(m);
  app.sim = createSim(m, snap);
  app.snap = snap;
  app.mode = 'getset';
  app.poseHeld = 0;
  app.countdown = null;
  app.acc = 0;
  show(null);
  hud(true, { getset: true });
  setHudText(snap ? 'Practice from here' : m.goal);
  const P = app.practice;
  setAssistUI(assist() === 'full');
  // In practice the step list helps for the first couple of reps, then gets out of the way.
  renderSteps(snap || (P && P.reps.length >= 2) ? null : m.live);
  $('#getset-warn').hidden = true;
  const pose = !snap && m.pose;
  $('#getset-title').textContent = snap ? 'Practice this bit' : P ? `Rep ${P.reps.length + 1}` : 'Get set';
  $('#pose').innerHTML = '';
  if (pose) {
    for (const p of pose) { const li = document.createElement('li'); li.textContent = p.label; li.dataset.p = p.pedal; $('#pose').appendChild(li); }
    $('#getset-hint').textContent = m.steps[0];
  } else {
    app.countdown = P && P.reps.length ? 1.5 : 3;
    $('#getset-hint').textContent = snap ? 'Put your feet where the ghost markers show. Starting in…' : `Rolling start at ${kmh(app.sim.car.v)} km/h. ${m.steps[0]}`;
  }
}

function tickGetset(dt, inp) {
  const sim = app.sim, m = app.moment;
  const f = sim.frames[sim.frames.length - 1];
  const pose = !app.snap && m.pose;
  if (pose) {
    const vals = { clu: inp.clutch, brk: inp.brake, thr: inp.throttle };
    let all = true;
    $('#pose').querySelectorAll('li').forEach((li, k) => {
      const ok = vals[pose[k].pedal] >= pose[k].min;
      li.classList.toggle('ok', ok);
      all = all && ok;
    });
    app.poseHeld = all ? app.poseHeld + dt : 0;
    const needed = new Set(pose.map(p => p.pedal));
    const wrong = Object.keys(vals).find(k => !needed.has(k) && vals[k] > 0.3);
    const warn = $('#getset-warn');
    warn.hidden = !wrong;
    if (wrong) warn.textContent = `That's the ${PEDAL_NAME[wrong]}. You need: ${pose.map(p => p.label).join(' and ')}.`;
    if (vals.thr > 0.9 && vals.brk > 0.9) {
      warn.hidden = false;
      warn.textContent = 'Gas and brake both read full. Your pedals look reversed: press Esc, open wheel setup and click Flip pedals.';
    }
    if (app.poseHeld > 0.5) beginDrive();
  } else {
    app.countdown -= dt;
    $('#getset-title').textContent = app.countdown > 0 ? String(Math.ceil(app.countdown)) : 'Go';
    if (app.countdown <= 0) beginDrive();
  }
  const si = app.snap?.input;
  const ghostPed = si ? { clu: si.clutch, brk: si.brake, thr: si.throttle } : null;
  updateHud({ ...f, thr: inp.throttle, brk: inp.brake, clu: inp.clutch }, ghostPed, assist() === 'full' || !!app.snap);
  audio.engine(f.rpm, inp.throttle);
  app.viewState = driveView(f);
}

function beginDrive() {
  app.mode = 'drive';
  app.acc = 0;
  $('#getset').hidden = true;
  flash('Go', 'go', 0.7);
  const first = app.steps?.[0];
  const quiet = app.practice && app.practice.reps.length > 0;
  if (!app.snap && !quiet) audio.say(first?.say || first?.text || 'Go.');
}

// Live step list: the instructor walks the learner through the moment, one step at a time.
const PEDAL_NAME = { clu: 'clutch (left pedal)', brk: 'brake (middle pedal)', thr: 'gas (right pedal)' };
function renderSteps(live) {
  app.steps = live || null;
  app.stepI = 0;
  const ol = $('#hud-steps');
  ol.innerHTML = '';
  ol.hidden = !live;
  for (const st of live || []) { const li = document.createElement('li'); li.textContent = st.text; ol.appendChild(li); }
  markSteps();
}
function markSteps() {
  $('#hud-steps').querySelectorAll('li').forEach((li, i) => {
    li.className = i < app.stepI ? 'done' : i === app.stepI ? 'now' : '';
  });
}
function advanceSteps(f) {
  const steps = app.steps;
  if (!steps || app.stepI >= steps.length - 1) return;
  if (steps[app.stepI].done(f, app.sim)) {
    app.stepI++;
    markSteps();
    const next = steps[app.stepI];
    if (assist() !== 'off' && next.say) { showCue(next.say, false, 2.8); audio.say(next.say, false); }
  }
}

// ---------------------------------------------------------------- drive
function refIndexTime(t) {
  return clamp(Math.round(t / FRAME_DT), 0, app.ref.frames.length - 1);
}
function refIndexDist(s) {
  const r = app.ref.frames;
  let lo = 0, hi = r.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (r[mid].s < s) lo = mid + 1; else hi = mid; }
  return lo;
}
function ghostPedalsFor(f) {
  const r = app.ref.frames;
  const i = app.moment.align === 'distance' ? refIndexDist(f.s) : refIndexTime(f.t);
  return { clu: r[i].clu, brk: r[i].brk, thr: r[i].thr };
}
function driveView(f) {
  const showGhost = assist() === 'full';
  const g = showGhost ? app.ref.frames[refIndexTime(f.t)] : null;
  return { car: f, ghost: g, leadS: f.leadS, leadBraking: f.leadV !== null && f.leadV < 0.4, cam: settings.camera, assist: showGhost, stopMark: showGhost ? stopMarkFor(f) : null };
}

// Where will the car stop? Before braking: if you braked gently now. While braking: at your current braking.
const COMFORT = 1.5; // m/s², the same gentle braking the BRAKE mark is placed for
function stopMarkFor(f) {
  const T = app.moment?.target;
  if (!T || T.kind !== 'stop') return null;
  const nose = f.s + CAR.length / 2;
  const rem = T.s - nose;
  if (f.v < 0.3 || rem < -3 || rem > 90) return null;
  const decel = -f.a;
  const braking = f.brk > 0.05 && decel > 0.4;
  const at = nose + (f.v * f.v) / (2 * (braking ? decel : COMFORT));
  if (!braking) {
    const late = at >= T.s - 0.5;
    return { s: at, color: late ? 0xf5b942 : 0x37d6c8, label: late ? 'Brake now!' : 'if you brake now' };
  }
  if (at > T.s + 0.3) return { s: at, color: 0xff6b6b, label: 'Over the line: brake more' };
  if (T.s - at > 3) return { s: at, color: 0xf5b942, label: 'Short: ease off a little' };
  return { s: at, color: 0x3ee08f, label: "You'll stop here ✓" };
}

function tickDrive(dt, inp) {
  const sim = app.sim;
  if (inp.ev.shift) {
    sim.input = { ...sim.input, clutch: inp.clutch };
    if (shiftGear(sim, inp.ev.shift)) flashGear();
  }
  app.acc += dt;
  let n = 0;
  const controls = { steer: inp.steer, throttle: inp.throttle, brake: inp.brake, clutch: inp.clutch };
  while (app.acc >= DT && !sim.ended && n < 400) { stepSim(sim, controls); app.acc -= DT; n++; }
  while (sim.cues.length) {
    const c = sim.cues.shift();
    if (assist() !== 'off') { showCue(c.text, c.priority, 2.8); audio.say(c.text, c.priority); }
  }
  const f = sim.frames[sim.frames.length - 1];
  advanceSteps(f);
  if (app.practice) {
    updatePracticeBar();
    if (app.practice.continuous) {
      segmentReps(f);
      if (app.clock >= app.practice.endsAt) return endPractice();
    }
  }
  updateHud(f, assist() === 'full' ? ghostPedalsFor(f) : null, assist() === 'full');
  $('#stall').hidden = f.running;
  audio.engine(f.rpm, inp.throttle);
  app.viewState = driveView(f);
  if (sim.ended && app.practice) {
    if (app.practice.continuous) return endPractice();
    repDone(repFromReport(sim.report));
    app.mode = 'repgap';
    app.gapT = 0;
    return;
  }
  if (sim.ended) {
    app.mode = 'ending';
    app.endT = 0;
    const r = sim.report;
    flash(r.passed ? 'Passed' : (r.completed ? 'Not quite' : sim.ended.reason), r.passed ? 'pass' : 'fail', 1.6);
  }
}

// ---------------------------------------------------------------- practice
// A practice session is many reps of one moment. No menus between reps: a one-line note, then go again.
function startPractice() {
  audio.unlock();
  const base = app.moment;
  const m = practiceOf(base);
  app.practice = {
    base, continuous: !!m.continuous, assist: settings.assist,
    reps: [], streak: 0, fails: 0, bestStreak: 0, offStreak: 0, bestStreakNoAssist: 0,
    startedAt: app.clock, endsAt: app.clock + practiceMins(base) * 60, phase: 'wait', stillT: 0,
  };
  app.moment = m;
  startGetset();
}

function repFromReport(r) {
  const checks = r.criteria.map(c => ({ id: c.id, label: c.label, ok: c.ok, tip: c.tip }));
  if (!r.completed) checks.push({ id: 'finish', label: 'Finished the moment', ok: false, tip: r.tip });
  return { clean: r.passed, checks, tip: r.tip };
}

// Continuous traffic: a rep runs from the auto moving off until you are stopped behind it again.
function segmentReps(f) {
  const P = app.practice, sim = app.sim, i = sim.frames.length - 1;
  if (P.phase === 'wait') {
    if (f.leadV > 0.3) { P.phase = 'rep'; P.from = i; P.t0 = f.t; }
  } else if (P.phase === 'rep') {
    if (sim.lead.v === 0) { P.phase = 'settle'; P.stillT = 0; }
  } else if (P.phase === 'settle') {
    P.stillT = f.v === 0 ? P.stillT + 1 / 60 : 0;
    if (P.stillT > 0.6 || f.leadV > 0.3) {
      closeRep(P.from, i, P.t0);
      if (f.leadV > 0.3) { P.phase = 'rep'; P.from = i; P.t0 = f.t; } else P.phase = 'wait';
    }
  }
}
function closeRep(a, b, t0) {
  const frames = app.sim.frames;
  const R = { stalls: 0, minGap: Infinity, crash: false, maxAccel: 0, reaction: Infinity };
  for (let k = a; k <= b; k++) {
    const f = frames[k];
    if (k > a && frames[k - 1].running && !f.running) R.stalls++;
    if (f.gap !== null) { R.minGap = Math.min(R.minGap, f.gap); if (f.gap <= 0.05) R.crash = true; }
    if (f.t - t0 > 0.3) R.maxAccel = Math.max(R.maxAccel, f.a);
    if (R.reaction === Infinity && f.v > 0.3) R.reaction = f.t - t0;
  }
  const m = app.moment, auto = m.transmission === 'auto';
  const checks = m.repChecks.filter(c => !(auto && c.manual))
    .map(c => ({ id: c.id, label: c.label, ok: !!c.test(R), tip: auto && c.autoTip ? c.autoTip : c.tip }));
  repDone({ clean: checks.every(c => c.ok), checks, R });
}

const ORDER = ['full', 'cues', 'off'];
function repDone(rep) {
  const P = app.practice;
  const prev = P.reps[P.reps.length - 1];
  P.reps.push({ ...rep, assist: P.assist });
  let line;
  if (rep.clean) {
    P.streak++; P.fails = 0;
    P.bestStreak = Math.max(P.bestStreak, P.streak);
    P.offStreak = P.assist === 'off' ? P.offStreak + 1 : 0;
    P.bestStreakNoAssist = Math.max(P.bestStreakNoAssist, P.offStreak);
    line = P.streak >= 3 ? `Clean again. ${P.streak} in a row.` : prev && !prev.clean ? 'Better! That one was clean.' : 'Clean. Again.';
    // Three clean in a row: take some help away.
    if (P.streak % 3 === 0 && P.assist !== 'off') {
      P.assist = ORDER[ORDER.indexOf(P.assist) + 1];
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
    if (P.fails >= 2 && P.assist !== 'full') {
      P.assist = ORDER[ORDER.indexOf(P.assist) - 1];
      P.fails = 0;
      line += ' Help is back on.';
    }
  }
  setAssistUI(assist() === 'full');
  syncChips();
  showCue(line, !rep.clean, 3.2);
  audio.say(line);
  updatePracticeBar();
}

function updatePracticeBar() {
  const P = app.practice;
  $('#pbar').hidden = !P;
  if (!P) return;
  const left = Math.max(0, P.endsAt - app.clock);
  $('#p-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left`;
  $('#p-rep').textContent = `${P.reps.length} reps · ${P.reps.filter(r => r.clean).length} clean`;
  const dots = $('#p-dots');
  const shown = P.reps.slice(-16);
  if (dots.childElementCount !== shown.length || P.reps.length > 16) {
    dots.innerHTML = shown.map(r => `<i class="${r.clean ? 'ok' : 'no'}"></i>`).join('');
  }
}

function tickRepGap(dt) {
  app.gapT += dt;
  const f = app.sim.frames[app.sim.frames.length - 1];
  audio.engine(f.rpm, 0);
  app.viewState = driveView(f);
  updatePracticeBar();
  if (app.gapT > 2.2) {
    if (app.clock >= app.practice.endsAt) endPractice();
    else startGetset();
  }
}

function endPractice() {
  const P = app.practice;
  audio.engine(0);
  audio.hush();
  app.practice = null;
  app.moment = P.base;
  hud(false);
  progress = { ...progress };
  recordPractice(progress, P.base.id, P);
  app.mode = 'summary';
  show('summary');
  const n = P.reps.length, mins = Math.max(1, Math.round((app.clock - P.startedAt) / 60));
  $('#sum-title').textContent = `${mins} min of ${P.base.title.toLowerCase()}`;
  $('#sum-reps').textContent = n;
  $('#sum-clean').textContent = P.reps.filter(r => r.clean).length;
  $('#sum-streak').textContent = P.bestStreak;
  $('#sum-dots').innerHTML = P.reps.map(r => `<i class="${r.clean ? 'ok' : 'no'}" title="${r.clean ? 'clean' : r.checks.filter(c => !c.ok).map(c => c.label).join(', ')}"></i>`).join('') || '<span class="muted">No reps finished.</span>';
  // How each habit changed from the first half of the session to the second.
  const half = Math.floor(n / 2);
  const ids = [...new Set(P.reps.flatMap(r => r.checks.map(c => c.id)))];
  const missCount = (reps, id) => reps.filter(r => r.checks.some(c => c.id === id && !c.ok)).length;
  const lines = ids.map(id => {
    const label = P.reps.flatMap(r => r.checks).find(c => c.id === id).label;
    const a = missCount(P.reps.slice(0, half), id), b = missCount(P.reps.slice(half), id);
    return { label, a, b };
  }).filter(x => x.a + x.b > 0);
  $('#sum-trend').innerHTML = n < 4 ? '<li class="muted">Do a few more reps to see a trend.</li>'
    : lines.length ? lines.map(x => `<li class="${x.b < x.a ? 'up' : x.b > x.a ? 'down' : ''}"><span>${x.label}</span><b>${x.a} miss${x.a === 1 ? '' : 'es'} → ${x.b}</b><small>first half → second half</small></li>`).join('')
    : '<li class="up"><span>Everything</span><b>clean all session</b></li>';
  const late = P.reps.slice(half);
  const worst = lines.sort((x, y) => y.b - x.b)[0];
  const tip = worst && worst.b > 0 ? P.reps.flatMap(r => r.checks).find(c => c.label === worst.label && !c.ok)?.tip : null;
  $('#sum-next').textContent = tip || (late.length ? 'Clean at the end. Next time, start with assists off, or test yourself.' : 'Keep going: reps are how this gets easy.');
  audio.say(`${n} reps, ${P.reps.filter(r => r.clean).length} clean. ${$('#sum-next').textContent}`);
}
$('#sum-again').onclick = () => startPractice();
$('#sum-test').onclick = () => { app.practice = null; startGetset(); };
$('#sum-back').onclick = () => openLadder();

function tickEnding(dt) {
  app.endT += dt;
  const sim = app.sim;
  const f = sim.frames[sim.frames.length - 1];
  audio.engine(f.rpm * Math.max(0, 1 - app.endT), 0);
  app.viewState = driveView(f);
  if (app.endT > 1.5) openDebrief();
}

// ---------------------------------------------------------------- debrief
const chart = createChart($('#chart'), i => { app.play = i; app.playing = false; app.playUntil = null; syncPlay(); });

function openDebrief() {
  const sim = app.sim, m = app.moment, r = sim.report;
  app.mode = 'debrief';
  audio.engine(0);
  hud(false);
  show('debrief');
  progress = { ...progress };
  const p = recordAttempt(progress, m.id, r, settings.assist);
  const res = $('#db-result');
  res.className = 'result ' + (r.passed ? 'pass' : 'fail');
  res.innerHTML = (r.passed ? '✓ Passed' : '✗ Not yet') + (r.practice ? ' <span class="prac">· practice run</span>' : '') + (r.passed && settings.assist === 'off' ? ' <span class="prac">· no assists ★</span>' : '');
  $('#db-headline').textContent = r.headline;
  $('#db-tip').textContent = r.tip;
  const insight = m.insight ? m.insight(r.stats) : '';
  $('#db-insight').hidden = !insight;
  $('#db-insight').textContent = insight;
  const ul = $('#db-criteria');
  ul.innerHTML = '';
  for (const c of r.criteria) {
    const li = document.createElement('li');
    li.className = c.ok ? 'ok' : 'no';
    li.innerHTML = `<b>${c.ok ? '✓' : '✗'}</b><span></span><small></small>`;
    li.querySelector('span').textContent = c.label;
    li.querySelector('small').textContent = c.detail || '';
    ul.appendChild(li);
  }
  const evs = $('#db-events');
  evs.innerHTML = '';
  r.events.forEach(e => {
    const b = document.createElement('button');
    b.className = 'ev ' + e.severity;
    b.textContent = `${(e.t - sim.frames[0].t).toFixed(1)}s · ${e.title}`;
    b.onclick = () => replayEvent(e);
    evs.appendChild(b);
  });
  $('#lg-bite').hidden = m.transmission === 'auto';
  $('#db-next').hidden = !(r.passed && m.n < LESSONS().length);
  const T = m.target;
  const s0 = sim.frames[0].s, nose = CAR.length / 2;
  const marks = T && T.kind === 'stop' && m.align === 'distance' ? [
    { x: T.s - T.brakeAt - nose - s0, label: 'brake here', color: '#f5b942' },
    { x: T.s - nose - s0, label: 'line', color: '#e9edf2' },
  ] : [];
  chart.set({ frames: sim.frames, ref: app.ref.frames, align: m.align, events: r.events, playhead: 0, noClutch: m.transmission === 'auto', marks });
  app.speed = 1;
  $('#db-speed').textContent = '1×';
  const firstMajor = r.events.find(e => e.severity === 'major') || r.events[0];
  if (firstMajor && !r.passed) replayEvent(firstMajor);
  else { app.play = 0; app.playing = true; app.playUntil = null; }
  syncPlay();
  audio.say(`${r.headline} ${r.tip}`);
  void p;
}

// Jump to just before a mistake and play it in slow motion.
function replayEvent(e) {
  app.play = Math.max(0, e.frame - 150);
  app.playUntil = Math.min(app.sim.frames.length - 1, e.frame + 50);
  app.speed = 0.5;
  $('#db-speed').textContent = '½×';
  app.playing = true;
  syncPlay();
}
function syncPlay() { $('#db-play').textContent = app.playing ? '❚❚' : '▶'; }
$('#db-play').onclick = () => {
  if (!app.playing && app.play >= app.sim.frames.length - 1) app.play = 0;
  app.playing = !app.playing; app.playUntil = null; syncPlay();
};
$('#db-speed').onclick = () => { app.speed = app.speed === 1 ? 0.5 : 1; $('#db-speed').textContent = app.speed === 1 ? '1×' : '½×'; };
$('#db-retry').onclick = () => startGetset();
$('#db-here').onclick = () => {
  const f = app.sim.frames[Math.round(app.play)];
  startGetset(f.snap);
};
$('#db-next').onclick = () => openBrief(LESSONS()[app.moment.n]);
$('#db-demo').onclick = () => startDemo();
$('#db-back').onclick = () => openLadder();

function tickDebrief(dt) {
  const frames = app.sim.frames;
  if (app.playing) {
    app.play += dt * app.speed / FRAME_DT;
    if (app.playUntil !== null && app.play >= app.playUntil) { app.play = app.playUntil; app.playing = false; app.playUntil = null; syncPlay(); }
    if (app.play >= frames.length - 1) { app.play = frames.length - 1; app.playing = false; syncPlay(); }
  }
  const f = frames[Math.round(app.play)];
  chart.draw(app.play);
  audio.engine(app.playing ? f.rpm : 0, f.thr);
  app.viewState = { car: f, ghost: app.ref.frames[refIndexTime(f.t)], leadS: f.leadS, leadBraking: f.leadV !== null && f.leadV < 0.4, cam: 'chase', assist: true, shiftUp: 0.2, stopMark: stopMarkFor(f) };
}

// ---------------------------------------------------------------- HUD helpers
function setHudText(goal) {
  const m = app.moment;
  $('#hud-eyebrow').textContent = `Moment ${m.n} · ${m.skill}`;
  $('#hud-title').textContent = m.title;
  $('#hud-goal').textContent = goal;
  syncChips();
}
function setAssistUI(on) {
  $('#pedals').classList.toggle('assist', on);
  $('.pedal[data-p=clu]').hidden = app.moment?.transmission === 'auto';
}

const ASSIST_LABEL = { full: 'Assist: full', cues: 'Assist: voice only', off: 'Assist: off (test)' };
function syncChips() {
  $('#btn-assist').textContent = ASSIST_LABEL[assist()];
  $('#btn-assist').classList.toggle('on', assist() !== 'off');
  $('#btn-exit').textContent = app.practice ? 'Finish' : 'Exit';
  $('#btn-cam').textContent = settings.camera === 'cockpit' ? 'View: driver' : 'View: chase';
  $('#btn-voice').textContent = settings.voice ? 'Voice on' : 'Voice off';
  $('#btn-voice').classList.toggle('on', settings.voice);
  $('#btn-sound').textContent = settings.sound ? 'Sound on' : 'Sound off';
  $('#btn-sound').classList.toggle('on', settings.sound);
}
function cycleAssist() {
  const next = { full: 'cues', cues: 'off', off: 'full' }[assist()];
  if (app.practice) app.practice.assist = next;
  else { settings.assist = next; saveSettings(settings); }
  setAssistUI(next === 'full');
  syncChips();
  showCue(ASSIST_LABEL[next], false, 1.5);
}
function toggleCam() { settings.camera = settings.camera === 'cockpit' ? 'chase' : 'cockpit'; saveSettings(settings); syncChips(); }
function toggleVoice() { settings.voice = audio.voice = !settings.voice; if (!settings.voice) audio.hush(); saveSettings(settings); syncChips(); }
function toggleSound() { settings.sound = audio.sound = !settings.sound; saveSettings(settings); syncChips(); }
$('#btn-assist').onclick = cycleAssist;
$('#btn-cam').onclick = toggleCam;
$('#btn-voice').onclick = toggleVoice;
$('#btn-sound').onclick = toggleSound;
$('#btn-exit').onclick = () => exitToBrief();
function exitToBrief() {
  if (app.practice) return endPractice();
  audio.engine(0); audio.hush();
  app.moment ? openBrief(app.moment) : openLadder();
}

let cueHide = 0;
function showCue(text, warn, secs) {
  const el = $('#cue');
  el.textContent = text;
  el.classList.toggle('warn', !!warn);
  el.classList.add('show');
  cueHide = secs;
}
let bannerHide = 0;
function flash(text, kind, secs) {
  const el = $('#banner');
  el.hidden = false;
  el.className = 'banner ' + kind;
  el.textContent = text;
  bannerHide = secs;
}
let gearFlash = 0;
function flashGear() { gearFlash = 0.4; }

const pedEls = {};
document.querySelectorAll('.pedal').forEach(el => {
  pedEls[el.dataset.p] = { fill: el.querySelector('.fill'), ghost: el.querySelector('.gmark') };
});
function updateHud(f, ghost, assistOn) {
  $('#speed').textContent = kmh(f.v);
  const auto = app.moment?.transmission === 'auto';
  $('#gear').textContent = auto ? `D${f.gear}` : f.gear === 0 ? 'N' : String(f.gear);
  $('#gear').style.borderColor = gearFlash > 0 ? 'var(--ghost)' : '';
  $('#gear-hint').textContent = auto ? 'automatic' : input.mode === 'wheel' ? 'paddles' : 'E / Q';
  const T = app.moment?.target;
  const toGo = T ? T.s - (T.kind === 'stop' ? f.s + CAR.length / 2 : f.s) : null;
  const dist = $('#dist');
  dist.hidden = !(T && toGo > -1 && toGo < 150);
  if (!dist.hidden) {
    $('#dist-v').textContent = Math.max(0, Math.round(toGo));
    $('#dist-l').textContent = `m to ${T.label.toLowerCase()}`;
    dist.classList.toggle('soon', T.brakeAt !== undefined && toGo <= T.brakeAt + 2 && toGo > 0);
  }
  const rpm = f.running ? f.rpm : 0;
  const fill = $('#rpm-fill');
  fill.style.width = `${clamp(rpm / 6500, 0, 1) * 100}%`;
  fill.className = 'rpm-fill' + (!f.running ? ' off' : rpm < 700 ? ' low' : rpm > 3800 ? ' high' : '');
  $('#rpm').textContent = f.running ? Math.round(rpm / 10) * 10 : 'off';
  for (const k of ['clu', 'brk', 'thr']) {
    pedEls[k].fill.style.height = `${clamp(f[k], 0, 1) * 100}%`;
    if (ghost && assistOn) { pedEls[k].ghost.style.display = 'block'; pedEls[k].ghost.style.bottom = `${clamp(ghost[k], 0, 1) * 100}%`; }
    else pedEls[k].ghost.style.display = 'none';
  }
}

// ---------------------------------------------------------------- loop
addEventListener('pointerdown', () => audio.unlock());
// Buttons give focus back so Enter / the wheel's OK button never double-fires.
addEventListener('click', e => e.target.closest?.('button')?.blur());
addEventListener('keydown', e => {
  audio.unlock();
  if (e.target instanceof HTMLInputElement) return;
  if (!['getset', 'drive', 'demo', 'ending', 'repgap'].includes(app.mode)) return;
  if (e.code === 'KeyG') cycleAssist();
  if (e.code === 'KeyV' || e.code === 'KeyC') toggleCam();
  if (e.code === 'KeyN') toggleVoice();
  if (e.code === 'KeyM') toggleSound();
});

function handleEvents(ev) {
  if (ev.back) {
    if (['drive', 'getset', 'demo', 'ending', 'debrief', 'repgap'].includes(app.mode)) return exitToBrief();
    if (app.mode === 'summary') return openLadder();
    if (app.mode === 'brief') return openLadder();
  }
  switch (app.mode) {
    case 'ladder': if (ev.ok) openBrief(nextUp()); break;
    case 'brief': if (ev.ok) startPractice(); break;
    case 'summary': if (ev.ok) startPractice(); break;
    case 'demo': if (ev.ok) { audio.engine(0); startGetset(); } break;
    case 'drive': case 'getset': if (ev.retry && !app.practice?.continuous) startGetset(app.snap); break;
    case 'debrief': {
      if (ev.ok || ev.retry) { startGetset(); break; }
      const evs = app.sim.report.events;
      if (ev.next || ev.prev) {
        const cur = Math.round(app.play);
        const e = ev.next ? evs.find(x => x.frame - 150 > cur + 5) : [...evs].reverse().find(x => x.frame - 150 < cur - 5);
        if (e) replayEvent(e);
      }
      break;
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.clock += dt;
  const inp = input.poll(dt);
  app.lastInput = inp;
  if (app.mode !== 'setup') handleEvents(inp.ev);
  if (cueHide > 0 && (cueHide -= dt) <= 0) $('#cue').classList.remove('show');
  if (bannerHide > 0 && (bannerHide -= dt) <= 0) $('#banner').hidden = true;
  if (gearFlash > 0) gearFlash -= dt;

  app.viewState = null;
  switch (app.mode) {
    case 'setup': updateSetup(); tickWizard(dt); break;
    case 'demo': tickDemo(dt); break;
    case 'getset': tickGetset(dt, inp); break;
    case 'drive': tickDrive(dt, inp); break;
    case 'ending': tickEnding(dt); break;
    case 'repgap': tickRepGap(dt); break;
    case 'debrief': tickDebrief(dt); break;
    default: audio.engine(0);
  }
  view.render(app.viewState || { car: app.orbitCar || null, cam: 'orbit', orbitAt: app.orbit, t: app.clock });
  requestAnimationFrame(loop);
}

function onResize() { view.resize(); }
addEventListener('resize', onResize);
onResize();
openSetup();
requestAnimationFrame(loop);

// Debug handle for poking at state from the console.
window.ds = { app, MOMENTS: MOMENTS, settings, input, DT };
