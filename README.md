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
| `x` / `Esc` | open / close the mixer drawer (key, scale, lock, tempo, per-voice instrument, level, mute) |

## Deploy

    ./deploy.sh

Cloudflare Pages direct upload, project `firehose-orchestra`.

Live: https://firehose-orchestra.pages.dev
