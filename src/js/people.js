/* ============ people: names, aliases, relations ============ */
import { app } from './app.js';
import { N_, tIn, UI_LANGS } from './i18n.js';
import { rosterFor, setRoster } from './roster.js';

// how a person stands with the player, in a world whose add-on turns bonds on (state.bonds: name -> { s, up })
export const BONDS = [
  { e: '😡', label: N_('Hostile') },
  { e: '🔒', label: N_('Guarded') },
  { e: '🤔', label: N_('Wary') },
  { e: '😐', label: N_('Neutral') },
  { e: '🙂', label: N_('Friendly') },
  { e: '😄', label: N_('Trusted') },
  { e: '☺️', label: N_('Devoted') },
  { e: '🥰', label: N_('In love') },
];
const BOND_START = 1; // a stranger is guarded
const BOND_FIRST_MAX = 5; // someone who already knows the player may start up to trusted, never higher
const BOND_GAP = 10; // saved rows between two rises (about five exchanges), the clock other cooldowns use
const bondKey = v =>
  String(v == null ? '' : v)
    .replace(/\uFE0F/g, '')
    .trim()
    .toLowerCase();
// the step a reply names: its emoji (with or without a word after it, as the prompt lists them) or its label in any
// screen language
export function bondStep(v) {
  const k = bondKey(v);
  if (!k) return null;
  const i = BONDS.findIndex(
    b => k.startsWith(bondKey(b.e)) || bondKey(b.label) === k || UI_LANGS.some(l => bondKey(tIn(l, b.label)) === k),
  );
  return i >= 0 ? i : null;
}
// the code's part: a first meeting starts guarded (or where the reply says, up to trusted); after that a rise is one
// step, never two within BOND_GAP rows, and a fall goes as far as the reply says. Someone already in the relations
// before bonds existed (a save from before v2.12) gets no step until a reply gives theirs, and may start anywhere.
// Returns [from, to] when it moved.
export function moveBond(name, want, known) {
  const B = (app.state.bonds = app.state.bonds || {});
  const t = app.state.next || 0;
  const cur = B[name];
  if (!cur) {
    if (known && want == null) return null;
    B[name] = { s: want == null ? BOND_START : known ? want : Math.min(want, BOND_FIRST_MAX), up: t };
    return null;
  }
  if (want == null || want === cur.s) return null;
  const from = cur.s;
  if (want < cur.s) cur.s = want;
  else if (t - cur.up >= BOND_GAP) {
    cur.s++;
    cur.up = t;
  } else return null;
  return [from, cur.s];
}
// the step this person stands at, or null
export function bondOf(name) {
  const b = (app.state.bonds || {})[name];
  return b ? BONDS[b.s] : null;
}
// the last reply of the story itself, not an answer to a judge or skills question
export const lastStoryReply = () => [...app.turns].reverse().find(t => t.kind === 'ai' && t.out && !t.out.judge);

// the label a person is kept under: merged labels followed, and a roster alias is its person's roster name
export function canonName(n) {
  const A = (app.state && app.state.aliases) || {};
  const follow = x => {
    for (let k = 0; k < 4 && A[x]; k++) x = A[x];
    return x;
  };
  const x = follow(String(n || '').trim());
  const r = rosterFor(x);
  return r ? follow(r.name) : x;
}
// a merged label or a roster alias used again is the kept person, before faces or notes are touched
export function aliasOut(o) {
  if (!o) return o;
  if (o.speaker) o.speaker = canonName(o.speaker);
  if (Array.isArray(o.also_present))
    o.also_present.forEach(p => {
      if (p && p.name) p.name = canonName(p.name);
    });
  const m = o.memory;
  if (m && Array.isArray(m.relations))
    m.relations.forEach(r => {
      if (r && r.name) r.name = canonName(r.name);
    });
  if (m && Array.isArray(m.died)) m.died = m.died.map(n => (typeof n === 'string' ? canonName(n) : n)); // their face retires
  if (typeof o.narration === 'string')
    o.narration = o.narration.replace(/\[\[(?!@)([^\]]+)\]\]/g, (x, n) => `[[${canonName(n)}]]`);
  return o;
}
// label a becomes label b, in st (the open state by default)
export function renamePerson(a, b, st = app.state) {
  let moved = false;
  if (a && b && a !== b) {
    st.aliases = st.aliases || {};
    if (st.aliases[b] === a) delete st.aliases[b];
    st.aliases[a] = b;
    for (const k of Object.keys(st.aliases)) if (st.aliases[k] === a) st.aliases[k] = b;
    moved = true;
  } /* one person under two labels: the kept label takes the face, its weight and the notes */
  for (const k of ['cast', 'castW', 'castWhy', 'seen', 'bonds']) {
    const m = st[k];
    if (m && Object.prototype.hasOwnProperty.call(m, a)) {
      if (m[b] == null) m[b] = m[a];
      else if (k === 'seen') m[b] = (m[b] || 0) + (m[a] || 0);
      delete m[a];
      moved = true;
    }
  }
  const R = st.relations;
  if (R && R[a] != null) {
    R[b] = R[b] ? (R[b] + ' ' + R[a]).slice(0, 300) : R[a];
    delete R[a];
    moved = true;
  }
  if (st.meta && st.meta[a]) {
    const ma = st.meta[a],
      mb = st.meta[b];
    if (mb) {
      mb.f = Math.min(mb.f, ma.f);
      mb.l = Math.max(mb.l || 0, ma.l || 0);
    } else st.meta[b] = ma;
    delete st.meta[a];
    moved = true;
  }
  if (Array.isArray(st.noFace)) {
    const n = st.noFace.length;
    st.noFace = st.noFace.filter(x => x !== a);
    if (st.noFace.length !== n) moved = true;
  }
  return moved;
}
export function saveRoster(worldId, text) {
  setRoster(app.state, worldId, text);
  adoptRosterNames();
}
// canonName turns a person's other names into their roster name, so what the story kept under one of those (a face,
// notes, a bond) moves to the roster name, unless that already holds its own. After a list is saved, and when a rewrite
// or a branch brings back older story with the latest list (st: that state).
const HELD = ['cast', 'relations', 'bonds'];
export function adoptRosterNames(st = app.state) {
  const holds = n => HELD.some(m => (st[m] || {})[n] != null);
  for (const x of new Set(HELD.flatMap(m => Object.keys(st[m] || {})))) {
    const e = rosterFor(x, st);
    if (e && x !== e.name && holds(x) && !holds(e.name)) renamePerson(x, e.name, st);
  }
}
const REL_FRESH = 200;
function ledgerNames() {
  const t = Object.values(app.state.ledger || {}).join(' ');
  return Object.keys(app.state.relations || {}).filter(n => t.includes(n));
}
export function activeRel() {
  const t = app.state.next || 0,
    meta = app.state.meta || {},
    led = new Set(ledgerNames());
  return Object.entries(app.state.relations || {})
    .filter(([n]) => {
      const m = meta[n];
      return led.has(n) || !m || m.l == null || t - m.l <= REL_FRESH;
    })
    .slice(-12);
}
export function markSeen(name) {
  if (!name) return;
  const t = app.state.next;
  app.state.meta = app.state.meta || {};
  const m = app.state.meta[name] || (app.state.meta[name] = { f: t });
  m.l = t;
  if (m.f == null || t < m.f) m.f = t;
}
