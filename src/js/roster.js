/* ============ people's profiles: set cards, and the character list (roster) a player pastes for a save ============ */
import { app } from './app.js';
import { N_ } from './i18n.js';
import { LIMITS } from './limits.js';
import { clone, cutLine, normName } from './util.js';
import { normGender } from './data.js';
import { rosterField } from './reply-words.js';

// who a person is, for the narrator: a set card's optional profile (set.profile) or a roster entry's. Field -> longest
// kept text and the set card editor's placeholder
export const PROFILE = {
  epithet: { max: 30, label: N_('Epithet (e.g. Plum Blossom Sword)') },
  position: { max: 40, label: N_('Position (e.g. sect elder)') },
  power: { max: 30, label: N_('Power (e.g. peak realm)') },
  looks: { max: 80, label: N_('Looks (e.g. silver hair, scar)') },
  traits: { max: 80, label: N_('Personality') },
  speech: { max: 40, label: N_('Speech (e.g. formal, curt)') },
  signature: { max: 60, label: N_('Signature art or weapon') },
  ties: { max: 80, label: N_("Ties (e.g. the sect leader's disciple)") },
  secret: { max: 120, label: N_('Secret (only the narrator knows)') },
};
export const PROFILE_FIELDS = Object.keys(PROFILE);
// a profile as a pack or the set card editor gives it: known fields, trimmed; undefined when nothing is left
export function cleanProfile(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const f of PROFILE_FIELDS) {
    const v = String(p[f] == null ? '' : p[f])
      .trim()
      .slice(0, PROFILE[f].max);
    if (v) out[f] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// The roster: state.roster[world id] is the pasted text, read whenever it is used (the format: ARCHITECTURE.md)
const CLOSE = { '"': '"', "'": "'", '「': '」', '『': '』', '“': '”', '‘': '’' };
const OPENS_AFTER = /[\s:：,(（]/; // a straight quote opens only after these, so an apostrophe in a word does not
const KEY_START = /^\s*[^:：\s/／|][^:：]{0,23}[:：]/; // a part that begins a new key: value
// a line's parts: split on / ／ | outside quotes, and only where the next part begins a key: value, so "black hair /
// red eyes", "S/A rank" and a URL stay one value. A quote left open is taken as no quote.
function parts(line) {
  const cut = quotes => {
    const segs = []; // [the separator before it, its text]
    let cur = '',
      sep = '',
      close = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (close) {
        if (ch === close) close = '';
      } else if (quotes && CLOSE[ch] && (!`"'`.includes(ch) || !i || OPENS_AFTER.test(line[i - 1]))) close = CLOSE[ch];
      else if ('/／|'.includes(ch)) {
        segs.push([sep, cur]);
        sep = ch;
        cur = '';
        continue;
      }
      cur += ch;
    }
    segs.push([sep, cur]);
    return close ? null : segs;
  };
  const out = [];
  for (const [sep, t] of cut(true) || cut(false)) {
    if (out.length && !KEY_START.test(t)) out[out.length - 1] += sep + t;
    else out.push(t);
  }
  return out.map(t => t.trim()).filter(Boolean);
}
const KEYED = /^([^:：]{1,24}?)\s*[:：]\s*(.*)$/;
const HEADING = /^#{1,6}\s*([^#].*?)\s*#*$/;
const BULLET = /^(?:[-*+•]|\d{1,3}[.)])\s+/;
const RULE = /^[\s\-*_=~`>]*$/; // a markdown rule, a code fence or an empty quote: no content
const ME = /\{\s*user\s*\}/i; // {user} or {{user}}: the player, in other RP services' sheets
const NAMED = /^(.*?)\s*(?:[(（]([^)）]*)[)）])?$/;
const join = (a, b) => (a ? a + ', ' + b : b);
// a value in a pair of quotes, without them
const unquote = v => (v.length > 1 && CLOSE[v[0]] && v.endsWith(CLOSE[v[0]]) ? v.slice(1, -1) : v);
const cleanLine = raw =>
  raw
    .replace(/\*\*|__/g, '')
    .replace(/^\s*>\s?/, '')
    .trim();
// a # heading: the affiliation of the people under it
export const isHeading = raw => HEADING.test(cleanLine(raw));

// the people a pasted text holds, and what it skipped or changed (notes: { line, why, ... } for the preview)
export function parseRoster(text, me = '') {
  const people = [],
    notes = [];
  const meN = normName(me);
  let faction = '',
    cur = null, // the person the lines below belong to, or SKIP for one the list does not keep
    over = false;
  const SKIP = {};
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const skip = (why, x) => void notes.push({ line, why, ...x });
    // a line it cannot read ends the person above, so the lines after it are not taken for theirs
    const reject = (why, x) => {
      cur = null;
      skip(why, x);
    };
    const t = cleanLine(raw);
    if (!t) {
      cur = null;
      return;
    }
    if (RULE.test(t)) return;
    const h = HEADING.exec(t);
    if (h) {
      faction = h[1]
        .replace(/[:：]$/, '')
        .trim()
        .slice(0, LIMITS.text.label);
      cur = null;
      return;
    }
    const ps = parts(t.replace(BULLET, '').replace(/^[\s/／|]+|[\s/／|]+$/g, '')).map(p => {
      const m = KEYED.exec(p);
      return m ? { key: m[1].trim(), field: rosterField(m[1]), value: m[2].trim() } : { raw: p };
    });
    const bare = ps.find(p => p.raw != null);
    if (bare) return reject('unlabeled', { text: bare.raw });
    const named = ps.filter(p => p.field === 'name');
    if (named.length > 1) return reject('twoNames', { text: t });
    if (named.length) {
      // Name (another name): the part in brackets is an alias
      // a name takes no part glued on after a slash ("Name: Baek / swordsman"): that part has no key, so it goes
      let v = unquote(named[0].value);
      const cut = v.search(/[/／|]/);
      if (cut >= 0) {
        skip('nameCut', { text: v.slice(cut + 1).trim() });
        v = v.slice(0, cut).trim();
      }
      const [, name, more = ''] = NAMED.exec(v);
      if (!name) return reject('noName', { text: t });
      if (name.length > LIMITS.text.name) return reject('longName', { text: name, n: LIMITS.text.name });
      if ((meN && normName(name) === meN) || ME.test(name)) {
        cur = SKIP;
        return skip('me', { name });
      }
      const dup = people.findIndex(e => normName(e.name) === normName(name));
      if (dup >= 0) {
        people.splice(dup, 1);
        skip('again', { name });
      }
      if (people.length >= LIMITS.roster.people) {
        if (!over) skip('over', { n: LIMITS.roster.people });
        over = true;
        cur = SKIP;
        return;
      }
      cur = { name, aliases: [], faction, gender: null, profile: {}, line };
      people.push(cur);
      if (more) ps.push({ field: 'aliases', value: more });
    } else if (cur === SKIP) return;
    else if (!cur) return skip('noName', { text: t });
    for (const p of ps) {
      if (p.field === 'name' || !p.value) continue;
      const v = p.value;
      if (p.field === 'faction') cur.faction = v.slice(0, LIMITS.text.label);
      else if (p.field === 'gender') {
        const g = normGender(v);
        if (g === 'female' || g === 'male') cur.gender = g;
      } else if (p.field === 'aliases' || p.field === 'epithet') {
        // an epithet is also told to the narrator (profile.epithet); both are names the person answers to
        if (p.field === 'epithet') cur.profile.epithet = join(cur.profile.epithet, v);
        for (const a of v.split(/[,，、]/).map(x => x.trim())) {
          const n = normName(a);
          if (a.length < 2 || a.length > LIMITS.text.name || n === normName(cur.name)) continue;
          if (cur.aliases.length < LIMITS.roster.aliases && !cur.aliases.some(x => normName(x) === n))
            cur.aliases.push(a);
        }
      } else if (p.field) cur.profile[p.field] = join(cur.profile[p.field], v);
      else {
        cur.profile.traits = join(cur.profile.traits, `${p.key}: ${v}`); // a key it does not know stays as a detail
        skip('other', { label: p.key, name: cur.name });
      }
    }
  });
  // a name is one person's: an alias that is the player's or another person's name is dropped, and an alias two
  // people claim stays with the first
  const names = new Set(people.map(e => normName(e.name)));
  const claimed = new Set();
  for (const e of people)
    e.aliases = e.aliases.filter(a => {
      const n = normName(a);
      const why = (meN && n === meN) || ME.test(a) ? 'aliasMe' : names.has(n) || claimed.has(n) ? 'aliasTaken' : '';
      if (why) notes.push({ line: e.line, why, alias: a, name: e.name });
      else claimed.add(n);
      return !why;
    });
  for (const e of people) {
    let cut = false;
    for (const f of Object.keys(e.profile)) {
      if (e.profile[f].length > PROFILE[f].max) cut = true;
      e.profile[f] = cutLine(e.profile[f], PROFILE[f].max);
    }
    if (cut) notes.push({ line: e.line, why: 'cut', name: e.name });
  }
  notes.sort((x, y) => x.line - y.line);
  return { people, notes };
}

// a roster person's names, the main one first
export const namesOf = e => [e.name, ...e.aliases];
// whether the text names this person (a name of two or more letters, so one letter never matches a word)
export const mentioned = (e, text) => namesOf(e).some(n => n.length >= 2 && says(text, n));
// a name in Latin letters as a whole word, any case ("Kai" is in "kai." but not "Kaiser"); Korean, Japanese and Chinese
// names anywhere, since particles attach to them (리운이)
const LATIN = /^[\p{Script=Latin}\d\s'’.-]+$/u;
const says = (text, n) =>
  LATIN.test(n)
    ? new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text)
    : text.includes(n);

export const rosterTextOf = (st, worldId) => ((st && st.roster) || {})[worldId] || '';
let memo = { text: null, me: null, people: [], byName: new Map() };
function rosterOf(st) {
  const text = st && st.life && rosterTextOf(st, st.life.world.id);
  if (!text) return null;
  const me = st.life.name;
  if (memo.text !== text || memo.me !== me) {
    const people = parseRoster(text, me).people;
    const byName = new Map(); // every name and alias, spaces and case ignored (parseRoster leaves each to one person)
    for (const e of people) for (const n of namesOf(e)) if (!byName.has(normName(n))) byName.set(normName(n), e);
    memo = { text, me, people, byName };
  } else memo.text = text; // the same text: the next check compares one string, not two copies
  return memo;
}
// a life's roster (this one's by default): the list kept for its world, parsed once per text
export const rosterNow = (st = app.state) => (rosterOf(st) || { people: [] }).people;
// the roster entry under this name or one of its aliases (spaces and case ignored), or null
export function rosterFor(name, st = app.state) {
  const R = rosterOf(st);
  return (R && R.byName.get(normName(name))) || null;
}
// a state to keep with a turn: the character lists stay out (a rewrite or a branch takes the live ones), as they would
// otherwise sit in every reply's copy
export const snapOf = st => clone({ ...st, roster: undefined }); // the JSON copy leaves an undefined key out
export function setRoster(st, worldId, text) {
  const t = String(text || '')
    .trim()
    .slice(0, LIMITS.roster.text);
  const R = { ...(st.roster || {}) };
  if (t) R[worldId] = t;
  else delete R[worldId];
  st.roster = R;
}
