// A scripted "good driver" that uses the same controls a student has.
// It produces the reference run: the ghost car, the ghost pedals and the demo.

import { pointAt, LANE_CENTER } from './road.js';
import { CAR, RPM, ratioOf } from './physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toward = (v, target, rate, dt) => v + clamp(target - v, -rate * dt, rate * dt);

export function pursuit(sim, look = 7) {
  const c = sim.car;
  const tp = pointAt(sim.road, sim.proj.s + look, LANE_CENTER);
  const dx = tp.x - c.x, dz = tp.z - c.z;
  const fwd = dx * Math.sin(c.h) + dz * Math.cos(c.h);
  const rgt = -dx * Math.cos(c.h) + dz * Math.sin(c.h);
  const alpha = Math.atan2(rgt, fwd);
  const delta = Math.atan(2 * CAR.wheelbase * Math.sin(alpha) / look);
  return clamp(delta / CAR.maxDelta, -1, 1);
}

// opts.target(sim) -> wanted speed m/s; opts.stopAt(sim) -> metres to the stop point (optional)
// opts.hill: hold the brake until the clutch pulls.
export function driver(opts) {
  return function expert(sim, ctx, dt) {
    const c = sim.car;
    const rpm = c.running ? c.omegaE * RPM : 0;
    if (!ctx.mode) {
      ctx.mode = c.v > 0.5 ? 'drive' : 'stopped';
      ctx.modeT = sim.t;
      ctx.clutch = c.v > 0.5 ? 0 : 1;
      ctx.brake = opts.hill ? 0.5 : 0;
      ctx.thr = 0;
      ctx.log = [{ t: sim.t, mode: ctx.mode }];
    }
    const set = m => { if (ctx.mode !== m) { ctx.mode = m; ctx.modeT = sim.t; ctx.log.push({ t: sim.t, mode: m }); } };
    let vt = opts.target(sim, ctx);
    const rem = opts.stopAt ? opts.stopAt(sim) : null;
    let thrT = 0, brakeT = 0;
    const slope = Math.sin(Math.atan(sim.proj.grade));
    const ratio = ratioOf(c.gear);
    const wW = (c.v / CAR.r) * ratio;

    if (rem !== null && ctx.mode !== 'stopped' && rem < (c.v * c.v) / (2 * 1.5) + 1.5) set('braking');

    switch (ctx.mode) {
      case 'stopped': {
        ctx.clutch = toward(ctx.clutch, 1, 4, dt);
        brakeT = opts.hill ? 0.5 : (rem !== null ? 0.4 : 0.3);
        if (vt > 0.3 && rem === null && sim.t - ctx.modeT > (opts.startDelay ?? 0.6)) {
          if (c.auto) { set('drive'); break; }
          set('launch');
          ctx.clutch = Math.min(ctx.clutch, 0.72);
        }
        break;
      }
      case 'launch': {
        const rpmT = opts.hill ? 1900 : 1500;
        thrT = clamp(0.1 + (rpmT - rpm) * 0.0006, 0, 0.55);
        if (c.v > 0.4 && rpm > 950) ctx.clutch -= 0.3 * dt;       // rolling: keep lifting
        else if (rpm > rpmT - 300) ctx.clutch -= 0.22 * dt;       // revs up: find the bite
        else if (rpm < 1000) ctx.clutch += 0.3 * dt;              // revs sagging: back off
        if (opts.hill) {
          const pull = c.tc * ratio * CAR.eff / CAR.r;
          brakeT = pull > CAR.mass * 9.81 * slope * 1.05 ? 0 : ctx.brake;
        }
        if ((c.v > 0.5 && c.omegaE - wW < 3) || ctx.clutch < 0.32) set('drive');
        if (vt < 0.2) set('stopping');
        break;
      }
      case 'drive': {
        ctx.clutch = toward(ctx.clutch, 0, 1.2, dt);
        thrT = clamp(0.06 + (vt - c.v) * 0.4 + slope * 2, 0, c.auto ? (opts.hill ? 0.55 : 0.4) : 0.7);
        if (c.v > vt + 0.4) { brakeT = clamp((c.v - vt - 0.4) * 0.25, 0, 0.5); thrT = 0; }
        if ((!c.auto && rpm < 1100 && c.v > vt - 0.2 && brakeT > 0) || (vt < 0.2 && c.v < 2.5)) set('stopping');
        break;
      }
      case 'braking': {
        thrT = 0;
        if (rem > 0.3 && c.v > 0.05) {
          brakeT = clamp((c.v * c.v) / (2 * rem) / 9 - 0.02, 0, 0.7);
        } else {
          brakeT = 0.4;
        }
        if (rpm < 1150) ctx.clutch = toward(ctx.clutch, 1, 5, dt);
        if (c.v === 0) set('stopped');
        break;
      }
      case 'stopping': {
        ctx.clutch = toward(ctx.clutch, 1, 5, dt);
        brakeT = c.v > 0.05 ? clamp(0.08 + (c.v - vt) * 0.35, 0, 0.6) : 0.3;
        if (c.v === 0) set('stopped');
        else if (vt > c.v + 0.8 && c.v < 1.5 && c.auto) set('drive');
        else if (vt > c.v + 0.8 && c.v < 1.5) { set('launch'); ctx.clutch = Math.min(ctx.clutch, 0.72); }
        break;
      }
    }
    ctx.clutch = clamp(ctx.clutch, 0, 1);
    ctx.thr = toward(ctx.thr, thrT, 2.5, dt);
    ctx.brake = toward(ctx.brake, brakeT, 3, dt);
    return { steer: opts.steer ? opts.steer(sim) : pursuit(sim), throttle: ctx.thr, brake: ctx.brake, clutch: ctx.clutch };
  };
}
