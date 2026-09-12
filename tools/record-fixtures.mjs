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

let done = false;
function finish() {
  if (done) return;
  done = true;
  try { ws.close(); } catch {}
  const byType = out.reduce((a, e) => ((a[e.type] = (a[e.type] ?? 0) + 1), a), {});
  writeFileSync(new URL('../fixtures/events.json', import.meta.url), JSON.stringify(out));
  console.error(`wrote ${out.length} events`, byType);
  process.exit(0);
}
