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
  if (URL_RE.test(text.replace(MENTION_RE, ' '))) return 'url';
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
