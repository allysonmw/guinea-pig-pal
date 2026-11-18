// Tiny synthesized guinea pig sounds (no audio files needed).
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function chirp(t0, f0, f1, f2, dur, vol) {
  const a = ac();
  const osc = a.createOscillator();
  const osc2 = a.createOscillator();
  const g = a.createGain();
  const filt = a.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 2200;
  filt.Q.value = 0.8;
  osc.type = 'sawtooth';
  osc2.type = 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.45);
  osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  osc2.frequency.setValueAtTime(f0 * 2, t0);
  osc2.frequency.exponentialRampToValueAtTime(f1 * 2, t0 + dur * 0.45);
  osc2.frequency.exponentialRampToValueAtTime(f2 * 2, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(vol * 0.7, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(filt); osc2.connect(filt); filt.connect(g); g.connect(a.destination);
  osc.start(t0); osc2.start(t0); osc.stop(t0 + dur + 0.02); osc2.stop(t0 + dur + 0.02);
}

// ---------- chewing ----------
// A guinea pig chews in fast, crispy little crunches. Each crunch is a cluster of tiny
// crackles (bits of veggie snapping) on top of a soft low "thump" from the jaw.
let noiseBuf = null;
function noise() {
  const a = ac();
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function grain(t, dur, freq, q, vol) {
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noise();
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(a.destination);
  src.start(t, Math.random() * 0.9, dur + 0.01);
}
function crunch(strength = 1, t = ac().currentTime + 0.005) {
  // jaw thump
  grain(t, 0.05, 260 + Math.random() * 120, 1.2, 0.05 * strength);
  // crackles
  const n = 5 + Math.floor(Math.random() * 6 * strength);
  for (let i = 0; i < n; i++) {
    const dt = Math.pow(Math.random(), 1.6) * 0.055;
    grain(t + dt, 0.006 + Math.random() * 0.014, 1800 + Math.random() * 4200, 1.5 + Math.random() * 2, (0.03 + Math.random() * 0.06) * strength);
  }
}

// Optional: your own recording. Put a file named chew.mp3 (or .wav / .m4a / .ogg)
// in the assets/sounds folder and it is used instead of the built-in crunching.
let customChew = null;
(() => {
  // try chew.wav first (loops without a gap), then the other formats, one at a time
  const exts = ['wav', 'mp3', 'm4a', 'ogg'];
  const tryNext = (i) => {
    if (i >= exts.length) return;
    try {
      const el = new Audio(new URL(`../../assets/sounds/chew.${exts[i]}`, import.meta.url).href);
      el.preload = 'auto';
      el.loop = true;
      el.addEventListener('canplaythrough', () => { if (!customChew) customChew = el; }, { once: true });
      el.addEventListener('error', () => tryNext(i + 1), { once: true });
      el.load();
    } catch { tryNext(i + 1); }
  };
  tryNext(0);
})();

let chewTimer = null;
let chewVolume = 0.8;

export const Sounds = {
  enabled: true,
  wheek(times = 2) {
    if (!this.enabled) return;
    const a = ac();
    let t = a.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      chirp(t, 900 + Math.random() * 100, 1900 + Math.random() * 200, 1500, 0.22, 0.12);
      t += 0.3;
    }
  },
  eep() {
    if (!this.enabled) return;
    const a = ac();
    chirp(a.currentTime + 0.01, 1400, 2300, 2100, 0.12, 0.1);
  },
  purr(duration = 0.9) {
    if (!this.enabled) return;
    const a = ac();
    const len = Math.floor(a.sampleRate * duration);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    const src = a.createBufferSource();
    src.buffer = buf;
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = a.createGain();
    g.gain.value = 0;
    const lfo = a.createOscillator();
    const lfoGain = a.createGain();
    lfo.frequency.value = 24;
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    const env = a.createGain();
    const t = a.currentTime;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.15);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(lp); lp.connect(g); g.connect(env); env.connect(a.destination);
    src.start(t); lfo.start(t); src.stop(t + duration); lfo.stop(t + duration);
  },
  burp() {
    if (!this.enabled) return;
    const a = ac();
    const t = a.currentTime + 0.02;
    const osc = a.createOscillator();
    const lp = a.createBiquadFilter();
    const g = a.createGain();
    const wob = a.createOscillator();
    const wobG = a.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.45);
    wob.frequency.value = 28;
    wobG.gain.value = 0.06;
    wob.connect(wobG); wobG.connect(g.gain);
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(lp); lp.connect(g); g.connect(a.destination);
    osc.start(t); wob.start(t); osc.stop(t + 0.52); wob.stop(t + 0.52);
  },
  // continuous chewing while eating
  chewStart(volume = 0.8) {
    if (!this.enabled) return;
    this.chewStop();
    chewVolume = volume;
    if (customChew) {
      customChew.volume = volume;
      try { customChew.currentTime = 0; customChew.play(); } catch { /* ignore */ }
      return;
    }
    const tick = () => {
      if (Math.random() > 0.08) crunch((0.7 + Math.random() * 0.5) * (chewVolume / 0.8));           // the odd little pause
      chewTimer = setTimeout(tick, 120 + Math.random() * 70);                 // ~6 crunches a second
    };
    tick();
  },
  chewStop() {
    clearTimeout(chewTimer);
    chewTimer = null;
    if (customChew) { try { customChew.pause(); } catch { /* ignore */ } }
  },
  // sucking a tab in: a rising whoosh
  slurp(duration = 1.4) {
    if (!this.enabled) return;
    const a = ac();
    const t = a.currentTime + 0.02;
    const src = a.createBufferSource();
    src.buffer = noise();
    src.loop = true;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + duration);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + duration * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.05);
    const wob = a.createOscillator();
    const wobG = a.createGain();
    wob.frequency.value = 9;
    wobG.gain.value = 0.05;
    wob.connect(wobG); wobG.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(a.destination);
    src.start(t); wob.start(t); src.stop(t + duration + 0.1); wob.stop(t + duration + 0.1);
  },
  // the final gulp
  gulp() {
    if (!this.enabled) return;
    const a = ac();
    const t = a.currentTime + 0.01;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g); g.connect(a.destination);
    osc.start(t); osc.stop(t + 0.22);
  },
  // a tiny wet lick on the bottle's ball valve
  lick() {
    if (!this.enabled) return;
    const t = ac().currentTime + 0.005;
    grain(t, 0.035, 2600 + Math.random() * 900, 3, 0.05);
    grain(t + 0.02, 0.03, 1500 + Math.random() * 500, 4, 0.03);
  },
  // an air bubble glugging up into the water bottle
  bloop() {
    if (!this.enabled) return;
    const a = ac();
    const t = a.currentTime + 0.01;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'sine';
    const f = 380 + Math.random() * 220;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g); g.connect(a.destination);
    osc.start(t); osc.stop(t + 0.1);
  },
  // one big crunch (the moment of a bite)
  munch() {
    if (!this.enabled) return;
    if (customChew) return; // the recording already covers it
    crunch(1.6);
  },
  _oldMunch() {
    if (!this.enabled) return;
    const a = ac();
    const t = a.currentTime;
    for (let i = 0; i < 3; i++) {
      const len = Math.floor(a.sampleRate * 0.03);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / len);
      const src = a.createBufferSource();
      src.buffer = buf;
      const hp = a.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = a.createGain();
      g.gain.value = 0.05;
      src.connect(hp); hp.connect(g); g.connect(a.destination);
      src.start(t + i * 0.11);
    }
  },
};
