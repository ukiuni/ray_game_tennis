// Tiny WebAudio synth for retro sound effects (no audio files needed).
let ctx = null;
let muted = false;

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    // iOS: play a silent buffer inside the gesture
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch {
    /* ignore */
  }
}

export function setMuted(v) {
  muted = v;
}
export function isMuted() {
  return muted;
}

function tone(freq, dur, type = 'square', vol = 0.15, slide = 0, delay = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.2, freq = 1800) {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(ctx.destination);
  s.start();
}

export const sfx = {
  hit(strong) {
    noise(0.06, strong ? 0.5 : 0.3, strong ? 2400 : 1600);
    tone(strong ? 520 : 380, 0.07, 'square', 0.1, -200);
  },
  swing() {
    noise(0.08, 0.06, 900);
  },
  bounce() {
    tone(160, 0.06, 'triangle', 0.18, -60);
  },
  net() {
    tone(110, 0.15, 'sawtooth', 0.12, -40);
  },
  point(good) {
    if (good) {
      tone(660, 0.1, 'square', 0.1);
      tone(990, 0.15, 'square', 0.1, 0, 0.1);
    } else {
      tone(330, 0.12, 'square', 0.1);
      tone(220, 0.2, 'square', 0.1, 0, 0.12);
    }
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, 'square', 0.1, 0, i * 0.12));
  },
  lose() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, 0, i * 0.16));
  },
};
