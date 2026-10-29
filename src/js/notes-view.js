/* ============ note library view: the Memory tab's list and the new game's picker ============ */
import { $, esc, fmt, kb, toast, uid, utf8Bytes } from './util.js';
import { N_, T, uiLang } from './i18n.js';
import { decodeText, legacyEncodings } from './zip.js';
import { app } from './app.js';
import { answerDialog, askConfirm, closeSheet, openDialog, openSheet } from './sheet.js';
import { persist } from './persistence.js';
import { notesShare } from './prompt.js';
import {
  cleanNoteName,
  deleteNote,
  freeNoteName,
  loadNotes,
  NOTE_MAX,
  NOTE_NAME_MAX,
  noteById,
  noteByName,
  saveNote,
  saveNotes,
  savesUsing,
} from './notes.js';

const HINT_GAME = N_(
  'Your own notes, kept for every save. Tick the ones this game uses: every turn Claude gets them whole, after the notes above. A note can be up to 32 KB.',
);
const HINT = N_(
  'Your own notes, kept for every save. A game uses the ones ticked on its new game screen, or here once it is open. A note can be up to 32 KB.',
);
const HINT_FORM = N_(
  'Your own notes, kept for every save. Tick the ones the new life uses on its screen, under the character profile. A note can be up to 32 KB.',
);
const unread = attr =>
  `<p class="muted field-note">${T("Couldn't read your note library.")} <button type="button" class="btn ghost inline-action" ${attr}>${T('Try again')}</button></p>`;
const formUp = () => !!$('#log .newlife');
// ticks here belong to an open save; while a new life's screen is up, its picker holds them
const tickable = () => !!(app.state && app.currentSave && !formUp());
// ticks to write: the boxes ticked, and ids this device hasn't loaded (another device may have added those notes)
const withUnseen = (ticked, ids) => [...ticked, ...ids.filter(id => !noteById(id))];
const retry = async () => {
  await loadNotes();
  libraryChanged();
};

// how much of the narrator prompt the ticked notes take, with a warning past a third
function showSize(root, ids) {
  const el = root.querySelector('[data-note-size]');
  if (!el) return;
  const { bytes, max, heavy } = notesShare(ids);
  el.classList.toggle('warn', heavy);
  el.textContent = !bytes
    ? ''
    : !max
      ? T('Ticked notes: {kb}', { kb: kb(bytes) })
      : T('Ticked notes: {kb} of the {max} prompt budget ({pct}%).', {
          kb: kb(bytes),
          max: kb(max),
          pct: Math.round((bytes / max) * 100),
        }) + (heavy ? ' ' + T('That is over a third, so fewer recent turns fit beside them.') : '');
}

/* ---- the Memory tab ---- */
export function renderNoteLibrary() {
  const root = $('#noteLib');
  if (!root) return;
  const st = tickable() ? app.state : null,
    lib = app.notes;
  const used = new Set(st ? st.noteIds : []);
  const rows = (lib || [])
    .map(
      n =>
        `<div class="note-row">${st ? `<label class="row opt grow"><input type="checkbox" data-lib-use="${esc(n.id)}"${used.has(n.id) ? ' checked' : ''}> <b>${esc(n.name)}</b></label>` : `<b class="grow">${esc(n.name)}</b>`}<span class="muted count-note">${kb(n.bytes)}</span><button class="btn ghost chip-sm" data-lib-edit="${esc(n.id)}">${T('Edit')}</button><button class="x" data-lib-del="${esc(n.id)}" aria-label="${T('Delete')}">✕</button></div>`,
    )
    .join('');
  root.innerHTML = `<h4>${T('Note library ({n})', { n: (lib || []).length })}</h4><p class="muted mem-hint">${T(st ? HINT_GAME : formUp() ? HINT_FORM : HINT)}</p>${
    lib
      ? `${rows || `<p class="muted empty">${T('No notes yet. Upload .md or .txt files, or write one here.')}</p>`}
    <div class="row note-tools"><label class="btn ghost file-btn">${T('Upload notes')}<input type="file" data-lib-upload multiple accept=".md,.txt,.markdown,text/markdown,text/plain" hidden></label><button class="btn ghost" data-lib-new>${T('New note')}</button></div>${st ? '<p class="muted field-note note-size" data-note-size></p>' : ''}`
      : unread('data-lib-retry')
  }`;
  if (!lib) {
    root.querySelector('[data-lib-retry]').onclick = retry;
    return;
  }
  const ticked = () => [...root.querySelectorAll('[data-lib-use]:checked')].map(c => c.dataset.libUse);
  if (st) showSize(root, st.noteIds);
  root.querySelectorAll('[data-lib-use]').forEach(
    c =>
      (c.onchange = async () => {
        if (!tickable()) return;
        app.state.noteIds = withUnseen(ticked(), app.state.noteIds);
        showSize(root, app.state.noteIds);
        await persist();
      }),
  );
  root
    .querySelectorAll('[data-lib-edit]')
    .forEach(b => (b.onclick = () => openNoteEditor(noteById(b.dataset.libEdit))));
  root.querySelectorAll('[data-lib-del]').forEach(b => (b.onclick = () => removeNote(b.dataset.libDel)));
  root.querySelector('[data-lib-new]').onclick = () => openNoteEditor(null);
  root.querySelector('[data-lib-upload]').onchange = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = ''; // the same files can be picked again
    try {
      if (files.length) await uploadNotes(files);
    } catch (err) {
      toast(T('Save failed: {err}', { err: err.code || err.message }));
    }
  };
}
// the library changed: the Memory tab and a new game's picker show it again
export function libraryChanged() {
  renderNoteLibrary();
  refreshNotePicker();
}

function openNoteEditor(note) {
  openSheet(
    `<h3 class="sheet-title">${note ? T('Edit note') : T('New note')}</h3>
   <div class="field"><label for="noteName">${T('Name')}</label><input id="noteName" maxlength="${NOTE_NAME_MAX}" value="${esc(note ? note.name : '')}"></div>
   <div class="field"><label for="noteText">${T('Text')}</label><textarea id="noteText" rows="14" class="note-text">${esc(note ? note.text : '')}</textarea><span class="muted count-note" id="noteBytes"></span></div>
   <div class="row actions"><button class="btn primary" id="noteSave">${T('Save note')}</button><button class="btn ghost" data-close>${T('Cancel')}</button></div>`,
    { wide: true },
  );
  const ta = $('#noteText');
  const count = () => {
    const b = utf8Bytes(ta.value);
    $('#noteBytes').textContent = T('{n} / {max} bytes', { n: fmt(b), max: fmt(NOTE_MAX) });
    $('#noteBytes').classList.toggle('over', b > NOTE_MAX);
  };
  ta.oninput = count;
  count();
  $('#noteSave').onclick = async () => {
    const name = cleanNoteName($('#noteName').value),
      text = ta.value;
    const other = noteByName(name),
      bytes = utf8Bytes(text);
    if (!name) toast(T('Enter a name'));
    else if (other && (!note || other.id !== note.id)) toast(T('Another note already has this name'));
    else if (bytes > NOTE_MAX) toast(T('A note can be up to 32 KB. This one is {kb}', { kb: kb(bytes) }));
    else
      try {
        await saveNote({ id: note ? note.id : undefined, name, text });
        closeSheet();
        toast(T('Note saved'));
        libraryChanged();
      } catch (e) {
        toast(T('Save failed: {err}', { err: e.code || e.message }));
      }
  };
}

// files picked at once, each read in the encoding it was written in
export async function uploadNotes(files) {
  const read = await Promise.allSettled(files.map(f => f.arrayBuffer()));
  const legacy = legacyEncodings(uiLang());
  const batch = [],
    big = [],
    unreadable = [],
    taken = new Set();
  files.forEach((f, i) => {
    const base = cleanNoteName(f.name.replace(/\.[^.]*$/, '')) || T('Untitled');
    if (read[i].status === 'rejected') return unreadable.push(base);
    const text = decodeText(new Uint8Array(read[i].value), legacy);
    if (utf8Bytes(text) > NOTE_MAX) return big.push(base);
    const name = taken.has(base) ? freeNoteName(base, taken) : base;
    taken.add(name);
    batch.push({ name, text });
  });
  const clash = batch.filter(n => noteByName(n.name)).map(n => n.name);
  const answer = clash.length ? await askSameName(clash) : 'add';
  const writes = [];
  let skipped = 0;
  for (const n of answer ? batch : []) {
    const old = noteByName(n.name);
    if (old && answer !== 'replace') skipped++;
    else writes.push({ id: old ? old.id : uid(), name: n.name, text: n.text, old: !!old });
  }
  const { saved, error } = await saveNotes(writes);
  libraryChanged();
  const done = new Set(saved.map(n => n.id));
  const replaced = writes.filter(w => w.old && done.has(w.id)).length;
  const added = saved.length - replaced;
  const said = [
    error && T('Save failed: {err}', { err: error.code || error.message }),
    added && T('{n} {n|note|notes} added.', { n: added }),
    replaced && T('{n} replaced.', { n: replaced }),
    skipped && T('{n} skipped, same name.', { n: skipped }),
    big.length && T('Over 32 KB, not added: {names}.', { names: big.join(', ') }),
    unreadable.length && T("Couldn't read: {names}.", { names: unreadable.join(', ') }),
  ].filter(Boolean);
  if (said.length) toast(said.join(' '), big.length || error || unreadable.length ? 6000 : 3000);
}
// 'replace', 'skip', or null for neither (nothing of the batch is added)
function askSameName(names) {
  const answer = openDialog(
    `<p class="dlg-msg pre">${esc(T('Your library already has notes with these names:\n{names}\nReplace them with the files, or skip those files?', { names: names.join('\n') }))}</p><div class="row"><button class="btn primary" id="libReplace">${T('Replace')}</button><button class="btn" id="libSkip">${T('Skip them')}</button><button class="btn ghost" id="libCancel">${T('Cancel')}</button></div>`,
  );
  $('#libReplace').onclick = () => answerDialog('replace');
  $('#libSkip').onclick = () => answerDialog('skip');
  $('#libCancel').onclick = () => answerDialog(null);
  return answer;
}

async function removeNote(id) {
  const note = noteById(id);
  if (!note) return;
  const n = savesUsing(id);
  const ok = await askConfirm(
    n
      ? T(
          "Delete '{name}' from your library? {n} {n|save uses|saves use} it and will stop sending it. This can't be undone.",
          { name: note.name, n },
        )
      : T("Delete '{name}' from your library? This can't be undone.", { name: note.name }),
    T('Delete'),
  );
  if (!ok) return;
  try {
    await deleteNote(id);
  } catch (e) {
    toast(T('Deleting the note failed: {err}', { err: e.code || e.message }));
    return;
  }
  libraryChanged();
  if (app.state && app.state.noteIds.includes(id)) {
    app.state.noteIds = app.state.noteIds.filter(x => x !== id);
    await persist();
  }
}

/* ---- the new game's picker ---- */
let pickerStart = []; // what the picker opened with, for a redraw once an unread library is read
export function notePickerHtml(ids) {
  pickerStart = ids;
  return `<div id="nlNotesBox">${pickerInner(ids)}</div>`;
}
function pickerInner(ids) {
  const lib = app.notes;
  if (!lib) return unread('data-nl-retry');
  if (!lib.length)
    return `<p class="muted field-note">${T('Notes you use in every game can be uploaded once to the note library in the Memory tab, then ticked here.')}</p>`;
  const on = new Set(ids);
  return `<div class="field" id="nlNotes"><label>${T('Notes from your library (sent to Claude every turn)')}</label><div class="nl-note-list">${lib
    .map(
      n =>
        `<label class="row opt"><input type="checkbox" id="nlNote-${esc(n.id)}" data-nl-note="${esc(n.id)}"${on.has(n.id) ? ' checked' : ''}> <span>${esc(n.name)} <span class="muted">${kb(n.bytes)}</span></span></label>`,
    )
    .join('')}</div><p class="muted field-note note-size" data-note-size></p></div>`;
}
export function bindNotePicker() {
  const box = $('#nlNotesBox');
  if (!box) return;
  const again = box.querySelector('[data-nl-retry]');
  if (again) again.onclick = retry;
  const sync = () => showSize(box, pickedInForm());
  box.querySelectorAll('[data-nl-note]').forEach(c => (c.onchange = sync));
  sync();
}
// what the form has ticked, or null when it shows no picker (an empty library, or one that could not be read)
export const pickedInForm = () =>
  $('#nlNotes')
    ? withUnseen(
        [...document.querySelectorAll('#nlNotes [data-nl-note]:checked')].map(c => c.dataset.nlNote),
        pickerStart,
      )
    : null;
function refreshNotePicker() {
  const box = $('#nlNotesBox');
  if (!box) return;
  box.innerHTML = pickerInner(pickedInForm() ?? pickerStart);
  bindNotePicker();
}
