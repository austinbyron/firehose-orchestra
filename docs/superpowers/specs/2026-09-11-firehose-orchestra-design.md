# Firehose Orchestra — Design

**Date**: 2026-09-11
**Status**: approved in brainstorm, pending spec review
**Deploy target**: single static page on Cloudflare Pages, $0

## What it is

A web page that turns the live Bluesky network into music. The browser opens a
WebSocket directly to Jetstream (public, no auth, no server of ours) and maps
network events to sound in real time. A sustained drone follows slow trends;
individual events pop as quantized percussive and melodic hits on top. A
full-screen canvas visualizer reacts to the same events. It is a toy to leave
running, not a dashboard and not a portfolio piece.

## Non-goals

- No backend, no accounts, no persistence beyond `localStorage` for mute/volume.
- No handles, avatars, or links are displayed; text only, and only after the
  strict filter below. No moderation UI (report/block) — this is a viewer.
- No dependencies: hand-rolled WebAudio, no Tone.js, no CDN scripts.
- No mixer UI in v1 (candidate for v2).

## Stream layer

- Endpoint: `wss://jetstream1.us-west.bsky.network/subscribe` with fallback
  rotation across `jetstream2.us-west`, `jetstream1.us-east`, `jetstream2.us-east`.
- Query: `wantedCollections=app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow`.
- Only `kind === "commit"` with `operation === "create"` is used.
- Reconnect with exponential backoff (1s → 30s), resuming from the last
  `time_us` minus 2s via `?cursor=`. Ignore events older than 10s on resume so
  a long outage doesn't dump a burst into the scheduler.
- Rate tracking per event type: exponential moving averages over ~5s (fast) and
  ~60s (slow), plus an instantaneous 1s count. These drive the drone and the
  burst detector.
- Expected load: ~50–100 posts/s, 200–500 likes/s. All JSON parsing stays on
  the main thread; it is well within budget for a modern browser, but the
  scheduler caps what reaches the audio graph (see below).

## Event → sound mapping

| Event | Voice | Parameters |
|---|---|---|
| Post | Melodic pluck (Karplus-ish: noise burst → resonant filter, or short triangle w/ fast decay) | Pitch = pentatonic degree chosen by `hash(did) % scaleLength` in the current key, octave by `hash(did) >> 8`; so an account always plays "its" note. Note length = clamp(text length / 60, 0.1s, 1.2s). |
| Reply (post with `reply.parent`) | Same pluck, one octave down, quieter | Pitch from `hash(parentUri)` so a busy thread repeats one note. |
| Like | Hi-hat tick (filtered noise, 20–40ms) | Density-throttled: at most 8 per 16th-note bucket; excess raises the tick's level slightly instead of adding voices. |
| Repost | Rim/snare (noise + short sine body) | Cap 2 per bucket. |
| Follow | Rising swell (sine sweep up a fifth over 0.6s, soft) | Cap 1 per bucket. |

- **Language → pan and timbre**: `langs[0]` mapped through a fixed table of
  ~12 common languages to a pan position across the stereo field and a small
  timbre offset (filter Q / waveform); unknown languages sit near center with
  the default timbre.
- **Loudness policy**: rate spikes make the music denser, never louder. A
  master compressor (`DynamicsCompressorNode`) sits before the destination as a
  safety net, but the per-bucket caps are the real control.

## Drone

- 3–4 detuned oscillators (saw/triangle mix) through a lowpass filter and a
  convolution reverb built from a synthesized impulse response (no sample
  assets).
- Chord follows a slow cycle through a fixed progression in the current key
  (e.g. I → vi → IV → V-ish voicings on the pentatonic-friendly set), changing
  every ~2 minutes with a slow crossfade.
- Filter cutoff and reverb wet mix track the slow posts/sec EMA, normalized
  against a rolling min/max so the piece self-calibrates to time of day.
- **Burst detector**: when the fast post EMA exceeds 2× the slow EMA for 3
  consecutive seconds, modulate to a new key (random walk around the circle of
  fifths) and flash the visual. Cooldown 90s.

## Scheduler

- Fixed tempo, default 90 BPM, 16th-note grid.
- Lookahead scheduler (setInterval ~25ms, schedules audio 100ms ahead) per the
  standard "tale of two clocks" pattern.
- Incoming events land in the *next* 16th bucket. Each tick drains one bucket,
  applying the per-voice caps above, then discards the remainder.
- Voices are created per-hit and disconnect themselves on `ended`; no voice
  pooling in v1 unless profiling shows GC pressure.

## Visual

- One full-screen `<canvas>` (2D context), `devicePixelRatio`-aware.
- Background: slow breathing radial gradient whose hue follows the current key
  and whose brightness follows the drone filter cutoff.
- Each triggered voice draws a radial pulse originating on a ring assigned to
  its event type (posts outer, likes inner, reposts/follows between), at an
  angle set by the language pan position, colored by language. Pulses expand
  and fade over ~0.6s.
- Key change: brief full-frame flash and ring rotation.
- Only voices that were actually scheduled draw (so visual and audio agree).

### Typewriter storm (post text)

- A sample of posts that pass the **strict content filter** type themselves
  out on the canvas, character by character, starting at their pulse's origin
  point and in their language's color, then fade over ~4s. Text lands with its
  note, so reading and hearing agree.
- Rate: at most one new text per 16th-note bucket and at most ~12 on screen
  at once; further eligible posts are dropped (not queued) so text never lags
  the audio.
- Typing speed scales with text length so every post finishes in ≤2.5s.
  Truncate at 140 chars with an ellipsis. Newlines collapse to spaces.
- Layout: word-wrapped to a max width of ~34ch, nudged inside the viewport;
  a new text that would overlap a live one by more than half its box shifts to
  the nearest free ring slot, or is skipped if none.
- Key `t` cycles text mode: typewriter (default) → off. Persisted in
  `localStorage`.

### Strict content filter (client-side, pure function in `music.js`/`filter.js`)

A post is eligible for display only if ALL hold:

1. No self-labels (`record.labels.values[].val`) in
   {`porn`, `sexual`, `nudity`, `graphic-media`, `!no-unauthenticated`}.
2. No `record.embed` of any kind (images, video, external link, quote).
3. `record.langs` includes `en` (configurable set; default `["en"]`).
4. No URLs (regex for `https?://` or `\w+\.\w{2,}/` shapes) and no more than
   two `#hashtags`; no more than one `@mention`.
5. Text length between 12 and 300 chars after trimming, and not mostly
   uppercase or mostly emoji/punctuation (ratio checks).
6. No hit against a bundled blocklist (`src/blocklist.js`, a few hundred
   slur/adult/spam terms, matched on word boundaries with simple leetspeak
   normalization). The list is a plain array so it is easy to extend.
7. Not a reply (keeps standalone thoughts; replies still play their note).

Filtering only gates *display*. Every post still drives audio and pulses.
Expected pass rate ~5–15% of English posts, which is far more than the
display budget anyway.
- Frame budget: retained pulse list capped (~400); oldest dropped first.

## UI

- Initial state: a single centered **Play** button (required by autoplay
  policy). Tapping creates the `AudioContext`, opens the socket, starts the
  scheduler.
- Bottom-left stats corner, small monospace: connection state, posts/s,
  likes/s, current key/BPM. Hidden after 5s of no mouse movement.
- Keys: `m` mute, `f` fullscreen, `[`/`]` BPM ±5, `k` force key change,
  `h` hide/show stats, `t` text mode. Volume and mute persist in `localStorage`.
- Mobile: works; pulses and voice caps scale down by ~50% when
  `matchMedia('(pointer: coarse)')`.

## Error handling

- Socket down: drone keeps playing, stats show "reconnecting"; visual dims.
- All four Jetstream hosts failing: stats show the error, drone continues,
  retry loop keeps going with 30s cap.
- `AudioContext` suspended (tab backgrounded on mobile): resume on next
  interaction; scheduler discards buckets accumulated while suspended.
- Malformed events are skipped silently; a counter in stats shows drops.

## Testing

- Pure functions (`hashDid`, `pitchFor`, `bucketFor`, EMA update, burst
  detector, cap application, the strict content filter, text wrapping) live in
  small ES modules and get unit tests with Node's built-in `node:test`. The
  filter tests include a fixture set of should-pass / should-block posts. No bundler; the module is loaded by `index.html`
  directly via `<script type="module">`.
- A `fixtures/` folder holds ~200 recorded Jetstream events for a replay mode
  (`?replay=1`) so the page can be developed and demoed offline at a chosen
  rate without hitting the network.
- Manual acceptance: 10 minutes live with no clipping (compressor gain
  reduction stays under ~6 dB), no audible glitches, CPU stays reasonable in
  the browser task manager on the Intel Mac.

## File layout

```
firehose-orchestra/
  index.html          page + canvas + UI
  src/
    stream.js         Jetstream client, reconnect, rate tracking
    music.js          pure mapping: hash, scale, pitch, caps, EMA, burst
    filter.js         strict display filter (pure) + text wrap/truncate
    blocklist.js      plain array of blocked terms
    synth.js          WebAudio voices, drone, master chain
    scheduler.js      lookahead clock, buckets
    visual.js         canvas renderer
    main.js           wiring + UI + keys
  test/               node:test unit tests for music.js
  fixtures/           recorded events for replay mode
  deploy.sh           wrangler pages deploy (direct upload, like snellstheme)
  README.md
```

## Deploy

Cloudflare Pages direct upload via `wrangler pages deploy .` from `deploy.sh`,
same pattern as snellstheme and liveShuffleSite. Custom domain optional
later. No environment variables, no secrets.

## Open items for v2 (not in scope)

Mixer drawer to remap voices; ticker/feed-column text modes; recording/export of a session; DID watchlist
so followed accounts get a distinct instrument; 24h cursor replay scrubber.
