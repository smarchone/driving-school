// Driving School M0: brief -> (demo) -> get set -> drive with assist -> debrief playback -> retry.
// This file is the app shell: screens, HUD, input and the frame loop. What differs between kinds of visit
// (test, practice, free drive) lives in modes.js; the rules in detectors.js; lessons in moments.js.
import { MOMENTS, FREE, forTransmission, lessons, practiceMins } from './moments.js';
import { createSim, stepSim, shiftGear, signal, runReference, roadOf, DT, FRAME_DT } from './sim.js';
import { pointAt, LANE_CENTER } from './road.js';
import { MODES } from './modes.js';
import { scoreRep } from './practice.js';
import { readout, roadMark, chartMarks, speedLimit, laneGauge, AIDS } from './aids.js';
import { DETECTORS } from './detectors.js';
import { ZONES } from './zones.js';
import { FRAME } from './telemetry.js';
import { createInput } from './input.js';
import { createRenderer, VARIANTS } from './render.js';
import { createAudio } from './audio.js';
import { createChart } from './chart.js';
import { createSession } from './session.js';
import { loadProgress, recordAttempt, recordPractice, resetProgress, loadSettings, saveSettings } from './progress.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const kmh = v => Math.round(Math.abs(v) * 3.6);

const input = createInput();
const audio = createAudio();
const settings = loadSettings();
const view = createRenderer($('#view'), settings.world);
audio.voice = settings.voice;
audio.sound = settings.sound;
audio.setVoice(settings.voiceName);
let progress = loadProgress();

// The ladder for the chosen gearbox (manual or automatic).
const LESSONS = () => lessons(settings.transmission);

const refs = new Map();
// Does the moment have a good run to compare against (ghost, ghost pedals, demo)?
const hasRef = m => m.reference !== false;
function refOf(m) {
  // No good run (free drive): just its first frame, so code that reads ref still works.
  if (!hasRef(m)) return { frames: [createSim(m).frames[0]], report: null, log: [] };
  const key = m.id + (m.continuous ? '#practice' : '');
  if (!refs.has(key)) refs.set(key, runReference(m));
  return refs.get(key);
}
// ---------------------------------------------------------------- session log
// Everything a lesson visit produces lands here: runs, reps, instructor findings, raw telemetry.
// It is the plug-in point for analysis and future LLM agents: window.ds.session.
let session = null;
const lessonId = m => (m.base || m).id.replace('@auto', '');
function newSession(kind) {
  const m = app.run?.base || app.moment;
  session = createSession({
    lesson: lessonId(m), lessonTitle: m.title, gearbox: m.transmission, kind,
    practiceMins: kind === 'practice' ? practiceMins(m) : null,
    input: input.mode === 'wheel' ? (input.getPad()?.id || 'wheel') : 'keyboard',
  });
  window.ds.session = session;
  return session;
}
function exportSession() {
  if (!session) return;
  const data = { ...session.toJSON(), summary: session.summary() };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `driving-school-${session.meta.lesson}-${session.meta.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Assist level in force: a practice session adapts it rep by rep; otherwise the learner's setting.
const freeLesson = () => forTransmission(FREE, settings.transmission);
const assist = () => app.run?.assist ?? settings.assist;
// The visit in progress ends with a summary (Finish), not a debrief.
const endsInSummary = () => app.run?.mode.ends === 'summary';

// app.mode is the screen; app.run is the visit in progress (see modes.js), null on the menus.
const app = {
  mode: 'setup', moment: null, sim: null, ref: null, clock: 0, run: null, lastMode: null, lastFrame: 0,
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
  $('#hud-hint').textContent = opts.hint ?? (endsInSummary() ? 'Esc finish' : input.mode === 'wheel' ? '✕ retry · Esc exit' : 'R retry · Esc exit');
  $('#pbar').hidden = !endsInSummary();
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
// Confirming the bars look right saves exactly what you checked, so next time there is nothing to redo.
$('#setup-go').onclick = () => {
  audio.unlock();
  if (input.getPad() && input.mode === 'wheel') input.save();
  openLadder();
};
$('#setup-kb').onclick = () => { audio.unlock(); input.mode = 'keyboard'; openLadder(); };
$('#setup-cal').onclick = () => startWizard();
const PEDAL_LABEL = { clu: 'Clutch', brk: 'Brake', thr: 'Gas' };
document.querySelectorAll('[data-flip]').forEach(b => {
  b.onclick = () => {
    const k = b.dataset.flip;
    input.flipPedal(k);
    app.pedalFull = {};
    $('#setup-note').textContent = `${PEDAL_LABEL[k]} reversed and saved. Released should be empty, pressed should fill the bar.`;
  };
});

function calibrationNote() {
  const when = input.mapping.savedAt ? ` (saved ${new Date(input.mapping.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})` : '';
  return input.custom ? `Using your saved calibration${when}.`
    : 'Not calibrated yet: press each pedal, check the bars, then continue to save.';
}

function updateSetup() {
  const pad = input.getPad();
  const inp = app.lastInput;
  $('#setup-status').textContent = pad
    ? `Found: ${pad.id.replace(/\(.*?\)/g, '').trim() || 'wheel'}. ${calibrationNote()}`
    : 'Press any button on your wheel so the browser can see it. No wheel? Use the keyboard.';
  if (inp) {
    $('#lv-steer').style.left = `${50 + inp.steer * 50}%`;
    $('#lv-clu').style.width = `${inp.clutch * 100}%`;
    $('#lv-brk').style.width = `${inp.brake * 100}%`;
    $('#lv-thr').style.width = `${inp.throttle * 100}%`;
    // A pedal sitting at full for a couple of seconds is almost certainly reading upside down.
    app.pedalFull = app.pedalFull || {};
    const vals = { clu: inp.clutch, brk: inp.brake, thr: inp.throttle };
    const suspects = [];
    for (const k of ['clu', 'brk', 'thr']) {
      app.pedalFull[k] = vals[k] > 0.95 ? (app.pedalFull[k] || 0) + 1 : 0;
      const sus = app.pedalFull[k] > 120;
      document.querySelector(`.live-row[data-p=${k}]`).classList.toggle('suspect', sus);
      if (sus) suspects.push(PEDAL_LABEL[k]);
    }
    $('#setup-warn').hidden = !suspects.length;
    if (suspects.length) $('#setup-warn-text').textContent = `${suspects.join(' and ')} ${suspects.length > 1 ? 'read' : 'reads'} full while not pressed? Click Reverse next to ${suspects.length > 1 ? 'each' : 'it'}.`;
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
    $('#setup-note').textContent = 'Saved. Check the bars follow your wheel and pedals.';
    app.wiz = null;
    $('#wizard').hidden = true;
    $('#setup-actions').hidden = false;
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
  $('#ladder-wheel').textContent = input.custom ? 'Wheel calibrated ✓ · setup' : input.mode === 'wheel' ? 'Wheel · setup' : 'Keyboard · wheel setup';
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
  // Free drive: always open, outside the ladder.
  const fm = freeLesson();
  const fp = progress[fm.id]?.free;
  const li = document.createElement('li');
  li.className = 'rung free';
  li.innerHTML = `<div class="num">∞</div><div><div class="t"></div><div class="s"></div></div><div class="st">${fp ? `${(fp.km || 0).toFixed(1)} km driven` : 'Open'}</div>`;
  li.querySelector('.t').textContent = fm.title;
  li.querySelector('.s').textContent = 'Just drive the town loop, at your own pace';
  li.onclick = () => { audio.unlock(); openBrief(fm); };
  ol.appendChild(li);
}
$('#ladder-wheel').onclick = () => openSetup();
// Instructor voice picker: the best-sounding voice is chosen by default; the learner can override it.
function fillVoices() {
  const sel = $('#ladder-voice');
  const vs = audio.voices();
  sel.hidden = !vs.length;
  const cur = audio.current();
  sel.innerHTML = '';
  for (const v of vs) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = 'Voice: ' + v.name.replace(/^(Microsoft|Google)\s+/, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/ - English.*$/, '').trim() + ` (${v.lang})`;
    o.selected = v.name === cur;
    sel.appendChild(o);
  }
}
audio.onvoices = fillVoices;
fillVoices();
$('#ladder-voice').onchange = e => {
  settings.voiceName = e.target.value;
  audio.setVoice(settings.voiceName);
  saveSettings(settings);
  audio.say('Hello. I will be your instructor today.');
};

$('#ladder-gearbox').onclick = () => {
  settings.transmission = settings.transmission === 'auto' ? 'manual' : 'auto';
  saveSettings(settings);
  openLadder();
};
$('#ladder-reset').onclick = () => { if (confirm('Clear all lesson progress?')) { progress = resetProgress(); openLadder(); } };

// ---------------------------------------------------------------- brief
function openBrief(m) {
  app.mode = 'brief';
  app.run = null;
  app.moment = m;
  app.ref = refOf(m);
  view.setMoment(m, roadOf(m));
  app.orbit = pointAt(roadOf(m), m.start.s, LANE_CENTER);
  app.orbitCar = app.ref.frames[0];
  show('brief');
  hud(false);
  const auto = m.transmission === 'auto';
  $('#brief-eyebrow').textContent = m.tag ? `${m.tag} · ${auto ? 'automatic' : 'manual'}` : `Moment ${m.n} of ${LESSONS().length} · ${m.skill}${auto ? ' · automatic' : ''}`;
  $('#brief-title').textContent = m.title;
  $('#brief-why').textContent = m.why;
  $('#brief-goal').textContent = m.goal;
  $('#brief-steps').innerHTML = '';
  for (const s of m.steps) { const li = document.createElement('li'); li.textContent = s; $('#brief-steps').appendChild(li); }
  // The main button starts the moment's first mode; "Test yourself" shows when it can also be tested.
  const primary = MODES[m.modes[0]];
  const pass = primary.briefPass(m);
  $('#brief-pass-h').textContent = pass.title;
  $('#brief-pass').innerHTML = '';
  for (const t of pass.items) { const li = document.createElement('li'); li.textContent = t; $('#brief-pass').appendChild(li); }
  $('#brief-practice').textContent = primary.button(m);
  $('#brief-demo').hidden = !hasRef(m);
  $('#brief-drive').hidden = primary.id === 'test' || !m.modes.includes('test');
  audio.say(`${m.title}. ${m.goal}`);
}
$('#brief-demo').onclick = () => startDemo();
$('#brief-drive').onclick = () => startMode('test');
$('#brief-practice').onclick = () => startMode(app.moment.modes[0]);
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
  app.viewState = { car: f, ghost: null, leadS: f.leadS, leadBraking: f.leadV < 0.3, cam: 'chase', assist: true, stopMark: roadMark(app.moment, f) };
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
  // Driving straight from the demo or a debrief, with no visit started: a test run.
  app.run ??= MODES.test.start(m);
  const R = app.run;
  app.ref = refOf(m);
  app.sim = createSim(m, snap);
  app.snap = snap;
  app.lastFrame = app.sim.frames.length - 1;
  if (!session || session.meta.lesson !== lessonId(m) || session.meta.gearbox !== m.transmission) newSession(R.mode.id);
  if (!session.ref) session.ref = { note: 'the good run, same frame shape', frames: app.ref.frames };
  session.beginRun(app.sim, snap ? 'retry-from-here' : R.mode.runKind(R));
  app.mode = 'getset';
  app.poseHeld = 0;
  app.countdown = null;
  app.acc = 0;
  show(null);
  hud(true, { getset: true });
  setHudText(snap ? 'Practice from here' : m.goal);
  const reps = R.mode.reps ? R.reps.length : 0;
  setAssistUI(assist() === 'full');
  // In practice the step list helps for the first couple of reps, then gets out of the way.
  renderSteps(snap || reps >= 2 ? null : m.live);
  $('#getset-warn').hidden = true;
  updateBar();  // fresh numbers at the start of each rep, not the last visit's
  const pose = !snap && m.pose;
  $('#getset-title').textContent = snap ? 'Practice this bit' : R.mode.reps ? `Rep ${reps + 1}` : 'Get set';
  $('#pose').innerHTML = '';
  if (pose) {
    for (const p of pose) { const li = document.createElement('li'); li.textContent = p.label; li.dataset.p = p.pedal; $('#pose').appendChild(li); }
    $('#getset-hint').textContent = m.steps[0];
  } else {
    app.countdown = reps ? 1.5 : 3;
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
      warn.textContent = 'Gas and brake both read full. A pedal looks reversed: press Esc, open wheel setup and click Reverse next to it.';
    }
    if (app.poseHeld > 0.5) beginDrive();
  } else {
    app.countdown -= dt;
    $('#getset-title').textContent = app.countdown > 0 ? String(Math.ceil(app.countdown)) : 'Go';
    if (app.countdown <= 0) beginDrive();
  }
  const si = app.snap?.input;
  const ghostPed = si ? { clu: si.clutch, brk: si.brake, thr: si.throttle } : null;
  // Signalling before pulling away is allowed (and good practice).
  if (inp.ev.ind) signal(app.sim, inp.ev.ind);
  updateHud({ ...f, thr: inp.throttle, brk: inp.brake, clu: inp.clutch, steer: inp.steer, ind: app.sim.ind }, ghostPed, assist() === 'full' || !!app.snap);
  audio.engine(f.rpm, inp.throttle);
  app.viewState = driveView(f);
}

function beginDrive() {
  app.mode = 'drive';
  app.acc = 0;
  $('#getset').hidden = true;
  flash('Go', 'go', 0.7);
  const first = app.steps?.[0];
  const quiet = app.run.mode.reps && app.run.reps.length > 0;
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
const ghostOn = () => assist() === 'full' && hasRef(app.moment);
function driveView(f) {
  const showGhost = ghostOn();
  const g = showGhost ? app.ref.frames[refIndexTime(f.t)] : null;
  return { car: f, ghost: g, leadS: f.leadS, leadBraking: f.leadV !== null && f.leadV < 0.4, cam: settings.camera, assist: showGhost, stopMark: showGhost ? roadMark(app.moment, f) : null };
}

function tickDrive(dt, inp) {
  const sim = app.sim;
  if (inp.ev.shift) {
    sim.input = { ...sim.input, clutch: inp.clutch };
    if (shiftGear(sim, inp.ev.shift)) flashGear();
  }
  if (inp.ev.ind) signal(sim, inp.ev.ind);
  app.acc += dt;
  let n = 0;
  const controls = { steer: inp.steer, throttle: inp.throttle, brake: inp.brake, clutch: inp.clutch };
  while (app.acc >= DT && !sim.ended && n < 400) { stepSim(sim, controls); app.acc -= DT; n++; }
  while (sim.cues.length) {
    const c = sim.cues.shift();
    if (assist() !== 'off') { showCue(c.text, c.priority, 2.8); audio.say(c.text, c.priority); }
  }
  const f = sim.frames[sim.frames.length - 1];
  const R = app.run;
  session.sync(sim, R.mode.reps && !R.continuous ? R.reps.length : null);
  if (sim.ended) session.endRun(sim.report);
  advanceSteps(f);
  // The mode sees every new telemetry frame (continuous practice cuts reps out of them).
  for (let i = app.lastFrame + 1; i < sim.frames.length; i++) {
    const rep = R.mode.frame(R, sim, i, app.clock);
    if (rep) repDone(rep);
  }
  app.lastFrame = sim.frames.length - 1;
  if (endsInSummary()) {
    updateBar();
    if (R.continuous && R.mode.timeUp(R, app.clock)) return endRun();
  }
  const ghost = ghostOn();
  updateHud(f, ghost ? ghostPedalsFor(f) : null, ghost);
  $('#stall').hidden = f.running;
  audio.engine(f.rpm, inp.throttle);
  app.viewState = driveView(f);
  if (!sim.ended) return;
  const out = R.mode.runEnded(R, sim);
  if (out.rep) repDone(out.rep);
  if (out.then === 'end') return endRun();
  if (out.then === 'next') {
    app.mode = 'repgap';
    app.gapT = 0;
    return;
  }
  // 'debrief': a short pause on the result, then the replay.
  app.mode = 'ending';
  app.endT = 0;
  const r = sim.report;
  flash(r.passed ? 'Passed' : (r.completed ? 'Not quite' : sim.ended.reason), r.passed ? 'pass' : 'fail', 1.6);
}

// ---------------------------------------------------------------- visits (modes.js)
// Start a visit to the current moment in a mode: test, practice or free drive.
function startMode(id) {
  audio.unlock();
  const base = app.run?.base || app.moment;
  app.run = MODES[id].start(base, { assist: settings.assist, clock: app.clock });
  app.moment = app.run.moment;
  newSession(id);
  startGetset();
}

// A rep finished: score it, log it, and say the instructor's one line.
function repDone(rep) {
  const R = app.run;
  const line = scoreRep(R, rep);
  const run = session.runs[session.runs.length - 1];
  const [fs, fe] = rep.range ? [run.frameStart + rep.range[0], run.frameStart + rep.range[1] + 1] : [run.frameStart, run.frameEnd];
  session.addRep({ ...rep, assist: R.reps[R.reps.length - 1].assist }, fs, fe);
  setAssistUI(assist() === 'full');
  syncChips();
  showCue(line, !rep.clean, 3.2);
  audio.say(line);
  updateBar();
}

function updateBar() {
  const R = app.run, on = endsInSummary();
  $('#pbar').hidden = !on;
  if (!on) return;
  const b = R.mode.bar(R, app.sim, app.clock);
  $('#p-time').textContent = b.time;
  $('#p-rep').textContent = b.count;
  const dots = $('#p-dots');
  if (!b.dots) { dots.innerHTML = ''; return; }
  const shown = b.dots.slice(-16);
  if (dots.childElementCount !== shown.length || b.dots.length > 16) {
    dots.innerHTML = shown.map(r => `<i class="${r.clean ? 'ok' : 'no'}"></i>`).join('');
  }
}

function tickRepGap(dt) {
  app.gapT += dt;
  const f = app.sim.frames[app.sim.frames.length - 1];
  audio.engine(f.rpm, 0);
  app.viewState = driveView(f);
  updateBar();
  if (app.gapT > 2.2) {
    if (app.run.mode.timeUp(app.run, app.clock)) endRun();
    else startGetset();
  }
}

// End the visit and show its summary (the mode works out what to say and records progress).
function endRun() {
  const R = app.run;
  audio.engine(0);
  audio.hush();
  app.run = null;
  app.moment = R.base;
  app.lastMode = R.mode.id;
  if (session) session.meta.endedAt = new Date().toISOString();
  hud(false);
  progress = { ...progress };
  showSummary(R.mode.finish(R, { sim: app.sim, clock: app.clock, progress, events: session ? session.events : [] }));
}

function showSummary(sum) {
  app.mode = 'summary';
  show('summary');
  $('#sum-eyebrow').textContent = sum.eyebrow;
  $('#sum-title').textContent = sum.title;
  const spans = document.querySelectorAll('.stats span');
  ['#sum-reps', '#sum-clean', '#sum-streak'].forEach((id, i) => { $(id).textContent = sum.stats[i][0]; spans[i].textContent = sum.stats[i][1]; });
  const dots = $('#sum-dots');
  dots.hidden = !sum.dots;
  dots.innerHTML = '';
  if (sum.dots && !sum.dots.length) { const e = document.createElement('span'); e.className = 'muted'; e.textContent = sum.dotsEmpty; dots.appendChild(e); }
  for (const d of sum.dots || []) { const i = document.createElement('i'); i.className = d.ok ? 'ok' : 'no'; i.title = d.title; dots.appendChild(i); }
  $('#sum-trend-h').textContent = sum.trendTitle;
  const ul = $('#sum-trend');
  ul.innerHTML = '';
  for (const row of sum.trend) {
    const li = document.createElement('li');
    li.className = row.cls || '';
    if (row.text) li.textContent = row.text;
    else {
      for (const [tag, text] of [['span', row.label], ['b', row.value], ['small', row.note]]) {
        if (text === undefined) continue;
        const el = document.createElement(tag); el.textContent = text; li.appendChild(el);
      }
    }
    ul.appendChild(li);
  }
  $('#sum-next').textContent = sum.next;
  $('#sum-again').textContent = sum.again;
  $('#sum-test').hidden = !sum.test;
  audio.say(sum.say);
}

$('#sum-again').onclick = () => startMode(app.lastMode);
$('#sum-test').onclick = () => startMode('test');
$('#sum-export').onclick = () => exportSession();
$('#db-export').onclick = () => exportSession();
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
  const marks = chartMarks(m, sim.frames[0].s);
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
  app.viewState = { car: f, ghost: app.ref.frames[refIndexTime(f.t)], leadS: f.leadS, leadBraking: f.leadV !== null && f.leadV < 0.4, cam: 'chase', assist: true, shiftUp: 0.2, stopMark: roadMark(app.moment, f) };
}

// ---------------------------------------------------------------- HUD helpers
function setHudText(goal) {
  const m = app.moment;
  $('#hud-eyebrow').textContent = m.tag ? `${m.tag} · ${m.skill.toLowerCase()}` : `Moment ${m.n} · ${m.skill}`;
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
  $('#btn-exit').textContent = endsInSummary() ? 'Finish' : 'Exit';
  $('#btn-cam').textContent = settings.camera === 'cockpit' ? 'View: driver' : 'View: chase';
  $('#btn-world').textContent = 'World: ' + (VARIANTS[settings.world] || VARIANTS.town).label.toLowerCase();
  $('#btn-voice').textContent = settings.voice ? 'Voice on' : 'Voice off';
  $('#btn-voice').classList.toggle('on', settings.voice);
  $('#btn-sound').textContent = settings.sound ? 'Sound on' : 'Sound off';
  $('#btn-sound').classList.toggle('on', settings.sound);
}
function cycleAssist() {
  const next = { full: 'cues', cues: 'off', off: 'full' }[assist()];
  if (app.run && app.run.assist != null) app.run.assist = next;
  else { settings.assist = next; saveSettings(settings); }
  setAssistUI(next === 'full');
  syncChips();
  showCue(ASSIST_LABEL[next], false, 1.5);
}
function toggleCam() { settings.camera = settings.camera === 'cockpit' ? 'chase' : 'cockpit'; saveSettings(settings); syncChips(); }
function cycleWorld() {
  const names = Object.keys(VARIANTS);
  settings.world = names[(names.indexOf(settings.world) + 1) % names.length];
  view.setVariant(settings.world);
  saveSettings(settings); syncChips();
}
function toggleVoice() { settings.voice = audio.voice = !settings.voice; if (!settings.voice) audio.hush(); saveSettings(settings); syncChips(); }
function toggleSound() { settings.sound = audio.sound = !settings.sound; saveSettings(settings); syncChips(); }
$('#btn-assist').onclick = cycleAssist;
$('#btn-cam').onclick = toggleCam;
$('#btn-world').onclick = cycleWorld;
// Make wherever the wheel is now "straight ahead" (the browser can't self-centre a G29) and save it.
function zeroSteer() {
  const pad = input.getPad();
  if (!pad || input.mode !== 'wheel') { showCue('Connect the wheel first: press any wheel button.', true, 2); return; }
  const m = input.effective();
  const raw = pad.axes[m.steer.axis] ?? 0;
  const was = Math.round((raw - m.steer.center) * m.steer.sign * 450);
  m.steer.center = raw;
  input.save(m);
  showCue(was ? `Steering centre set (was ${Math.abs(was)}° ${was < 0 ? 'left' : 'right'}).` : 'Steering centre set.', false, 2);
}
$('#btn-zero').onclick = zeroSteer;
$('#btn-voice').onclick = toggleVoice;
$('#btn-sound').onclick = toggleSound;
$('#btn-exit').onclick = () => exitToBrief();
function exitToBrief() {
  if (endsInSummary()) return endRun();
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
let hudBlink = false;
function updateHud(f, ghost, assistOn) {
  $('#speed').textContent = kmh(f.v);
  const auto = app.moment?.transmission === 'auto';
  $('#gear').textContent = auto ? `D${f.gear}` : f.gear === 0 ? 'N' : String(f.gear);
  $('#gear').style.borderColor = gearFlash > 0 ? 'var(--ghost)' : '';
  $('#gear-hint').textContent = auto ? 'automatic' : input.mode === 'wheel' ? 'paddles' : 'E / Q';
  const r = readout(app.moment, f);
  const dist = $('#dist');
  dist.hidden = !r;
  if (r) {
    $('#dist-v').textContent = r.m;
    $('#dist-l').textContent = r.label;
    dist.classList.toggle('soon', r.soon);
  }
  const rpm = f.running ? f.rpm : 0;
  const fill = $('#rpm-fill');
  fill.style.width = `${clamp(rpm / 6500, 0, 1) * 100}%`;
  fill.className = 'rpm-fill' + (!f.running ? ' off' : rpm < 700 ? ' low' : rpm > 3800 ? ' high' : '');
  $('#rpm').textContent = Math.round(rpm / 10) * 10;
  $('#engine').textContent = f.running ? 'engine on' : 'engine off';
  // Indicators blink about 80 times a minute, with the relay's tick.
  const blink = !!f.ind && Math.floor(app.clock / 0.38) % 2 === 0;
  $('#ind-l').classList.toggle('on', f.ind < 0 && blink);
  $('#ind-r').classList.toggle('on', f.ind > 0 && blink);
  if (blink !== hudBlink) { hudBlink = blink; if (f.ind && app.mode !== 'debrief') audio.tick(blink); }
  // Speed limit in force (the last sign passed); the speed turns red above it.
  const limit = speedLimit(app.moment, f);
  $('#limit').hidden = !limit;
  if (limit) $('#limit').textContent = limit;
  $('#speed-wrap').classList.toggle('over', !!limit && kmh(f.v) > limit);
  // Lane gauge: the car across the road, kerb to kerb.
  const L = laneGauge(f);
  const car = $('#lane-car');
  car.style.left = `${clamp(L.left, -0.1, 1.1) * 100}%`;
  car.style.width = `${L.width * 100}%`;
  car.className = 'lane-car' + (L.state === 'ok' ? '' : ' ' + L.state);
  $('#lane-txt').textContent = L.text;
  // Wheel angle (900° lock): the dot spans ±90°, the label gives the exact angle.
  const deg = (f.steer || 0) * 450;
  const dot = $('#steer-dot');
  dot.style.left = `${50 + clamp(deg / 90, -1, 1) * 50}%`;
  dot.classList.toggle('off', Math.abs(deg) > 3);
  $('#steer-deg').textContent = Math.abs(deg) < 0.5 ? 'straight' : `${Math.round(Math.abs(deg))}° ${deg < 0 ? 'left' : 'right'}`;
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
  if (e.code === 'KeyB') cycleWorld();
  if (e.code === 'KeyZ') zeroSteer();
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
    case 'brief': if (ev.ok) startMode(app.moment.modes[0]); break;
    case 'summary': if (ev.ok) startMode(app.lastMode); break;
    case 'demo': if (ev.ok) { audio.engine(0); startGetset(); } break;
    case 'drive': case 'getset': if (ev.retry && !app.run?.continuous) startGetset(app.snap); break;
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
// With a saved calibration, go straight to the lessons; otherwise check the wheel first.
if (input.custom) openLadder(); else openSetup();
requestAnimationFrame(loop);

// Handle for the console and for agents: live state, plus the registries that describe what the app can do.
window.ds = {
  app, settings, input, DT, session: null,
  MOMENTS, FREE, MODES, DETECTORS, ZONES, AIDS, FRAME,
};
