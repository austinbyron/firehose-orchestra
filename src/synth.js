import { midiToHz } from './music.js';

export function makeImpulse(ctx, seconds = 3, decay = 2.5) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function panner(ctx, pan) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

export class Drone {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 0.7;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.14;
    this.filter.connect(this.gain).connect(out);
    this.voices = [];
    const waves = ['sawtooth', 'triangle', 'sawtooth', 'triangle'];
    const detunes = [-6, 4, 7, -3];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = waves[i];
      osc.detune.value = detunes[i];
      osc.frequency.value = 110;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      osc.connect(g).connect(this.filter);
      osc.start();
      this.voices.push({ osc, g });
    }
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.05;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 120;
    this.lfo.connect(this.lfoGain).connect(this.filter.frequency);
    this.lfo.start();
    this.brightness = 0.3;
  }

  setChord(midis, when, glideSec = 2) {
    midis.forEach((m, i) => {
      const v = this.voices[i];
      if (!v) return;
      const hz = midiToHz(m);
      v.osc.frequency.cancelScheduledValues(when);
      v.osc.frequency.setValueAtTime(v.osc.frequency.value, when);
      v.osc.frequency.exponentialRampToValueAtTime(hz, when + glideSec);
    });
  }

  setBrightness(b) {
    this.brightness = b;
    const hz = 250 + Math.pow(b, 1.5) * 2800;
    const t = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(hz, t, 1.5);
  }
}

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.25;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.bus = ctx.createGain();
    this.bus.connect(this.dry).connect(this.comp);
    this.bus.connect(this.reverb).connect(this.wet).connect(this.comp);
    this.comp.connect(this.master).connect(ctx.destination);
    this.drone = new Drone(ctx, this.bus);
    this.muted = false;
    this.volume = 0.8;
  }

  get reduction() { return this.comp.reduction; }

  setVolume(v) {
    this.volume = v;
    if (!this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setWet(w) { this.wet.gain.setTargetAtTime(0.15 + 0.5 * w, this.ctx.currentTime, 1); }

  pluck({ when, midi, dur, pan = 0, timbre = 0.5, gain = 0.16 }) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const osc = ctx.createOscillator();
    osc.type = timbre > 0.6 ? 'square' : 'triangle';
    osc.frequency.value = hz;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2 + timbre * 8;
    f.frequency.setValueAtTime(hz * 6, when);
    f.frequency.exponentialRampToValueAtTime(hz * 1.2, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
    const p = panner(ctx, pan);
    osc.connect(f).connect(g).connect(p).connect(this.bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    osc.onended = () => { osc.disconnect(); f.disconnect(); g.disconnect(); p.disconnect(); };
  }

  tick({ when, pan = 0, gain = 0.07 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.03);
    const p = panner(ctx, pan);
    src.connect(f).connect(g).connect(p).connect(this.bus);
    src.start(when);
    src.stop(when + 0.05);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); p.disconnect(); };
  }

  rim({ when, pan = 0, gain = 0.2 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, when);
    osc.frequency.exponentialRampToValueAtTime(180, when + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.12);
    const p = panner(ctx, pan);
    osc.connect(g).connect(p).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.15);
    osc.onended = () => { osc.disconnect(); g.disconnect(); p.disconnect(); };
    this.tick({ when, pan, gain: gain * 0.6 });
  }

  swell({ when, pan = 0, gain = 0.14 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, when);
    osc.frequency.exponentialRampToValueAtTime(330, when + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.3);
    g.gain.linearRampToValueAtTime(0, when + 0.8);
    const p = panner(ctx, pan);
    osc.connect(g).connect(p).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.85);
    osc.onended = () => { osc.disconnect(); g.disconnect(); p.disconnect(); };
  }

  noise() {
    if (!this._noise) {
      const len = Math.floor(this.ctx.sampleRate * 0.1);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }
}
