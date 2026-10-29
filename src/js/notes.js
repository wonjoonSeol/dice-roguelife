/* ============ note library: the player's own notes, for every save ============ */
import { noteIgnored, nowIso, uid, utf8Bytes } from './util.js';
import { N_, T } from './i18n.js';
import { dget, thaw, userCol, userDoc } from './db.js';
import { app } from './app.js';
import { NOTE_TYPE, NOTE_TYPES, STYLE } from './enums.js';

// One document per note, P/notes/items/<id> = { name, text, updatedAt, type, cast? }, shared by every save of this
// player. A save keeps the ids it uses in state.noteIds; the narrator gets those notes whole (prompt.js buildPrompt).
// type is the note's job (enums.js NOTE_TYPE), only for the pickers. cast is what Import characters made of the text
// (roster-view.js): never sent, never counted in the note's size.
export const NOTE_MAX = 32768; // UTF-8 bytes of one note's text
export const NOTE_NAME_MAX = 60;
export const NOTES_UNREAD = N_("Couldn't read your note library. Try again in a moment.");
const notePath = id => `notes/items/${id}`;
const noteDoc = id => userDoc(notePath(id));
const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
// a known type, else general (notes from before types had none)
export const noteType = t => (NOTE_TYPES.includes(t) ? t : NOTE_TYPE.GENERAL);
// a note in memory: the document, its id, and its text's size, counted once
const inMemory = (id, d) => ({
  name: d.name,
  text: d.text,
  updatedAt: d.updatedAt,
  type: noteType(d.type),
  cast: d.cast && typeof d.cast === 'object' ? d.cast : undefined,
  id,
  bytes: utf8Bytes(d.text),
});

// app.notes: the library, or null when it has never been read; a failed read keeps what was read before
export async function loadNotes() {
  try {
    const q = await userCol('notes/items').limit(1000).get();
    app.notes = q.docs
      .map(d => [d.id, thaw(d.data())])
      .filter(([, d]) => d && typeof d.name === 'string' && typeof d.text === 'string')
      .map(([id, d]) => inMemory(id, d))
      .sort(byName);
  } catch (e) {
    noteIgnored('notes: load the library', e);
  }
  return app.notes;
}
export const STYLE_GONE = N_(
  "This game's prose style note isn't in your note library, so nothing was sent. Pick another note or style in the Memory tab, then try again.",
);
let missingRead = ''; // ticked ids the library was last read again for, so a deleted note costs one read
// the notes a state sends in places of their own: a scenario save's scenario, and a prose style from a note
const ownIds = st => (st ? [st.scenarioId, st.style === STYLE.NOTE && st.styleNoteId].filter(Boolean) : []);
// the ids of the notes a state sends: the ticked ones and its own
const usedIds = st => [...((st && st.noteIds) || []), ...ownIds(st)];
// whether the notes this state ticks can be read: the library is read again when it never was, or once for ticked ids
// it doesn't have (another device may have added them)
export async function notesReady(st = app.state) {
  const ids = usedIds(st);
  const missing = ids.filter(id => !noteById(id)).join();
  if (!ids.length || (app.notes && (!missing || missing === missingRead))) return true;
  if (app.notes) missingRead = missing;
  return !!(await loadNotes());
}
export const noteById = id => (app.notes || []).find(n => n.id === id);
export const noteByName = name => (app.notes || []).find(n => n.name === name);
export const cleanNoteName = name =>
  String(name || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_NAME_MAX);
// the name, or "name (2)", "name (3)"... when a note in the library or in taken has it
export function freeNoteName(name, taken = new Set()) {
  const used = x => !!noteByName(x) || taken.has(x);
  if (!used(name)) return name;
  for (let k = 2; ; k++) {
    const tail = ` (${k})`;
    const next = name.slice(0, NOTE_NAME_MAX - tail.length) + tail;
    if (!used(next)) return next;
  }
}
// the notes a state uses, in the library's order; a deleted one is just left out
export function pickedNotes(st = app.state) {
  const ids = new Set((st && st.noteIds) || []);
  for (const id of ownIds(st)) ids.delete(id); // sent once, in its own place
  return (app.notes || []).filter(n => ids.has(n.id));
}
// the library note a scenario save plays, or null (none, or deleted)
export const scenarioNote = (st = app.state) => (st && st.scenarioId && noteById(st.scenarioId)) || null;
// the library note a save's prose style is, or null (another style, or deleted)
export const styleNote = (st = app.state) =>
  (st && st.style === STYLE.NOTE && st.styleNoteId && noteById(st.styleNoteId)) || null;
// its name for the strip and the save card: the note's own, else the one it had when last seen
export const scenarioName = (st = app.state) =>
  (scenarioNote(st) || {}).name || (st && st.scenarioName) || T('Scenario');
// how many saves tick this note: the open one by its state, the others by their cards (persistence.js cardFields)
export function savesUsing(id) {
  const open = app.state && app.currentSave ? app.currentSave.id : null;
  return app.saves.filter(s => usedIds(s.id === open ? app.state : s).includes(id)).length;
}

// type: given, else the note's own, else general
async function writeNote({ id, name, text, type }) {
  const old = noteById(id);
  const doc = {
    name: cleanNoteName(name),
    text: String(text),
    updatedAt: nowIso(),
    type: noteType(type || (old && old.type)),
  };
  if (old && old.cast && old.text === doc.text) doc.cast = old.cast; // a rename or a new type keeps it
  await noteDoc(id).set(doc);
  return inMemory(id, doc);
}
function putNotes(notes) {
  const ids = new Set(notes.map(n => n.id));
  app.notes = [...(app.notes || []).filter(n => !ids.has(n.id)), ...notes].sort(byName);
}
export async function saveNote({ id = uid(), name, text, type }) {
  const note = await writeNote({ id, name, text, type });
  putNotes([note]);
  return note;
}
// several notes written side by side: the ones written join the library; error is the first failure
export async function saveNotes(list) {
  const done = await Promise.allSettled(list.map(writeNote));
  const saved = done.filter(r => r.status === 'fulfilled').map(r => r.value);
  putNotes(saved);
  const failed = done.find(r => r.status === 'rejected');
  return { saved, error: failed ? failed.reason : null };
}
// Import characters' result kept on the note. The document is read first, so another device's newer text is not
// written over; the note's text and updatedAt stay as they are
export async function saveNoteCast(id, cast) {
  const n = noteById(id);
  const d = await dget(notePath(id));
  if (!n || !d || d.text !== n.text) return;
  await noteDoc(id).set({ ...d, cast });
  n.cast = cast;
}
export async function deleteNote(id) {
  await noteDoc(id).delete();
  app.notes = (app.notes || []).filter(n => n.id !== id);
}

// A save file carries the notes its save ticks, its scenario and its style note (saves-view.js)
export const notesForFile = st =>
  [...new Set([scenarioNote(st), styleNote(st), ...pickedNotes(st)].filter(Boolean))].map(
    ({ id, name, text, type }) => ({ id, name, text, type }),
  );
// An imported save's notes, planned before any write: { notes to add, names too big, map: file id to the id it gets
// here } (ARCHITECTURE.md)
export function planNotes(list, ids) {
  const given = new Map(
    (Array.isArray(list) ? list : [])
      .filter(n => n && n.id != null && typeof n.text === 'string')
      .map(n => [String(n.id), n]),
  );
  const plan = { add: [], big: [], map: {} };
  const taken = new Set();
  const use = (from, id) => (plan.map[from] = id);
  for (const id of Array.isArray(ids) ? ids.map(String) : []) {
    if (plan.map[id]) continue; // a scenario note also ticked comes once
    if (noteById(id)) {
      use(id, id);
      continue;
    }
    const n = given.get(id);
    if (!n) continue; // gone here and not in the file
    const name = cleanNoteName(n.name) || T('Untitled');
    const same = (app.notes || []).find(x => x.name === name && x.text === n.text);
    if (same) use(id, same.id);
    else if (utf8Bytes(n.text) > NOTE_MAX) plan.big.push(name);
    else {
      const add = { id: uid(), name: freeNoteName(name, taken), text: n.text, type: noteType(n.type) };
      taken.add(add.name);
      plan.add.push(add);
      use(id, add.id);
    }
  }
  return plan;
}
