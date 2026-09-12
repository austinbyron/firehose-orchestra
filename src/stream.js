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
      if (!this.events.length) return;
      for (let n = 0; n < perTick; n++) {
        const e = this.events[this.i++ % this.events.length];
        this.onEvent({ ...e, timeUs: Date.now() * 1000 });
      }
    }, 50);
  }
  stop() { clearInterval(this.timer); }
}
