// Manual-transmission hatchback. Deliberately simple, but the parts a learner feels are real:
// clutch slip, the bite point, stalling, engine braking, rolling back on a hill.

export const RPM = 60 / (2 * Math.PI); // rad/s -> rpm
const G = 9.81;

export const CAR = {
  mass: 1000,
  r: 0.3,
  gears: [0, 3.6, 2.1, 1.4, 1.05, 0.85], // 0 = neutral
  final: 4.1,
  eff: 0.92,
  ie: 0.15,          // engine inertia kg·m²
  tcMax: 250,        // clutch torque capacity N·m
  slip: 4,           // rad/s slip scale for clutch smoothing
  brakeMax: 9000,    // N at full pedal (~0.9 g)
  crr: 0.012,
  cda: 0.65,
  wheelbase: 2.45,
  maxDelta: 30 * Math.PI / 180, // road-wheel angle at full lock (900° wheel, 15:1)
  mu: 0.95,
  stallRpm: 450,
  limiter: 6500,
  length: 3.9,
  width: 1.7,
};

// Clutch pedal 0 (up) .. 1 (down) -> engagement 1 .. 0. The bite point sits around 0.6.
export const BITE_LO = 0.3, BITE_HI = 0.7;
export function engagement(c) {
  const t = Math.min(1, Math.max(0, (c - BITE_LO) / (BITE_HI - BITE_LO)));
  return 1 - t * t * (3 - 2 * t);
}

const CURVE = [[0, 0], [800, 82], [2000, 105], [4000, 115], [6000, 95], [6800, 0]];
export function torqueCurve(rpm) {
  for (let i = 1; i < CURVE.length; i++) {
    if (rpm <= CURVE[i][0]) {
      const [r0, t0] = CURVE[i - 1], [r1, t1] = CURVE[i];
      return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
    }
  }
  return 0;
}

export function createCar({ x = 0, z = 0, h = 0, v = 0, gear = 1, running = true, auto = false }) {
  const ratio = gear ? CAR.gears[gear] * CAR.final : 0;
  const wheelRpm = (v / CAR.r) * ratio * RPM;
  const rpm = running ? Math.max(850, wheelRpm) : 0;
  return { x, z, h, v, gear: auto ? Math.max(1, gear) : gear, running, auto, shiftT: 0, omegaE: rpm / RPM, startTimer: 0, tc: 0, e: 0, stalledNow: false };
}

export function ratioOf(gear) { return gear > 0 ? CAR.gears[gear] * CAR.final : 0; }

// Automatic: fluid coupling (torque converter). ~20 N·m of creep at idle, never stalls.
const COUPLING = 0.0027;

function autoShift(car, inp, dt) {
  car.shiftT = Math.max(0, car.shiftT - dt);
  if (car.shiftT > 0) return;
  const wheelRpm = (car.v / CAR.r) * ratioOf(car.gear) * RPM;
  const up = 2000 + 1800 * inp.throttle;
  if (wheelRpm > up && car.gear < 5) { car.gear++; car.shiftT = 0.8; }
  else if (car.gear > 1 && wheelRpm < 1000) { car.gear--; car.shiftT = 0.8; }
}

// slope = sine of the incline along the car's heading (positive = uphill).
export function stepCar(car, inp, dt, slope) {
  const C = CAR;
  if (car.auto) autoShift(car, inp, dt);
  const ratio = ratioOf(car.gear);
  const wW = (car.v / C.r) * ratio;          // wheel speed seen at the engine side
  const e = ratio ? engagement(inp.clutch) : 0;
  const wE = car.running ? car.omegaE : 0;
  let tc = 0;
  if (car.auto) tc = COUPLING * (wE - wW) * Math.max(Math.abs(wE), Math.abs(wW), 30);
  else if (ratio && e > 0) tc = C.tcMax * Math.pow(e, 1.5) * Math.tanh((wE - wW) / C.slip);
  car.e = car.auto ? 1 : e;
  car.tc = tc;
  car.stalledNow = false;

  if (car.running) {
    const rpm = car.omegaE * RPM;
    const te = rpm < C.limiter ? inp.throttle * torqueCurve(rpm) : 0;
    const idle = rpm < 950 ? Math.min(30, (950 - rpm) * 0.08) * (1 - inp.throttle) : 0;
    const tf = 8 + 0.0025 * rpm;
    car.omegaE += (te + idle - tf - tc) / C.ie * dt;
    if (car.omegaE * RPM < C.stallRpm) {
      car.running = false;
      car.omegaE = 0;
      car.stalledNow = true;
    }
  } else if (inp.clutch > 0.85 || car.gear === 0) {
    // Modern-car convenience: clutch fully down restarts the engine.
    car.startTimer += dt;
    if (car.startTimer > 0.7) {
      car.running = true;
      car.omegaE = 1000 / RPM;
      car.startTimer = 0;
    }
  } else {
    car.startTimer = 0;
  }

  const m = C.mass;
  let fDrive = ratio ? tc * ratio * C.eff / C.r : 0;
  fDrive = Math.max(-C.mu * m * G, Math.min(C.mu * m * G, fDrive));
  const fPush = fDrive - m * G * slope - 0.6 * C.cda * car.v * Math.abs(car.v);
  const fRes = C.crr * m * G + inp.brake * C.brakeMax;
  const v = car.v;
  let a;
  if (v === 0) {
    a = Math.abs(fPush) <= fRes ? 0 : (fPush - Math.sign(fPush) * fRes) / m;
  } else {
    a = (fPush - Math.sign(v) * fRes) / m;
  }
  let nv = v + a * dt;
  if (v !== 0 && Math.sign(nv) !== Math.sign(v) && Math.abs(fPush) <= fRes) nv = 0;
  car.v = nv;

  const delta = inp.steer * C.maxDelta;
  car.h -= car.v * Math.tan(delta) / C.wheelbase * dt;
  car.x += car.v * Math.sin(car.h) * dt;
  car.z += car.v * Math.cos(car.h) * dt;
}
