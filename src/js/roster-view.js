/* ============ the character list editor: the fate screen and the memory tab ============ */
import { $, esc, kb, normName, noteIgnored, sha256Hex, toast } from './util.js';
import { N_, T } from './i18n.js';
import { LIMITS } from './limits.js';
import { isHeading, namesOf, parseRoster } from './roster.js';
import { charSets } from './images.js';
import { cardIndex, namedSetOf } from './casting.js';
import { platform } from './db.js';
import { app } from './app.js';
import { storyLang } from './settings.js';
import { logErr } from './diag.js';
import { fillTemplate, prIn, sampleJson } from './prompt.js';
import { closeSheet, openSheet } from './sheet.js';
import { noteById, saveNoteCast } from './notes.js';
import { otherTag } from './notes-view.js';
import { NOTE_TYPE } from './enums.js';
import { ensureSample } from './boot.js';
import { sampleError } from './turn.js';

// a paste box, a file to read in, and what the list holds
const ROSTER_HELP = N_(
  'Every detail is key: value. Name: starts a person, and the lines under it are theirs until a blank line; or put a person on one line split by /. A # heading is the affiliation of the people under it. Keys: Name, Epithet, Aliases, Affiliation, Gender, Position, Power, Looks, Personality, Speech, Signature, Ties, Secret. Any other key is kept too.',
);
export const ROSTER_EXAMPLE = N_(
  "# Mount Hua Sect\nName: Baek Ri-un\nEpithet: Plum Sword\nAliases: Ri-un\nPosition: first disciple\nPower: first-rate\nPersonality: quiet, stubborn\nSpeech: curt\nSecret: the sect leader's hidden son\n\nName: Seol-hwa / Position: third disciple / Speech: 'Hmph.'",
);
const ROSTER_NOTE = {
  unlabeled: N_('Line {line} skipped, a part has no key (key: value): {text}'),
  noName: N_('Line {line} skipped, no person above it (a person starts with Name:): {text}'),
  twoNames: N_('Line {line} skipped, two names on one line: {text}'),
  longName: N_('Line {line} skipped, a name is at most {n} characters: {text}'),
  me: N_('Line {line} skipped, {name} is your character'),
  again: N_('Line {line}: {name} was listed before, this one is kept'),
  other: N_('Line {line}: {label} is not a known key, kept as a detail of {name}'),
  over: N_('Only the first {n} people are kept'),
  cut: N_('Some details of {name} were cut to fit'),
  aliasMe: N_('Line {line}: {alias} is your character, so it is not another name of {name}'),
  nameCut: N_('Line {line}: {text} has no key and is not part of the name, so it is skipped'),
  aliasTaken: N_('Line {line}: {alias} already names someone else in the list, so it is not another name of {name}'),
};
export function rosterEditorHtml(text) {
  return `<p class="muted field-note">${T(ROSTER_HELP)}</p>
   <textarea data-roster rows="7" maxlength="${LIMITS.roster.text}" aria-label="${T('Character list')}" placeholder="${esc(T(ROSTER_EXAMPLE))}" class="roster-text">${esc(text)}</textarea>
   <div class="row roster-row"><label class="btn ghost file-btn">${T('Open a file')}<input type="file" data-roster-file accept=".md,.txt,text/markdown,text/plain" hidden></label><button type="button" class="btn ghost" data-roster-import>${T('Import characters')}</button><span class="muted count-note" data-roster-count></span></div>
   <div class="roster-preview" data-roster-preview></div>`;
}
// me: the player's name, which the list never holds; onInput gets the text after every change. The preview waits for
// a pause in typing; the count does not. imp, for Import characters: own, this screen's box as a source
// ({ label, text(), put(rest) }); lang, the story language; busy(), why the list can't change now; commit(), what
// keeps the list once the import changed it
export function bindRosterEditor(root, worldId, me, onInput, imp = {}) {
  const ta = root.querySelector('[data-roster]');
  let wait = 0;
  const preview = () => {
    clearTimeout(wait);
    root.querySelector('[data-roster-preview]').innerHTML = rosterPreviewHtml(ta.value, worldId, me);
  };
  const show = now => {
    root.querySelector('[data-roster-count]').textContent = `${ta.value.length}/${LIMITS.roster.text}`;
    if (onInput) onInput(ta.value);
    if (now) preview();
    else {
      clearTimeout(wait);
      wait = setTimeout(preview, 150);
    }
  };
  ta.oninput = () => show(false);
  root.querySelector('[data-roster-file]').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    ta.value = (await f.text()).slice(0, LIMITS.roster.text);
    e.target.value = ''; // the same file can be read again
    show(true);
  };
  root.querySelector('[data-roster-import]').onclick = () =>
    openImport({
      ...imp,
      worldId,
      me,
      list: () => ta.value,
      add: text => {
        ta.value = text;
        show(true);
      },
    });
  show(true);
}
// parsed: the text already read, when the caller needs it too
function rosterPreviewHtml(text, worldId, me, parsed) {
  if (!text.trim()) return '';
  const { people, notes } = parsed || parseRoster(text, me);
  const ix = cardIndex(charSets(), worldId); // the cards of the world this list is for
  const faces = people.map(e => !!namedSetOf(namesOf(e), { ix, exact: true }));
  const chips = people
    .map(
      (e, i) =>
        `<span class="roster-chip${faces[i] ? ' has-face' : ''}">${faces[i] ? '🖼 ' : ''}${esc(e.name)}${e.faction ? ` <span class="muted">${esc(e.faction)}</span>` : ''}</span>`,
    )
    .join('');
  return `<p class="roster-sum">${T('{n} {n|person|people} read, {m} with a face', { n: people.length, m: faces.filter(Boolean).length })}</p>${chips ? `<div class="roster-people">${chips}</div>` : ''}${notes.length ? `<ul class="roster-notes">${notes.map(x => `<li>${esc(T(ROSTER_NOTE[x.why], x))}</li>`).join('')}</ul>` : ''}`;
}

/* ---- Import characters: one model call turns sheets in any format into the list ---- */
const IMPORT_HELP = N_(
  'Claude reads character sheets in any format and writes everyone in them as this list. Nothing is sent until you press Read characters.',
);
// ctx: what bindRosterEditor describes as imp, plus worldId and me, list() (the list now) and add(text) (the list after)
export function openImport(ctx) {
  const own = ctx.own && ctx.own.text().trim() ? ctx.own : null;
  const notes = (app.notes || []).filter(n => n.text.trim());
  // character sheet notes first, then the others with their type
  const cast = n => n.type === NOTE_TYPE.CAST;
  const pick = notes.find(cast) || notes[0];
  const first = own ? 'own' : pick ? 'note:' + pick.id : 'paste';
  const opt = (value, label, on) =>
    `<label class="row opt"><input type="radio" name="impSrc" value="${esc(value)}"${on ? ' checked' : ''}> <span>${label}</span></label>`;
  const noteOpt = (n, other) =>
    opt(
      'note:' + n.id,
      `${esc(T('Note: {name}', { name: n.name }))} ${otherTag(n, other)} <span class="muted">${kb(n.bytes)}</span>`,
      first === 'note:' + n.id,
    );
  openSheet(
    `<h3 class="sheet-title">${T('Import characters')}</h3><p class="muted sheet-lead">${T(IMPORT_HELP)}</p>
   <div class="field"><label>${T('Read from')}</label><div class="imp-src">${own ? opt('own', esc(own.label), true) : ''}${[...notes.filter(cast), ...notes.filter(n => !cast(n))].map(n => noteOpt(n, !cast(n))).join('')}${opt('paste', T('Text pasted here'), first === 'paste')}</div>
   <textarea id="impPaste" rows="6" class="roster-text" aria-label="${T('Text pasted here')}" placeholder="${esc(T('Paste character sheets in any format'))}"></textarea></div>
   <div class="row actions"><button class="btn primary" id="impRead">${T('Read characters')}</button><button class="btn ghost" id="impCancel">${T('Cancel')}</button></div>`,
    { wide: true, modal: true },
  );
  const ac = new AbortController();
  $('#impPaste').oninput = () => ($('[name="impSrc"][value="paste"]').checked = true);
  $('#impCancel').onclick = () => {
    ac.abort(); // a reply that comes later changes nothing
    closeSheet();
  };
  const btn = $('#impRead');
  btn.onclick = async () => {
    const src = sourceOf(($('[name="impSrc"]:checked') || {}).value, own, ctx);
    if (!src || !src.text.trim()) return toast(T('Nothing to read'));
    const kept = await keptCast(src.note, langOf(ctx));
    if (ac.signal.aborted || !btn.isConnected) return;
    if (kept) reviewImport(ctx, src, kept, ac);
    else await readFresh(ctx, src, btn, ac);
  };
}
const langOf = ctx => ctx.lang || storyLang();
const textHash = text => sha256Hex(new Blob([text]));
// a library note's last result, while its text and the story language are the same: no model call
async function keptCast(note, lang) {
  const c = note && note.cast;
  if (!c || c.lang !== lang || typeof c.roster !== 'string' || c.hash !== (await textHash(note.text).catch(() => '')))
    return null;
  return { roster: c.roster, rest: String(c.rest || ''), kept: true };
}
// the model call (btn shows it is waiting), then the review; a library note keeps the result for next time
async function readFresh(ctx, src, btn, ac) {
  if (!platform.sample && !(await ensureSample())) return toast(T('Claude needs to be connected'));
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = T('Reading the characters...');
  let got;
  try {
    got = await readCharacters(src.text, ctx, ac.signal);
  } catch (e) {
    if (ac.signal.aborted) return;
    btn.disabled = false;
    btn.textContent = label;
    sampleError(e);
    return;
  }
  if (ac.signal.aborted || !btn.isConnected) return;
  if (src.note) {
    const { note } = src;
    textHash(note.text)
      .then(hash => saveNoteCast(note.id, { hash, lang: langOf(ctx), roster: got.roster, rest: got.rest }))
      .catch(e => noteIgnored('roster import: keep the result on the note', e));
  }
  reviewImport(ctx, src, got, ac);
}
// the text to read and, when the leftover can go back, where. A library note is never changed, as other games use it:
// this game stops using it and keeps its leftover in this screen's own box
function sourceOf(pick, own, ctx) {
  if (pick === 'own' && own) return { text: own.text(), put: own.put };
  if (pick === 'paste') return { text: $('#impPaste').value };
  const note = pick && pick.startsWith('note:') && noteById(pick.slice(5));
  if (!note) return null;
  const into = ctx.own;
  if (!into) return { text: note.text, note };
  const after = rest => [into.text().trim(), rest].filter(Boolean).join('\n\n');
  return {
    text: note.text,
    note,
    into,
    after,
    put: rest => {
      if (ctx.untick) ctx.untick(note.id);
      into.put(after(rest));
    },
  };
}
// the one model call, on the quick tier like the summaries (it answers with the list and the leftover text)
async function readCharacters(text, ctx, signal) {
  const lang = langOf(ctx);
  const prompt = fillTemplate(prIn(lang, 'rosterImport'), {
    labels: (prIn(lang, 'rosterImportLabels') || {})[lang] || '',
    me: ctx.me || '{user}',
    text,
  });
  let r = null;
  try {
    r = await sampleJson(prompt, { modelTier: 'quick', cache: false, signal });
  } catch (e) {
    if (!signal.aborted) logErr('roster import', e);
    throw e;
  }
  const str = v => (Array.isArray(v) ? v.join('\n') : typeof v === 'string' ? v : '');
  if (!r || typeof r !== 'object' || !('roster' in r)) {
    logErr('roster import', { code: 'no_json', message: 'reply without roster', text: JSON.stringify(r) });
    throw Object.assign(new Error(T("Couldn't read the reply (see ⚙ → Recent errors)")), { shown: true });
  }
  const roster = str(r.roster).trim();
  if (!roster) throw Object.assign(new Error(T('No characters were found in that text.')), { shown: true });
  return { roster, rest: str(r.rest).trim() };
}
// the list with the imported people after its own. People of no group go before the list's first heading, or they
// would be taken for the last group's
export function joinRoster(cur, add) {
  cur = cur.trim();
  add = add.trim();
  if (!cur || !add) return cur || add;
  if (!cur.split('\n').some(isHeading)) return `${cur}\n\n${add}`;
  const lines = add.split('\n');
  const h = lines.findIndex(isHeading);
  const at = h < 0 ? lines.length : h;
  return [lines.slice(0, at).join('\n').trim(), cur, lines.slice(at).join('\n').trim()].filter(Boolean).join('\n\n');
}
function reviewImport(ctx, src, got, ac) {
  const cut = !!src.put;
  openSheet(
    `<h3 class="sheet-title">${T('Characters found')}</h3>${got.kept ? `<div class="row imp-kept"><span class="muted field-note">${T('Saved result (no model call)')}</span><button type="button" class="btn ghost chip-sm" id="impAgain">${T('Read again')}</button></div>` : ''}
   <div class="field"><label for="impRoster">${T('Character list')}</label><textarea id="impRoster" rows="8" class="roster-text">${esc(got.roster)}</textarea><div class="roster-preview" id="impPreview"></div><div class="imp-fit" id="impFit"></div></div>
   <div class="field"><label for="impRest">${T('The rest, not about characters')}</label><textarea id="impRest" rows="5" class="roster-text" placeholder="${esc(T('Nothing else'))}">${esc(got.rest)}</textarea></div>
   ${
     !cut
       ? ''
       : src.into
         ? `<label class="row opt"><input type="checkbox" id="impCut" checked> ${T('Use the character list and the rest in this game instead of the note (the note stays as it is)')}</label><p class="muted field-note">${esc(T('The note is unticked for this game, and the rest above is added to {box}.', { box: src.into.label }))}</p>`
         : `<label class="row opt"><input type="checkbox" id="impCut" checked> ${T('Take the character parts out of the source')}</label><p class="muted field-note">${T('The source keeps only the rest above, so the characters are not sent twice.')}</p>`
   }
   <div class="row actions"><button class="btn primary" id="impAdd">${T('Add to the list')}</button><button class="btn ghost" id="impCancel">${T('Cancel')}</button></div>`,
    { wide: true, modal: true },
  );
  const ta = $('#impRoster'),
    add = $('#impAdd');
  // the list under the sheet doesn't change while it is open
  const mine = new Set(parseRoster(ctx.list(), ctx.me).people.map(e => normName(e.name)));
  let joined = '',
    n = 0,
    again = [],
    full = '',
    wait = 0;
  // the imported list, read once a change and shared with the preview
  const readList = () => {
    clearTimeout(wait);
    if (!ta.isConnected) return; // the sheet closed while typing paused
    const text = ta.value.trim();
    const parsed = parseRoster(text, ctx.me);
    joined = joinRoster(ctx.list(), text);
    $('#impPreview').innerHTML = rosterPreviewHtml(text, ctx.worldId, ctx.me, parsed);
    n = parsed.people.length;
    again = parsed.people.filter(e => mine.has(normName(e.name))).map(e => e.name);
    full =
      joined.length > LIMITS.roster.text
        ? T("That doesn't fit: the list holds up to {max} characters, and with these it would be {n}.", {
            max: LIMITS.roster.text,
            n: joined.length,
          })
        : parseRoster(joined, ctx.me).notes.some(x => x.why === 'over')
          ? T("That doesn't fit: the list keeps up to {max} people, and with these there would be more.", {
              max: LIMITS.roster.people,
            })
          : '';
    fit();
  };
  // what the rest box adds to that: only its own length is checked again
  const fit = () => {
    const long = src.into && $('#impCut').checked && src.after($('#impRest').value.trim()).length;
    const why =
      long > LIMITS.userNotes
        ? T(
            "The rest doesn't fit in {box}: it holds up to {max} characters, and with it there would be {n}. Untick the box to keep using the note.",
            {
              box: src.into.label,
              max: LIMITS.userNotes,
              n: long,
            },
          )
        : full;
    $('#impFit').innerHTML =
      (again.length
        ? `<p class="muted field-note">${esc(T('Already in your list: {names}. Where a name comes twice, the later entry is kept.', { names: again.join(', ') }))}</p>`
        : '') + (why ? `<p class="field-note warn">${esc(why)} ${T('Shorten it above, then add.')}</p>` : '');
    add.disabled = !!why || !n;
  };
  ta.oninput = () => {
    clearTimeout(wait);
    wait = setTimeout(readList, 150);
  };
  if (src.into) $('#impRest').oninput = $('#impCut').onchange = fit;
  readList();
  $('#impCancel').onclick = () => {
    ac.abort();
    closeSheet();
  };
  if (got.kept) $('#impAgain').onclick = () => readFresh(ctx, src, $('#impAgain'), ac);
  add.onclick = async () => {
    readList();
    const busy = ctx.busy && ctx.busy();
    if (add.disabled || busy) return busy && toast(busy);
    const rest = cut && $('#impCut').checked ? $('#impRest').value.trim() : null;
    closeSheet();
    ctx.add(joined);
    if (rest != null) src.put(rest);
    if (ctx.commit) await ctx.commit();
    toast(T('{n} {n|person|people} added to the list.', { n }));
  };
}
