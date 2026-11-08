// The lesson ladder. Each moment is ~30 seconds around one hard thing.
// A moment is pure data + rules: road, start, pose, success criteria, live cues, expert.

import { CAR } from './physics.js';
import { LANE_CENTER } from './road.js';
import { driver } from './expert.js';
import { FRAME_DT, LEAD_LEN } from './sim.js';

const kmh = v => Math.round(v * 3.6);
const CLUTCH_DOWN = { pedal: 'clu', min: 0.85, label: 'Clutch fully down (left pedal)' };
const BRAKE_ON = { pedal: 'brk', min: 0.3, label: 'Brake held (middle pedal)' };
const BRAKE_POSE = [BRAKE_ON];
const pullForce = f => f.tc * 14.76 * CAR.eff / CAR.r;
const front = f => f.s + CAR.length / 2;
const noStall = { manual: true, id: 'stall', label: 'No stall', fail: 'You stalled.', events: ['stall'], test: S => S.stalls === 0, detail: S => S.stalls ? `${S.stalls} stall${S.stalls > 1 ? 's' : ''}` : '', tip: 'Ease the clutch up slowly and keep a little gas on.' };

const movingOff = {
  id: 'moving-off',
  auto: {
    skill: 'Creep, then gentle gas',
    why: 'In an automatic the car creeps as soon as you lift off the brake. Control starts with your right foot.',
    goal: 'Ease off the brake, creep, then gently pick up speed past the gate.',
    steps: [
      'Foot on the brake. The gearbox is in D.',
      'Slowly lift off the brake and let the car creep forward on its own.',
      'Move your foot to the gas and press gently to pick up speed.',
    ],
    praise: 'Smooth. Nice gentle right foot.',
    pose: BRAKE_POSE,
    live: [
      { text: 'Slowly ease off the brake. The car creeps on its own.', say: 'Slowly ease off the brake and let it creep.', done: f => f.v > 0.3 },
      { text: 'Move your foot to the gas (right pedal) and press gently.', say: 'Now gently onto the gas.', done: f => f.thr > 0.05 && f.v > 1.5 },
      { text: 'Roll through the gate.', say: 'Nice. Roll through the gate.', done: () => false },
    ],
    criteria: [{ id: 'gentle', label: 'Gentle on the gas', fail: 'Too much gas.', test: S => S.maxThr <= 0.6, detail: S => `peak ${Math.round(S.maxThr * 100)}%`, tip: 'Squeeze the gas. A third of the pedal is plenty in town.' }],
    demo: { stopped: 'Brake on, gearbox in D.', drive: 'Ease off the brake, let it creep, then gentle gas.' },
  },
  n: 1,
  title: 'Moving off',
  skill: 'Find the bite point',
  why: 'Every drive starts here. Most new drivers stall because they rush the clutch.',
  goal: 'Move off smoothly and roll past the gate without stalling.',
  steps: [
    'Clutch fully down and foot on the brake. First gear is already in.',
    'Lift the clutch slowly until the engine note drops. That is the bite point. Hold it there.',
    'Add a little gas, let the car creep forward, then lift the clutch the rest of the way.',
  ],
  praise: 'Smooth. You found the bite point.',
  road: { segments: [{ len: 200 }] },
  start: { s: 20, v: 0, gear: 1 },
  pose: [CLUTCH_DOWN, BRAKE_ON],
  live: [
    { text: 'Let go of the brake. Keep the clutch down.', say: 'Now let go of the brake. Keep the clutch down.', done: f => f.brk < 0.05 },
    { text: 'Lift the clutch slowly until the car starts to creep. That is the bite point.', say: 'Slowly lift the clutch until the car starts to creep.', done: f => f.v > 0.3 },
    { text: 'Add a little gas, then lift the clutch the rest of the way.', say: 'Good. A little gas, and lift the clutch all the way.', done: f => f.clu < 0.15 && f.v > 1 },
    { text: 'Roll through the gate.', say: 'Nice. Roll through the gate.', done: () => false },
  ],
  zones: [{ type: 'finish', s: 50 }],
  align: 'time',
  timeLimit: 40,
  detect: ['lurch', 'lane'],
  end: f => (f.s >= 50 ? { completed: true, reason: 'Made it past the gate' } : null),
  criteria: [
    noStall,
    { id: 'smooth', label: 'Smooth start, no jerk', fail: 'The car jerked.', events: ['lurch'], test: S => S.maxAccel <= 2.6, tip: 'Pause at the bite point. Lift the rest of the clutch slowly once you are rolling.' },
    { manual: true, id: 'revs', label: 'Gentle on the revs', fail: 'Too many revs.', events: ['overrev'], test: S => S.overrevs === 0, tip: 'A quarter of the gas pedal is plenty to move off.' },
  ],
  cues: [
    { manual: true, id: 'gas', text: 'Add a little gas.', when: f => f.running && f.e > 0.08 && f.rpm < 720 && f.thr < 0.05 },
  ],
  drive: ({ target: () => 4.2 }),
  demo: { stopped: 'Clutch fully down, first gear.', launch: 'Lift to the bite point and add a little gas.', drive: 'It is rolling. Now lift the clutch all the way.' },
};

const LINE = 110;
const BRAKE_AT = 24; // where the good run starts braking: metres before the line, at 30 km/h
const stopLine = {
  id: 'stop-line',
  auto: {
    skill: 'Brake early, brake smooth',
    goal: 'Stop with your front bumper just before the white line, smoothly.',
    steps: [
      'Start braking at the amber BRAKE mark, 24 m before the line. Gentle at first, then a little more.',
      'Keep a steady foot as the car slows. The gearbox looks after itself.',
      'Stop just before the line, ease off a touch for a soft stop, then hold the brake so you do not creep.',
    ],
    live: [
      { text: 'Brake gently when you reach the amber BRAKE mark.', done: f => f.brk > 0.05 },
      { text: 'Watch the stop marker. Keep it green, just before the line. Then hold the brake.', done: () => false },
    ],
    demo: { drive: 'Hold your speed and look at the line.', braking: 'Brake early and gently.', stopped: 'Soft stop, then hold the brake.' },
  },
  n: 2,
  title: 'Stop at the line',
  skill: 'Brake and clutch together',
  why: 'Stopping smoothly, exactly where you mean to, is half of city driving.',
  goal: 'Stop with your front bumper just before the white line, without stalling.',
  steps: [
    'Start braking at the amber BRAKE mark, 24 m before the line (about 6 car lengths). Gentle at first, then a little more.',
    'As the car slows to walking pace, press the clutch down so the engine does not stall.',
    'Stop with your bumper just before the line. Ease off the brake at the very end for a soft stop.',
  ],
  praise: 'Clean stop, right on the line.',
  road: { segments: [{ len: 170 }] },
  start: { s: 10, v: 30 / 3.6, gear: 2 },
  pose: null,
  live: [
    { text: 'Brake gently when you reach the amber BRAKE mark.', done: f => f.brk > 0.05 },
    { text: 'As it slows to walking pace, clutch fully down.', say: 'Clutch down as it slows.', done: f => f.clu > 0.85 },
    { text: 'Watch the stop marker. Keep it green, just before the line.', done: () => false },
  ],
  zones: [
    { type: 'stopLine', s: LINE }, { type: 'stopBox', s0: LINE - 3, s1: LINE },
    { type: 'brakeMark', s: LINE - BRAKE_AT },
    { type: 'boards', at: LINE, marks: [50, 30, 10] },
  ],
  // What the driver is aiming for: drives the distance readout and the "you'd stop here" marker.
  target: { kind: 'stop', s: LINE, label: 'Line', brakeAt: BRAKE_AT },
  insight: S => {
    if (S.brakeAt === undefined) return 'You never pressed the brake before the line.';
    const d = Math.round(S.brakeAt);
    if (Math.abs(S.brakeAt - BRAKE_AT) <= 4) {
      if (S.stopGap > 3) return `You started braking ${d} m before the line, right at the mark, but pressed too hard and stopped ${Math.round(S.stopGap)} m short. Press lighter and keep the stop marker on the line.`;
      if (S.overLine > 0.3) return `You started braking ${d} m before the line, right at the mark, but too lightly. Press a little more as the stop marker nears the line.`;
      return `You started braking ${d} m before the line, right at the mark.`;
    }
    return `You started braking ${d} m before the line. The good run starts at the amber mark, ${BRAKE_AT} m before${S.brakeAt < BRAKE_AT ? ', so you were late' : ', so you were early'}.`;
  },
  align: 'distance',
  timeLimit: 45,
  detect: ['harsh', 'lane'],
  measure: (S, f) => {
    const over = front(f) - LINE;
    S.overLine = Math.max(S.overLine ?? -Infinity, over);
    S.stopGap = LINE - front(f);
    S.still = f.v === 0 ? (S.still || 0) + FRAME_DT : 0;
    // Where braking began: metres from the front bumper to the line.
    if (S.brakeAt === undefined && f.brk > 0.05 && f.v > 1) S.brakeAt = LINE - front(f);
  },
  end: (f, sim) => {
    const S = sim.ins.stats;
    if (front(f) > LINE + 4) return { completed: true, reason: 'Ran the line' };
    if (S.still > 1 && front(f) > LINE - 40) return { completed: true, reason: 'Stopped' };
    return null;
  },
  criteria: [
    { id: 'before', label: 'Stopped before the line', fail: 'You crossed the line.', test: S => S.overLine <= 0.3, detail: S => S.overLine > 0.3 ? `${S.overLine.toFixed(1)} m over` : '', tip: 'Start braking at the amber BRAKE mark, 24 m before the line.' },
    { id: 'smooth', label: 'Smooth braking', fail: 'The braking was harsh.', events: ['harsh'], test: S => S.maxDecel <= HARSH_OK, detail: S => `peak ${S.maxDecel.toFixed(1)} m/s²`, tip: 'Start braking at the amber mark so you can press gently. Late braking means braking hard.' },
    { id: 'close', label: 'Within 3 m of the line', fail: 'You stopped too far back.', test: S => S.stopGap <= 3 && S.overLine <= 0.3, detail: S => S.stopGap > 3 ? `${S.stopGap.toFixed(1)} m short` : '', tip: 'Keep rolling a little longer, then brake gently to creep up to the line.' },
    noStall,
  ],
  cues: [
    // Same rule as the on-road "you'd stop here" marker: gentle braking from here just reaches the line.
    { id: 'brake', once: true, text: 'Brake now, gently.', when: f => f.brk < 0.05 && f.v > 3 && front(f) + (f.v * f.v) / (2 * 1.5) >= LINE - 0.5 },
    { manual: true, id: 'clutch', text: "Clutch down, or you'll stall.", when: f => f.running && f.gear > 0 && f.clu < 0.5 && f.v > 0.3 && f.rpm < 1150 && f.brk > 0.05 },
    { id: 'soft', once: true, text: 'Ease off the brake a little for a soft stop.', when: f => f.v > 0.2 && f.v < 1.5 && f.brk > 0.5 },
  ],
  drive: ({ target: () => 30 / 3.6, stopAt: sim => LINE - 1.0 - (sim.proj.s + CAR.length / 2) }),
  demo: { drive: 'Hold your speed and look at the line.', braking: 'Brake early and gently. Clutch down as the revs drop.', stopped: 'Soft stop, just before the line.' },
};
const HARSH_OK = 4.5;

const BEND0 = 60, BEND1 = 107;
const bend = {
  id: 'bend',
  auto: {},
  n: 3,
  title: 'Take the bend',
  skill: 'Slow in, steer smooth',
  why: 'Most new drivers enter bends too fast and drift wide into oncoming traffic.',
  goal: 'Take the left bend at a safe speed and stay in your lane.',
  steps: [
    'Slow down before the bend, while the road is still straight.',
    'Turn in smoothly and keep the car in the left lane.',
    'Look through the bend to where you are going, then straighten up.',
  ],
  praise: 'Nice line. Slow in, smooth through.',
  road: { segments: [{ len: BEND0 }, { len: BEND1 - BEND0, turn: -90 }, { len: 90 }] },
  start: { s: 10, v: 30 / 3.6, gear: 2 },
  pose: null,
  zones: [{ type: 'speedSign', s: 34, limit: 25 }, { type: 'finish', s: 175 }],
  speedZone: { s0: BEND0 - 5, s1: BEND1 },
  target: { kind: 'distance', s: BEND0, label: 'Bend' },
  live: [
    { text: 'Slow to 25 km/h before the bend.', done: f => f.s > BEND0 - 5 },
    { text: 'Steer smoothly. Stay in the left lane.', say: 'Look through the bend.', done: f => f.s > BEND1 },
    { text: 'Straighten up and carry on to the gate.', done: () => false },
  ],
  align: 'distance',
  timeLimit: 50,
  detect: ['lane', 'harsh'],
  end: f => (f.s >= 175 ? { completed: true, reason: 'Through the bend' } : null),
  criteria: [
    { id: 'lane', label: 'Stayed in your lane', fail: 'You left your lane.', events: ['lane'], test: S => S.maxLaneDev <= 0.9, detail: S => `widest ${S.maxLaneDev.toFixed(1)} m off centre`, tip: 'Look through the bend, not at the bonnet. Small, steady steering.' },
    { id: 'speed', label: 'At or under 25 km/h in the bend', fail: 'Too fast in the bend.', test: S => S.maxSpeedZone <= 27 / 3.6, detail: S => `${kmh(S.maxSpeedZone)} km/h`, tip: 'Do your braking on the straight, before you turn the wheel.' },
    noStall,
  ],
  cues: [
    { id: 'slow', once: true, text: 'Slow down before the bend, not in it.', when: f => f.s > BEND0 - 28 && f.s < BEND0 && f.v > 26 / 3.6 },
    { id: 'look', once: true, text: 'Look where you want to go.', when: f => f.s > BEND0 + 2 && f.s < BEND0 + 10 },
  ],
  drive: ({ target: sim => (sim.proj.s < BEND0 - 25 ? 30 / 3.6 : 22 / 3.6) }),
  demo: { drive: 'Brake on the straight, then steer smoothly through.' },
};

const LEAD_S0 = 20 + (CAR.length + LEAD_LEN) / 2 + 4.5;
const traffic = {
  id: 'traffic',
  auto: {
    skill: 'Creep and brake, stop and go',
    goal: 'Follow the auto through stop-go traffic. Keep a safe gap, no bumps.',
    steps: [
      'When the auto moves, ease off the brake and let the car creep after it.',
      'Creep is often enough. Add only a touch of gas, and cover the brake.',
      'When it stops, brake smoothly and hold the brake while you wait.',
    ],
    pose: BRAKE_POSE,
    cues: [
      { id: 'go', text: "Traffic's moving. Ease off the brake.", when: f => f.leadV > 1 && f.gap > 6 && f.v < 0.3 },
      { id: 'close', text: 'Too close. Brake gently.', when: f => f.gap < 2.2 && f.v > 0.4 && f.leadV < f.v },
    ],
    demo: { stopped: 'Brake on. Wait for the auto.', drive: 'It moved. Off the brake, creep after it.', stopping: 'It is stopping. Brake smoothly and hold.' },
  },
  n: 4,
  title: 'Creep in traffic',
  skill: 'Clutch control, stop and go',
  why: 'Bumper-to-bumper traffic is where clutch control matters most, and where most stalls happen.',
  goal: 'Follow the auto through stop-go traffic. Keep a safe gap, no bumps, no stalls.',
  steps: [
    'When the auto moves, clutch to the bite point and creep after it.',
    'Keep about a car length of gap. Use the clutch and brake, not lots of gas.',
    'When it stops, clutch down and brake. Wait, then go again.',
  ],
  praise: 'Calm and in control. That is traffic sorted.',
  road: { segments: [{ len: 200 }] },
  start: { s: 20, v: 0, gear: 1 },
  pose: [CLUTCH_DOWN],
  lead: {
    s0: LEAD_S0,
    script: [
      { dur: 2, v: 0 }, { dur: 5, v: 2.5 }, { dur: 4, v: 0 },
      { dur: 4, v: 3 }, { dur: 4, v: 0 }, { dur: 5, v: 2.2 }, { dur: 2, v: 0 },
    ],
  },
  zones: [],
  align: 'time',
  timeLimit: 60,
  // Practice: one long street of stop-go traffic. Every stop-go of the auto is one rep.
  practice: { kind: 'continuous', mins: 10 },
  repChecks: [
    { id: 'stall', manual: true, label: 'No stall', test: R => R.stalls === 0, tip: 'Pause at the bite point until the car creeps, then lift the clutch slowly.' },
    { id: 'go', label: 'Moved off promptly', test: R => R.reaction <= 2.5, tip: 'Go as soon as the auto moves. Have the clutch at the bite point, ready.', autoTip: 'Ease off the brake as soon as the auto moves.' },
    { id: 'gap', label: 'Kept a safe gap', test: R => R.minGap >= 1.5 && !R.crash, tip: 'Hold back more. Keep about a car length to the auto.' },
    { id: 'smooth', label: 'Smooth', test: R => R.maxAccel <= 2.6, tip: 'Smoother: less gas, and lift the clutch more slowly.', autoTip: 'Smoother: squeeze the gas, don\'t stab it.' },
  ],
  detect: ['tailgate', 'lane', 'lurch'],
  measure: (S, f) => { S.still = f.v === 0 ? (S.still || 0) + FRAME_DT : 0; },
  end: (f, sim) => (sim.lead.done && sim.lead.v === 0 && sim.ins.stats.still > 1 ? { completed: true, reason: 'Traffic cleared' } : null),
  criteria: [
    { id: 'bump', label: 'No bumps', fail: 'You bumped the auto.', events: ['crash'], test: S => !S.crashed, tip: 'Clutch down and brake as soon as the auto stops.' },
    { id: 'gap', label: 'Kept a safe gap (over 1.5 m)', fail: 'You got too close.', events: ['tailgate'], test: S => S.minGap >= 1.5, detail: S => `closest ${Math.max(0, S.minGap).toFixed(1)} m`, tip: 'Hold back a little. Creep on the bite point instead of gas.' },
    { id: 'keepup', label: 'Kept up with traffic', fail: 'You fell too far behind.', test: S => S.maxGap <= 15, detail: S => `widest ${S.maxGap.toFixed(0)} m`, tip: 'Go as soon as the auto moves. Bite point first, then a little gas.' },
    noStall,
  ],
  cues: [
    { manual: true, id: 'go', text: "Traffic's moving. Bite point, and go.", when: f => f.leadV > 1 && f.gap > 6 && f.v < 0.3 },
    { manual: true, id: 'close', text: 'Too close. Clutch down, ease off.', when: f => f.gap < 2.2 && f.v > 0.4 && f.leadV < f.v },
    { manual: true, id: 'clutch', text: "Clutch down, or you'll stall.", when: f => f.running && f.gear > 0 && f.clu < 0.5 && f.v > 0.2 && f.rpm < 800 && f.brk > 0.05 },
  ],
  drive: ({
    target: sim => {
      const L = sim.lead;
      const gap = L.s - sim.proj.s - (CAR.length + LEAD_LEN) / 2;
      const want = 3 + 0.9 * L.v;
      const vt = L.v + 0.6 * (gap - want);
      return vt < 0.4 ? 0 : Math.min(4, vt);
    },
    startDelay: 0.3,
  }),
  demo: { stopped: 'Clutch down, brake on. Wait for the auto.', launch: 'It moved. Bite point, creep after it.', stopping: 'It is stopping. Clutch down and brake.' },
};

const hill = {
  id: 'hill-start',
  auto: {
    skill: 'Quick brake-to-gas swap',
    why: 'Even automatics roll back on a steep ramp if you are slow coming off the brake.',
    steps: [
      'Hold the brake. The gearbox is in D.',
      'Swap your foot from brake to gas in one quick move.',
      'Squeeze the gas progressively up the ramp.',
    ],
    pose: BRAKE_POSE,
    live: [
      { text: 'Swap from brake to gas (right pedal) in one quick move.', say: 'Quick swap, brake to gas.', done: f => f.thr > 0.1 && f.brk < 0.05 },
      { text: 'Squeeze the gas progressively up the ramp.', done: () => false },
    ],
    cues: [{ id: 'hold', once: true, text: 'Brake on. When ready, swap quickly to the gas.', when: (f, sim, ins) => f.t - ins.startT > 0.4 }],
    demo: { stopped: 'Brake on, in D.', drive: 'Quick swap from brake to gas, then squeeze.' },
  },
  n: 5,
  title: 'Hill start',
  skill: 'No roll-back',
  why: 'Flyovers and ramps are everywhere. Rolling back into the bike behind you is the classic beginner fear.',
  goal: 'Pull away up the flyover ramp without rolling back.',
  steps: [
    'Keep the brake on. Clutch down, first gear.',
    'Add a little gas and lift the clutch to the bite point. Feel the car pull against the brake.',
    'Now release the brake and add more gas as you lift the clutch the rest of the way.',
  ],
  praise: 'Rock steady. No roll-back at all.',
  road: { segments: [{ len: 20 }, { len: 90, grade: 0.1 }] },
  start: { s: 40, v: 0, gear: 1 },
  pose: [CLUTCH_DOWN, BRAKE_ON],
  live: [
    { text: 'Add a little gas and lift the clutch to the bite point. Keep the brake on.', say: 'Keep the brake on. A little gas, and clutch up to the bite point.', done: f => pullForce(f) > 1100 },
    { text: 'Feel it pull? Release the brake.', say: 'Feel it pull? Release the brake.', done: f => f.brk < 0.05 && f.v >= 0 },
    { text: 'More gas as you lift the clutch the rest of the way.', say: 'More gas, and lift the clutch slowly.', done: f => f.clu < 0.15 && f.v > 1 },
    { text: 'Up the ramp to the gate.', done: () => false },
  ],
  zones: [{ type: 'finish', s: 65 }],
  align: 'time',
  timeLimit: 45,
  detect: ['rollback', 'lurch', 'lane'],
  end: (f, sim) => {
    if (sim.ins.rollRun > 2) return { completed: false, reason: 'Rolled back too far' };
    return f.s >= 65 ? { completed: true, reason: 'Up the ramp' } : null;
  },
  criteria: [
    { id: 'roll', label: 'No roll-back (under 30 cm)', fail: 'You rolled back.', events: ['rollback'], test: S => S.rollback <= 0.3, detail: S => S.rollback > 0.05 ? `${(S.rollback * 100).toFixed(0)} cm back` : '', tip: 'Do not release the brake until you feel the car pull at the bite point.' },
    noStall,
    { id: 'smooth', label: 'Smooth pull-away', fail: 'The car jerked.', events: ['lurch'], test: S => S.maxAccel <= 2.8, tip: 'Once the brake is off, lift the clutch slowly while adding gas.' },
  ],
  cues: [
    { manual: true, id: 'hold', once: true, text: 'Brake on. Gas, then clutch to the bite point.', when: (f, sim, ins) => f.t - ins.startT > 0.4 },
    { manual: true, id: 'pull', once: true, text: 'Feel it pull? Now release the brake.', when: f => f.brk > 0.2 && f.tc * 14.76 * CAR.eff / CAR.r > 1100 },
  ],
  drive: ({ target: () => 3.5, hill: true }),
  demo: { stopped: 'Brake on, clutch down.', launch: 'Gas, bite point. Feel it pull, then release the brake.', drive: 'Brake off. Lift the clutch, more gas.' },
};

// Free drive: a town loop (left-hand corners, a small flyover hump), repeated so you can keep going.
const R = 25, ARC = R * Math.PI / 2;
const LAP = [
  { len: 160 }, { len: ARC, turn: -90 },
  { len: 60 }, { len: 50, grade: 0.06 }, { len: 30, grade: 0 }, { len: 50, grade: -0.06 }, { len: 20, grade: 0 },
  { len: ARC, turn: -90 },
  { len: 160 }, { len: ARC, turn: -90 },
  { len: 210 }, { len: ARC, turn: -90 },
];
const LAP_LEN = LAP.reduce((a, g) => a + Math.max(1, Math.round(g.len / 0.5)) * 0.5, 0);
export const FREE = {
  id: 'free-drive',
  n: 6,
  free: true,
  continuous: true,
  title: 'Free drive',
  skill: 'Just drive',
  why: 'Put it all together at your own pace. No score and no timer: the instructor only speaks up when something goes wrong.',
  goal: 'Drive the town loop at your own pace. Keep left.',
  steps: [
    'Pull away when you are ready.',
    'Keep left. Slow down before the corners. There is a small flyover on one side.',
    'Press Esc or Finish whenever you like. You can download the drive afterwards.',
  ],
  auto: { pose: [{ pedal: 'brk', min: 0.3, label: 'Brake held (middle pedal)' }] },
  praise: 'Nice drive.',
  road: { segments: Array.from({ length: 40 }, () => LAP).flat() }, // ~36 km of laps
  lapLength: LAP_LEN,
  start: { s: 10, v: 0, gear: 1 },
  pose: [CLUTCH_DOWN, BRAKE_ON],
  zones: [{ type: 'speedSign', s: 25, limit: 30 }, { type: 'speedSign', s: 160 + ARC + 20, limit: 30 }],
  align: 'time',
  timeLimit: 4 * 3600,
  detect: ['lurch', 'harsh', 'lane'],
  end: (f, sim) => (f.s > sim.road.length - 60 ? { completed: true, reason: 'End of the road' } : null),
  criteria: [],
  cues: [],
  drive: { target: () => 8 },
};

export const MOMENTS = [movingOff, stopLine, bend, traffic, hill];
for (const m of [...MOMENTS, FREE]) { m.transmission = 'manual'; m.expert = driver(m.drive); }

// The same moment for an automatic gearbox: clutch-only rules dropped, automatic wording merged in.
export function forTransmission(m, trans) {
  if (trans !== 'auto') return m;
  if (!m._autoVariant) {
    const a = m.auto || {};
    m._autoVariant = {
      ...m, ...a,
      id: m.id + '@auto',
      transmission: 'auto',
      criteria: [...m.criteria.filter(c => !c.manual), ...(a.criteria || [])],
      cues: [...m.cues.filter(c => !c.manual), ...(a.cues || [])],
      expert: driver(m.drive),
      _road: m._road,
      _autoVariant: undefined,
    };
  }
  return m._autoVariant;
}
export const lessons = trans => MOMENTS.map(m => forTransmission(m, trans));

// Practice length for a lesson, in minutes.
export const practiceMins = m => m.practice?.mins ?? 5;

// A continuous practice version of a lesson: a long street and traffic that never runs out.
export function practiceOf(m) {
  if (m.practice?.kind !== 'continuous') return m;
  if (!m._practice) {
    let seed = 1234;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const script = [{ dur: 2, v: 0 }];
    for (let i = 0; i < 160; i++) {
      script.push({ dur: 3 + rnd() * 5, v: 1.5 + rnd() * 2.2 });
      script.push({ dur: 2 + rnd() * 4, v: 0 });
    }
    m._practice = {
      ...m,
      continuous: true,
      road: { segments: [{ len: 2600 }] },
      lead: { ...m.lead, script },
      timeLimit: practiceMins(m) * 60 + 30,
      end: () => null,
      _road: undefined,
      _practice: undefined,
    };
    m._practice.expert = driver(m.drive);
  }
  return m._practice;
}
export const LANE = LANE_CENTER;
