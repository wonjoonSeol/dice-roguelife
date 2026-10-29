/* ============ reading narrator replies in any language ============ */
// Each language's patterns are a profile in reply/<lang>.js (named groups, see CLAUDE.md). Every profile is tried,
// since a save can hold turns written in another language.
import KO from './reply/ko.js';
import EN from './reply/en.js';
import JA from './reply/ja.js';
import { normName } from './util.js';

const RAW = { ko: KO, en: EN, ja: JA };
let compiled = null;

// every pattern case-insensitive (profiles are written without flags), and the forms derived from a profile's parts
const ci = v =>
  v instanceof RegExp
    ? new RegExp(v.source, 'i')
    : Array.isArray(v)
      ? v.map(ci)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ci(x)]))
        : v;
export function profiles() {
  if (compiled) return compiled;
  compiled = Object.entries(RAW).map(([lang, raw]) => {
    const p = ci(raw);
    return {
      ...p,
      lang,
      worldHead: new RegExp(`^(?:${p.world.source})`, 'i'),
      worldPrefix: new RegExp(`^(?:${p.world.source})\\s*[:：\\-]?\\s*`, 'i'),
      starHead: new RegExp(`^(?:${p.constellation.source})`, 'i'),
      tags: Object.entries(p.tags),
      roster: Object.entries(p.roster),
      weekday: new RegExp(p.weekday.source, 'gi'),
    };
  });
  return compiled;
}
const first = f => {
  for (const p of profiles()) {
    const v = f(p);
    if (v) return v;
  }
  return null;
};
export const any = key => s => profiles().some(p => p[key].test(s));

// the chance tag ending a choice, such as (success chance 60%, decisive): its chance p, the rest, and where it starts
export const matchOdds = text =>
  first(p => {
    const m = p.odds.exec(String(text));
    return m && { p: Number(m.groups.p), rest: m.groups.rest || '', index: m.index };
  });
export const stripOdds = text => {
  const m = matchOdds(text);
  return m ? String(text).slice(0, m.index) : String(text);
};
export const isPivotal = any('decisive'); // the dice reveal plays whatever the result
export const isWorldHead = any('worldHead');
export const stripWorldPrefix = s => first(p => p.worldHead.test(s) && s.replace(p.worldPrefix, '')) || s;
export const mentionsStars = any('constellation');
export const isStarHead = any('starHead');
export const titleGained = s => first(p => (p.titleGained.exec(s) || {}).groups?.title);
export const isCheckLine = any('checkLine'); // a check result the screen already shows (spaces removed)
export const sysTag = head => first(p => (p.tags.find(([, re]) => re.test(head)) || [])[0]);
export const sysKind = head => (any('bad')(head) ? 'sys-bad' : any('good')(head) ? 'sys-good' : '');
// the field a character list's key names (any language, spaces and case ignored), or null
export const rosterField = key => {
  const k = normName(key);
  return first(p => (p.roster.find(([, re]) => re.test(k)) || [])[0]);
};
