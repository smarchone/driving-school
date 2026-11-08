# Driving School — M0

An at-home driving school for people with a wheel (built and tuned on a Logitech G29).
One core loop, repeated per *moment*:

    brief → (demo) → get set → drive with assist → deterministic instructor → playback debrief → retry

Run it:

    make school          # static server, open http://127.0.0.1:8000/school/
    node school/tools/check.mjs   # headless: every expert run passes its own moment; bad drivers get the right feedback

Chrome is recommended (Gamepad API + speech voices). Press any wheel button once so the browser sees the wheel.

Wheel calibration is saved once, in the browser (localStorage), and reused: "Looks right, continue" on the wheel check,
the calibration wizard, or a pedal's Reverse button saves it. With a saved calibration the app opens on the lessons.
No server is needed, so it runs as static files (e.g. GitHub Pages). localStorage belongs to one address: locally,
use the same host and port each time (`127.0.0.1:8000` and `localhost:8000` are different).

## The ladder (skill graph)

1. **Moving off** — find the bite point
2. **Stop at the line** — brake and clutch together
3. **Take the bend** — slow in, steer smooth
4. **Creep in traffic** — clutch control, stop and go (behind an auto)
5. **Hill start** — no roll-back (flyover ramp)

**Free drive** (always open, below the ladder): a town loop with keep-left streets, four left-hand corners and a small
flyover hump, about 900 m per lap, long enough for over an hour. No score, timer or ghost; the instructor speaks only when
something goes wrong. Finish with Esc for a summary (distance, average speed, what came up) and the session download.

## How it fits together

Generic engines, configured by lessons. A **moment** (a lesson) is data: it names what to draw, which detectors coach,
what passes, and how the good driver drives. A **mode** is the shape of a visit (test, practice, free drive). Code that
names a specific lesson belongs in `moments.js`; everything else names only a *kind* of thing, looked up in a registry.

| Layer | File | Role |
|---|---|---|
| Simulation | `src/physics.js` | Manual hatchback: clutch slip, bite point, stall, hills; automatic torque converter. 960 Hz fixed step |
| | `src/road.js` | Road centreline, projection to `(s, d)`; India keeps left |
| | `src/sim.js` | Deterministic sim + 60 Hz telemetry frames, each with a restorable snapshot |
| | `src/telemetry.js` | The frame schema: every field with its unit, and which ones the session log saves |
| Judgment | `src/detectors.js` | **Registry** of mistakes (stall + cause, jerk, harsh brake, over-rev, lane, roll-back, crash, tailgate…): stats always, events when switched on |
| | `src/instructor.js` | Runs the detectors, the moment's measure() and cues; `evaluate()` → report |
| Reference | `src/expert.js` | Scripted good driver using the same controls → the ghost, ghost pedals and demo |
| Teaching | `src/moments.js` | The lessons as data (fields listed at the top of the file) |
| | `src/modes.js` | **Registry** of visit shapes: test → debrief, practice reps → summary, free drive → summary |
| | `src/practice.js` | Rep scoring, assist fading, rep splitters for continuous practice (**registry**), practice summary |
| Experience | `src/zones.js` | **Registry** of things on the road (stop line, BRAKE mark, boards, gate, speed sign…) |
| | `src/aids.js` | **Registry** of target kinds: distance readout, "you'd stop here" marker, chart marks |
| | `src/render.js` | three.js scene; `src/main.js` the app shell (screens, HUD, loop); `src/chart.js` debrief chart |
| Memory | `src/progress.js` | Progress and settings in localStorage; `src/session.js` the session log |

Adding things:

- **A lesson** that reuses existing kinds: a new moment in `moments.js`, then `node school/tools/check.mjs`.
- **A new mistake**: a detector in `detectors.js`; switch it on with a moment's `detect`.
- **A new road object / target / way to cut reps**: an entry in `zones.js` / `aids.js` / `SEGMENTERS`.
- **A new kind of visit** (task-based drive, long drive): an entry in `modes.js`; the brief, bar, summary and log follow it.

`check.mjs` fails if a moment names a detector, zone, aid, mode or rep splitter that doesn't exist, or if frames drift from
`telemetry.js`. `window.ds` exposes the live state and every registry (`MODES`, `DETECTORS`, `ZONES`, `AIDS`, `FRAME`)
for the console and for agents.

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

## Session log (plug-in point for analysis / LLM agents)

Every lesson visit writes into one in-memory object, `window.ds.session` (`src/session.js`, schema v1). Not persisted yet;
"Download data" on the debrief and the practice summary saves it as JSON.

| Part | What |
|---|---|
| `meta` | lesson, gearbox, kind (practice / test), input device, start/end time |
| `runs[]` | each run (test, practice rep, retry from here): frame range, result, checks, metrics |
| `reps[]` | each practice rep: clean?, assist level, checks, metrics (e.g. reaction_s, minGap, maxAccel, brakeAt), frame range |
| `events[]` | every instructor finding: session time, rep, type, severity, cause (title), tip, frame index |
| `frames` | telemetry columns at 60 Hz: `T t run s d v a rpm gear running e thr brk clu steer gap leadV` (units in `fields`) |
| `ref` | the good run's frames, for comparisons |

Helpers: `summary()` gives a compact brief for an LLM (context, reps, findings, per-check trend; no raw frames, ~2–3 KB);
`slice(T0, T1, fields)` returns raw telemetry for a time window; `around(event, before, after, fields)` returns the
telemetry around a finding; `toJSON()` returns everything.
