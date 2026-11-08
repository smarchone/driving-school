// Wheel (Gamepad API) + keyboard fallback, with a calibration store.
// Defaults come from a real G29 on Chrome/macOS (PS3 mode, raw HID axis order).

const KEY = 'ds.wheel.v1';

export const G29_DEFAULT = {
  steer: { axis: 0, center: 0, sign: 1 },
  clu: { axis: 1, rest: 1, full: -1 },
  thr: { axis: 2, rest: 1, full: -1 },
  brk: { axis: 5, rest: 1, full: -0.7 }, // stiff pedal: a hard press reaches ~-0.8
  up: 4,
  down: 5,
  ok: [0, 1, 2, 3],
};

function load() {
  try { const m = JSON.parse(localStorage.getItem(KEY)); if (m && m.steer) return m; } catch { /* storage unavailable */ }
  return null;
}
export function saveMapping(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}
export function clearMapping() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

const clamp01 = v => Math.max(0, Math.min(1, v));

export function createInput() {
  const keys = new Set();
  const pressedOnce = new Set();
  const kb = { steer: 0, throttle: 0, brake: 0, clutch: 0 };
  const awake = { clu: false, thr: false, brk: false };
  // Which way each pedal points, learned from its first real reading (pedals wake at rest).
  // 1 = as configured, -1 = this browser reports it the other way round.
  const orient = { clu: 1, thr: 1, brk: 1 };
  let prevButtons = [];
  const stored = load();
  const self = {
    mapping: stored || G29_DEFAULT,
    custom: !!stored,
    source: stored ? 'browser' : 'default', // 'browser' | 'default'
    mode: 'keyboard',
    pad: null,
    awake,
  };

  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (!keys.has(e.code)) pressedOnce.add(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  self.getPad = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    return pads.find(p => p.axes.length >= 3) || null;
  };

  self.rawAxes = () => { const p = self.getPad(); return p ? [...p.axes] : []; };
  self.rawButtons = () => { const p = self.getPad(); return p ? p.buttons.map(b => b.pressed) : []; };

  function pedal(pad, cfg, name) {
    const raw = pad.axes[cfg.axis];
    if (raw === undefined) return 0;
    // Pedal axes read a meaningless 0 until each pedal is touched once after connecting.
    if (!awake[name]) {
      if (raw === 0) return 0;
      awake[name] = true;
      // Uncalibrated defaults: trust the side the pedal wakes on as "released".
      if (!self.custom && Math.abs(raw) > 0.5) orient[name] = Math.sign(raw) === Math.sign(cfg.rest) ? 1 : -1;
    }
    const o = orient[name];
    return clamp01((cfg.rest * o - raw) / ((cfg.rest - cfg.full) * o));
  }

  // Returns the current controls plus one-shot events (shift, ok, retry, back).
  self.poll = dt => {
    const pad = self.getPad();
    self.pad = pad;
    const m = self.mapping;
    const ev = { shift: 0, ok: false, retry: false, back: false, prev: false, next: false, any: false };
    const once = c => pressedOnce.has(c);
    if (pressedOnce.size) ev.any = true;
    if (once('Enter')) ev.ok = true;
    if (once('KeyR')) ev.retry = true;
    if (once('Escape')) ev.back = true;
    if (once('KeyE') || once('PageUp')) ev.shift = 1;
    if (once('KeyQ') || once('PageDown')) ev.shift = -1;
    if (once('BracketLeft')) ev.prev = true;
    if (once('BracketRight')) ev.next = true;

    let out;
    const wheelActive = pad && (self.mode === 'wheel' || pad.buttons.some(b => b.pressed));
    if (wheelActive) self.mode = 'wheel';
    if (pad && self.mode === 'wheel') {
      const btn = pad.buttons.map(b => b.pressed);
      const edge = i => btn[i] && !prevButtons[i];
      if (edge(m.up)) { ev.shift = 1; ev.next = true; }
      if (edge(m.down)) { ev.shift = -1; ev.prev = true; }
      if ((m.ok || []).some(edge)) { ev.ok = true; ev.retry = true; }
      if (btn.some((b, i) => b && !prevButtons[i])) ev.any = true;
      prevButtons = btn;
      const raw = pad.axes[m.steer.axis] ?? 0;
      out = {
        steer: Math.max(-1, Math.min(1, (raw - m.steer.center) * m.steer.sign)),
        throttle: pedal(pad, m.thr, 'thr'),
        brake: pedal(pad, m.brk, 'brk'),
        clutch: m.clu ? pedal(pad, m.clu, 'clu') : 0,
      };
    } else {
      // Keyboard: pedals ramp so slow clutch work is possible.
      const ramp = (v, on, up, down) => clamp01(on ? v + up * dt : v - down * dt);
      kb.throttle = ramp(kb.throttle, keys.has('ArrowUp') || keys.has('KeyW'), 1.5, 3);
      kb.brake = ramp(kb.brake, keys.has('ArrowDown') || keys.has('KeyS'), 1.5, 3);
      kb.clutch = ramp(kb.clutch, keys.has('Space'), 4, keys.has('ShiftLeft') ? 0 : 0.6);
      const target = (keys.has('ArrowRight') || keys.has('KeyD') ? 0.35 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 0.35 : 0);
      kb.steer += Math.max(-1.2 * dt, Math.min(1.2 * dt, target - kb.steer));
      out = { ...kb };
      if (pad && pad.buttons.some(b => b.pressed)) self.mode = 'wheel';
    }
    pressedOnce.clear();
    return { ...out, ev };
  };

  // The mapping as it is being read right now, with any learned pedal direction baked in.
  self.effective = () => {
    const m = JSON.parse(JSON.stringify(self.mapping));
    for (const k of ['clu', 'thr', 'brk']) {
      if (!m[k]) continue;
      m[k].rest *= orient[k];
      m[k].full *= orient[k];
    }
    return m;
  };

  // Save a mapping in this browser (localStorage). No server needed, so it works on static hosting.
  self.save = (m = self.effective()) => {
    const saved = { ...m, savedAt: new Date().toISOString(), padId: self.getPad()?.id || m.padId || null };
    self.mapping = saved;
    self.custom = true;
    self.source = 'browser';
    orient.clu = orient.thr = orient.brk = 1;
    saveMapping(saved);
    return saved;
  };

  self.useMapping = m => self.save(m);
  // Reverse one pedal (pedals can report in different directions, even on the same wheel) and save.
  self.flipPedal = k => {
    const m = self.effective();
    if (!m[k]) return self.mapping;
    m[k].rest = -m[k].rest;
    m[k].full = -m[k].full;
    return self.save(m);
  };
  self.resetMapping = () => { self.mapping = G29_DEFAULT; self.custom = false; self.source = 'default'; clearMapping(); };
  return self;
}
