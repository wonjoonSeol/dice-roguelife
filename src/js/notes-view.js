/* ============ note library view: the Memory tab's list and the new game's picker ============ */
import { $, esc, fmt, kb, toast, uid, utf8Bytes } from './util.js';
import { N_, T, uiLang } from './i18n.js';
import { decodeText, legacyEncodings } from './zip.js';
import { app } from './app.js';
import { answerDialog, askConfirm, askPrompt, closeSheet, openDialog, openSheet } from './sheet.js';
import { persist } from './persistence.js';
import { notesShare } from './prompt.js';
import { NOTE_TYPE, NOTE_TYPE_LABEL, NOTE_TYPES } from './enums.js';
import {
  cleanNoteName,
  deleteNote,
  freeNoteName,
  loadNotes,
  NOTE_MAX,
  NOTE_NAME_MAX,
  noteById,
  noteByName,
  noteType,
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
const typeLabel = t => T(NOTE_TYPE_LABEL[t]);
const typeTag = n => `<span class="note-type">${esc(typeLabel(n.type))}</span>`;
// A picker's notes: its own type first, the rest behind a toggle that starts open when one of them is picked
// (shown). row(note, other) draws one; the others carry their type
export function typedRows(notes, type, row, shown = () => false) {
  const own = notes.filter(n => n.type === type),
    rest = notes.filter(n => n.type !== type);
  return (
    own.map(n => row(n, false)).join('') +
    (rest.length
      ? `<details class="other-notes"${rest.some(shown) ? ' open' : ''}><summary>${T('Show other notes too ({n})', { n: rest.length })}</summary>${rest.map(n => row(n, true)).join('')}</details>`
      : '')
  );
}
export const otherTag = (n, other) => (other ? typeTag(n) : '');

// how much of the narrator prompt the ticked notes take, with a warning past a third. story: the ids start with a
// scenario note
function showSize(root, ids, story = false) {
  const el = root.querySelector('[data-note-size]');
  if (!el) return;
  const { bytes, max, heavy } = notesShare(ids);
  el.classList.toggle('warn', heavy);
  const vars = { kb: kb(bytes), max: kb(max), pct: Math.round((bytes / max) * 100) };
  el.textContent = !bytes
    ? ''
    : !max
      ? story
        ? T('Scenario and ticked notes: {kb}', vars)
        : T('Ticked notes: {kb}', vars)
      : (story
          ? T('Scenario and ticked notes: {kb} of the {max} prompt budget ({pct}%).', vars)
          : T('Ticked notes: {kb} of the {max} prompt budget ({pct}%).', vars)) +
        (heavy ? ' ' + T('That is over a third, so fewer recent turns fit beside them.') : '');
}

/* ---- the Memory tab ---- */
let libFilter = 'all'; // the library's type filter: all, or one NOTE_TYPE
export function renderNoteLibrary() {
  const root = $('#noteLib');
  if (!root) return;
  const st = tickable() ? app.state : null,
    lib = app.notes;
  const used = new Set(st ? st.noteIds : []);
  // the box ticks; the name opens the note, like Edit
  const row = n =>
    `<div class="note-row">${st && n.id === st.scenarioId ? `<span class="muted count-note">${T("This game's scenario")}</span>` : st ? `<input type="checkbox" data-lib-use="${esc(n.id)}" aria-label="${esc(T('Use {name} in this game', { name: n.name }))}"${used.has(n.id) ? ' checked' : ''}>` : ''}<button type="button" class="note-name grow" data-lib-open="${esc(n.id)}">${esc(n.name)}</button>${typeTag(n)}<span class="muted count-note">${kb(n.bytes)}</span><button class="btn ghost chip-sm" data-lib-edit="${esc(n.id)}">${T('Edit')}</button><button class="x" data-lib-del="${esc(n.id)}" aria-label="${T('Delete')}">✕</button></div>`;
  const shown = (lib || []).filter(n => libFilter === 'all' || n.type === libFilter);
  // grouped by type, in NOTE_TYPES order
  const rows = NOTE_TYPES.map(t => [t, shown.filter(n => n.type === t)])
    .filter(([, l]) => l.length)
    .map(([t, l]) => `<h5 class="note-group">${esc(typeLabel(t))} (${l.length})</h5>${l.map(row).join('')}`)
    .join('');
  const filter = (lib || []).length
    ? `<div class="seg note-filter" role="group" aria-label="${T('Note type')}">${['all', ...NOTE_TYPES].map(t => `<button type="button" class="chip-sm" data-lib-filter="${t}" aria-pressed="${t === libFilter}">${t === 'all' ? T('All') : esc(typeLabel(t))}</button>`).join('')}</div>`
    : '';
  const preset = libFilter === 'all' ? NOTE_TYPE.GENERAL : libFilter; // a new note takes the type in view
  root.innerHTML = `<h4>${T('Note library ({n})', { n: (lib || []).length })}</h4><p class="muted mem-hint">${T(st ? HINT_GAME : formUp() ? HINT_FORM : HINT)}</p>${
    lib
      ? `${filter}${rows || `<p class="muted empty">${T('No notes yet. Upload .md or .txt files, or write one here.')}</p>`}
    <div class="row note-tools"><label class="btn ghost file-btn">${T('Upload notes')}<input type="file" data-lib-upload multiple accept=".md,.txt,.markdown,text/markdown,text/plain" hidden></label><button class="btn ghost" data-lib-new>${T('New note')}</button></div>${st ? '<p class="muted field-note note-size" data-note-size></p>' : ''}`
      : unread('data-lib-retry')
  }`;
  if (!lib) {
    root.querySelector('[data-lib-retry]').onclick = retry;
    return;
  }
  root.querySelectorAll('[data-lib-filter]').forEach(
    b =>
      (b.onclick = () => {
        libFilter = b.dataset.libFilter;
        renderNoteLibrary();
      }),
  );
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
    .querySelectorAll('[data-lib-edit],[data-lib-open]')
    .forEach(b => (b.onclick = () => openNoteEditor(noteById(b.dataset.libEdit || b.dataset.libOpen))));
  root.querySelectorAll('[data-lib-del]').forEach(b => (b.onclick = () => removeNote(b.dataset.libDel)));
  root.querySelector('[data-lib-new]').onclick = () => openNoteEditor(null, null, preset);
  root.querySelector('[data-lib-upload]').onchange = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = ''; // the same files can be picked again
    try {
      if (files.length) await uploadNotes(files, libFilter === 'all' ? '' : libFilter);
    } catch (err) {
      toast(T('Save failed: {err}', { err: err.code || err.message }));
    }
  };
}
// the library changed: the Memory tab and a new game's pickers show it again
export function libraryChanged() {
  renderNoteLibrary();
  refreshNotePicker();
  refreshOnePickers();
}

// the type choices, the current one selected
const typeOptions = cur =>
  NOTE_TYPES.map(t => `<option value="${t}"${t === cur ? ' selected' : ''}>${esc(typeLabel(t))}</option>`).join('');
// onSaved: what to do with the note once it is saved (a picker picks a new one); preset: a new note's type
function openNoteEditor(note, onSaved, preset) {
  openSheet(
    `<h3 class="sheet-title">${note ? T('Edit note') : T('New note')}</h3>
   <div class="row note-head"><div class="field grow"><label for="noteName">${T('Name')}</label><input id="noteName" maxlength="${NOTE_NAME_MAX}" value="${esc(note ? note.name : '')}"></div><div class="field"><label for="noteType">${T('Note type')}</label><select id="noteType">${typeOptions(note ? note.type : noteType(preset))}</select></div></div>
   <div class="field"><label for="noteText">${T('Text')}</label><textarea id="noteText" rows="14" class="note-text">${esc(note ? note.text : '')}</textarea><span class="muted count-note" id="noteBytes"></span></div>
   <div class="row actions"><button class="btn primary" id="noteSave">${T('Save note')}</button><button class="btn ghost" data-close>${T('Cancel')}</button></div>`,
    { wide: true, modal: true },
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
        const saved = await saveNote({ id: note ? note.id : undefined, name, text, type: $('#noteType').value });
        closeSheet();
        toast(T('Note saved'));
        libraryChanged();
        if (onSaved) onSaved(saved);
      } catch (e) {
        toast(T('Save failed: {err}', { err: e.code || e.message }));
      }
  };
}

// What several files at once are for, asked once (preset, else general, is the main button). A single file takes
// preset, else general, and the editor changes it. null: cancelled
function askType(n, preset) {
  const def = noteType(preset);
  const answer = openDialog(
    `<p class="dlg-msg">${esc(T('What are these {n} notes for?', { n }))}</p><div class="row">${NOTE_TYPES.map(t => `<button class="btn${t === def ? ' primary' : ''}" data-ask-type="${t}">${esc(typeLabel(t))}</button>`).join('')}<button class="btn ghost" data-ask-type="">${T('Cancel')}</button></div>`,
  );
  document
    .querySelectorAll('[data-ask-type]')
    .forEach(b => (b.onclick = () => answerDialog(b.dataset.askType || null)));
  return answer;
}
// files picked at once, each read in the encoding it was written in; preset: the type of the picker they came from
export async function uploadNotes(files, preset) {
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
  const asked = batch.length > 1 ? await askType(batch.length, preset) : null;
  if (batch.length > 1 && !asked) return;
  const clash = batch.filter(n => noteByName(n.name)).map(n => n.name);
  const answer = clash.length ? await askSameName(clash) : 'add';
  const writes = [];
  let skipped = 0;
  for (const n of answer ? batch : []) {
    const old = noteByName(n.name);
    // a replaced note keeps its type unless the batch was asked for one
    const type = asked || (old ? undefined : noteType(preset));
    if (old && answer !== 'replace') skipped++;
    else writes.push({ id: old ? old.id : uid(), name: n.name, text: n.text, type, old: !!old });
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
// The new game's setting box kept as a library note and ticked in the picker. True when it was, so the box can be
// emptied and the text isn't sent twice (as the save's notes too)
export async function saveBoxAsNote(text) {
  const bytes = utf8Bytes(text);
  if (bytes > NOTE_MAX) {
    toast(T('A note can be up to 32 KB. This one is {kb}', { kb: kb(bytes) }));
    return false;
  }
  const name = cleanNoteName(await askPrompt(T('Name of the note'), T('World setting')));
  if (!name) return false;
  const old = noteByName(name);
  if (old && (await askSameName([name])) !== 'replace') return false;
  let note;
  try {
    note = await saveNote({ id: old ? old.id : undefined, name, text });
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
    return false;
  }
  libraryChanged();
  const box = $(`#nlNote-${note.id}`);
  if (box && !box.checked) {
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  }
  toast(T('Saved as a note, ticked for this game'));
  return true;
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
  const row = (n, other) =>
    `<div class="row opt"><input type="checkbox" id="nlNote-${esc(n.id)}" data-nl-note="${esc(n.id)}" aria-label="${esc(T('Use {name} in this game', { name: n.name }))}"${on.has(n.id) ? ' checked' : ''}><button type="button" class="note-name" data-nl-open="${esc(n.id)}">${esc(n.name)}</button>${otherTag(n, other)}<span class="muted">${kb(n.bytes)}</span><button type="button" class="btn ghost chip-sm" data-nl-edit="${esc(n.id)}">${T('Edit')}</button></div>`;
  return `<div class="field" id="nlNotes"><label>${T('Notes from your library (sent to Claude every turn)')}</label><div class="nl-note-list">${typedRows(lib, NOTE_TYPE.GENERAL, row, n => on.has(n.id))}</div><p class="muted field-note note-size" data-note-size></p></div>`;
}
export function bindNotePicker() {
  const box = $('#nlNotesBox');
  if (!box) return;
  const again = box.querySelector('[data-nl-retry]');
  if (again) again.onclick = retry;
  const sync = () => {
    showSize(box, pickedInForm());
    scenarioSize();
  };
  box.querySelectorAll('[data-nl-note]').forEach(c => (c.onchange = sync));
  box
    .querySelectorAll('[data-nl-open],[data-nl-edit]')
    .forEach(b => (b.onclick = () => openNoteEditor(noteById(b.dataset.nlOpen || b.dataset.nlEdit))));
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

/* ---- one-note pickers: a scenario game's scenario (sc), and a prose style from a note on the new game screen
   (sty) and in the Memory tab (msty) ---- */
const STYLE_HINT = N_(
  'The note says how the narrator writes: voice, tone, sentence length, words to use or avoid. It goes to Claude whole every turn.',
);
const ONE = {
  sc: {
    label: N_('Play {name}'),
    hint: N_(
      "The scenario is a note: its world, rules, characters, style and first message. It goes to Claude whole every turn, and wins over the game's own conventions.",
    ),
    type: NOTE_TYPE.SCENARIO,
    size: true,
  },
  sty: { label: N_('Write in the style of {name}'), hint: STYLE_HINT, type: NOTE_TYPE.STYLE },
  msty: { label: N_('Write in the style of {name}'), hint: STYLE_HINT, type: NOTE_TYPE.STYLE },
};
const oneStart = {}; // the note each picker opened with
const oneChange = {}; // what a pick does at once (the Memory tab saves it)
export function onePickerHtml(key, id) {
  oneStart[key] = id;
  return `<div id="${key}NoteBox">${oneInner(key, id)}</div>`;
}
function oneInner(key, id) {
  const lib = app.notes,
    c = ONE[key];
  if (!lib) return unread('data-one-retry');
  const row = (n, other) =>
    `<div class="row opt"><input type="radio" name="${key}Note" id="${key}Note-${esc(n.id)}" data-one-note="${esc(n.id)}" aria-label="${esc(T(c.label, { name: n.name }))}"${n.id === id ? ' checked' : ''}><button type="button" class="note-name" data-one-open="${esc(n.id)}">${esc(n.name)}</button>${otherTag(n, other)}<span class="muted">${kb(n.bytes)}</span><button type="button" class="btn ghost chip-sm" data-one-open="${esc(n.id)}">${T('Edit')}</button></div>`;
  const rows = typedRows(lib, c.type, row, n => n.id === id);
  return `${rows ? `<div class="nl-note-list">${rows}</div>` : ''}<p class="muted field-note">${T(c.hint)}</p>
   <div class="row note-tools"><button type="button" class="btn ghost" data-one-new>${T('New note')}</button><label class="btn ghost file-btn">${T('Upload notes')}<input type="file" data-one-upload multiple accept=".md,.txt,.markdown,text/markdown,text/plain" hidden></label></div>${c.size ? '<p class="muted field-note note-size" data-note-size></p>' : ''}`;
}
// the note a picker has picked, or null
export const oneInForm = key => {
  const r = $(`#${key}NoteBox [data-one-note]:checked`);
  return r ? r.dataset.oneNote : null;
};
export const scenarioPickerHtml = id => onePickerHtml('sc', id);
export const scenarioInForm = () => oneInForm('sc');
function onePicked(key) {
  if (key === 'sc') scenarioSize();
  if (oneChange[key]) oneChange[key](oneInForm(key));
}
// the scenario counts with the ticked notes: both go to the narrator whole
const scenarioSize = () => {
  const box = $('#scNoteBox'),
    id = scenarioInForm();
  if (box) showSize(box, id ? [id, ...(pickedInForm() || []).filter(x => x !== id)] : [], true);
};
// onChange(id): what a pick does at once
export function bindOnePicker(key, onChange) {
  const box = $(`#${key}NoteBox`);
  if (!box) return;
  if (onChange) oneChange[key] = onChange;
  const again = box.querySelector('[data-one-retry]');
  if (again) {
    again.onclick = retry; // an unread library shows only this
    return;
  }
  box.querySelectorAll('[data-one-note]').forEach(r => (r.onchange = () => onePicked(key)));
  box.querySelectorAll('[data-one-open]').forEach(b => (b.onclick = () => openNoteEditor(noteById(b.dataset.oneOpen))));
  box.querySelector('[data-one-new]').onclick = () =>
    openNoteEditor(
      null,
      n => {
        const r = $(`#${key}Note-${n.id}`);
        if (!r) return;
        r.checked = true;
        onePicked(key);
      },
      ONE[key].type,
    );
  box.querySelector('[data-one-upload]').onchange = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = ''; // the same files can be picked again
    try {
      if (files.length) await uploadNotes(files, ONE[key].type);
    } catch (err) {
      toast(T('Save failed: {err}', { err: err.code || err.message }));
    }
  };
  if (key === 'sc') scenarioSize();
}
export const bindScenarioPicker = () => bindOnePicker('sc');
function refreshOnePickers() {
  for (const key of Object.keys(ONE)) {
    const box = $(`#${key}NoteBox`);
    if (!box) continue;
    box.innerHTML = oneInner(key, oneInForm(key) ?? oneStart[key]);
    bindOnePicker(key);
  }
}
