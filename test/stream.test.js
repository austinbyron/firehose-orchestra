import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUrl, normalizeEvent, JetstreamClient, JETSTREAM_HOSTS, WANTED } from '../src/stream.js';

const commit = (collection, record, extra = {}) => ({
  did: 'did:plc:abc', time_us: 1700000000000000, kind: 'commit',
  commit: { rev: 'r', operation: 'create', collection, rkey: 'k', record, ...extra },
});

test('buildUrl includes collections and optional cursor', () => {
  const u = buildUrl(JETSTREAM_HOSTS[0]);
  assert.ok(u.startsWith('wss://jetstream1.us-west.bsky.network/subscribe?'));
  for (const c of WANTED.split(',')) assert.ok(u.includes(`wantedCollections=${c}`), c);
  assert.ok(!u.includes('cursor='));
  assert.ok(buildUrl(JETSTREAM_HOSTS[0], 123).includes('cursor=123'));
});

test('normalizeEvent: post', () => {
  const e = normalizeEvent(commit('app.bsky.feed.post', { text: 'hi there', langs: ['EN'], createdAt: 'x' }));
  assert.equal(e.type, 'post');
  assert.equal(e.did, 'did:plc:abc');
  assert.equal(e.lang, 'en');
  assert.equal(e.text, 'hi there');
  assert.equal(e.parentUri, null);
  assert.equal(e.record.text, 'hi there');
});

test('normalizeEvent: reply', () => {
  const e = normalizeEvent(commit('app.bsky.feed.post', {
    text: 'yes', langs: ['en'], reply: { parent: { uri: 'at://p' }, root: { uri: 'at://r' } },
  }));
  assert.equal(e.type, 'reply');
  assert.equal(e.parentUri, 'at://p');
});

test('normalizeEvent: like, repost, follow', () => {
  assert.equal(normalizeEvent(commit('app.bsky.feed.like', { subject: {} })).type, 'like');
  assert.equal(normalizeEvent(commit('app.bsky.feed.repost', { subject: {} })).type, 'repost');
  const f = normalizeEvent(commit('app.bsky.graph.follow', { subject: 'did:plc:z' }));
  assert.equal(f.type, 'follow');
  assert.equal(f.record, null);
  assert.equal(f.text, '');
});

test('normalizeEvent ignores non-create, non-commit, unknown collections, garbage', () => {
  assert.equal(normalizeEvent(commit('app.bsky.feed.post', { text: 'x' }, { operation: 'delete' })), null);
  assert.equal(normalizeEvent({ kind: 'identity', did: 'd', time_us: 1 }), null);
  assert.equal(normalizeEvent(commit('app.bsky.actor.profile', {})), null);
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent({}), null);
});

class FakeWS {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; FakeWS.instances.push(this); }
  emitOpen() { this.readyState = 1; this.onopen?.(); }
  emitMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  emitClose() { this.readyState = 3; this.onclose?.(); }
  close() { this.emitClose(); }
}

test('JetstreamClient delivers normalized events, tracks cursor, resumes on reconnect', async () => {
  FakeWS.instances = [];
  const got = [];
  const statuses = [];
  const t = 1_700_000_000_000; // ms
  const client = new JetstreamClient({
    onEvent: (e) => got.push(e),
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWS,
    now: () => t,
    staleMs: 10_000,
    backoffMs: [0, 0, 0],
  });
  client.start();
  const ws1 = FakeWS.instances[0];
  ws1.emitOpen();
  ws1.emitMessage({ ...commit('app.bsky.feed.like', { subject: {} }), time_us: t * 1000 });
  ws1.emitMessage({ ...commit('app.bsky.feed.like', { subject: {} }), time_us: (t - 60_000) * 1000 });
  assert.equal(got.length, 1);
  assert.equal(client.dropped, 1);
  ws1.emitClose();
  await new Promise((r) => setTimeout(r, 5));
  const ws2 = FakeWS.instances[1];
  assert.ok(ws2, 'reconnected');
  assert.ok(ws2.url.includes('cursor='), 'resume with cursor');
  assert.ok(ws2.url.includes('jetstream2.us-west'), 'rotated host');
  assert.ok(statuses.includes('reconnecting'));
  client.stop();
  assert.equal(statuses.at(-1), 'stopped');
});
