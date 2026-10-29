/* ============ note library: the player's own notes, for every save ============ */
import { noteIgnored, nowIso, uid, utf8Bytes } from './util.js';
import { N_, T } from './i18n.js';
import { thaw, userCol, userDoc } from './db.js';
import { app, lastSaveCard } from './app.js';

// One document per note, P/notes/items/<id> = { name, text, updatedAt }, shared by every save of this player. A save
// keeps the ids it uses in state.noteIds; the narrator gets those notes whole (prompt.js buildPrompt).
export const NOTE_MAX = 32768; // UTF-8 bytes of one note's text
export const NOTE_NAME_MAX = 60;
export const NOTES_UNREAD = N_("Couldn't read your note library. Try again in a moment.");
const noteDoc = id => userDoc(`notes/items/${id}`);
const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
// a note in memory: the document, its id, and its text's size, counted once
const inMemory = (id, d) => ({ name: d.name, text: d.text, updatedAt: d.updatedAt, id, bytes: utf8Bytes(d.text) });

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
let missingRead = ''; // ticked ids the library was last read again for, so a deleted note costs one read
// whether the notes this state ticks can be read: the library is read again when it never was, or once for ticked ids
// it doesn't have (another device may have added them)
export async function notesReady(st = app.state) {
  const ids = (st && st.noteIds) || [];
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
  return (app.notes || []).filter(n => ids.has(n.id));
}
// a new game starts with the notes of the save played last; the card has them, the library is not needed
export const lastNoteIds = () => (lastSaveCard() || {}).noteIds || [];
// how many saves tick this note: the open one by its state, the others by their cards (persistence.js cardFields)
export function savesUsing(id) {
  const open = app.state && app.currentSave ? app.currentSave.id : null;
  return app.saves.filter(s => (s.id === open ? app.state.noteIds : s.noteIds || []).includes(id)).length;
}

async function writeNote({ id, name, text }) {
  const doc = { name: cleanNoteName(name), text: String(text), updatedAt: nowIso() };
  await noteDoc(id).set(doc);
  return inMemory(id, doc);
}
function putNotes(notes) {
  const ids = new Set(notes.map(n => n.id));
  app.notes = [...(app.notes || []).filter(n => !ids.has(n.id)), ...notes].sort(byName);
}
export async function saveNote({ id = uid(), name, text }) {
  const note = await writeNote({ id, name, text });
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
export async function deleteNote(id) {
  await noteDoc(id).delete();
  app.notes = (app.notes || []).filter(n => n.id !== id);
}

// A save file carries the notes its save ticks (saves-view.js)
export const notesForFile = st => pickedNotes(st).map(({ id, name, text }) => ({ id, name, text }));
// An imported save's notes, planned before any write: { ids it ticks, notes to add, names too big } (ARCHITECTURE.md)
export function planNotes(list, ids) {
  const given = new Map(
    (Array.isArray(list) ? list : [])
      .filter(n => n && n.id != null && typeof n.text === 'string')
      .map(n => [String(n.id), n]),
  );
  const plan = { ids: [], add: [], big: [] };
  const taken = new Set();
  for (const id of Array.isArray(ids) ? ids.map(String) : []) {
    if (noteById(id)) {
      plan.ids.push(id);
      continue;
    }
    const n = given.get(id);
    if (!n) continue; // gone here and not in the file
    const name = cleanNoteName(n.name) || T('Untitled');
    const same = (app.notes || []).find(x => x.name === name && x.text === n.text);
    if (same) plan.ids.push(same.id);
    else if (utf8Bytes(n.text) > NOTE_MAX) plan.big.push(name);
    else {
      const add = { id: uid(), name: freeNoteName(name, taken), text: n.text };
      taken.add(add.name);
      plan.add.push(add);
      plan.ids.push(add.id);
    }
  }
  plan.ids = [...new Set(plan.ids)];
  return plan;
}
