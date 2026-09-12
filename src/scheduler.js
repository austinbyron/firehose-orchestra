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
    // Clock jumped far ahead (tab suspended): resync instead of spraying catch-up steps.
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
