import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, stepDuration } from '../src/scheduler.js';

const ev = (type) => ({ type, did: 'd', timeUs: 0, lang: 'en', text: '', parentUri: null, record: null });

test('stepDuration', () => {
  assert.ok(Math.abs(stepDuration(120) - 0.125) < 1e-12);
  assert.ok(Math.abs(stepDuration(90) - 60 / 90 / 4) < 1e-12);
});

test('tick schedules buckets ahead of the clock and applies caps', () => {
  const ctx = { currentTime: 0 };
  const ticks = [];
  const s = new Scheduler({ ctx, bpm: 120, lookaheadSec: 0.1, onTick: (ev, when, step, dropped) => ticks.push({ n: ev.length, when, step, dropped }) });
  s.prime();
  for (let i = 0; i < 20; i++) s.push(ev('like'));
  s.tick();
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].n, 8);
  assert.equal(ticks[0].dropped, 12);
  assert.equal(ticks[0].step, 0);
  s.tick();
  assert.equal(ticks.length, 1);
  ctx.currentTime = 0.2;
  s.tick();
  assert.ok(ticks.length >= 2);
  assert.equal(ticks.at(-1).n, 0);
  assert.ok(ticks[1].when > ticks[0].when);
});

test('setBpm changes step spacing; flush clears pending', () => {
  const ctx = { currentTime: 0 };
  const whens = [];
  const s = new Scheduler({ ctx, bpm: 60, lookaheadSec: 0.01, onTick: (ev, when) => whens.push(when) });
  s.prime();
  s.tick();
  ctx.currentTime = 0.3; s.tick();
  s.setBpm(120);
  ctx.currentTime = 0.6; s.tick(); // step 2 was already spaced at the old tempo
  ctx.currentTime = 0.7; s.tick(); // step 3 uses the new tempo
  const d1 = whens[1] - whens[0];
  const d2 = whens[3] - whens[2];
  assert.ok(Math.abs(d1 - 0.25) < 1e-9, `d1=${d1}`);
  assert.ok(Math.abs(d2 - 0.125) < 1e-9, `d2=${d2}`);
  s.push(ev('post'));
  s.flush();
  assert.equal(s.pendingCount, 0);
});

test('resyncs after a large clock jump instead of catching up', () => {
  const ctx = { currentTime: 0 };
  const ticks = [];
  const s = new Scheduler({ ctx, bpm: 120, lookaheadSec: 0.1, onTick: (ev) => ticks.push(ev.length) });
  s.prime();
  s.tick();
  s.push(ev('post'));
  ctx.currentTime = 30;
  s.tick();
  assert.ok(ticks.length < 5, `ticks=${ticks.length}`);
  assert.equal(s.pendingCount, 0);
});
