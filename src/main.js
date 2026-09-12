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
    // language picks a sector; the account picks a stable spot inside it
    const jitter = ((fnv1a(e.did) % 1000) / 1000 - 0.5) * 0.9;
    const angle = info.pan * Math.PI * 0.75 - Math.PI / 2 + jitter;
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
        synth.pluck({ when, midi, dur: noteLengthFor(e.text.length), pan: info.pan, timbre: info.timbre, gain: 0.1 });
        visual.pulse({ type: 'reply', angle, hue, at: when, strength: 0.7 });
        break;
      }
      case 'like':
        synth.tick({ when: when + (fnv1a(e.did) % 20) / 1000, pan: info.pan * 0.5 });
        visual.pulse({ type: 'like', angle, hue, at: when, strength: 0.6 });
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
  state.minSlow = Math.min(state.minSlow * 1.001 + 0.01, p.slow);
  state.maxSlow = Math.max(state.maxSlow * 0.999, p.slow, state.minSlow + 1);
  const b = Math.max(0, Math.min(1, (p.slow - state.minSlow) / (state.maxSlow - state.minSlow)));
  synth.drone.setBrightness(b);
  synth.setWet(b);
  visual.setBrightness(b);
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
