# Driving School — M0

An at-home driving school for people with a wheel (built and tuned on a Logitech G29).
One core loop, repeated per *moment*:

    brief → (demo) → get set → drive with assist → deterministic instructor → playback debrief → retry

Run it:

    make school          # serves the repo, open http://127.0.0.1:8000/school/
    node school/tools/check.mjs   # headless: every expert run passes its own moment; bad drivers get the right feedback

Chrome is recommended (Gamepad API + speech voices). Press any wheel button once so the browser sees the wheel.

## The ladder (skill graph)

1. **Moving off** — find the bite point
2. **Stop at the line** — brake and clutch together
3. **Take the bend** — slow in, steer smooth
4. **Creep in traffic** — clutch control, stop and go (behind an auto)
5. **Hill start** — no roll-back (flyover ramp)

## How it fits together

| File | Role |
|---|---|
| `src/physics.js` | Manual hatchback: clutch slip, bite point, stall, hills. 960 Hz fixed step |
| `src/road.js` | Road centreline, projection; India keeps left |
| `src/sim.js` | Deterministic sim + 60 Hz telemetry frames, each with a restorable snapshot |
| `src/instructor.js` | Rule-based detectors (stall + cause, jerk, harsh brake, lane, roll-back, gap…), live cues, evaluation |
| `src/expert.js` | Scripted good driver using the same controls → the ghost, ghost pedals and demo |
| `src/moments.js` | The lessons as data: road, start, pose, criteria, cues, expert |
| `src/render.js` | three.js scene; `src/main.js` the flow; `src/chart.js` debrief chart |

Gearbox: **manual** (clutch, bite point, stalls, paddle shifts) or **automatic** (torque converter: creeps off the brake,
shifts itself, never stalls — but still rolls back on the ramp if you're slow from brake to gas). Switch it on the lessons
screen; each gearbox has its own wording, cues, pass rules and progress.

Stop at the line has distance cues: kerbside 50 / 30 / 10 m boards (always), a "m to line" readout, and with full
assist an amber BRAKE mark where the good run starts braking (24 m at 30 km/h) plus a moving "you'd stop here" marker
(teal = if you brake now, amber = brake now / stopping short, green = on target, red = over the line).

**Practice is the main way to learn** (repeat, adjust, improve): a 5–10 minute session of reps with no menus in between.
Creep in traffic is one long street where every stop-go of the auto is a rep; other moments reset to the start after each run.
After every rep the instructor says one line: praise, or the tip for whatever keeps going wrong. Three clean reps in a row
fade the help (full → voice only → off); two misses bring it back. The session ends with a summary of how each habit changed
from the first half to the second. Five clean reps in a row counts as passing the moment. "Test yourself" keeps the
single run with a full replay debrief.

Assist levels: **full** (ghost car, ghost pedal markers, bite zone, voice cues) → **voice only** → **off (test)**.
Passing with assists off marks a moment *Mastered ★*.

Known limits (M0): no force feedback in the browser (the wheel has no self-centring), keyboard is a fallback only,
progress lives in this browser's localStorage, no learner model yet.
