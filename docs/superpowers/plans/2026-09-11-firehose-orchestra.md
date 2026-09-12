# Firehose Orchestra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single static web page that opens a WebSocket to Bluesky Jetstream and turns live network events into a hybrid drone + quantized percussive/melodic piece, with a reactive canvas visualizer and filtered post text typing itself out on screen.

**Architecture:** Browser-only. `stream.js` normalizes Jetstream events; `scheduler.js` buckets them onto a 16th-note grid using a WebAudio lookahead clock; `music.js` and `filter.js` are pure functions (pitch from DID hash, rate EMAs, burst detection, per-bucket caps, strict display filter); `synth.js` owns the WebAudio graph (drone + one-shot voices + compressor + synthesized reverb); `visual.js` draws pulses and typewriter text; `main.js` wires it together with a Play button, stats corner, and hotkeys.

**Tech Stack:** Plain ES modules, WebAudio API, Canvas 2D, Node 22 `node:test` for unit tests, Cloudflare Pages direct upload via `wrangler`. Zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-firehose-orchestra-design.md`

## Global Constraints

- No runtime dependencies, no bundler, no CDN scripts. `index.html` loads `src/main.js` via `<script type="module">`.
- Node ≥ 22 (built-in `WebSocket` and `node:test`). `package.json` has `"type": "module"`.
- Commit messages are plain text. A global git hook rejects `Co-Authored-By`, `🤖`, and "Generated with Claude" markers. Never add them.
- Jetstream hosts (in order): `jetstream1.us-west.bsky.network`, `jetstream2.us-west.bsky.network`, `jetstream1.us-east.bsky.network`, `jetstream2.us-east.bsky.network`. Path `/subscribe`. Query `wantedCollections=app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow`.
- Default tempo 90 BPM, 16th-note grid. Per-bucket voice caps: post 12, reply 6, like 8, repost 2, follow 1. Text: max 1 new per bucket, max 12 on screen, truncate at 140 chars, wrap at 34 chars.
- Never display handles, avatars, or links. Text is shown only if it passes the strict filter.
- Loudness rule: rate spikes add density, never volume. A `DynamicsCompressorNode` sits before the destination.
- Files stay small and single-purpose (see File Structure). No file over ~300 lines.

## File Structure

```
firehose-orchestra/
  index.html                 page shell, canvas, Play button, stats corner, module script tag
  package.json               {"type":"module"}, scripts: test, record, serve
  deploy.sh                  wrangler pages deploy (direct upload)
  README.md                  what it is, hotkeys, dev + deploy
  .gitignore
  src/
    music.js                 pure: fnv1a, pitchFor, midiToHz, noteLengthFor, Ema, RateTracker, createBurstDetector, nextKey, applyCaps, LANG_TABLE/langInfo, chordAt
    filter.js                pure: rejectReason, isDisplayable, prepareText, wrapText, normalizeForBlocklist
    blocklist.js             plain exported array of blocked terms
    stream.js                normalizeEvent (pure), buildUrl, JetstreamClient (reconnect/cursor), ReplaySource
    scheduler.js             Scheduler: lookahead clock, pending bucket, applyCaps, onTick callback
    synth.js                 Synth: master chain, makeImpulse, pluck/tick/rim/swell voices, Drone
    visual.js                Visual: canvas rings, pulses, typewriter texts, key hue, flash, dim
    main.js                  wiring, conductor (drone updates, chord cycle, burst→key change), UI, hotkeys, localStorage
  test/
    music.test.js
    filter.test.js
    stream.test.js
    scheduler.test.js
  tools/
    record-fixtures.mjs      Node script: connect to Jetstream for N seconds, write fixtures/events.json
  fixtures/
    events.json              ~200+ recorded, normalized events for replay mode
    filter-cases.json        should-pass / should-block post records for filter tests
```

**Event shape (produced by `stream.js`, consumed everywhere):**

```js
// NormalizedEvent
{
  type: 'post' | 'reply' | 'like' | 'repost' | 'follow',
  did: string,          // author DID
  timeUs: number,       // Jetstream time_us
  lang: string | null,  // first of record.langs, lowercased 2-letter, or null
  text: string,         // post text ('' for non-posts)
  parentUri: string | null, // reply parent uri, else null
  record: object | null // raw record for posts (filter needs labels/embed/facets), null otherwise
}
```

---

### Task 1: Project scaffold and test runner

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`, `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs `node --test test/`. `npm run serve` serves the repo root for manual testing.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "firehose-orchestra",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/",
    "record": "node tools/record-fixtures.mjs",
    "serve": "python3 -m http.server 8765"
  }
}
```

- [ ] **Step 2: Write .gitignore and README**

`.gitignore`:
```
node_modules/
.wrangler/
.DS_Store
```

`README.md`:
```markdown
# Firehose Orchestra

The live Bluesky network as music. The browser opens a WebSocket straight to
Jetstream and maps events to sound: a drone that follows slow trends, plucks
for posts (each account always plays its own note), hi-hats for likes, rims
for reposts, swells for follows. Filtered post text types itself onto the
canvas in time with its note.

No backend. One static page.

## Run locally

    npm test          # unit tests (Node >= 22)
    npm run serve     # http://localhost:8765
    npm run record    # refresh fixtures/events.json from the live firehose

Open `http://localhost:8765/?replay=1` to run offline from fixtures.

## Hotkeys

| Key | Action |
|---|---|
| `m` | mute |
| `f` | fullscreen |
| `[` / `]` | tempo -5 / +5 BPM |
| `k` | force key change |
| `t` | text on/off |
| `h` | hide/show stats |

## Deploy

    ./deploy.sh

Cloudflare Pages direct upload, project `firehose-orchestra`.
```

- [ ] **Step 3: Write a smoke test**

`test/smoke.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: `# pass 1`

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore README.md test/smoke.test.js
git commit -m "Scaffold project with node:test runner"
```

---

### Task 2: music.js — hashing, pitch, note length, language table

**Files:**
- Create: `src/music.js`, `test/music.test.js`

**Interfaces:**
- Produces:
  - `fnv1a(str: string): number` (uint32)
  - `SCALE = [0, 2, 4, 7, 9]` (major pentatonic degrees)
  - `pitchFor(did: string, keyRoot: number, opts?: {octaveLow?: number, octaveSpan?: number}): number` (MIDI note)
  - `midiToHz(midi: number): number`
  - `noteLengthFor(textLen: number): number` (seconds, clamp(len/60, 0.1, 1.2))
  - `LANG_TABLE: Record<string, {pan: number, hue: number, timbre: number}>` and `langInfo(lang: string|null): {pan, hue, timbre}`
  - `CHORDS: number[][]` and `chordAt(index: number, keyRoot: number): number[]` (MIDI notes, 4 voices, octaves 2–3)

- [ ] **Step 1: Write failing tests**

`test/music.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fnv1a, SCALE, pitchFor, midiToHz, noteLengthFor, langInfo, chordAt, CHORDS,
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
  // default octaves 3..5 => MIDI 48..83
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find module `../src/music.js`

- [ ] **Step 3: Implement**

`src/music.js`:
```js
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

// Chord progression as scale-degree offsets (semitones from key root) for 4 voices.
// I, vi, IV, V voicings that sit inside the pentatonic set as much as possible.
export const CHORDS = [
  [0, 7, 12, 16],   // I  (root, 5th, root, 3rd)
  [9, 16, 21, 24],  // vi (6th, 3rd, 6th, root)
  [5, 12, 17, 21],  // IV
  [7, 14, 19, 23],  // V
];

export function chordAt(index, keyRoot) {
  const chord = CHORDS[((index % CHORDS.length) + CHORDS.length) % CHORDS.length];
  const base = 36 + (keyRoot % 12); // C2 + root
  return chord.map((off) => base + off);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/music.js test/music.test.js
git commit -m "Add pure musical mapping: hash, pitch, language table, chords"
```

---

### Task 3: music.js — EMA, rate tracker, burst detector, key walk, caps

**Files:**
- Modify: `src/music.js`, `test/music.test.js`

**Interfaces:**
- Produces:
  - `class Ema { constructor(tauSec); update(value, dtSec): number; value: number }`
  - `class RateTracker { constructor(); add(count); sample(dtSec): void; inst: number; fast: number; slow: number }` (per-second rates; `add` accumulates within the current second, `sample(dt)` folds it into the EMAs and resets)
  - `createBurstDetector({ratio=2, holdSec=3, cooldownSec=90}): (fast, slow, nowSec) => boolean`
  - `nextKey(current: number, rand?: () => number): number` (±fifth on the circle)
  - `CAPS = { post: 12, reply: 6, like: 8, repost: 2, follow: 1 }`
  - `applyCaps(events: NormalizedEvent[], caps = CAPS): { scheduled: NormalizedEvent[], dropped: number }`

- [ ] **Step 1: Write failing tests (append)**

```js
import { Ema, RateTracker, createBurstDetector, nextKey, applyCaps, CAPS } from '../src/music.js';

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
  assert.ok(r.slow > 15 && r.slow < 50);
});

test('burst detector needs ratio held for holdSec, then cools down', () => {
  const b = createBurstDetector({ ratio: 2, holdSec: 3, cooldownSec: 90 });
  assert.equal(b(100, 40, 0), false);
  assert.equal(b(100, 40, 1), false);
  assert.equal(b(100, 40, 2), false);
  assert.equal(b(100, 40, 3), true);   // held 3s
  assert.equal(b(100, 40, 4), false);  // cooldown
  assert.equal(b(100, 40, 93), false); // still needs to re-hold
  assert.equal(b(100, 40, 96), true);
});

test('burst detector resets hold when ratio drops', () => {
  const b = createBurstDetector({ ratio: 2, holdSec: 3, cooldownSec: 0 });
  b(100, 40, 0); b(100, 40, 1);
  b(50, 40, 2);            // dropped below ratio
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, `Ema` not exported

- [ ] **Step 3: Implement (append to `src/music.js`)**

```js
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
    if (!hot) { heldSince = null; return false; }
    if (heldSince === null) heldSince = nowSec;
    if (nowSec - heldSince >= holdSec && nowSec - lastFire >= cooldownSec) {
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
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/music.js test/music.test.js
git commit -m "Add rate tracking, burst detector, key walk, and voice caps"
```

---

### Task 4: blocklist.js and filter.js — strict display filter and text prep

**Files:**
- Create: `src/blocklist.js`, `src/filter.js`, `fixtures/filter-cases.json`, `test/filter.test.js`

**Interfaces:**
- Produces:
  - `BLOCKLIST: string[]` (lowercase terms)
  - `normalizeForBlocklist(s: string): string`
  - `rejectReason(record: object, opts?: {langs?: string[]}): string | null` (null = displayable)
  - `isDisplayable(record, opts?): boolean`
  - `prepareText(text: string, max = 140): string`
  - `wrapText(text: string, maxChars = 34): string[]`

- [ ] **Step 1: Write the blocklist**

`src/blocklist.js` (starter list; a plain array, extend freely. Keep lowercase, single words or short phrases):
```js
// Terms that make a post ineligible for on-screen display. Matched on word
// boundaries after normalizeForBlocklist(). Extend as needed.
export const BLOCKLIST = [
  // adult / sexual
  'porn', 'porno', 'nsfw', 'onlyfans', 'nudes', 'nude', 'hentai', 'xxx',
  'sex', 'sexy', 'blowjob', 'handjob', 'cum', 'cumming', 'dick', 'cock',
  'pussy', 'tits', 'boobs', 'anal', 'milf', 'horny', 'fuck me', 'dm me',
  // spam / scams
  'crypto giveaway', 'airdrop', 'free followers', 'follow back', 'f4f',
  'promo code', 'click here', 'link in bio', 'earn money', 'casino',
  // violence / hate (extend with slurs; keep them here, not in the spec)
  'kys', 'kill yourself', 'nazi', 'heil', 'lynch', 'rape', 'rapist',
  'retard', 'retarded', 'faggot', 'fag', 'tranny', 'nigger', 'nigga',
  'chink', 'spic', 'kike', 'wetback',
];
```

- [ ] **Step 2: Write filter fixture cases**

`fixtures/filter-cases.json`:
```json
{
  "pass": [
    { "text": "finally got the sourdough starter to rise, feeling unstoppable", "langs": ["en"] },
    { "text": "the light on the bay this morning was unreal. no photo could do it", "langs": ["en"] },
    { "text": "hot take: the second album is the good one", "langs": ["en", "fr"] }
  ],
  "block": [
    { "reason": "label", "text": "new set is up, link below", "langs": ["en"], "labels": { "$type": "com.atproto.label.defs#selfLabels", "values": [{ "val": "porn" }] } },
    { "reason": "embed", "text": "look at this photo of my dog being a good boy today", "langs": ["en"], "embed": { "$type": "app.bsky.embed.images", "images": [] } },
    { "reason": "lang", "text": "hoje o dia está lindo demais, vamos aproveitar", "langs": ["pt"] },
    { "reason": "url", "text": "read my new post at https://example.com/blog it is good", "langs": ["en"] },
    { "reason": "url", "text": "check out example.com/deal before it expires tonight", "langs": ["en"] },
    { "reason": "hashtags", "text": "good morning #art #artist #drawing everyone", "langs": ["en"] },
    { "reason": "mentions", "text": "hey @a.bsky.social and @b.bsky.social come look", "langs": ["en"] },
    { "reason": "short", "text": "lol ok", "langs": ["en"] },
    { "reason": "long", "text": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "langs": ["en"] },
    { "reason": "shouty", "text": "THIS IS THE BEST DAY OF MY ENTIRE LIFE AND I AM SCREAMING", "langs": ["en"] },
    { "reason": "symbols", "text": "🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥 !!!", "langs": ["en"] },
    { "reason": "blocklist", "text": "new nsfw drop for my subscribers this weekend", "langs": ["en"] },
    { "reason": "blocklist", "text": "brand new p0rn set just dropped for you all", "langs": ["en"] },
    { "reason": "reply", "text": "totally agree with everything you said here honestly", "langs": ["en"], "reply": { "parent": { "uri": "at://x/app.bsky.feed.post/y" }, "root": { "uri": "at://x/app.bsky.feed.post/y" } } }
  ]
}
```

- [ ] **Step 3: Write failing tests**

`test/filter.test.js`:
```js
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
    assert.equal(rejectReason(rec), rec.reason, `text: ${rec.text}`);
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
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find `../src/filter.js`

- [ ] **Step 5: Implement**

`src/filter.js`:
```js
import { BLOCKLIST } from './blocklist.js';

const BLOCKED_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', '!no-unauthenticated']);
const URL_RE = /https?:\/\/|\b[\w-]+\.(?:com|net|org|io|co|me|app|gg|ly|xyz|social|tv|dev)\b(?:\/\S*)?/i;
const HASHTAG_RE = /(^|\s)#\w+/g;
const MENTION_RE = /(^|\s)@[\w.-]+/g;
const LETTER_RE = /\p{L}/gu;
const UPPER_RE = /\p{Lu}/gu;

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

export function normalizeForBlocklist(s) {
  return s
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .replace(/\s+/g, ' ');
}

const BLOCK_RES = BLOCKLIST.map((term) => {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu');
});

function count(re, s) {
  return (s.match(re) || []).length;
}

export function rejectReason(record, { langs = ['en'] } = {}) {
  if (!record || typeof record.text !== 'string') return 'notext';
  const vals = record.labels?.values ?? [];
  if (vals.some((v) => BLOCKED_LABELS.has(v?.val))) return 'label';
  if (record.embed) return 'embed';
  const recLangs = (record.langs ?? []).map((l) => String(l).toLowerCase().slice(0, 2));
  if (!recLangs.some((l) => langs.includes(l))) return 'lang';
  const text = record.text.trim();
  if (URL_RE.test(text)) return 'url';
  if (count(HASHTAG_RE, text) > 2) return 'hashtags';
  if (count(MENTION_RE, text) > 1) return 'mentions';
  if (text.length < 12) return 'short';
  if (text.length > 300) return 'long';
  const letters = count(LETTER_RE, text);
  const uppers = count(UPPER_RE, text);
  if (letters >= 10 && uppers / letters > 0.7) return 'shouty';
  if (letters / text.length < 0.5) return 'symbols';
  const norm = normalizeForBlocklist(text);
  if (BLOCK_RES.some((re) => re.test(norm))) return 'blocklist';
  if (record.reply) return 'reply';
  return null;
}

export function isDisplayable(record, opts) {
  return rejectReason(record, opts) === null;
}

export function prepareText(text, max = 140) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

export function wrapText(text, maxChars = 34) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (word.length > maxChars) {
      if (cur) { lines.push(cur); cur = ''; }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars) cur = next;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}
```

Note on the `'long'` fixture: it is 300+ `a`s with no spaces, so the `length > 300` check fires before `'shouty'`/`'symbols'`. Order of checks is significant; keep the order above.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass. If the `'symbols'` case fails because emoji count as one char each, tighten the fixture (more emoji) rather than the ratio.

- [ ] **Step 7: Commit**

```bash
git add src/blocklist.js src/filter.js fixtures/filter-cases.json test/filter.test.js
git commit -m "Add strict display filter, blocklist, and text wrapping"
```

---

### Task 5: stream.js — event normalization, URL builder, Jetstream client, replay source

**Files:**
- Create: `src/stream.js`, `test/stream.test.js`

**Interfaces:**
- Produces:
  - `JETSTREAM_HOSTS: string[]`
  - `WANTED = 'app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow'`
  - `buildUrl(host: string, cursorUs?: number|null): string`
  - `normalizeEvent(raw: object): NormalizedEvent | null`
  - `class JetstreamClient { constructor({ onEvent, onStatus, WebSocketImpl?, now?, staleMs? }); start(); stop(); }` — `onStatus(state: 'connecting'|'open'|'reconnecting'|'stopped', info: {host, attempt})`
  - `class ReplaySource { constructor(events, { onEvent, rate = 120 }); start(); stop(); }` — loops the fixture list at `rate` events/sec, rewriting `timeUs` to now

- [ ] **Step 1: Write failing tests**

`test/stream.test.js`:
```js
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
  assert.ok(u.includes(`wantedCollections=${encodeURIComponent(WANTED)}`) || u.includes(`wantedCollections=${WANTED}`));
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

// Minimal fake WebSocket for client tests
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
  let t = 1_700_000_000_000; // ms
  const client = new JetstreamClient({
    onEvent: (e) => got.push(e),
    onStatus: (s, info) => statuses.push(s),
    WebSocketImpl: FakeWS,
    now: () => t,
    staleMs: 10_000,
    backoffMs: [0, 0, 0],
  });
  client.start();
  const ws1 = FakeWS.instances[0];
  ws1.emitOpen();
  ws1.emitMessage(commit('app.bsky.feed.like', { subject: {} }, {}));
  // stale event (older than staleMs relative to now)
  ws1.emitMessage({ ...commit('app.bsky.feed.like', { subject: {} }), time_us: (t - 60_000) * 1000 });
  assert.equal(got.length, 1);
  ws1.emitClose();
  await new Promise((r) => setTimeout(r, 5));
  const ws2 = FakeWS.instances[1];
  assert.ok(ws2, 'reconnected');
  assert.ok(ws2.url.includes('cursor='), 'resume with cursor');
  assert.ok(statuses.includes('reconnecting'));
  client.stop();
  assert.equal(statuses.at(-1), 'stopped');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find `../src/stream.js`

- [ ] **Step 3: Implement**

`src/stream.js`:
```js
export const JETSTREAM_HOSTS = [
  'jetstream1.us-west.bsky.network',
  'jetstream2.us-west.bsky.network',
  'jetstream1.us-east.bsky.network',
  'jetstream2.us-east.bsky.network',
];

export const WANTED = 'app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow';

export function buildUrl(host, cursorUs = null) {
  const params = new URLSearchParams();
  for (const c of WANTED.split(',')) params.append('wantedCollections', c);
  if (cursorUs != null) params.set('cursor', String(Math.floor(cursorUs)));
  return `wss://${host}/subscribe?${params.toString()}`;
}

const TYPE_BY_COLLECTION = {
  'app.bsky.feed.post': 'post',
  'app.bsky.feed.like': 'like',
  'app.bsky.feed.repost': 'repost',
  'app.bsky.graph.follow': 'follow',
};

export function normalizeEvent(raw) {
  if (!raw || raw.kind !== 'commit' || !raw.commit) return null;
  const c = raw.commit;
  if (c.operation !== 'create') return null;
  let type = TYPE_BY_COLLECTION[c.collection];
  if (!type) return null;
  const record = c.record ?? {};
  let text = '';
  let parentUri = null;
  let lang = null;
  let keep = null;
  if (type === 'post') {
    text = typeof record.text === 'string' ? record.text : '';
    const l = Array.isArray(record.langs) && record.langs[0];
    lang = l ? String(l).toLowerCase().slice(0, 2) : null;
    if (record.reply?.parent?.uri) { type = 'reply'; parentUri = record.reply.parent.uri; }
    keep = record;
  }
  return { type, did: raw.did, timeUs: raw.time_us, lang, text, parentUri, record: keep };
}

const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

export class JetstreamClient {
  constructor({
    onEvent, onStatus = () => {}, WebSocketImpl = globalThis.WebSocket,
    now = () => Date.now(), staleMs = 10_000, backoffMs = DEFAULT_BACKOFF, hosts = JETSTREAM_HOSTS,
  }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.WS = WebSocketImpl;
    this.now = now;
    this.staleMs = staleMs;
    this.backoffMs = backoffMs;
    this.hosts = hosts;
    this.cursorUs = null;
    this.attempt = 0;
    this.hostIndex = 0;
    this.ws = null;
    this.timer = null;
    this.running = false;
    this.dropped = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; w.close?.(); }
    this.onStatus('stopped', { host: null, attempt: this.attempt });
  }

  connect() {
    const host = this.hosts[this.hostIndex % this.hosts.length];
    const cursor = this.cursorUs != null ? this.cursorUs - 2_000_000 : null;
    this.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', { host, attempt: this.attempt });
    const ws = new this.WS(buildUrl(host, cursor));
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.onStatus('open', { host, attempt: 0 }); };
    ws.onmessage = (msg) => this.handleMessage(msg.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      const delay = this.backoffMs[Math.min(this.attempt, this.backoffMs.length - 1)];
      this.attempt++;
      this.hostIndex++;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  handleMessage(data) {
    let raw;
    try { raw = JSON.parse(data); } catch { this.dropped++; return; }
    if (typeof raw?.time_us === 'number') this.cursorUs = raw.time_us;
    const e = normalizeEvent(raw);
    if (!e) return;
    if (this.now() - e.timeUs / 1000 > this.staleMs) { this.dropped++; return; }
    this.onEvent(e);
  }
}

export class ReplaySource {
  constructor(events, { onEvent, rate = 120 }) {
    this.events = events;
    this.onEvent = onEvent;
    this.rate = rate;
    this.i = 0;
    this.timer = null;
  }
  start() {
    const perTick = Math.max(1, Math.round(this.rate / 20));
    this.timer = setInterval(() => {
      for (let n = 0; n < perTick; n++) {
        const e = this.events[this.i++ % this.events.length];
        this.onEvent({ ...e, timeUs: Date.now() * 1000 });
      }
    }, 50);
  }
  stop() { clearInterval(this.timer); }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/stream.js test/stream.test.js
git commit -m "Add Jetstream client with reconnect, cursor resume, and replay source"
```

---

### Task 6: Fixture recorder and recorded events

**Files:**
- Create: `tools/record-fixtures.mjs`, `fixtures/events.json`

**Interfaces:**
- Consumes: `normalizeEvent`, `buildUrl`, `JETSTREAM_HOSTS` from `src/stream.js`
- Produces: `fixtures/events.json`, an array of `NormalizedEvent` (posts keep `record`, but `record` is trimmed to `{text, langs, labels, embed, reply, facets}` to keep the file small). Used by `?replay=1`.

- [ ] **Step 1: Write the recorder**

`tools/record-fixtures.mjs`:
```js
// Usage: node tools/record-fixtures.mjs [seconds=8] [maxEvents=600]
import { writeFileSync } from 'node:fs';
import { buildUrl, normalizeEvent, JETSTREAM_HOSTS } from '../src/stream.js';

const seconds = Number(process.argv[2] ?? 8);
const maxEvents = Number(process.argv[3] ?? 600);
const out = [];

const ws = new WebSocket(buildUrl(JETSTREAM_HOSTS[0]));
ws.onopen = () => console.error(`connected, recording ${seconds}s...`);
ws.onmessage = (m) => {
  const e = normalizeEvent(JSON.parse(m.data));
  if (!e) return;
  if (e.record) {
    const { text, langs, labels, embed, reply, facets } = e.record;
    e.record = { text, langs, labels, embed, reply, facets };
  }
  out.push(e);
  if (out.length >= maxEvents) finish();
};
ws.onerror = (err) => { console.error('ws error', err?.message ?? err); };
setTimeout(finish, seconds * 1000);

function finish() {
  try { ws.close(); } catch {}
  const byType = out.reduce((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {});
  writeFileSync(new URL('../fixtures/events.json', import.meta.url), JSON.stringify(out));
  console.error(`wrote ${out.length} events`, byType);
  process.exit(0);
}
```

- [ ] **Step 2: Record**

Run: `npm run record`
Expected: stderr shows `wrote N events { like: ..., post: ..., ... }` with N in the hundreds. Sanity check: `node -e "const e=require('./fixtures/events.json');console.log(e.length, e.filter(x=>x.type==='post').length)"` shows posts > 30. If a host refuses, edit the script's host index temporarily and retry.

- [ ] **Step 3: Verify posts in the fixture include some that pass the filter**

Run:
```bash
node -e "
import('./src/filter.js').then(({rejectReason})=>{
  const ev=JSON.parse(require('fs').readFileSync('fixtures/events.json'));
  const posts=ev.filter(e=>e.type==='post');
  const ok=posts.filter(p=>rejectReason(p.record)===null);
  console.log('posts',posts.length,'displayable',ok.length);
  console.log(ok.slice(0,5).map(p=>p.text));
});"
```
Expected: displayable ≥ 3. If 0, re-record for longer (`npm run record -- 20 1500`).

- [ ] **Step 4: Commit**

```bash
git add tools/record-fixtures.mjs fixtures/events.json
git commit -m "Add fixture recorder and recorded Jetstream events for replay mode"
```

---

### Task 7: scheduler.js — lookahead clock and buckets

**Files:**
- Create: `src/scheduler.js`, `test/scheduler.test.js`

**Interfaces:**
- Consumes: `applyCaps`, `CAPS` from `src/music.js`
- Produces:
  - `stepDuration(bpm: number): number` (seconds per 16th)
  - `class Scheduler { constructor({ ctx: {currentTime}, bpm = 90, lookaheadSec = 0.1, intervalMs = 25, onTick(scheduled: NormalizedEvent[], whenSec: number, step: number, dropped: number) }); push(event); start(); stop(); tick(); setBpm(bpm); bpm; step; flush() }`
  - `tick()` is public so tests (and a suspended-context resume) can drive it manually. `flush()` clears pending events.

- [ ] **Step 1: Write failing tests**

`test/scheduler.test.js`:
```js
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
  s.prime(); // sets nextNoteTime = ctx.currentTime + small offset, without setInterval
  for (let i = 0; i < 20; i++) s.push(ev('like'));
  s.tick();
  assert.equal(ticks.length, 1);
  assert.equal(ticks[0].n, 8);
  assert.equal(ticks[0].dropped, 12);
  assert.equal(ticks[0].step, 0);
  // no time passed: next tick schedules nothing new (bucket empty, not yet within lookahead)
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
  const s = new Scheduler({ ctx, bpm: 60, onTick: (ev, when) => whens.push(when) });
  s.prime();
  s.tick(); // step 0
  ctx.currentTime = 1; s.tick(); // step 1 at +0.25
  s.setBpm(120);
  ctx.currentTime = 2; s.tick();
  const d1 = whens[1] - whens[0];
  const d2 = whens[2] - whens[1];
  assert.ok(Math.abs(d1 - 0.25) < 1e-9);
  assert.ok(Math.abs(d2 - 0.125) < 1e-9);
  s.push(ev('post'));
  s.flush();
  assert.equal(s.pendingCount, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find `../src/scheduler.js`

- [ ] **Step 3: Implement**

`src/scheduler.js`:
```js
import { applyCaps, CAPS } from './music.js';

export function stepDuration(bpm) {
  return 60 / bpm / 4;
}

export class Scheduler {
  constructor({ ctx, bpm = 90, lookaheadSec = 0.1, intervalMs = 25, onTick, caps = CAPS }) {
    this.ctx = ctx;
    this._bpm = bpm;
    this.lookaheadSec = lookaheadSec;
    this.intervalMs = intervalMs;
    this.onTick = onTick;
    this.caps = caps;
    this.pending = [];
    this.nextNoteTime = 0;
    this.step = 0;
    this.timer = null;
  }

  get bpm() { return this._bpm; }
  setBpm(bpm) { this._bpm = Math.min(180, Math.max(40, bpm)); }
  get pendingCount() { return this.pending.length; }

  push(event) { this.pending.push(event); }
  flush() { this.pending.length = 0; }

  prime() {
    this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  start() {
    this.prime();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    // If the clock jumped far ahead (tab suspended), resync instead of spraying catch-up steps.
    if (this.nextNoteTime < this.ctx.currentTime - 0.5) {
      this.flush();
      this.prime();
    }
    while (this.nextNoteTime < this.ctx.currentTime + this.lookaheadSec) {
      const { scheduled, dropped } = applyCaps(this.pending, this.caps);
      this.pending = [];
      this.onTick(scheduled, this.nextNoteTime, this.step, dropped);
      this.nextNoteTime += stepDuration(this._bpm);
      this.step++;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "Add lookahead scheduler with per-step voice caps"
```

---

### Task 8: synth.js — master chain, voices, drone

**Files:**
- Create: `src/synth.js`

**Interfaces:**
- Consumes: `midiToHz`, `langInfo` from `src/music.js`
- Produces:
  - `makeImpulse(ctx, seconds = 3, decay = 2.5): AudioBuffer`
  - `class Synth { constructor(ctx); setVolume(v: 0..1); setMuted(bool); muted: boolean; reduction: number (compressor dB); pluck({when, midi, dur, pan, timbre, gain = 0.25}); tick({when, pan, gain = 0.12}); rim({when, pan, gain = 0.3}); swell({when, pan, gain = 0.2}); drone: Drone }`
  - `class Drone { setChord(midis: number[], when: number, glideSec = 2); setBrightness(b: 0..1); setWet(w: 0..1) }`

No unit tests here (WebAudio has no Node implementation). Verified in Task 10's manual acceptance and via the `?replay=1` mode.

- [ ] **Step 1: Implement**

`src/synth.js`:
```js
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
    this.gain.gain.value = 0.18;
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
    // slow LFO on the filter for breathing
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

  // Melodic pluck: short triangle/sine blend through a resonant lowpass with a fast decay.
  pluck({ when, midi, dur, pan = 0, timbre = 0.5, gain = 0.25 }) {
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
    osc.connect(f).connect(g).connect(panner(ctx, pan)).connect(this.bus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    osc.onended = () => { osc.disconnect(); f.disconnect(); g.disconnect(); };
  }

  // Hi-hat: bandpassed noise, 30ms.
  tick({ when, pan = 0, gain = 0.12 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.03);
    src.connect(f).connect(g).connect(panner(ctx, pan)).connect(this.bus);
    src.start(when);
    src.stop(when + 0.05);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  }

  // Rim: sine body + noise click.
  rim({ when, pan = 0, gain = 0.3 }) {
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

  // Follow swell: soft sine sweeping up a fifth over 0.6s.
  swell({ when, pan = 0, gain = 0.2 }) {
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/synth.js && node -e "import('./src/synth.js').then(()=>console.log('ok'))"`
Expected: `ok` (module imports without touching WebAudio at load time)

- [ ] **Step 3: Commit**

```bash
git add src/synth.js
git commit -m "Add WebAudio synth: drone, pluck, tick, rim, swell, master chain"
```

---

### Task 9: visual.js — rings, pulses, typewriter text

**Files:**
- Create: `src/visual.js`

**Interfaces:**
- Consumes: `wrapText` from `src/filter.js`
- Produces:
  - `RING_BY_TYPE = { post: 0.42, reply: 0.42, repost: 0.34, follow: 0.28, like: 0.2 }` (fraction of `min(w,h)`)
  - `class Visual { constructor(canvas, { coarse = false }); start(); stop(); resize(); pulse({ type, angle, hue, at, strength = 1 }); text({ str, angle, hue }); setKeyHue(h); setBrightness(b); flash(); setDim(bool); setTextEnabled(bool); textEnabled; liveTextCount }`
  - `angle` is radians; callers derive it from language pan: `angle = pan * Math.PI * 0.75 - Math.PI / 2`.
  - `at` is an AudioContext time; the visual converts with an offset it is given via `setClockOffset(audioNowSec, perfNowMs)`.

- [ ] **Step 1: Implement**

`src/visual.js`:
```js
import { wrapText } from './filter.js';

export const RING_BY_TYPE = { post: 0.42, reply: 0.42, repost: 0.34, follow: 0.28, like: 0.2 };

const MAX_PULSES = 400;
const MAX_TEXTS = 12;
const TEXT_LIFE_MS = 4000;
const PULSE_LIFE_MS = 600;

export class Visual {
  constructor(canvas, { coarse = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.coarse = coarse;
    this.pulses = [];
    this.texts = [];
    this.keyHue = 200;
    this.brightness = 0.3;
    this.flashUntil = 0;
    this.dim = false;
    this.textEnabled = true;
    this.audioOffsetMs = 0; // perfNowMs - audioNowSec*1000
    this.raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setClockOffset(audioNowSec, perfNowMs) { this.audioOffsetMs = perfNowMs - audioNowSec * 1000; }
  toPerf(audioSec) { return audioSec * 1000 + this.audioOffsetMs; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.base = Math.min(this.w, this.h);
  }

  setKeyHue(h) { this.keyHue = h; }
  setBrightness(b) { this.brightness = b; }
  setDim(d) { this.dim = d; }
  setTextEnabled(on) { this.textEnabled = on; if (!on) this.texts.length = 0; }
  get liveTextCount() { return this.texts.length; }
  flash() { this.flashUntil = performance.now() + 250; }

  pulse({ type, angle, hue, at, strength = 1 }) {
    const r = (RING_BY_TYPE[type] ?? 0.3) * this.base * (this.coarse ? 0.9 : 1);
    this.pulses.push({
      x: this.cx + Math.cos(angle) * r,
      y: this.cy + Math.sin(angle) * r,
      hue, type, strength,
      start: this.toPerf(at),
    });
    if (this.pulses.length > MAX_PULSES) this.pulses.splice(0, this.pulses.length - MAX_PULSES);
  }

  text({ str, angle, hue, at }) {
    if (!this.textEnabled || this.texts.length >= MAX_TEXTS) return false;
    const lines = wrapText(str, this.coarse ? 26 : 34);
    const font = this.coarse ? 13 : 15;
    const boxW = Math.max(...lines.map((l) => l.length)) * font * 0.6;
    const boxH = lines.length * font * 1.35;
    const r = RING_BY_TYPE.post * this.base;
    // try the natural slot, then rotate around the ring to find a free one
    for (let k = 0; k < 8; k++) {
      const a = angle + k * (Math.PI / 4);
      let x = this.cx + Math.cos(a) * r - boxW / 2;
      let y = this.cy + Math.sin(a) * r - boxH / 2;
      x = Math.max(8, Math.min(this.w - boxW - 8, x));
      y = Math.max(8, Math.min(this.h - boxH - 8, y));
      if (!this.overlaps(x, y, boxW, boxH)) {
        const total = lines.join(' ').length;
        this.texts.push({
          lines, x, y, w: boxW, h: boxH, hue, font,
          start: this.toPerf(at), typeMs: Math.min(2500, 40 * total), total,
        });
        return true;
      }
    }
    return false;
  }

  overlaps(x, y, w, h) {
    for (const t of this.texts) {
      const ix = Math.max(0, Math.min(x + w, t.x + t.w) - Math.max(x, t.x));
      const iy = Math.max(0, Math.min(y + h, t.y + t.h) - Math.max(y, t.y));
      if (ix * iy > 0.5 * w * h) return true;
    }
    return false;
  }

  start() {
    const loop = (now) => { this.frame(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = null; }

  frame(now) {
    const c = this.ctx;
    const breathe = 0.5 + 0.5 * Math.sin(now / 6000);
    const l = (this.dim ? 3 : 6) + this.brightness * 14 + breathe * 3;
    const grad = c.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.base * 0.8);
    grad.addColorStop(0, `hsl(${this.keyHue} 40% ${l + 6}%)`);
    grad.addColorStop(1, `hsl(${this.keyHue} 50% ${Math.max(2, l - 6)}%)`);
    c.fillStyle = grad;
    c.fillRect(0, 0, this.w, this.h);

    if (now < this.flashUntil) {
      c.fillStyle = `hsla(${this.keyHue} 80% 90% / ${(this.flashUntil - now) / 250 * 0.5})`;
      c.fillRect(0, 0, this.w, this.h);
    }

    // rings
    c.lineWidth = 1;
    for (const [type, f] of Object.entries(RING_BY_TYPE)) {
      if (type === 'reply') continue;
      c.strokeStyle = `hsla(${this.keyHue} 30% 70% / 0.08)`;
      c.beginPath();
      c.arc(this.cx, this.cy, f * this.base, 0, Math.PI * 2);
      c.stroke();
    }

    // pulses
    const keep = [];
    for (const p of this.pulses) {
      const age = now - p.start;
      if (age < -200) { keep.push(p); continue; } // scheduled in the future
      if (age > PULSE_LIFE_MS) continue;
      keep.push(p);
      const t = Math.max(0, age) / PULSE_LIFE_MS;
      const size = (p.type === 'like' ? 4 : p.type === 'follow' ? 14 : 9) * (1 + t * 2.5) * p.strength;
      c.strokeStyle = `hsla(${p.hue} 85% 65% / ${(1 - t) * 0.9})`;
      c.lineWidth = 2 * (1 - t) + 0.5;
      c.beginPath();
      c.arc(p.x, p.y, size, 0, Math.PI * 2);
      c.stroke();
    }
    this.pulses = keep;

    // typewriter texts
    c.textBaseline = 'top';
    const keepT = [];
    for (const t of this.texts) {
      const age = now - t.start;
      if (age < -200) { keepT.push(t); continue; }
      if (age > TEXT_LIFE_MS) continue;
      keepT.push(t);
      const shown = Math.min(t.total, Math.floor(Math.max(0, age) / t.typeMs * t.total));
      const fade = age > TEXT_LIFE_MS - 1200 ? (TEXT_LIFE_MS - age) / 1200 : 1;
      c.font = `${t.font}px ui-monospace, Menlo, monospace`;
      c.fillStyle = `hsla(${t.hue} 70% 85% / ${0.95 * fade})`;
      let remaining = shown;
      t.lines.forEach((line, i) => {
        if (remaining <= 0) return;
        const part = line.slice(0, remaining);
        remaining -= line.length + 1;
        c.fillText(part, t.x, t.y + i * t.font * 1.35);
      });
      if (shown < t.total && Math.floor(now / 250) % 2 === 0) {
        // caret
        const li = Math.min(t.lines.length - 1, t.lines.findIndex((_, i) => t.lines.slice(0, i + 1).join(' ').length >= shown));
        const consumed = t.lines.slice(0, li).join(' ').length + (li > 0 ? 1 : 0);
        const col = Math.max(0, shown - consumed);
        c.fillRect(t.x + col * t.font * 0.6, t.y + li * t.font * 1.35, t.font * 0.55, t.font * 1.1);
      }
    }
    this.texts = keepT;
  }
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/visual.js`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add src/visual.js
git commit -m "Add canvas visualizer with rings, pulses, and typewriter text"
```

---

### Task 10: index.html and main.js — wiring, conductor, UI, hotkeys

**Files:**
- Create: `index.html`, `src/main.js`
- Delete: `test/smoke.test.js` (no longer needed)

**Interfaces:**
- Consumes everything above. Key call sites:
  - `new Scheduler({ ctx, bpm, onTick: (scheduled, when, step, dropped) => ... })`
  - `synth.pluck/tick/rim/swell`, `synth.drone.setChord/setBrightness`, `synth.setWet`
  - `visual.pulse/text/setKeyHue/setBrightness/flash/setDim/setClockOffset`
  - `new JetstreamClient({ onEvent, onStatus })` or `new ReplaySource(events, { onEvent, rate })` when `?replay=1` (`&rate=N` optional)
  - `rejectReason(record)`, `prepareText(text)`

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Firehose Orchestra</title>
<style>
  html, body { margin: 0; height: 100%; background: #06080d; color: #cfd6e4; overflow: hidden;
    font: 13px ui-monospace, Menlo, monospace; }
  canvas { position: fixed; inset: 0; display: block; }
  #play { position: fixed; inset: 0; display: grid; place-items: center; background: #06080d;
    cursor: pointer; z-index: 2; }
  #play button { font: inherit; font-size: 18px; letter-spacing: 0.2em; text-transform: uppercase;
    color: #cfd6e4; background: none; border: 1px solid #cfd6e4; padding: 14px 28px; cursor: pointer; }
  #play p { position: absolute; bottom: 24px; opacity: 0.5; font-size: 12px; max-width: 34ch; text-align: center; }
  #stats { position: fixed; left: 12px; bottom: 12px; opacity: 0.7; white-space: pre; z-index: 1;
    transition: opacity 0.4s; pointer-events: none; }
  #stats.hidden { opacity: 0; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="play">
  <button id="playBtn">Play</button>
  <p>the bluesky firehose as music. m mute · f fullscreen · [ ] tempo · k key · t text · h stats</p>
</div>
<div id="stats"></div>
<script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write main.js**

```js
import { JetstreamClient, ReplaySource } from './stream.js';
import { Scheduler } from './scheduler.js';
import { Synth } from './synth.js';
import { Visual } from './visual.js';
import {
  pitchFor, fnv1a, noteLengthFor, langInfo, chordAt, RateTracker, createBurstDetector, nextKey, CHORDS,
} from './music.js';
import { rejectReason, prepareText } from './filter.js';

const params = new URLSearchParams(location.search);
const REPLAY = params.get('replay') === '1';
const REPLAY_RATE = Number(params.get('rate') ?? 150);
const CHORD_STEPS = 720; // 2 minutes at 90 BPM in 16ths

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const playEl = $('play');
const statsEl = $('stats');
const coarse = matchMedia('(pointer: coarse)').matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  keyRoot: Math.floor(Math.random() * 12),
  chordIndex: 0,
  muted: store.get('muted', false),
  volume: store.get('volume', 0.8),
  textOn: store.get('textOn', true),
  statsOn: true,
  connection: 'idle',
  host: '',
  dropped: 0,
  textShown: 0,
  minSlow: Infinity, maxSlow: 0,
  started: false,
};

const rates = { post: new RateTracker(), like: new RateTracker(), repost: new RateTracker(), follow: new RateTracker() };
const burst = createBurstDetector();

let ctx, synth, visual, scheduler, source;

$('playBtn').addEventListener('click', start);
playEl.addEventListener('click', (e) => { if (e.target === playEl) start(); });

async function start() {
  if (state.started) return;
  state.started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  synth = new Synth(ctx);
  synth.setVolume(state.volume);
  synth.setMuted(state.muted);
  visual = new Visual(canvas, { coarse });
  visual.setTextEnabled(state.textOn);
  visual.setClockOffset(ctx.currentTime, performance.now());
  visual.setKeyHue(hueForKey(state.keyRoot));
  synth.drone.setChord(chordAt(0, state.keyRoot), ctx.currentTime, 0.1);

  scheduler = new Scheduler({ ctx, bpm: 90, onTick });
  scheduler.start();
  visual.start();
  playEl.remove();

  source = REPLAY ? startReplay() : startLive();
  setInterval(everySecond, 1000);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);
  setupStatsAutoHide();
}

function startLive() {
  const client = new JetstreamClient({
    onEvent,
    onStatus: (s, info) => { state.connection = s; state.host = info.host ?? ''; visual.setDim(s !== 'open'); },
  });
  client.start();
  return client;
}

function startReplay() {
  state.connection = 'replay';
  const src = new ReplaySource([], { onEvent, rate: REPLAY_RATE });
  fetch('fixtures/events.json').then((r) => r.json()).then((events) => { src.events = events; src.start(); });
  return src;
}

function onEvent(e) {
  const bucket = e.type === 'reply' ? 'post' : e.type;
  rates[bucket]?.add(1);
  scheduler.push(e);
}

function onTick(scheduled, when, step, dropped) {
  state.dropped += dropped;
  if (step > 0 && step % CHORD_STEPS === 0) advanceChord(when);
  let textUsed = false;
  for (const e of scheduled) {
    const info = langInfo(e.lang);
    const angle = info.pan * Math.PI * 0.75 - Math.PI / 2;
    const hue = info.hue;
    switch (e.type) {
      case 'post': {
        synth.pluck({ when, midi: pitchFor(e.did, state.keyRoot), dur: noteLengthFor(e.text.length), pan: info.pan, timbre: info.timbre });
        visual.pulse({ type: 'post', angle, hue, at: when });
        if (!textUsed && state.textOn && rejectReason(e.record) === null) {
          if (visual.text({ str: prepareText(e.text), angle, hue, at: when })) { textUsed = true; state.textShown++; }
        }
        break;
      }
      case 'reply': {
        const midi = pitchFor(e.parentUri, state.keyRoot) - 12;
        synth.pluck({ when, midi, dur: noteLengthFor(e.text.length), pan: info.pan, timbre: info.timbre, gain: 0.15 });
        visual.pulse({ type: 'reply', angle, hue, at: when, strength: 0.7 });
        break;
      }
      case 'like':
        synth.tick({ when: when + (fnv1a(e.did) % 20) / 1000, pan: info.pan * 0.5 });
        visual.pulse({ type: 'like', angle: angle + ((fnv1a(e.did) % 100) / 100 - 0.5) * 0.6, hue, at: when, strength: 0.6 });
        break;
      case 'repost':
        synth.rim({ when, pan: info.pan });
        visual.pulse({ type: 'repost', angle, hue, at: when });
        break;
      case 'follow':
        synth.swell({ when, pan: info.pan });
        visual.pulse({ type: 'follow', angle, hue, at: when, strength: 1.4 });
        break;
    }
  }
}

function advanceChord(when) {
  state.chordIndex = (state.chordIndex + 1) % CHORDS.length;
  synth.drone.setChord(chordAt(state.chordIndex, state.keyRoot), when, 3);
}

function changeKey(when = ctx.currentTime) {
  state.keyRoot = nextKey(state.keyRoot);
  synth.drone.setChord(chordAt(state.chordIndex, state.keyRoot), when, 2);
  visual.setKeyHue(hueForKey(state.keyRoot));
  visual.flash();
}

function hueForKey(root) { return (root * 30 + 200) % 360; }

function everySecond() {
  for (const r of Object.values(rates)) r.sample(1);
  const p = rates.post;
  // self-calibrating brightness: normalize slow rate against a decaying min/max window
  state.minSlow = Math.min(state.minSlow * 1.001 + 0.01, p.slow);
  state.maxSlow = Math.max(state.maxSlow * 0.999, p.slow, state.minSlow + 1);
  const b = (p.slow - state.minSlow) / (state.maxSlow - state.minSlow);
  synth.drone.setBrightness(Math.max(0, Math.min(1, b)));
  synth.setWet(Math.max(0, Math.min(1, b)));
  visual.setBrightness(Math.max(0, Math.min(1, b)));
  if (burst(p.fast, p.slow, ctx.currentTime)) changeKey();
  renderStats();
}

function renderStats() {
  if (!state.statsOn) return;
  const keyName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][state.keyRoot];
  statsEl.textContent = [
    `${state.connection}${state.host ? ' ' + state.host : ''}`,
    `posts/s ${rates.post.inst.toFixed(0)}  likes/s ${rates.like.inst.toFixed(0)}  reposts/s ${rates.repost.inst.toFixed(0)}  follows/s ${rates.follow.inst.toFixed(0)}`,
    `key ${keyName}  ${scheduler.bpm} bpm  comp ${synth.reduction.toFixed(1)} dB`,
    `text ${state.textOn ? 'on' : 'off'} (${state.textShown})  dropped ${state.dropped}${state.muted ? '  MUTED' : ''}`,
  ].join('\n');
}

function onKey(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  switch (ev.key) {
    case 'm': state.muted = !state.muted; synth.setMuted(state.muted); store.set('muted', state.muted); break;
    case 'f': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
    case '[': scheduler.setBpm(scheduler.bpm - 5); break;
    case ']': scheduler.setBpm(scheduler.bpm + 5); break;
    case 'k': changeKey(); break;
    case 't': state.textOn = !state.textOn; visual.setTextEnabled(state.textOn); store.set('textOn', state.textOn); break;
    case 'h': state.statsOn = !state.statsOn; statsEl.classList.toggle('hidden', !state.statsOn); break;
    default: return;
  }
  renderStats();
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    ctx.resume().then(() => { scheduler.flush(); scheduler.prime(); visual.setClockOffset(ctx.currentTime, performance.now()); });
  }
}

let hideTimer;
function setupStatsAutoHide() {
  const show = () => {
    if (!state.statsOn) return;
    statsEl.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => statsEl.classList.add('hidden'), 5000);
  };
  document.addEventListener('mousemove', show);
  document.addEventListener('touchstart', show, { passive: true });
  show();
}
```

- [ ] **Step 3: Remove the smoke test, run the suite**

```bash
git rm -q test/smoke.test.js
npm test
```
Expected: all pass (music, filter, stream, scheduler).

- [ ] **Step 4: Manual check in replay mode**

Run: `npm run serve`, open `http://localhost:8765/?replay=1&rate=200`, click Play.
Expected:
- Drone audible immediately; plucks/ticks land on a steady grid; no clicks or pops.
- Pulses appear on rings; text types out near the outer ring, at most ~12 at once, no text overlapping badly.
- Stats corner shows `replay`, rates, key, bpm, comp reduction.
- Keys work: `m`, `[`, `]`, `k` (flash + hue change), `t` (text disappears), `h`.
- Reload: mute/text/volume state persisted.

- [ ] **Step 5: Manual check live**

Open `http://localhost:8765/`, click Play. Expected: stats show `open jetstream1.us-west...`, posts/s in the tens, likes/s in the hundreds. Let it run 10 minutes: comp reduction stays above -6 dB most of the time (if not, lower `gain` defaults in `synth.js` voices by ~30%), no audible glitching, browser CPU reasonable. Toggle Wi-Fi off/on: stats go `reconnecting`, visual dims, drone keeps playing, then recovers.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.js
git commit -m "Wire up page: conductor, UI, hotkeys, replay and live modes"
```

---

### Task 11: Deploy script and first deploy

**Files:**
- Create: `deploy.sh`
- Modify: `README.md` (add live URL once known)

- [ ] **Step 1: Write deploy.sh**

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
npm test
rm -rf dist && mkdir dist
cp index.html dist/
cp -R src fixtures dist/
npx wrangler pages deploy dist --project-name=firehose-orchestra --branch=main
```

```bash
chmod +x deploy.sh
echo "dist/" >> .gitignore
```

- [ ] **Step 2: Create the Pages project (first time only) and deploy**

Run: `npx wrangler pages project create firehose-orchestra --production-branch=main` (skip if it says it exists), then `./deploy.sh`.
Expected: wrangler prints a `*.pages.dev` URL. Open it, click Play, confirm audio and stats show `open`.

- [ ] **Step 3: Record the URL in README and commit**

Add under `## Deploy` in `README.md`: `Live: https://firehose-orchestra.pages.dev`

```bash
git add deploy.sh .gitignore README.md
git commit -m "Add Cloudflare Pages deploy script"
```

---

## Self-review notes

- **Spec coverage:** stream layer (T5), rate tracking (T3), mapping table incl. reply octave-down and DID-stable pitch (T2/T10), like density throttle via caps (T3/T7), language pan/timbre (T2/T10), loudness policy compressor (T8), drone chord cycle/brightness/wet/burst→key change (T8/T10), scheduler lookahead + resync (T7), visual rings/pulses/key flash/pulse cap (T9), typewriter storm incl. 1/bucket, 12 max, ≤2.5s typing, 140 truncate, 34 wrap, overlap slot search (T9/T10), strict filter 7 rules (T4), UI Play/stats/hotkeys/localStorage/coarse scaling (T10), error handling (reconnect T5, visibility resume T10, malformed counter T5/T10), tests + fixtures + replay mode (T4/T5/T6), deploy (T11).
- **Not covered, deliberately:** spec's "voice caps scale down ~50% on coarse pointer" is only applied to visuals; audio caps stay. Add `caps` override to `Scheduler` in T10 if mobile CPU proves a problem.
- **Type consistency check:** `onTick(scheduled, when, step, dropped)` matches T7 and T10; `visual.text` returns boolean used by T10; `Scheduler.prime()` used by tests, T10 visibility handler; `synth.setWet` defined in T8, called in T10; `langInfo` returns `{pan, hue, timbre}` used in T10.
