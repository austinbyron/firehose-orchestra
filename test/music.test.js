import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fnv1a, SCALE, pitchFor, midiToHz, noteLengthFor, langInfo, chordAt, CHORDS,
  Ema, RateTracker, createBurstDetector, nextKey, applyCaps, CAPS,
} from '../src/music.js';

test('fnv1a is deterministic and 32-bit', () => {
  assert.equal(fnv1a('did:plc:abc'), fnv1a('did:plc:abc'));
  assert.notEqual(fnv1a('did:plc:abc'), fnv1a('did:plc:abd'));
  const h = fnv1a('anything');
  assert.ok(h >= 0 && h <= 0xffffffff);
});

test('pitchFor is stable per DID and lands on the pentatonic scale', () => {
  const a = pitchFor('did:plc:one', 0);
  assert.equal(a, pitchFor('did:plc:one', 0));
  assert.ok(SCALE.includes(a % 12), `pitch class ${a % 12} not in scale`);
  assert.ok(a >= 48 && a < 84);
});

test('pitchFor transposes with the key root', () => {
  const c = pitchFor('did:plc:one', 0);
  const g = pitchFor('did:plc:one', 7);
  assert.equal((g - c + 120) % 12, 7);
});

test('midiToHz', () => {
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(57) - 220) < 1e-9);
});

test('noteLengthFor clamps', () => {
  assert.equal(noteLengthFor(0), 0.1);
  assert.equal(noteLengthFor(30), 0.5);
  assert.equal(noteLengthFor(1000), 1.2);
});

test('langInfo returns a table entry or the default', () => {
  const en = langInfo('en');
  assert.ok(en.pan >= -1 && en.pan <= 1);
  assert.ok(en.hue >= 0 && en.hue < 360);
  const unknown = langInfo('xx');
  assert.equal(unknown.pan, 0);
  assert.deepEqual(langInfo(null), unknown);
});

test('chordAt returns 4 MIDI voices in a low register, cycles progression', () => {
  const c0 = chordAt(0, 0);
  assert.equal(c0.length, 4);
  for (const m of c0) assert.ok(m >= 36 && m < 72);
  assert.deepEqual(chordAt(CHORDS.length, 0), c0);
});

test('Ema approaches the input', () => {
  const e = new Ema(5);
  for (let i = 0; i < 100; i++) e.update(10, 1);
  assert.ok(Math.abs(e.value - 10) < 0.01);
});

test('Ema first sample seeds directly', () => {
  const e = new Ema(60);
  e.update(42, 1);
  assert.equal(e.value, 42);
});

test('RateTracker tracks instantaneous and smoothed rates', () => {
  const r = new RateTracker();
  for (let s = 0; s < 30; s++) { r.add(50); r.sample(1); }
  assert.equal(r.inst, 50);
  assert.ok(Math.abs(r.fast - 50) < 1);
  assert.ok(r.slow > 15 && r.slow <= 50);
});

test('burst detector needs ratio held for holdSec, then cools down', () => {
  const b = createBurstDetector({ ratio: 2, holdSec: 3, cooldownSec: 90 });
  assert.equal(b(100, 40, 0), false);
  assert.equal(b(100, 40, 1), false);
  assert.equal(b(100, 40, 2), false);
  assert.equal(b(100, 40, 3), true);
  assert.equal(b(100, 40, 4), false);
  assert.equal(b(100, 40, 93), false);
  assert.equal(b(100, 40, 96), true);
});

test('burst detector resets hold when ratio drops', () => {
  const b = createBurstDetector({ ratio: 2, holdSec: 3, cooldownSec: 0 });
  b(100, 40, 0); b(100, 40, 1);
  b(50, 40, 2);
  assert.equal(b(100, 40, 3), false);
  assert.equal(b(100, 40, 4), false);
  assert.equal(b(100, 40, 6), true);
});

test('nextKey moves a fifth up or down', () => {
  assert.equal(nextKey(0, () => 0.9), 7);
  assert.equal(nextKey(0, () => 0.1), 5);
  assert.equal(nextKey(11, () => 0.9), 6);
});

test('applyCaps limits per type and counts drops', () => {
  const ev = (type) => ({ type, did: 'x', timeUs: 0, lang: 'en', text: '', parentUri: null, record: null });
  const events = [
    ...Array.from({ length: 20 }, () => ev('like')),
    ...Array.from({ length: 3 }, () => ev('repost')),
    ev('follow'), ev('follow'),
    ev('post'),
  ];
  const { scheduled, dropped } = applyCaps(events, CAPS);
  const count = (t) => scheduled.filter((e) => e.type === t).length;
  assert.equal(count('like'), 8);
  assert.equal(count('repost'), 2);
  assert.equal(count('follow'), 1);
  assert.equal(count('post'), 1);
  assert.equal(dropped, 12 + 1 + 1);
});
