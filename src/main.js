import { JetstreamClient, ReplaySource } from './stream.js';
import { Scheduler } from './scheduler.js';
import { Synth } from './synth.js';
import { Visual } from './visual.js';
import {
  pitchFor, fnv1a, noteLengthFor, langInfo, chordAt, RateTracker, createBurstDetector, nextKey, CHORDS,
  SCALES, KEY_NAMES,
} from './music.js';
import { rejectReason, prepareText } from './filter.js';
import { buildMixer } from './mixer.js';

const params = new URLSearchParams(location.search);
const REPLAY = params.get('replay') === '1';
const REPLAY_RATE = Number(params.get('rate') ?? 150);
const CHORD_STEPS = 720; // 2 minutes at 90 BPM in 16ths

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const playEl = $('play');
const statsEl = $('stats');
const mixerEl = $('mixer');
const mixToggle = $('mixToggle');
const coarse = matchMedia('(pointer: coarse)').matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const TYPES = ['post', 'reply', 'like', 'repost', 'follow'];
export const VOICES = ['pluck', 'bell', 'tick', 'rim', 'swell', 'off'];

export function defaultMix() {
  return {
    keyRoot: Math.floor(Math.random() * 12),
    scale: 'major pentatonic',
    lock: false,
    bpm: 90,
    drone: 1,
    master: 0.8,
    types: {
      post: { voice: 'pluck', level: 1, mute: false },
      reply: { voice: 'pluck', level: 0.6, mute: false },
      like: { voice: 'tick', level: 1, mute: false },
      repost: { voice: 'rim', level: 1, mute: false },
      follow: { voice: 'swell', level: 1, mute: false },
    },
  };
}

function loadMix() {
  const d = defaultMix();
  const saved = store.get('mix', null);
  if (!saved) return d;
  const mix = { ...d, ...saved, types: { ...d.types } };
  for (const t of TYPES) mix.types[t] = { ...d.types[t], ...(saved.types?.[t] ?? {}) };
  if (!SCALES[mix.scale]) mix.scale = d.scale;
  return mix;
}

const mix = loadMix();
const state = {
  chordIndex: 0,
  muted: store.get('muted', false),
  textOn: store.get('textOn', true),
  statsOn: true,
  mixerOpen: false,
  connection: 'idle',
  host: '',
  dropped: 0,
  textShown: 0,
  minSlow: Infinity, maxSlow: 0,
  started: false,
};

const rates = { post: new RateTracker(), like: new RateTracker(), repost: new RateTracker(), follow: new RateTracker() };
const burst = createBurstDetector();

let ctx, synth, visual, scheduler, source, mixer;

$('playBtn').addEventListener('click', start);
playEl.addEventListener('click', (e) => { if (e.target === playEl) start(); });

async function start() {
  if (state.started) return;
  state.started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  synth = new Synth(ctx);
  synth.setVolume(mix.master);
  synth.setMuted(state.muted);
  synth.drone.setLevel(mix.drone);
  visual = new Visual(canvas, { coarse });
  visual.setTextEnabled(state.textOn);
  visual.setClockOffset(ctx.currentTime, performance.now());
  visual.setKeyHue(hueForKey(mix.keyRoot));
  synth.drone.setChord(chordAt(0, mix.keyRoot), ctx.currentTime, 0.1);

  scheduler = new Scheduler({ ctx, bpm: mix.bpm, onTick });
  scheduler.start();
  visual.start();
  playEl.remove();
  mixToggle.hidden = false;

  mixer = buildMixer(mixerEl, { mix, TYPES, VOICES, SCALES, KEY_NAMES, onChange: applyMix, onReset: resetMix });
  mixToggle.addEventListener('click', toggleMixer);

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

function playVoice(voice, { when, midi, dur, pan, timbre, level }) {
  switch (voice) {
    case 'pluck': synth.pluck({ when, midi, dur, pan, timbre, gain: 0.16 * level }); break;
    case 'bell': synth.bell({ when, midi, pan, gain: 0.08 * level }); break;
    case 'tick': synth.tick({ when, pan: pan * 0.5, gain: 0.07 * level }); break;
    case 'rim': synth.rim({ when, pan, gain: 0.2 * level }); break;
    case 'swell': synth.swell({ when, pan, gain: 0.14 * level }); break;
    default: break;
  }
}

function onTick(scheduled, when, step, dropped) {
  state.dropped += dropped;
  if (step > 0 && step % CHORD_STEPS === 0) advanceChord(when);
  const scale = SCALES[mix.scale];
  let textUsed = false;
  for (const e of scheduled) {
    const info = langInfo(e.lang);
    // language picks a sector; the account picks a stable spot inside it
    const spread = e.lang === 'en' ? 2.6 : 0.9;
    const jitter = ((fnv1a(e.did) % 1000) / 1000 - 0.5) * spread;
    const angle = info.pan * Math.PI * 0.75 - Math.PI / 2 + jitter;
    const hue = info.hue;
    const cfg = mix.types[e.type];
    const silent = cfg.mute || cfg.voice === 'off';

    if (!silent) {
      const seed = e.type === 'reply' ? e.parentUri : e.did;
      let midi = pitchFor(seed, mix.keyRoot, { scale });
      if (e.type === 'reply') midi -= 12;
      const dur = e.text ? noteLengthFor(e.text.length) : 0.4;
      const whenJ = e.type === 'like' ? when + (fnv1a(e.did) % 20) / 1000 : when;
      playVoice(cfg.voice, { when: whenJ, midi, dur, pan: info.pan, timbre: info.timbre, level: cfg.level });
    }

    const strength = e.type === 'follow' ? 1.4 : e.type === 'reply' ? 0.7 : e.type === 'like' ? 0.6 : 1;
    visual.pulse({ type: e.type, angle, hue, at: when, strength: silent ? strength * 0.4 : strength });

    if (e.type === 'post' && !textUsed && state.textOn && rejectReason(e.record) === null) {
      if (visual.text({ str: prepareText(e.text), angle, hue, at: when })) { textUsed = true; state.textShown++; }
    }
  }
}

function advanceChord(when) {
  state.chordIndex = (state.chordIndex + 1) % CHORDS.length;
  synth.drone.setChord(chordAt(state.chordIndex, mix.keyRoot), when, 3);
}

function setKey(root, { glide = 2, flash = true } = {}) {
  mix.keyRoot = ((root % 12) + 12) % 12;
  synth.drone.setChord(chordAt(state.chordIndex, mix.keyRoot), ctx.currentTime, glide);
  visual.setKeyHue(hueForKey(mix.keyRoot));
  if (flash) visual.flash();
  saveMix();
  mixer?.sync();
}

function changeKey() { setKey(nextKey(mix.keyRoot)); }

function hueForKey(root) { return (root * 30 + 200) % 360; }

function saveMix() { store.set('mix', mix); }

// Called by the drawer after it mutates `mix` in place.
function applyMix(field) {
  switch (field) {
    case 'keyRoot': setKey(mix.keyRoot, { glide: 1.5 }); return;
    case 'bpm': scheduler.setBpm(mix.bpm); break;
    case 'drone': synth.drone.setLevel(mix.drone); break;
    case 'master': synth.setVolume(mix.master); break;
    default: break;
  }
  saveMix();
  renderStats();
}

function resetMix() {
  const d = defaultMix();
  d.keyRoot = mix.keyRoot;
  Object.assign(mix, d);
  scheduler.setBpm(mix.bpm);
  synth.drone.setLevel(mix.drone);
  synth.setVolume(mix.master);
  saveMix();
  mixer.sync();
  renderStats();
}

function toggleMixer(force) {
  state.mixerOpen = typeof force === 'boolean' ? force : !state.mixerOpen;
  mixerEl.classList.toggle('open', state.mixerOpen);
  mixToggle.classList.toggle('on', state.mixerOpen);
}

function everySecond() {
  for (const r of Object.values(rates)) r.sample(1);
  const p = rates.post;
  state.minSlow = Math.min(state.minSlow * 1.001 + 0.01, p.slow);
  state.maxSlow = Math.max(state.maxSlow * 0.999, p.slow, state.minSlow + 1);
  const b = Math.max(0, Math.min(1, (p.slow - state.minSlow) / (state.maxSlow - state.minSlow)));
  synth.drone.setBrightness(b);
  synth.setWet(b);
  visual.setBrightness(b);
  if (!mix.lock && burst(p.fast, p.slow, ctx.currentTime)) changeKey();
  renderStats();
}

function renderStats() {
  if (!state.statsOn) return;
  statsEl.textContent = [
    `${state.connection}${state.host ? ' ' + state.host : ''}`,
    `posts/s ${rates.post.inst.toFixed(0)}  likes/s ${rates.like.inst.toFixed(0)}  reposts/s ${rates.repost.inst.toFixed(0)}  follows/s ${rates.follow.inst.toFixed(0)}`,
    `key ${KEY_NAMES[mix.keyRoot]} ${mix.scale}${mix.lock ? ' (locked)' : ''}  ${scheduler.bpm} bpm  comp ${synth.reduction.toFixed(1)} dB`,
    `text ${state.textOn ? 'on' : 'off'} (${state.textShown})  dropped ${state.dropped}${state.muted ? '  MUTED' : ''}`,
  ].join('\n');
}

function onKey(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const inField = ev.target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(ev.target.tagName);
  if (inField && ev.key !== 'Escape') return;
  if (inField) ev.target.blur();
  switch (ev.key) {
    case 'm': state.muted = !state.muted; synth.setMuted(state.muted); store.set('muted', state.muted); break;
    case 'f': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
    case '[': mix.bpm = Math.max(40, mix.bpm - 5); applyMix('bpm'); mixer.sync(); break;
    case ']': mix.bpm = Math.min(180, mix.bpm + 5); applyMix('bpm'); mixer.sync(); break;
    case 'k': changeKey(); break;
    case 't': state.textOn = !state.textOn; visual.setTextEnabled(state.textOn); store.set('textOn', state.textOn); break;
    case 'h': state.statsOn = !state.statsOn; statsEl.classList.toggle('hidden', !state.statsOn); break;
    case 'x': toggleMixer(); break;
    case 'Escape': toggleMixer(false); break;
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
