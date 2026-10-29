/* ============ situations view: the situation dictionary and the situation pickers of the images tab ============ */
import { $, clone, esc, toast } from './util.js';
import { app } from './app.js';
import { logErr } from './diag.js';
import { IMGDOC, IMGX } from './library.js';
import { charSetsAll, imgById, imgUrl } from './images.js';
import { answerDialog, askConfirm, openDialog } from './sheet.js';
import {
  frameSits,
  isAdultSit,
  saveSituations,
  setFrameSits,
  SIT_KEY_RE,
  SIT_MAX,
  sitAncestors,
  sitDict,
  sitKey,
  sitLabel,
  sitTree,
  sitVer,
} from './situations.js';
import { T, uiLang } from './i18n.js';

const NEW = '+new'; // the picker's "create" option; no key starts with +
const indent = depth => '&nbsp;'.repeat(depth * 3); // options keep no other spacing
const failed = e => {
  logErr('situations', e);
  toast(
    e && e.code === 'unread'
      ? T("The situation dictionary hadn't loaded. It has now, so try again")
      : T('Save failed: {err}', { err: (e && (e.code || e.message)) || e }),
    5000,
  );
};

// key -> the characters and pictures that use it
function usage() {
  const u = {};
  for (const [k, imgs] of Object.entries(charSetsAll()))
    for (const x of imgs)
      for (const s of frameSits(x)) {
        const e = (u[s] = u[s] || { sets: new Set(), frames: 0 });
        e.sets.add(k);
        e.frames++;
      }
  return u;
}

let dictOpen = false;
const openSets = new Set(); // set cards whose situation rows are open, kept across redraws
export function sitDictHtml() {
  const d = sitDict(),
    keys = Object.keys(d),
    u = usage();
  const rows = sitTree()
    .map(([k, depth]) => {
      const e = d[k],
        n = u[k] || { sets: new Set(), frames: 0 };
      return `<div class="item sit-row" data-sit="${esc(k)}"${depth ? ` style="margin-left:${Math.min(depth, 4) * 14}px"` : ''}><div class="row sit-row-head"><b>${esc(sitLabel(k))}</b><code>${esc(k)}</code>${isAdultSit(k) ? `<span class="sit-adult">${T('Adult')}</span>` : ''}<span class="muted sit-use">${T('{sets} {sets|character|characters}, {n} {n|picture|pictures}', { sets: n.sets.size, n: n.frames })}</span></div>${e.hint ? `<div class="muted sit-hint">${esc(e.hint)}</div>` : ''}<div class="row sit-acts"><button class="btn ghost" data-sitedit>${T('Edit')}</button><button class="btn ghost" data-sitmerge ${keys.length < 2 ? 'disabled' : ''}>${T('Merge')}</button><button class="btn ghost danger" data-sitdrop>${T('Delete')}</button></div></div>`;
    })
    .join('');
  return `   <details class="sec sit-dict"${dictOpen ? ' open' : ''}><summary><h4 class="sit-dict-title">${T('Situation dictionary ({n})', { n: keys.length })}</h4></summary><p class="muted sit-lead">${T('The scenes a picture can be marked for. The narrator gets each hint and names the situation; an adult one shows only when it is named.')}</p>${rows}<button class="btn" id="sitNew">${T('Create a new situation')}</button></details>
`;
}

// the dictionary's options in tree order, built once per dictionary and screen language
let opts = { key: '', html: '' };
function sitOptions() {
  const key = sitVer() + ':' + uiLang();
  if (opts.key !== key)
    opts = {
      key,
      html: sitTree()
        .map(([k, depth]) => `<option value="${esc(k)}">${indent(depth)}${esc(sitLabel(k))}</option>`)
        .join(''),
    };
  return opts.html;
}
// a frame's situations as chips, and the dictionary to pick from (no typing), its own keys disabled
export function sitPickerHtml(x) {
  const on = frameSits(x);
  let list = sitOptions();
  for (const k of on) list = list.replace(`<option value="${esc(k)}">`, `<option value="${esc(k)}" disabled>`);
  return `<div class="seg sit-pick" data-sitid="${esc(x.id)}">${on.map(k => `<button type="button" class="chip-sm sit-chip${isAdultSit(k) ? ' adult' : ''}" data-sitdel="${esc(k)}" aria-pressed="true" title="${esc(k)}">${esc(sitLabel(k))} ✕</button>`).join('')}<select class="sit-add" data-sitadd aria-label="${T('Add a situation')}"><option value="">${T('+ Situation')}</option>${list}<option value="${NEW}">${T('Create a new situation')}</option></select></div>`;
}
const sitSummary = imgs => {
  const used = [...new Set(imgs.flatMap(frameSits))];
  return used.length ? esc(used.map(sitLabel).join(', ')) : T('none, every picture is plain');
};
// in a set card: every frame with its situations
export function setSitsHtml(k, imgs) {
  return `<details class="set-sits" data-sitset="${esc(k)}"${openSets.has(k) ? ' open' : ''}><summary>${T('Situation pictures')} <span class="muted" data-sitsum>${sitSummary(imgs)}</span></summary>${imgs.map(x => `<div class="row set-sit-row"><img src="${imgUrl(x.id)}" data-big="${esc(x.id)}" loading="lazy" decoding="async" alt="" class="cover-thumb"><span class="muted set-sit-emo">${esc(x.emotion || 'neutral')}</span>${sitPickerHtml(x)}</div>`).join('')}</details>`;
}

// the pickers of this frame, in the grid and in its set card, and the set card's summary
function refresh(box, x) {
  box.querySelectorAll(`[data-sitid="${CSS.escape(x.id)}"]`).forEach(el => (el.outerHTML = sitPickerHtml(x)));
  const k = x.set || x.name;
  const sum = box.querySelector(`[data-sitset="${CSS.escape(k)}"] [data-sitsum]`);
  if (sum) sum.innerHTML = sitSummary(charSetsAll()[k] || []);
}
async function saveFrame(box, x, list) {
  setFrameSits(x, list);
  refresh(box, x);
  try {
    await IMGDOC(x.id).set(x);
  } catch (e) {
    failed(e);
  }
}

// Every character frame with the old key gets the new one instead (none when it is empty). In memory only; returns
// the ids to write.
function rewriteFrames(from, to) {
  const ids = [];
  for (const x of app.images) {
    if (x.kind !== 'char' || !frameSits(x).includes(from)) continue;
    setFrameSits(
      x,
      frameSits(x).map(s => (s === from ? to : s)),
    );
    ids.push(x.id);
  }
  return ids;
}
// the entries under `from` go under `to`, or under nothing; next is a copy, so the live dictionary stays as it is
function reparent(next, from, to) {
  for (const e of Object.values(next))
    if (e.parent === from) {
      if (to) e.parent = to;
      else delete e.parent;
    }
  return next;
}
// before `from` goes (deleted or merged into `to`), an entry under it that was adult only through it says so itself
function keepAdult(next, from, to) {
  if (!isAdultSit(from) || (to && isAdultSit(to))) return next;
  for (const e of Object.values(next)) if (e.parent === from && !e.adult) e.adult = true;
  return next;
}
// the frames first: a failure there leaves the dictionary as it was, and a frame naming a key not in it is harmless
async function commit(ids, next) {
  if (ids.length) await IMGX.flush(ids);
  await saveSituations(next);
}

// The entry form, for a new entry or this one. Resolves the key it saved under, or null.
async function editSituation(key = '') {
  const d = sitDict(),
    e = d[key] || {};
  const field = (id, label, v, max) =>
    `<label class="sit-f">${label}<input id="${id}" class="dlg-input" value="${esc(v || '')}" maxlength="${max}"></label>`;
  const answer = openDialog(
    `<h3 class="sheet-title">${key ? T('Edit situation') : T('New situation')}</h3>
     ${field('sfKey', T('Key: lowercase English, what the narrator names'), key, 24)}
     ${field('sfLabel', T('Label (Korean)'), e.label, SIT_MAX.label)}
     ${field('sfHint', T('Hint for the narrator (Korean): when to pick it'), e.hint, SIT_MAX.hint)}
     <label class="sit-f">${T('Under (a broader situation it falls back to)')}<select id="sfParent" class="set-select dlg-input"><option value="">${T('None')}</option>${sitTree()
       .filter(([k]) => k !== key && !sitAncestors(k).includes(key))
       .map(
         ([k, depth]) =>
           `<option value="${esc(k)}" ${e.parent === k ? 'selected' : ''}>${indent(depth)}${esc(sitLabel(k))}</option>`,
       )
       .join('')}</select></label>
     <details class="sit-more"${e.label_ja || e.hint_en ? ' open' : ''}><summary>${T('Other languages (optional)')}</summary>
     ${field('sfLabelJa', T('Label (Japanese)'), e.label_ja, SIT_MAX.label)}
     ${field('sfHintEn', T('Hint (English), for English and Japanese stories'), e.hint_en, SIT_MAX.hint)}</details>
     <label class="row opt"><input type="checkbox" id="sfAdult" ${e.adult ? 'checked' : ''}> ${T('Adult: shown only when named, never in place of another picture. Everything under an adult situation is adult too')}</label>
     <p class="muted sit-err" id="sfErr"></p>
     <div class="row actions"><button class="btn primary" id="dlgOk">${T('Save')}</button><button class="btn ghost" id="dlgNo">${T('Cancel')}</button></div>`,
    { modal: true },
  );
  $('#sfKey').focus();
  $('#dlgNo').onclick = () => answerDialog(null);
  $('#dlgOk').onclick = () => {
    const k = sitKey($('#sfKey').value);
    const say = m => ($('#sfErr').textContent = m);
    if (!SIT_KEY_RE.test(k)) return say(T('A key is lowercase English letters, digits, spaces, _ or -, up to 24'));
    if (k !== key && d[k]) return say(T('"{key}" is already in the dictionary', { key: k }));
    const v = id => $(id).value;
    answerDialog({
      k,
      entry: {
        label: v('#sfLabel'),
        label_ja: v('#sfLabelJa'),
        hint: v('#sfHint'),
        hint_en: v('#sfHintEn'),
        adult: $('#sfAdult').checked,
        parent: $('#sfParent').value,
      },
    });
  };
  const r = await answer;
  if (!r) return null;
  // a renamed key keeps its place in the list, and every frame and entry under it follows
  const at = (src, keepOld) => {
    const out = {};
    for (const [k, v] of Object.entries(clone(src))) {
      if (k !== key) out[k] = v;
      else {
        if (keepOld) out[k] = v;
        out[r.k] = clone(r.entry);
      }
    }
    if (!key) out[r.k] = clone(r.entry);
    return out;
  };
  try {
    if (!key || r.k === key) await saveSituations(at(d, false));
    else {
      // both keys while the frames move, so a failure at any step leaves every frame on a key in the dictionary
      await saveSituations(at(d, true));
      const ids = rewriteFrames(key, r.k);
      if (ids.length) await IMGX.flush(ids);
      const next = reparent(clone(sitDict()), key, r.k);
      delete next[key];
      await saveSituations(next);
    }
    return r.k;
  } catch (err) {
    failed(err);
    return null;
  }
}
// An adult situation goes only into another adult one, or its pictures would show in any scene; none goes into one
// under it, which would leave that one under nothing that exists
async function mergeSituation(from) {
  const d = sitDict();
  const outside = Object.keys(d).filter(k => k !== from && !sitAncestors(k).includes(from));
  const others = outside.filter(k => !isAdultSit(from) || isAdultSit(k));
  if (!others.length) {
    toast(
      outside.length
        ? T('An adult situation can only be merged into another adult one')
        : T('Nothing to merge it into: a situation never goes into one under it'),
      5000,
    );
    return;
  }
  const answer = openDialog(
    `<p class="dlg-msg">${T('Merge {from} into', { from: `<b>${esc(sitLabel(from))}</b>` })}</p><select id="sfInto" class="set-select">${others.map(k => `<option value="${esc(k)}">${esc(sitLabel(k))} (${esc(k)})</option>`).join('')}</select><p class="muted field-note">${T('Its pictures get the other situation, and it leaves the dictionary.')}</p><div class="row actions"><button class="btn primary" id="dlgOk">${T('Merge')}</button><button class="btn ghost" id="dlgNo">${T('Cancel')}</button></div>`,
  );
  $('#dlgOk').onclick = () => answerDialog($('#sfInto').value);
  $('#dlgNo').onclick = () => answerDialog(null);
  const into = await answer;
  if (!into || !d[into] || !others.includes(into)) return;
  const next = reparent(keepAdult(clone(d), from, into), from, into);
  delete next[from];
  await commit(rewriteFrames(from, into), next);
}
// An adult situation's pictures move to the nearest adult one above it; with none above, it stays while pictures use
// it, so they never turn into plain pictures.
export async function dropSituation(k) {
  const n = (usage()[k] || {}).frames || 0;
  const to = isAdultSit(k) ? sitAncestors(k).find(isAdultSit) || '' : '';
  if (isAdultSit(k) && !to && n) {
    toast(
      T(
        '{label} is an adult situation with no adult one above it, and {n} {n|picture|pictures} use it. Move them to another situation first.',
        { label: sitLabel(k), n },
      ),
      6000,
    );
    return;
  }
  const ask = to
    ? T('Delete {label} from the dictionary? Its {n} {n|picture|pictures} move to {to}.', {
        label: sitLabel(k),
        n,
        to: sitLabel(to),
      })
    : T('Delete {label} from the dictionary? {n} {n|picture|pictures} lose it.', { label: sitLabel(k), n });
  if (!(await askConfirm(ask))) return;
  const up = sitDict()[k].parent;
  const next = reparent(keepAdult(clone(sitDict()), k, up), k, up);
  delete next[k];
  await commit(rewriteFrames(k, to), next);
}

// One set of listeners on the images tab, which redraws its contents; job runs a change that writes many frames.
export function bindSituations(box, { redraw, job }) {
  if (box.dataset.sits) return;
  box.dataset.sits = '1';
  // toggle doesn't bubble
  box.addEventListener(
    'toggle',
    e => {
      const t = e.target;
      if (t.classList && t.classList.contains('sit-dict')) dictOpen = t.open;
      else if (t.dataset && t.dataset.sitset) {
        if (t.open) openSets.add(t.dataset.sitset);
        else openSets.delete(t.dataset.sitset);
      }
    },
    true,
  );
  const frameOf = el => imgById(el.closest('[data-sitid]').dataset.sitid);
  box.addEventListener('change', async e => {
    const sel = e.target.closest('[data-sitadd]');
    if (!sel || !sel.value) return;
    const x = frameOf(sel);
    if (!x) return;
    const v = sel.value;
    sel.value = '';
    const made = v === NEW; // a new entry goes in the dictionary first, then every picker shows it
    const k = made ? await editSituation() : v;
    if (!k) return;
    await saveFrame(box, x, [...frameSits(x), k]);
    if (made) redraw();
  });
  box.addEventListener('click', e => {
    const chip = e.target.closest('[data-sitdel]');
    if (chip) {
      const x = frameOf(chip);
      if (x)
        saveFrame(
          box,
          x,
          frameSits(x).filter(s => s !== chip.dataset.sitdel),
        );
      return;
    }
    if (e.target.closest('#sitNew')) {
      editSituation().then(k => k && redraw());
      return;
    }
    const row = e.target.closest('[data-sit]');
    if (!row) return;
    const k = row.dataset.sit;
    const run = (name, fn) =>
      job(name, () =>
        fn(k)
          .catch(failed)
          .then(() => redraw()),
      );
    if (e.target.closest('[data-sitedit]')) run(T('Situation dictionary'), editSituation);
    else if (e.target.closest('[data-sitmerge]')) run(T('Situation dictionary'), mergeSituation);
    else if (e.target.closest('[data-sitdrop]')) run(T('Situation dictionary'), dropSituation);
  });
}
