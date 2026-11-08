core engine (same for every mode)
- moment: brief -> sim + assist (overlay) -> telemetry -> deterministic instructor -> playback (analysis) -> retry
- skill graph = the ladder of moments
- detection is deterministic (rules); AI explains on top later

M0 — DONE (school/)
- [x] 5 moments: moving off, stop at line, bend, traffic creep, hill start
- [x] manual car physics: clutch bite, stall, hills, engine braking
- [x] brief + demo (pre-viz: expert ghost run, narrated)
- [x] assist overlay: ghost car, ghost pedal markers, bite zone, stop box
- [x] deterministic instructor: live voice cues + mistake detection with causes
- [x] playback debrief: you vs ghost chart, jump to mistake in slow-mo
- [x] retry / retry from here (practice a section, no waiting a lap)
- [x] G29 defaults + calibration wizard, keyboard fallback
- [x] gearbox: manual or automatic (torque converter, auto shifts), per-gearbox lessons + progress

- [x] free drive: town loop, no score, instructor only on mistakes, drive summary + session log
- [x] practice sessions: timed reps, per-rep coaching, help fades with a clean streak, end-of-session trend

M1 — fading assist (started: per-session fading in practice; next: remember it per moment across sessions)
- assist ladder per moment: full -> voice -> silent -> exam, auto-stepped by results
- 3-5 more moments (roundabout/junction, reversing, gear changes 1-2-3)

M2 — AI instructor
- LLM explains detector output in plain words, Hindi/English voice
- interactive coaching (ask "why did I stall?")

M3 — learner model
- each drive is a learning about the user; pick drills from weak spots

M4 — mid-flight takeover + chaos
- wheel "shows you how" (force feedback via WebHID?), scripted Indian traffic chaos

M5 — school mode
- multi-student per rig, instructor dashboard

later
- modes: free drive, highway, long drive; relaxing drive with music
- community maps / visuals
