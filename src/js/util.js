/* ============ honest dice ============ */
import { locale } from './i18n.js';

export let rnd = function rnd() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};
export function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/* ============ utilities ============ */
export const $ = s => document.querySelector(s);
export const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const clone = o => JSON.parse(JSON.stringify(o));
export const pad = n => String(n).padStart(6, '0');
export const nowIso = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.floor(rnd() * 1e8).toString(36);
export let toast = function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
};
export function fmt(n) {
  return Number(n || 0).toLocaleString(locale());
}
const UTF8 = new TextEncoder();
export const utf8Bytes = s => UTF8.encode(String(s ?? '')).length;
export const kb = bytes => `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

// Errors a caller deliberately survives (a cleanup that may fail, a capability that may be missing). They are kept
// here instead of thrown so ⚙ → Diagnostics can show what went wrong on a phone, where there is no console.
export const IGNORED = [];
export function noteIgnored(where, e) {
  IGNORED.unshift({
    t: new Date().toLocaleTimeString(locale()),
    where,
    msg: String((e && (e.code || e.message)) || e).slice(0, 160),
  });
  IGNORED.length = Math.min(IGNORED.length, 20);
  console.warn('[ignored]', where, e);
}

// the SHA-256 of a file or blob as hex: how a picture is recognized when it is uploaded again
export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// run fn over items, a few at a time
export async function inParallel(items, n, fn) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await fn(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, worker));
}

// a name to compare: no spaces, lower case
export const normName = x =>
  String(x || '')
    .replace(/\s+/g, '')
    .toLowerCase();
export function cutLine(v, n) {
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const h = t.slice(0, n - 1);
  const k = Math.max(h.lastIndexOf(' '), h.lastIndexOf(','));
  return (k > n * 0.6 ? h.slice(0, k) : h).replace(/[ ,.]+$/, '') + '…';
}

export function shortWhat(x) {
  const t = String(x || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 24 ? t.slice(0, 23) + '…' : t;
}

// a mark is any [[...]] on one line (a person, or @ and place words); the length cap only bounds the scan
export const MARK_RE = /\[\[\s*(@?)([^\[\]\n]{1,200}?)\s*\]\]/g;
// a mark on its own line, with the blank lines around it
export const MARK_LINE_RE = /\n*(\[\[[^\[\]\n]{1,200}\]\])\n*/g;

// a system window in narration: [ ... ], 【 world news 】, 〈 or 《 a constellation 》 (log.js shows these as windows)
export const SYS_BOX = String.raw`\[[^\[\]\n]{2,140}\]|【[^【】\n]{2,180}】|〈[^〈〉\n]{2,180}〉|《[^《》\n]{2,180}》`;
const WINDOW_LINE_RE = new RegExp(String.raw`^[ \t]*(?:${SYS_BOX})[ \t]*$`);
const MARK_ONLY_RE = /^[ \t]*\[\[[^\[\]\n]{1,200}\]\][ \t]*$/;
// list items, table rows and quotes keep their single breaks
const LIST_LINE_RE = /^[ \t]*(?:(?:[-*+•]|\d{1,3}[.)])[ \t]|[|>])/;
// prose ends a sentence, a line of speech or a sound; stat lines (이름: 민지), headings and windows don't
const PROSE_END_RE = /[.!?…。！？"”'’」』)~-][ \t]*$/;
// a markdown comment line ([//]: # (...)), which chat-site prompts ask for and markdown never shows
const MD_COMMENT_RE = /^[ \t]*\[[^\[\]\n]*\]:[ \t]*(?:#|<>)[ \t]*(?:\(.*\)|".*"|'.*')?[ \t]*$/;
// one still streaming in: the last line so far
const MD_COMMENT_START_RE = /^[ \t]*\[[^\[\]\n]*\]:[ \t]*(?:#|<>)[ \t]*[("']/;
const isProse = line => PROSE_END_RE.test(line) && !LIST_LINE_RE.test(line);
// a blank line between two lines of text; marks are skipped, and windows end the run (a correction adds one before)
const hasParagraphs = lines => {
  let text = false,
    gap = false;
  for (const line of lines) {
    if (MARK_ONLY_RE.test(line)) continue;
    if (!line.trim()) gap = text;
    else if (WINDOW_LINE_RE.test(line)) text = gap = false;
    else if (text && gap) return true;
    else {
      text = true;
      gap = false;
    }
  }
  return false;
};
// some models write no blank lines: then a break between two lines of prose becomes one (lists and windows keep theirs)
export const tidyNarration = t => {
  const all = String(t || '').split(/\r\n?|\n/);
  const lines = [];
  all.forEach((line, i) => {
    if (MD_COMMENT_RE.test(line) || (i === all.length - 1 && MD_COMMENT_START_RE.test(line))) return;
    if (!line.trim() && (!lines.length || !lines.at(-1).trim())) return; // one blank line at most, none on top
    lines.push(line);
  });
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (!lines.length) return '';
  lines.push(lines.pop().trimEnd());
  if (hasParagraphs(lines)) return lines.join('\n');
  return lines.reduce((out, line, i) => out + (isProse(lines[i - 1]) && isProse(line) ? '\n\n' : '\n') + line);
};

export const stripMarks = t =>
  String(t || '')
    .replace(MARK_RE, '')
    .replace(/\n{3,}/g, '\n\n');
// narration as plain text: tidied, without marks, and no blank line where a leading mark was
export const narrText = t => stripMarks(tidyNarration(t)).replace(/^\s*\n/, '');

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  rnd: f => (rnd = f),
  toast: f => (toast = f),
};
