import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  rejectReason, isDisplayable, prepareText, wrapText, normalizeForBlocklist,
} from '../src/filter.js';

const cases = JSON.parse(readFileSync(new URL('../fixtures/filter-cases.json', import.meta.url)));

test('all pass fixtures are displayable', () => {
  for (const rec of cases.pass) {
    assert.equal(rejectReason(rec), null, `expected pass: ${rec.text}`);
    assert.equal(isDisplayable(rec), true);
  }
});

test('all block fixtures are rejected with the expected reason', () => {
  for (const rec of cases.block) {
    assert.equal(rejectReason(rec), rec.reason, `text: ${rec.text.slice(0, 40)}`);
  }
});

test('langs option is respected', () => {
  const rec = { text: 'hoje o dia está lindo demais, vamos aproveitar', langs: ['pt'] };
  assert.equal(rejectReason(rec, { langs: ['pt'] }), null);
});

test('normalizeForBlocklist lowercases and de-leets', () => {
  assert.equal(normalizeForBlocklist('P0rN'), 'porn');
  assert.equal(normalizeForBlocklist('$3x'), 'sex');
});

test('prepareText collapses whitespace and truncates with ellipsis', () => {
  assert.equal(prepareText('  a\n\nb   c '), 'a b c');
  const long = 'x'.repeat(200);
  const out = prepareText(long, 140);
  assert.equal(out.length, 140);
  assert.ok(out.endsWith('…'));
});

test('wrapText wraps on words within maxChars', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog again and again', 20);
  for (const l of lines) assert.ok(l.length <= 20, l);
  assert.equal(lines.join(' '), 'the quick brown fox jumps over the lazy dog again and again');
});

test('wrapText hard-splits a single overlong word', () => {
  const lines = wrapText('a'.repeat(50), 20);
  assert.deepEqual(lines.map((l) => l.length), [20, 20, 10]);
});
