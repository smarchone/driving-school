// Engine note (you learn the bite point by ear) and the instructor's voice.

// ---------------------------------------------------------------- voice choice
// Browsers ship a mix of natural voices and old, very robotic ones. Rank them so we
// pick a natural one when it exists, and never a novelty voice.
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|\bfred\b|junior|ralph|kathy|princess|hysterical|grandma|grandpa|\beddy\b|\bflo\b|\breed\b|rocko|sandy|shelley|espeak/i;
const NATURAL = /premium|enhanced|neural|natural|online|siri/i;
const GOOD_MAC = /samantha|daniel|karen|moira|serena|tessa|veena|isha|arthur|martha|catherine|aaron|nicky|alex/i;

export function voiceScore(v) {
  if (!/^en/i.test(v.lang)) return -Infinity;
  if (NOVELTY.test(v.name)) return -100;
  let s = 0;
  if (NATURAL.test(v.name)) s += 50;
  if (/^google/i.test(v.name)) s += 30;           // Chrome's network voices: smooth
  if (/^microsoft/i.test(v.name)) s += 10;
  if (GOOD_MAC.test(v.name)) s += 15;
  if (/compact/i.test(v.voiceURI || '')) s -= 20;  // macOS low-quality builds
  if (!v.localService) s += 5;
  const lang = v.lang.replace('_', '-');
  s += lang === 'en-IN' ? 8 : lang === 'en-GB' ? 6 : lang === 'en-US' ? 4 : 0;
  return s;
}

// Speech engines read "24 m" as "24 em" and "km/h" letter by letter.
export function speakable(text) {
  return String(text)
    .replace(/(\d+(?:\.\d+)?)\s?km\/h\b/g, '$1 kilometres an hour')
    .replace(/\b1\s?m\b/g, '1 metre')
    .replace(/(\d+(?:\.\d+)?)\s?m\b(?!\/)/g, '$1 metres')
    .replace(/(\d+)\s?cm\b/g, '$1 centimetres')
    .replace(/(\d+)\s?rpm\b/gi, '$1 revs')
    .replace(/[→✓★✕·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createAudio() {
  let ctx = null, main, sub, lp, body, rumble, chug, chugDepth, out;
  const self = { sound: true, voice: true, voiceName: null };

  self.unlock = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new AudioContext();
      // Firing pulse: a few harmonics that fall off fast. Warmer than a raw saw/square.
      const n = 12, re = new Float32Array(n), im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (k % 2 ? 1 : 0.55) / (k * k * 0.6 + 0.4);
      const wave = ctx.createPeriodicWave(re, im);
      main = ctx.createOscillator(); main.setPeriodicWave(wave);
      sub = ctx.createOscillator(); sub.type = 'sine';       // crank order: body
      const subG = ctx.createGain(); subG.gain.value = 0.7;
      lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
      body = ctx.createGain(); body.gain.value = 0;

      // Exhaust rumble: low noise, pulsed at the firing rate so it "chugs" instead of hissing.
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); d[i] = last * 6; }
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 120; nf.Q.value = 0.8;
      chug = ctx.createGain(); chug.gain.value = 0.5;
      chugDepth = ctx.createGain(); chugDepth.gain.value = 0.45;
      main.connect(chugDepth); chugDepth.connect(chug.gain);
      rumble = ctx.createGain(); rumble.gain.value = 0;
      noise.connect(nf); nf.connect(chug); chug.connect(rumble);

      // Gentle saturation + compressor glue it together.
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(1.6 * x); }
      shaper.curve = curve;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
      out = ctx.createGain(); out.gain.value = 0.9;

      main.connect(lp); sub.connect(subG); subG.connect(lp); lp.connect(body);
      body.connect(shaper); rumble.connect(shaper);
      shaper.connect(comp); comp.connect(out); out.connect(ctx.destination);
      main.start(); sub.start(); noise.start();
    } catch { ctx = null; }
  };

  // rpm 0 = engine off
  let wob = 0;
  self.engine = (rpm, throttle = 0, on = true) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const audible = on && self.sound && rpm > 0;
    // A real engine never holds a perfect pitch: a slow, small wander keeps it from sounding synthetic.
    wob += (Math.random() - 0.5) * 0.004; wob *= 0.96;
    const f = Math.max(12, (rpm / 60) * 2) * (1 + wob); // 4-cylinder firing frequency
    main.frequency.setTargetAtTime(f, t, 0.04);
    sub.frequency.setTargetAtTime(f / 2, t, 0.04);
    lp.frequency.setTargetAtTime(180 + rpm * 0.22 + throttle * 1400, t, 0.06);
    const load = Math.min(rpm, 6000) / 6000;
    body.gain.setTargetAtTime(audible ? 0.07 + throttle * 0.06 + load * 0.05 : 0, t, 0.06);
    rumble.gain.setTargetAtTime(audible ? 0.05 + throttle * 0.05 : 0, t, 0.06);
  };

  // ---------------------------------------------------------------- voice
  const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let voicePick = null;
  self.voices = () => (hasSpeech ? speechSynthesis.getVoices().filter(v => voiceScore(v) > -100).sort((a, b) => voiceScore(b) - voiceScore(a)) : []);
  function pickVoice() {
    if (voicePick || !hasSpeech) return voicePick;
    const vs = self.voices();
    voicePick = (self.voiceName && vs.find(v => v.name === self.voiceName)) || vs[0] || null;
    return voicePick;
  }
  self.setVoice = name => { self.voiceName = name || null; voicePick = null; pickVoice(); };
  self.current = () => pickVoice()?.name || null;
  self.onvoices = null;
  if (hasSpeech) speechSynthesis.addEventListener?.('voiceschanged', () => { voicePick = null; pickVoice(); self.onvoices?.(); });

  // Interrupting cancels whatever is playing (for warnings). Otherwise a line waits for the
  // current one, only the newest waiting line is kept, and it is dropped if it has gone stale.
  let current = null, pending = null;
  function speakNow(text) {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 0.98; u.pitch = 1; u.volume = 1;
    const done = () => {
      if (current !== u) return;
      current = null;
      const p = pending; pending = null;
      if (p && performance.now() - p.at < 3500) speakNow(p.text);
    };
    u.onend = done; u.onerror = done;
    current = u;
    speechSynthesis.speak(u);
  }
  self.say = (text, interrupt = true) => {
    if (!self.voice || !hasSpeech || !text) return;
    const line = speakable(text);
    try {
      if (interrupt || !current) {
        pending = null; current = null;
        speechSynthesis.cancel();
        speakNow(line);
      } else {
        pending = { text: line, at: performance.now() };
      }
    } catch { /* speech unavailable */ }
  };
  self.hush = () => { pending = null; current = null; try { speechSynthesis.cancel(); } catch { /* */ } };
  return self;
}
