// Per-learner progress on the ladder (this browser only, for M0).
const KEY = 'ds.progress.v1';
const SETTINGS = 'ds.settings.v1';

function read(k, fallback) {
  try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; }
}
function write(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export function loadProgress() { return read(KEY, {}); }

export function recordAttempt(progress, id, report, assist) {
  const p = progress[id] || { attempts: 0, passed: false, passedNoAssist: false, best: null };
  p.attempts++;
  if (report.passed && !report.practice) {
    p.passed = true;
    if (assist === 'off') p.passedNoAssist = true;
  }
  progress[id] = p;
  write(KEY, progress);
  return p;
}

// A practice session: reps and how clean they were. A clean streak of 5 counts as passing.
export function recordPractice(progress, id, P) {
  const p = progress[id] || { attempts: 0, passed: false, passedNoAssist: false, best: null };
  const clean = P.reps.filter(r => r.clean).length;
  p.practice = { reps: (p.practice?.reps || 0) + P.reps.length, clean: (p.practice?.clean || 0) + clean, last: { reps: P.reps.length, clean } };
  if (P.bestStreak >= 5) p.passed = true;
  if (P.bestStreakNoAssist >= 5) p.passedNoAssist = true;
  progress[id] = p;
  write(KEY, progress);
  return p;
}

export function resetProgress() { write(KEY, {}); return {}; }

export function loadSettings() {
  return { assist: 'full', camera: 'cockpit', voice: true, sound: true, transmission: 'manual', ...read(SETTINGS, {}) };
}
export function saveSettings(s) { write(SETTINGS, s); }
