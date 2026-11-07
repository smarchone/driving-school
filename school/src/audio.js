// Engine note (you learn the bite point by ear) and the instructor's voice.

export function createAudio() {
  let ctx = null, osc1, osc2, filter, gain, noiseGain;
  const self = { sound: true, voice: true };

  self.unlock = () => {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new AudioContext();
      osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
      osc2 = ctx.createOscillator(); osc2.type = 'square';
      filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2;
      gain = ctx.createGain(); gain.gain.value = 0;
      const g2 = ctx.createGain(); g2.gain.value = 0.5;
      osc1.connect(filter); osc2.connect(g2); g2.connect(filter);
      // a little rumble so idle doesn't sound like a pure tone
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 180;
      noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      noise.connect(nf); nf.connect(noiseGain); noiseGain.connect(gain);
      filter.connect(gain); gain.connect(ctx.destination);
      osc1.start(); osc2.start(); noise.start();
    } catch { ctx = null; }
  };

  // rpm 0 = engine off
  self.engine = (rpm, throttle = 0, on = true) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const audible = on && self.sound && rpm > 0;
    const f = Math.max(20, (rpm / 60) * 2); // 4-cylinder firing frequency
    osc1.frequency.setTargetAtTime(f, t, 0.03);
    osc2.frequency.setTargetAtTime(f / 2, t, 0.03);
    filter.frequency.setTargetAtTime(250 + rpm * 0.35 + throttle * 900, t, 0.05);
    gain.gain.setTargetAtTime(audible ? 0.05 + throttle * 0.05 + Math.min(rpm, 6000) / 6000 * 0.04 : 0, t, 0.05);
    noiseGain.gain.setTargetAtTime(audible ? 0.6 : 0, t, 0.05);
  };

  let voicePick = null;
  function pickVoice() {
    if (voicePick || !('speechSynthesis' in window)) return voicePick;
    const vs = speechSynthesis.getVoices();
    voicePick = vs.find(v => v.lang === 'en-IN') || vs.find(v => v.lang === 'en-GB') || vs.find(v => v.lang.startsWith('en')) || null;
    return voicePick;
  }
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { voicePick = null; pickVoice(); };

  self.say = (text, interrupt = true) => {
    if (!self.voice || !('speechSynthesis' in window) || !text) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  };
  self.hush = () => { try { speechSynthesis.cancel(); } catch { /* */ } };
  return self;
}
