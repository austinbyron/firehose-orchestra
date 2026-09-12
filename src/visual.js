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
    this.audioOffsetMs = 0;
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

    c.lineWidth = 1;
    for (const [type, f] of Object.entries(RING_BY_TYPE)) {
      if (type === 'reply') continue;
      c.strokeStyle = `hsla(${this.keyHue} 30% 70% / 0.08)`;
      c.beginPath();
      c.arc(this.cx, this.cy, f * this.base, 0, Math.PI * 2);
      c.stroke();
    }

    const keep = [];
    for (const p of this.pulses) {
      const age = now - p.start;
      if (age < -200) { keep.push(p); continue; }
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
      let caretLine = -1;
      let caretCol = 0;
      t.lines.forEach((line, i) => {
        if (remaining < 0) return;
        const part = line.slice(0, Math.max(0, remaining));
        if (caretLine < 0 && remaining <= line.length) { caretLine = i; caretCol = remaining; }
        remaining -= line.length + 1;
        c.fillText(part, t.x, t.y + i * t.font * 1.35);
      });
      if (shown < t.total && caretLine >= 0 && Math.floor(now / 250) % 2 === 0) {
        c.fillRect(t.x + caretCol * t.font * 0.6, t.y + caretLine * t.font * 1.35, t.font * 0.55, t.font * 1.1);
      }
    }
    this.texts = keepT;
  }
}
