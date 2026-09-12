// Pure musical mapping. No DOM, no WebAudio.

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const SCALE = [0, 2, 4, 7, 9];

export function pitchFor(did, keyRoot, { octaveLow = 3, octaveSpan = 3 } = {}) {
  const h = fnv1a(did);
  const degree = SCALE[h % SCALE.length];
  const octave = octaveLow + ((h >>> 8) % octaveSpan);
  return 12 * (octave + 1) + ((keyRoot + degree) % 12);
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteLengthFor(textLen) {
  return Math.min(1.2, Math.max(0.1, textLen / 60));
}

// pan in [-1, 1], hue in degrees, timbre in [0, 1] (filter Q / waveform blend)
export const LANG_TABLE = {
  en: { pan: 0.0, hue: 200, timbre: 0.5 },
  ja: { pan: 0.6, hue: 340, timbre: 0.8 },
  pt: { pan: -0.6, hue: 120, timbre: 0.4 },
  es: { pan: -0.4, hue: 40, timbre: 0.45 },
  de: { pan: 0.3, hue: 60, timbre: 0.6 },
  fr: { pan: -0.2, hue: 260, timbre: 0.55 },
  ko: { pan: 0.8, hue: 300, timbre: 0.85 },
  zh: { pan: 0.45, hue: 0, timbre: 0.7 },
  it: { pan: -0.8, hue: 90, timbre: 0.4 },
  nl: { pan: 0.15, hue: 30, timbre: 0.6 },
  th: { pan: 0.9, hue: 160, timbre: 0.75 },
  tr: { pan: -0.9, hue: 20, timbre: 0.5 },
};
const DEFAULT_LANG = { pan: 0, hue: 220, timbre: 0.5 };

export function langInfo(lang) {
  return (lang && LANG_TABLE[lang]) || DEFAULT_LANG;
}

// Chord progression as semitone offsets from key root for 4 voices (I, vi, IV, V).
export const CHORDS = [
  [0, 7, 12, 16],
  [9, 16, 21, 24],
  [5, 12, 17, 21],
  [7, 14, 19, 23],
];

export function chordAt(index, keyRoot) {
  const chord = CHORDS[((index % CHORDS.length) + CHORDS.length) % CHORDS.length];
  const base = 36 + (keyRoot % 12);
  return chord.map((off) => base + off);
}

export class Ema {
  constructor(tauSec) {
    this.tau = tauSec;
    this.value = 0;
    this.seeded = false;
  }
  update(value, dtSec) {
    if (!this.seeded) { this.value = value; this.seeded = true; return this.value; }
    const a = 1 - Math.exp(-dtSec / this.tau);
    this.value += a * (value - this.value);
    return this.value;
  }
}

export class RateTracker {
  constructor() {
    this.pending = 0;
    this.inst = 0;
    this.fastEma = new Ema(5);
    this.slowEma = new Ema(60);
  }
  add(count = 1) { this.pending += count; }
  sample(dtSec) {
    const rate = dtSec > 0 ? this.pending / dtSec : 0;
    this.inst = rate;
    this.fastEma.update(rate, dtSec);
    this.slowEma.update(rate, dtSec);
    this.pending = 0;
  }
  get fast() { return this.fastEma.value; }
  get slow() { return this.slowEma.value; }
}

export function createBurstDetector({ ratio = 2, holdSec = 3, cooldownSec = 90 } = {}) {
  let heldSince = null;
  let lastFire = -Infinity;
  return function update(fast, slow, nowSec) {
    const hot = slow > 0 && fast >= ratio * slow;
    if (!hot || nowSec - lastFire < cooldownSec) { heldSince = null; return false; }
    if (heldSince === null) heldSince = nowSec;
    if (nowSec - heldSince >= holdSec) {
      lastFire = nowSec;
      heldSince = null;
      return true;
    }
    return false;
  };
}

export function nextKey(current, rand = Math.random) {
  const step = rand() < 0.5 ? 5 : 7;
  return (current + step) % 12;
}

export const CAPS = { post: 12, reply: 6, like: 8, repost: 2, follow: 1 };

export function applyCaps(events, caps = CAPS) {
  const used = {};
  const scheduled = [];
  let dropped = 0;
  for (const e of events) {
    const cap = caps[e.type] ?? 0;
    const n = used[e.type] ?? 0;
    if (n < cap) { used[e.type] = n + 1; scheduled.push(e); } else { dropped++; }
  }
  return { scheduled, dropped };
}
