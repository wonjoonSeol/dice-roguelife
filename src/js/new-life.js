/* ============ new life ============ */
import { $, clone, esc, noteIgnored, nowIso, pick, rnd, toast, uid } from './util.js';
import { LIMITS } from './limits.js';
import {
  ADMIN_TALENT,
  BASE,
  cmdName,
  CMDS,
  creatureRace,
  currencyOf,
  inPool,
  moneyFor,
  ORIGINS,
  RACES,
  rollEntry,
  rollSponsor,
  rollSubStats,
  rollTier,
  TALENTS,
  TIER_P,
  tierRank,
  TIERS,
  TRANSFER_RACES,
  WORLDS,
  worldIn,
} from './data.js';
import { langOptions, N_, T, tIn, uiLang } from './i18n.js';
import {
  ENTRY_LABEL,
  GENDER,
  GENDER_LABEL,
  GENDERS,
  ADDON,
  ADDON_LABEL,
  ADDONS,
  MODE,
  MODE_LABEL,
  MODES,
  SCENARIO_WORLD,
  SKILL_SRC,
  STANCE_LABEL,
  STYLE,
  STYLE_LABEL,
  STYLES,
} from './enums.js';
import { isPrivileged, platform } from './db.js';
import { NEW_SAVES, turnStore } from './turn-store.js';
import { app, exclusive, lastSaveCard } from './app.js';
import { saveSettings, setting, storyLang } from './settings.js';
import { adminOn, snapshotRules } from './rules.js';
import { showTab } from './shell.js';
import { cueBlip, cueReveal } from './sound.js';
import { ensureSample } from './boot.js';
import { liveWorldIds, openingFor } from './images.js';
import { leaveOpenSave, pushTurn, showPlay } from './persistence.js';
import { introPrompt, runTurn } from './turn.js';
import { fillTemplate, normalize, pr, talentVars } from './prompt.js';
import { chooseUiLang } from './settings-sheet.js';
import { extStart, WORLD_EXT } from './world-ext.js';
import { parseRoster, rosterTextOf, setRoster, snapOf } from './roster.js';
import { bindRosterEditor, joinRoster, openImport, rosterEditorHtml } from './roster-view.js';
import { lastNoteIds, noteById } from './notes.js';
import {
  bindNotePicker,
  bindOnePicker,
  bindScenarioPicker,
  notePickerHtml,
  oneInForm,
  onePickerHtml,
  pickedInForm,
  saveBoxAsNote,
  scenarioInForm,
  scenarioPickerHtml,
} from './notes-view.js';

const TALENT_MAX = 5;
// a regression keeps its save's notes; a new game starts with the last save's
const startNotes = inherit => (inherit ? app.state.noteIds : lastNoteIds());
// the prose style the same way: the save's, else the last save's
const startStyle = inherit => {
  const s = inherit ? app.state.style : (lastSaveCard() || {}).style;
  return STYLES.includes(s) ? s : STYLE.DEFAULT;
};
// a new game opens in the last save's mode; a regression goes on as a roguelike
const startPlay = inherit =>
  !inherit && (lastSaveCard() || {}).mode === MODE.SCENARIO ? MODE.SCENARIO : MODE.ROGUELIKE;
// A scenario's extras (enums.js ADDON), ticked on the form (sc) and in the Memory tab (mem); the world add-on only for
// a world that has one (X), named by it
export const addonRowsHtml = (pre, on, X) =>
  ADDONS.filter(k => k !== ADDON.EXT || X)
    .map(
      k =>
        `<label class="row opt"><input type="checkbox" id="${pre}Addon-${k}" data-addon="${k}"${on[k] ? ' checked' : ''}> ${esc(T(k === ADDON.EXT ? X.name : ADDON_LABEL[k]))}</label>`,
    )
    .join('');
// the form's ticks start from the last scenario save's
const startAddons = () => ({ ...((lastSaveCard() || {}).addons || {}) });
const formAddons = () =>
  Object.fromEntries([...document.querySelectorAll('#scAddons [data-addon]')].map(c => [c.dataset.addon, c.checked]));
// the extras for the picked world: its add-on starts ticked, with a choice of where on its ladder the story starts
function syncAddons(worldId) {
  const box = $('#scAddons');
  if (!box) return;
  const X = WORLD_EXT[worldId] || null;
  const on = { ...startAddons(), ...formAddons() };
  if (X && !$('#scAddon-ext')) on.ext = true;
  box.innerHTML =
    addonRowsHtml('sc', on, X) +
    (X && X.ladder
      ? `<div class="row ext-start"><label for="scExtStart">${T('Starting {label}', { label: T(X.ladder.label) })}</label><select id="scExtStart"><option value="">${T('Let the story decide')}</option>${X.ladder.steps.map((st, i) => `<option value="${i}">${esc(T(st))}</option>`).join('')}</select></div>`
      : '');
}
// chips with data-sty, for the form and the Memory tab
export const styleChips = (cur, off) =>
  STYLES.map(
    s =>
      `<button type="button" data-sty="${s}" aria-pressed="${s === cur}"${off ? ' disabled' : ''}>${T(STYLE_LABEL[s])}</button>`,
  ).join('');
const formStyle = () => ($('#styseg button[aria-pressed="true"]') || { dataset: {} }).dataset.sty;
// a style note, like the style: the save's, else the last save's
const startStyleNote = inherit => (inherit ? app.state.styleNoteId : (lastSaveCard() || {}).styleNoteId) || null;
// the note picker under the style chips (#styNote, or #mstyNote in the Memory tab), shown while From a note is picked
export const styleNoteHtml = (key, style, id) =>
  `<div id="${key}Wrap" class="style-note${style === STYLE.NOTE ? '' : ' hidden'}">${onePickerHtml(key, id)}</div>`;
// the form's prose style, with its note when it is one; null (and a toast) when From a note has none picked
function styleFromForm(inherit) {
  const style = formStyle() || startStyle(inherit);
  if (style !== STYLE.NOTE) return { style };
  const id = oneInForm('sty');
  if (noteById(id)) return { style, styleNoteId: id };
  toast(T('Pick a note for the prose style'));
  return null;
}
let tierLocked = false;
// free setup for players without owner rights stops at C; Random stays open, its odds are the fair ones
function lockTierSel(sel) {
  if (!sel) return;
  [...sel.options].forEach(o => {
    o.setAttribute('value', o.value);
    const r = tierRank(o.value);
    if (r >= 0 && r < tierRank('C')) {
      o.disabled = true;
      o.textContent = o.value + T(' (locked)');
    }
  });
  if (sel.selectedOptions[0]?.disabled) sel.value = RANDOM_TIER;
}
// the first row's grade may be "no talent": the life starts with none at all (life.talent null)
const NO_TALENT = 'none';
// a grade left to the dice (rollLife takes any value outside TIERS as rolled)
const RANDOM_TIER = 'random';
const tierOptions = () =>
  `<option value="${RANDOM_TIER}" selected>${T('Random')}</option>${TIERS.map(t => `<option>${t}</option>`).join('')}`;
const talentRow = first =>
  `<div class="trow"><div class="row talent-row"><select class="tt" aria-label="${T('Talent grade')}">${first ? `<option value="${NO_TALENT}">${T('No talent')}</option>` : ''}${tierOptions()}</select><input class="tn grow" maxlength="30" placeholder="${first ? T('e.g. Obsessed with the sword (blank for random)') : T('Talent name')}">${first ? '' : `<button type="button" class="tx" aria-label="${T('Remove this talent')}">×</button>`}</div><input class="td talent-desc" maxlength="80" placeholder="${T('Effect in one line')}"></div>`;
let formInherit; // for redrawNewLifeForm
// characters imported from the setting box before the world is known: the fate screen's list takes them
let castDraft = '';
export function startNewLifeForm(inherit) {
  formInherit = inherit;
  castDraft = '';
  tierLocked = false;
  if (!inherit) {
    leaveOpenSave(); // a new game leaves the open save; a regression continues it
    app.currentSave = null;
  }
  $('#strip').classList.add('hidden');
  $('#composer').classList.add('hidden');
  const log = $('#log');
  // the form's choices; play is the game mode, scWorld a scenario's picture world
  const sel = { world: 'random', gender: GENDER.MALE, mode: 'gacha', play: startPlay(inherit), scWorld: 'none' };
  log.innerHTML = newLifeHtml(inherit, sel.play);
  bindChoice(log, '#playseg', 'pm', v => {
    sel.play = v;
    showMode(v);
  });
  bindChoice(log, '#scwseg', 'scw', v => {
    sel.scWorld = v;
    syncAddons(v);
  });
  syncAddons(sel.scWorld);
  bindChoice(log, '#gseg', 'g', v => (sel.gender = v));
  bindChoice(log, '#wseg', 'w', v => (sel.world = v));
  bindChoice(log, '#spseg', 'sp', v => (sel.sponsor = v));
  bindChoice(log, '#styseg', 'sty', v => $('#styWrap').classList.toggle('hidden', v !== STYLE.NOTE)); // read when the life begins (styleFromForm)
  bindChoice(log, '#mseg', 'm', v => {
    sel.mode = v;
    $('#freeBox').classList.toggle('hidden', v !== 'free');
  });
  const ts = $('#toSaves');
  if (ts) ts.onclick = () => showTab('saves');
  bindTalentRows();
  lockFreeSetup(inherit);
  bindProfileCount();
  bindNotePicker();
  bindOnePicker('sty');
  bindWorldNoteSave();
  bindScenarioForm();
  bindFormLang();
  $('#rollBtn').onclick = () => rollFromForm(inherit, sel);
  if ($('#scStart')) $('#scStart').onclick = () => startScenario(sel);
}
// the form shows one mode's parts (the .sc class)
function showMode(to) {
  $('#log .newlife').classList.toggle('sc', to === MODE.SCENARIO);
  if (to === MODE.SCENARIO) syncScenarioCast();
}
// the scenario's picker and its character list, which holds the same draft as the setting box's import (castDraft)
function bindScenarioForm() {
  const root = $('#scRoster');
  if (!root) return;
  bindScenarioPicker();
  bindRosterEditor(root, null, $('#nm').value.trim(), v => (castDraft = v), { lang: storyLang() });
}
function syncScenarioCast() {
  const ta = $('#scRoster [data-roster]');
  if (!ta || ta.value === castDraft) return;
  ta.value = castDraft;
  ta.dispatchEvent(new Event('input'));
}
function bindFormLang() {
  const el = $('#nlLang');
  if (!el) return;
  el.value = uiLang();
  el.onchange = () => chooseUiLang(el.value);
}
// keeps what was typed and a fate already rolled
export function redrawNewLifeForm() {
  const form = $('#log .newlife');
  if (!form) return;
  const fields = [...form.querySelectorAll('input[id],textarea[id],select[id]')].filter(el => el.id !== 'nlLang');
  const ticks = el => el.type === 'checkbox' || el.type === 'radio';
  const kept = fields.map(el => [el.id, ticks(el) ? el.checked : el.value]);
  const pressed = [...form.querySelectorAll('.seg button[aria-pressed="true"]')].map(b => [
    b.parentElement.id,
    b.dataset,
  ]);
  const talents = [...form.querySelectorAll('#talents .trow')].map(r =>
    [...r.querySelectorAll('select,input')].map(x => x.value),
  );
  const pending = app.pendingRoll,
    cast = castDraft;
  startNewLifeForm(formInherit);
  castDraft = cast;
  syncScenarioCast();
  for (const [id, data] of pressed) {
    const [k, v] = Object.entries(data)[0] || [];
    const b = k && $(`#${id} button[data-${k}="${v}"]`);
    if (b && !b.disabled) b.click();
  }
  for (let i = 1; i < talents.length; i++) $('#addTalent').click();
  [...document.querySelectorAll('#talents .trow')].forEach((r, i) =>
    [...r.querySelectorAll('select,input')].forEach((x, j) => {
      if (talents[i] && talents[i][j] !== undefined && !x.disabled) x.value = talents[i][j];
    }),
  );
  const firstGrade = $('#talents .tt');
  if (firstGrade) firstGrade.dispatchEvent(new Event('change')); // a restored "no talent" locks its rows again
  for (const [id, v] of kept) {
    const el = $('#' + id);
    if (!el || el.closest('.trow')) continue;
    if (ticks(el)) el.checked = v;
    else el.value = v;
  }
  $('#prof').dispatchEvent(new Event('input'));
  bindNotePicker();
  bindScenarioPicker();
  bindOnePicker('sty');
  bindWorldNoteSave();
  if (pending) {
    app.pendingRoll = pending;
    revealFate(pending.life, pending.inherit, true);
  }
}
// a row of toggle buttons: pressing one marks it and reports its data-<key> value
export function bindChoice(root, seg, key, onPick) {
  const buttons = root.querySelectorAll(seg + ' button');
  buttons.forEach(
    b =>
      (b.onclick = () => {
        onPick(b.dataset[key]);
        buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }),
  );
}
// the parts only one mode shows are marked rl-only and sc-only; the form's sc class picks (styles.css)
function newLifeHtml(inherit, play) {
  const worlds = ['random', ...WORLDS.map(w => w.id)];
  return `<div class="newlife${play === MODE.SCENARIO ? ' sc' : ''}">
    <div class="row nl-head"><h2>${inherit ? T('Regression') : T('A New Life')}</h2><label class="nl-lang"><span aria-hidden="true">🌐</span><select id="nlLang" aria-label="Language">${langOptions()}</select></label></div>
    ${inherit ? '' : `<div class="seg" id="playseg" role="group" aria-label="${T('Game mode')}">${MODES.map(m => `<button type="button" data-pm="${m}" aria-pressed="${m === play}">${T(MODE_LABEL[m])}</button>`).join('')}</div>`}
    ${
      inherit
        ? ''
        : `<div class="sysmsg intro-head rl-only"><span>${T('[ SYSTEM: Player Registration ]')}</span></div>
    <p class="narr intro-narr rl-only">${T('Converting your soul to data. Your world, race, standing and talent are all left to luck. This world will be unfair, cruel, and wickedly fun. When you die, you come back holding the one ability that made your last life special.')}</p>
    <p class="muted intro-note sc-only">${T('Play a story of your own: pick a scenario note (its world, rules, characters and style), say who you play, and start. Story prompts from other AI story apps work as they are.')}</p>`
    }
    <p class="muted intro-note rl-only">${inherit ? T('You are reborn holding a fragment of your past life. Your world and standing are left to luck once more.') : T('Choose a name and gender; the dice decide your world, race, standing and talent. There are no take-backs.')}</p>
    ${
      inherit
        ? ''
        : `<div class="field"><label for="nm">${T('Name')}</label><input id="nm" maxlength="20" placeholder="${T('Name')}"></div>
    <div class="field"><label>${T('Gender')}</label><div class="seg" id="gseg">${GENDERS.map(g => `<button type="button" data-g="${g}" aria-pressed="${g === GENDER.MALE}">${T(GENDER_LABEL[g])}</button>`).join('')}</div></div>`
    }
    <div class="field"><label for="prof">${T('Character profile (optional): looks, personality, verbal tics, backstory, anything weird you like')}</label><textarea id="prof" rows="3" maxlength="600" placeholder="${esc(T('e.g. Worked the night shift at a convenience store in a past life and is obsessed with instant noodles. Ends every sentence with "I mean, though." Loses all reason around cats.'))}">${esc(inherit ? app.state.life.profile || '' : app.settings.profile || '')}</textarea><div class="row profile-head"><label class="row profile-toggle"><input type="checkbox" id="profSave" checked> ${T('Save as the default for my next life')}</label><span class="muted count-note" id="profCount"></span></div></div>
    ${inherit ? '' : scenarioHtml()}
    ${notePickerHtml(startNotes(inherit))}
    <div class="field rl-only"><label>${T('World')}</label><div class="seg" id="wseg">${worlds.map(w => `<button type="button" data-w="${w}" aria-pressed="${w === 'random'}">${w === 'random' ? T('Random') : T(WORLDS.find(x => x.id === w).name)}</button>`).join('')}</div></div>
    <div class="field"><label>${T('Prose style')}</label><div class="seg" id="styseg">${styleChips(startStyle(inherit))}</div>${styleNoteHtml('sty', startStyle(inherit), startStyleNote(inherit))}<p class="muted field-note">${T('How the narrator writes this game. You can change it later in the Memory tab.')}</p></div>
    ${
      inherit
        ? ''
        : `<div class="field dm rl-only"><label class="row dm-head"><input type="checkbox" id="diceMode" ${app.settings.dice !== false ? 'checked' : ''}> ${T('🎲 Roll the dice every turn')} <span class="dm-tag">${T('2d100 (choices, daily luck)')}</span></label>
      <div class="dm-desc">
        <p>${T('<b>On:</b> <span class="dm-up">harder ↑ more thrilling ↑</span>')}</p>
        <p class="li">${T('- <b>Choice dice</b>: decide risky actions and choices that show a chance')}</p>
        <p class="li">${T('- <b>Daily dice</b>: the occasional good or bad luck, whatever you do')}</p>
        <p class="li">${T("- The code rolls them, not the AI, so results don't lean either way")}</p>
        <p class="gap">${T('<b>Off:</b> relaxed, the way you want it')}</p>
        <p class="li">${T('- The story goes by what is plausible, no dice')}</p>
        <p class="li">${T('- So results may lean a little in your favor')}</p>
        <p class="gap muted">${T('Once you start, this stays fixed for the whole save.')}</p>
      </div></div>`
    }
    <div class="field rl-only"><label>${T('How to start')}</label><div class="seg" id="mseg"><button type="button" data-m="gacha" aria-pressed="true">${T('Luck (dice)')}</button><button type="button" data-m="free" aria-pressed="false">${T('Custom')}</button></div></div>
    <div id="freeBox" class="hidden free-box rl-only">
      <div class="field"><label for="fRace">${T('Race')}</label><input id="fRace" maxlength="20" placeholder="${T('Leave blank for random')}"></div>
      <div class="row"><div class="field talent-grade-field"><label for="fOT">${T('Standing grade')}</label><select id="fOT">${tierOptions()}</select></div><div class="field grow"><label for="fOrigin">${T('Standing')}</label><input id="fOrigin" maxlength="30" placeholder="${T('e.g. Lowest disciple of the Mount Hua Sect (blank for random)')}"></div></div>
      <div class="field"><label>${T('Talents (grade, name, effect in one line)')}</label><div id="talents">${talentRow(true)}</div><button type="button" class="btn ghost add-talent" id="addTalent">${T('+ Add a talent')}</button></div>
      <div class="field"><label for="fAge">${T('Starting age')}</label><input id="fAge" type="number" min="0" max="90" placeholder="${T('Leave blank for random')}"></div>
      <div class="field"><label for="worldNote">${T('Setting and characters (optional)')}</label><textarea id="worldNote" rows="3" maxlength="${LIMITS.userNotes}" placeholder="${T('e.g. There is no magic in this world and the guilds rule the cities. My childhood friend Seoyun lives next door. Blunt on the outside, but always looking out for me.')}">${esc(app.settings.worldNote || '')}</textarea><div class="row note-tools"><button type="button" class="btn ghost" id="worldNoteSave" disabled>${T('Save as note')}</button><button type="button" class="btn ghost" id="worldNoteCast" disabled>${T('Import as characters')}</button></div><p class="muted field-note" id="worldNoteCastNote"></p><p class="muted field-note">${T('This goes into your notes, so it shapes the story from the first scene. You can edit it later in the Memory tab.')}</p></div>
      <div class="field"><label>${T('Constellations')}</label><div class="seg" id="spseg"><button type="button" data-sp="random" aria-pressed="true">${T('Random')}</button><button type="button" data-sp="on" aria-pressed="false">${T('Yes')}</button><button type="button" data-sp="off" aria-pressed="false">${T('None')}</button></div></div>
    </div>
    <details class="odds guide rl-only"><summary>${T('How to play')}</summary>
      <p>${T('<b>Commands</b> (type them in the input box)')}</p>
      <div class="g">${CMDS.map(c => `<code>${cmdName(c.id)}</code><span>${T(c.d)}</span>`).join('')}</div>
      <p>${T('<b>Input</b>: write speech and actions as they are, and put only thoughts or scene notes inside *asterisks*. No one in the scene hears what is inside asterisks. Quotes around speech are optional.')}</p>
      <p>${T('<b>Turns</b>: in a save with the dice on, risky actions and choices that show a chance roll a 1-100 die. <b>Lower is better</b>: at a 30% chance, 30 or under succeeds. An offered choice uses the chance it shows; for anything you type, the narrator sets the chance. A save with the dice off goes by what is plausible. Tap a stat chip under a turn to see why it changed; Rewrite asks for a reason and fixes that.')}</p>
      <p>${T('<b>Death</b>: after your life is tallied, you regress carrying one ability from it. You keep your memories.')}</p>
    </details>
    <details class="odds guide rl-only"><summary>${T('Odds')}</summary>
      <p>${T('<b>Standing and talent</b> are rolled separately: {odds}.', { odds: TIER_P.map(([t, p]) => `<code>${t}</code> ${p}%`).join(', ') })}</p>
      <p>${T("<b>World</b>: one of {n} at random (or pick one). <b>Difficulty</b> ★1-5 is rolled each life within the world's range. Monster Realm is always ★5.", { n: WORLDS.length })}</p>
      <p>${T('<b>Arrival</b> (native, transmigrator, possessor) and <b>whether there are constellations</b> are also rolled by world. Possession is common in romance fantasy and palace worlds, constellations in hunter and tower worlds. If there are constellations, their stance toward ADMIN (indifferent, rivals, hostile, allies) is rolled too.')}</p>
      <p>${T('<b>Your profile</b> leans the world, race, arrival, and which standing and talent you get within a grade, but never the odds of a grade.')}</p>
    </details>
    <div class="row"><button class="btn primary rl-only" id="rollBtn">${T('Roll your fate')}</button>${inherit ? '' : `<button class="btn primary sc-only" id="scStart">${T('Start the story')}</button>`}${app.saves.length && !inherit ? `<button class="btn ghost" id="toSaves">${T('See saved lives')}</button>` : ''}</div>
    <div id="fate"></div></div>`;
}
// a scenario game's own fields: its note (required), an optional first scene, the world its pictures come from and
// its characters
function scenarioHtml() {
  return `<div class="field sc-only"><label>${T('Scenario: a note from your library')}</label>${scenarioPickerHtml((lastSaveCard() || {}).scenarioId || null)}</div>
    <div class="field sc-only"><label for="scFirst">${T('First scene (optional)')}</label><textarea id="scFirst" rows="4" maxlength="${LIMITS.userNotes}" placeholder="${esc(T('e.g. The rain has not stopped for three days. You push open the door of the bookshop at the end of the alley.'))}"></textarea><label class="row opt"><input type="checkbox" id="scVerbatim"> ${T('Show this text as the first message, as it is')}</label><p class="muted field-note">${T('Unticked, the narrator writes the opening from the scenario, starting from this situation when there is one.')}</p></div>
    <div class="field sc-only"><label>${T('World of the pictures (optional)')}</label><div class="seg" id="scwseg"><button type="button" data-scw="none" aria-pressed="true">${T('None')}</button>${WORLDS.map(w => `<button type="button" data-scw="${w.id}" aria-pressed="false">${T(w.name)}</button>`).join('')}</div><p class="muted field-note">${T('It only decides which pictures fit. None means any picture.')}</p></div>
    <div class="field sc-only"><label>${T('Extras')}</label><div id="scAddons" class="addons"></div><p class="muted field-note">${T('Each extra brings in only its own part of the game. You can change them later in the Memory tab.')}</p></div>
    <details class="roster-box sc-only" id="scRoster"><summary>${T('Characters for this story (optional)')}</summary>${rosterEditorHtml('')}<p class="muted field-note">${T('Kept in this save. Each turn the narrator gets the names of a few people not met yet, and the full details only of the few the story is on right now, so a long list costs no more.')}</p></details>`;
}
// the free setup's talent rows: add up to TALENT_MAX, remove any
function bindTalentRows() {
  const box = $('#talents'),
    add = $('#addTalent');
  if (!box || !add) return;
  const sync = () => {
    const rows = [...box.querySelectorAll('.trow')];
    const none = rows[0].querySelector('.tt').value === NO_TALENT; // no talent means no extra ones either
    rows.forEach((r, i) => r.querySelectorAll(i ? 'select,input,button' : 'input').forEach(x => (x.disabled = none)));
    add.disabled = none || rows.length >= TALENT_MAX;
    box.querySelectorAll('.tx').forEach(
      x =>
        (x.onclick = () => {
          x.closest('.trow').remove();
          sync();
        }),
    );
  };
  add.onclick = () => {
    if (box.querySelectorAll('.trow').length >= TALENT_MAX) return;
    box.insertAdjacentHTML('beforeend', talentRow(false));
    sync();
    const rows = box.querySelectorAll('.trow');
    const last = rows[rows.length - 1];
    if (tierLocked) lockTierSel(last.querySelector('.tt'));
    last.querySelector('.tn').focus();
  };
  box.querySelector('.tt').onchange = sync;
  sync();
}
// before the second life (and for anyone but the owner) free setup is closed and tiers are rolled, not chosen
async function lockFreeSetup(inherit) {
  const priv = await isPrivileged();
  const first = !inherit;
  const fb = $('#mseg [data-m="free"]');
  if (!priv) {
    if (first) {
      fb.disabled = true;
      fb.title = T('Custom setup opens from your second life');
      fb.textContent = T('Custom (from your 2nd life)');
    }
    tierLocked = true;
    lockTierSel($('#fOT'));
    document.querySelectorAll('#talents .tt').forEach(lockTierSel);
  }
}
// the setting box kept as a library note instead: ticked for this game, and the box emptied so it isn't sent twice.
// Or its characters imported: held until the fate is rolled, as the world may still be random
function bindWorldNoteSave() {
  const box = $('#worldNote'),
    save = $('#worldNoteSave'),
    cast = $('#worldNoteCast');
  if (!box || !save) return;
  const me = () => (formInherit ? app.state.life.name : $('#nm').value.trim());
  const sync = () => {
    save.disabled = !box.value.trim() || !!app.pendingRoll; // a rolled fate already took the text
    cast.disabled = !!app.pendingRoll; // the fate screen's list imports from then on
    const n = castDraft ? parseRoster(castDraft, me()).people.length : 0;
    $('#worldNoteCastNote').textContent = n
      ? T("{n} {n|person|people} imported. They join this world's character list once your fate is rolled.", { n })
      : '';
  };
  box.oninput = sync;
  cast.onclick = () => {
    const w = ($('#wseg button[aria-pressed="true"]') || { dataset: {} }).dataset.w;
    openImport({
      own: worldNoteSource(),
      untick: untickInForm,
      worldId: w && w !== 'random' ? w : null, // the faces in the preview: any world's while it is random
      me: me(),
      list: () => castDraft,
      add: text => {
        castDraft = text;
        sync();
      },
    });
  };
  save.onclick = async () => {
    if (await saveBoxAsNote(box.value.trim())) {
      box.value = '';
      sync();
    }
  };
  sync();
}
// the setting box as a source for Import characters; its leftover also replaces what the rolled fate took from it
const worldNoteSource = () => ({
  label: T('Setting and characters box'),
  text: () => ($('#worldNote') ? $('#worldNote').value : ''),
  put: rest => {
    const box = $('#worldNote'),
      life = app.pendingRoll && app.pendingRoll.life;
    if (box) {
      box.value = rest.slice(0, LIMITS.userNotes);
      box.dispatchEvent(new Event('input'));
    }
    if (!life || life.seedNotes === undefined) return;
    life.seedNotes = app.settings.worldNote = rest.slice(0, LIMITS.userNotes);
    saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
  },
});
// a library note this game stops using: Import characters put its list and leftover in its place
function untickInForm(id) {
  const box = $('#nlNote-' + id);
  if (!box || !box.checked) return;
  box.checked = false;
  box.dispatchEvent(new Event('change'));
}
// the profile box shows how much of its 600 characters is used
function bindProfileCount() {
  const ta = $('#prof'),
    pc = $('#profCount');
  const upd = () => {
    pc.textContent = T('{n} / 600 characters', { n: ta.value.length });
  };
  ta.oninput = upd;
  upd();
}
// the free-setup fields as rollLife takes them: the first talent row is the talent, the rest are extras
function readFreeSetup(sel) {
  const talents = [...document.querySelectorAll('#talents .trow')].map(r => ({
    tier: r.querySelector('.tt').value,
    name: r.querySelector('.tn').value.trim(),
    desc: r.querySelector('.td').value.trim(),
  }));
  const first = talents[0] || { tier: RANDOM_TIER, name: '', desc: '' };
  return {
    race: $('#fRace').value.trim(),
    originTier: $('#fOT').value,
    origin: $('#fOrigin').value.trim(),
    talentTier: first.tier,
    talent: first.name,
    talentDesc: first.desc,
    extraTalents:
      first.tier === NO_TALENT
        ? []
        : talents
            .slice(1)
            .filter(t => t.name)
            .slice(0, TALENT_MAX - 1),
    age: $('#fAge').value,
    sponsor: sel.sponsor || 'random',
  };
}
// the roll button: read the form, ask the narrator how the player's own setup leans (gacha only), roll, show the fate
async function rollFromForm(inherit, sel) {
  const rb = $('#rollBtn');
  if (rb.disabled) return;
  const name = inherit ? app.state.life.name : $('#nm').value.trim();
  if (!name) {
    toast(T('Enter a name'));
    $('#nm').focus();
    return;
  }
  const gender = inherit ? app.state.life.gender : sel.gender;
  const free = sel.mode === 'free' ? readFreeSetup(sel) : null;
  const profTxt = ($('#prof').value || '').trim().slice(0, 600);
  let aff = null;
  if (profTxt && !free) {
    rb.disabled = true;
    rb.textContent = T('Reading your profile...');
    try {
      aff = await profileAffinity(profTxt);
    } catch (e) {
      noteIgnored('new life: profile affinity (rolling without it)', e);
    }
    rb.disabled = false;
    rb.textContent = T('Roll your fate');
  }
  const life = rollLife(name, gender, sel.world, free, aff);
  life.profile = profTxt;
  const wn = $('#worldNote');
  if (wn && sel.mode === 'free') life.seedNotes = wn.value.trim().slice(0, LIMITS.userNotes); // the save's first user notes, so the opening scene knows them
  rememberFormDefaults(life);
  app.pendingRoll = { life, inherit, lang: storyLang() }; // the language the fate was rolled in, even if the screen changes before starting
  revealFate(life, inherit);
}
// the form's answers become the next new game's defaults (each save keeps the copy it started with). A scenario's
// dice answer is its own, not the roguelike's default
function rememberFormDefaults(life, scenario = false) {
  const settings = app.settings;
  let changed = false;
  if ($('#profSave').checked && settings.profile !== life.profile) {
    settings.profile = life.profile;
    changed = true;
  }
  const dm = !scenario && $('#diceMode');
  if (dm && settings.dice !== dm.checked) {
    settings.dice = dm.checked;
    changed = true;
  }
  if (life.seedNotes !== undefined && settings.worldNote !== life.seedNotes) {
    settings.worldNote = life.seedNotes;
    changed = true;
  }
  if (changed) saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
}
function wpick(items) {
  const tot = items.reduce((a, [, p]) => a + p, 0);
  let r = rnd() * tot;
  for (const [x, p] of items) {
    if ((r -= p) < 0) return x;
  }
  return items[items.length - 1][0];
}
const AFF_FALLBACK = [
  [/무협|강호|내공|검객|문파|武侠|武林|江湖|内功|門派|murim|wuxia|martial art|cultivat/i, 'murim'],
  [/헌터|게이트|각성|ハンター|ゲート|覚醒|hunter|\bgate|awaken/i, 'hunter'],
  [/게임|레벨|유저|ゲーム|レベル|ユーザー|vr|mmo|\bgame|\blevel/i, 'vrmmo'],
  [/학원|아카데미|학생|입학|学園|アカデミー|学生|入学|academy|school|student/i, 'academy'],
  [
    /사이버|해킹|안드로이드|메가코프|거대 ?기업|サイバー|ハッキング|アンドロイド|巨大企業|メガコープ|cyber|hack|android|megacorp/i,
    'cyber',
  ],
  [/영애|황녀|공녀|악녀|북부 대공|令嬢|皇女|公女|悪女|北部大公|young lady|princess|villainess|grand duke/i, 'rofan'],
  [/좀비|멸망|생존|ゾンビ|滅亡|生存|zombie|apocalyp|surviv/i, 'apoc'],
  [/후궁|황궁|조정|궁녀|後宮|皇宮|朝廷|宮女|harem|palace|imperial court|concubine/i, 'palace'],
  [/전이|트럭|소환|이세계|転移|トラック|召喚|異世界|isekai|truck|summon|another world/i, 'isekai'],
  [/마왕|용사|기사|마법|魔王|勇者|騎士|魔法|demon king|\bhero|knight|magic/i, 'fantasy'],
];
// everyday words fill other worlds' profiles too (an office worker who wakes in a novel), so they come out first and
// lean the modern world only when no other world's word is left
const AFF_MODERN =
  /회사|직장|(?<!거대 ?)기업|대학|(?:고등|중|초등)학(?:생|교)|연애|재벌|연예|아이돌|러닝|(?:택시|버스|배달) ?기사|会社|職場|(?<!巨大)企業|サラリーマン|大学|高校|中学|小学|恋愛|財閥|芸能|アイドル|ランニング|\boffice\b|\bcompan(?:y|ies)\b|salary ?m[ae]n|(?:college|universit(?:y|ies))(?: students?)?|(?:high|middle|elementary) school(?:ers?| students?)?|\bromance(?!\s*fantasy)|\bdating\b|chaebol|\bidols?\b|k-?pop|running (?:crew|club)/gi;
// a profile read before the world list changed is read again
const affWorlds = () => WORLDS.map(w => w.id).join();
async function profileAffinity(text) {
  text = String(text || '').trim();
  if (!text) return null;
  const seen = app.settings.profileAff;
  if (seen && seen.text === text && seen.worlds === affWorlds()) return seen.data;
  let data = null;
  if (platform.sample) {
    try {
      data = await Promise.race([
        platform.sample.json(
          fillTemplate(pr('affinity'), {
            worlds: WORLDS.map(w => w.id + '=' + tIn(storyLang(), w.name)).join(', '),
            profile: text,
          }),
          {
            modelTier: 'quick',
            cache: false,
          },
        ),
        new Promise(r => setTimeout(() => r(null), 7000)),
      ]);
    } catch (e) {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') {
    const plain = text.replace(AFF_MODERN, ' ');
    const hits = AFF_FALLBACK.filter(([re]) => re.test(plain)).map(([, w]) => w);
    data = {
      worlds: (hits.length ? hits : plain !== text ? ['modern'] : []).slice(0, 3),
      races: [],
      keywords: [],
    };
  }
  const entryHint = /빙의|원작|憑依|原作|possess|original (novel|story)|inside (a|the) novel/i.test(text)
    ? 'possess'
    : /전이|이세계로|떨어[졌진]|転移|転生|異世界|transport|transmigrat|another world|isekai/i.test(text)
      ? 'transfer'
      : null; // the player's own words about how they arrived
  data = {
    entry: entryHint,
    worlds: liveWorldIds(Array.isArray(data.worlds) ? data.worlds : []).slice(0, 3),
    races: (Array.isArray(data.races) ? data.races : []).map(String).slice(0, 3),
    keywords: (Array.isArray(data.keywords) ? data.keywords : []).map(String).filter(Boolean).slice(0, 8),
  };
  app.settings.profileAff = { text, worlds: affWorlds(), data };
  saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
  return data;
}
function pickWorld(gender, aff) {
  const w = WORLDS.map(x => [
    x,
    (x.id === 'rofan' ? (gender === GENDER.FEMALE ? 1.6 : gender === GENDER.MALE ? 0.7 : 1) : 1) *
      (aff && aff.worlds.includes(x.id) ? 3 : 1),
  ]);
  const tot = w.reduce((a, [, p]) => a + p, 0);
  let r = rnd() * tot;
  for (const [x, p] of w) {
    if ((r -= p) < 0) return x;
  }
  return WORLDS[0];
}
function affPick(list, text, kw) {
  if (!kw || !kw.length) return pick(list);
  const sc = x => kw.filter(k => text(x).toLowerCase().includes(k.toLowerCase())).length;
  const top = Math.max(...list.map(sc));
  if (top > 0 && rnd() < 0.7) return pick(list.filter(x => sc(x) === top));
  return pick(list);
}
// world, race, origin and talent are stored in the story's language
export let rollLife = function rollLife(name, gender, worldChoice, free, aff) {
  const L = storyLang();
  const tr = x => tIn(L, x);
  const table = (worldChoice !== 'random' && WORLDS.find(w => w.id === worldChoice)) || pickWorld(gender, aff);
  const world = worldIn(table, L);
  const entry = rollEntry(table, aff),
    sponsor = rollSponsor(table, free && free.sponsor, setting('adminPersona'));
  const rl = (
    entry === 'transfer' ? TRANSFER_RACES[table.from ? 'other' : 'earth'] : RACES[table.id] || [N_('Human')]
  ).map(tr);
  const rw =
    aff && aff.races.length
      ? rl.map(r => {
          const lr = r.toLowerCase();
          const base = lr.replace(/\(.*\)/, '').trim();
          const hit = aff.races.map(a => a.toLowerCase()).some(a => a && (lr.includes(a) || a.includes(base)));
          return [r, hit ? 4 : 1];
        })
      : rl.map(r => [r, 1]);
  const dr = Array.isArray(world.diff) ? world.diff : [3, 3];
  const diff = dr[0] + Math.floor(rnd() * (dr[1] - dr[0] + 1));
  let race = rnd() < 0.01 ? tIn(L, '[No data (ERROR)]') : wpick(rw);
  const ownRace = (free && free.race ? free.race.slice(0, 20) : '').toLowerCase();
  // a typed race keeps out the creatures of any other race
  const fits = x => {
    const r = creatureRace(x);
    return !r || !ownRace || [r, tr(r)].some(n => ownRace.includes(n.toLowerCase()));
  };
  const pool = t => ORIGINS[t].filter(x => inPool(table, x) && fits(x));
  // last resort: a grade with nothing that fits takes the nearest grade above's
  const origins = t =>
      TIERS.slice(0, tierRank(t) + 1)
        .reverse()
        .map(pool)
        .find(l => l.length),
    talents = t => TALENTS[t].filter(x => inPool(table, x[0]) && (x[0] !== ADMIN_TALENT || adminOn()));
  const kw = aff ? [...aff.keywords, ...aff.races] : [];
  let ot = rollTier(),
    tt = rollTier();
  if (free) {
    if (TIERS.includes(free.originTier)) ot = free.originTier;
    tt = free.talentTier === NO_TALENT ? null : TIERS.includes(free.talentTier) ? free.talentTier : tt;
  }
  const rolled = free && free.origin ? null : affPick(origins(ot), tr, kw);
  const origin = rolled ? tr(rolled) : free.origin;
  if (ownRace) race = free.race.slice(0, 20);
  else if (creatureRace(rolled)) race = tr(creatureRace(rolled));
  let [tn, td] = ['', ''];
  if (tt && free && free.talent) [tn, td] = [free.talent, free.talentDesc || ''];
  else if (tt) [tn, td] = affPick(talents(tt), x => tr(x[0]) + ' ' + tr(x[1]), kw).map(tr);
  let age = pick([0, 0, 7, 12, 16, 17, 19, 24, 31]);
  if (free && free.age !== '') age = Math.max(0, Math.min(90, parseInt(free.age) || 0));
  const extra =
    free && Array.isArray(free.extraTalents)
      ? free.extraTalents
          .map(t => ({
            name: String(t.name).slice(0, 30),
            grade: TIERS.includes(t.tier) ? t.tier : rollTier(),
            desc: String(t.desc || '').slice(0, 80),
          }))
          .filter(t => t.name)
      : [];
  return {
    name,
    gender,
    world,
    race,
    diff,
    originTier: ot,
    origin,
    talentTier: tt,
    talent: tt ? { name: tn, grade: tt, desc: td } : null,
    age,
    free: !!free,
    entry,
    sponsor,
    ...(extra.length ? { extraTalents: extra } : {}),
  };
};
// again: redraw without the reveal animation
function revealFate(life, inherit, again) {
  const cards = [
    [
      T('World'),
      life.world.name,
      `${T('Difficulty')} ${'★'.repeat(life.diff || 3)}${'☆'.repeat(5 - (life.diff || 3))}. ${life.world.desc ? life.world.desc + '. ' : ''}${life.world.risk}. ${life.world.opp}.`,
      null,
    ],
    [T('Race'), life.race, '', null],
    [T('Standing'), life.origin, '', life.originTier],
    life.talent
      ? [T('Talent'), life.talent.name, life.talent.desc, life.talentTier]
      : [T('Talent'), T('No talent'), '', null],
  ];
  if (life.entry && life.entry !== 'native')
    cards.push([
      T('Arrival'),
      T(ENTRY_LABEL[life.entry]),
      life.entry === 'possess'
        ? T('In the body of a character from a novel about this world. You know how the story goes')
        : T('Fell here from {from}. Nothing makes sense, not even the language', {
            from: life.world.from || T('modern-day Earth'),
          }),
      null,
    ]);
  if (life.sponsor)
    cards.push([
      T('Constellations'),
      T('This world has constellations'),
      T('Stance toward ADMIN: {stance}. The channel is still closed', {
        stance: T(STANCE_LABEL[life.sponsor.stance] || life.sponsor.stance),
      }),
      null,
    ]);
  const f = $('#fate');
  // this world's character list: the draft, else what a regression's save already keeps for it, with the characters
  // imported on the form after it
  const draft =
    (app.pendingRoll && app.pendingRoll.roster) ??
    joinRoster(rosterTextOf(inherit && app.state, life.world.id), castDraft);
  f.innerHTML = `<div class="fate">${cards.map((c, i) => `<div class="card${again ? '' : ' flip'} ${c[3] ? 'glow-' + c[3] : ''}" style="animation-delay:${again ? 0 : i * 0.35}s"><small>${c[0]}</small>${c[3] ? `<span class="g ${c[3]}">${c[3]}</span>` : ''}<div class="v">${esc(c[1])}</div>${c[2] ? `<div class="d">${esc(c[2])}</div>` : ''}</div>`).join('')}</div>
   ${inherit && inherit.name ? `<div class="item fate-note"><div class="m">${T('Inherited')}</div><div class="t"><span class="tier ${inherit.grade}">${inherit.grade}</span> ${esc(inherit.name)}</div><div class="m">${esc(inherit.desc)}</div></div>` : ''}
   <details class="roster-box"${draft ? ' open' : ''}><summary>${T('Characters for this story (optional)')}</summary>${rosterEditorHtml(draft)}<p class="muted field-note">${T('Kept in this save for lives in this world. Each turn the narrator gets the names of a few people not met yet, and the full details only of the few the story is on right now, so a long list costs no more.')}</p></details>
   <div class="row fate-actions"><button class="btn primary" id="acceptBtn">${T('Begin with this fate')}</button></div>`;
  bindRosterEditor(
    f,
    life.world.id,
    life.name,
    v => {
      if (app.pendingRoll) app.pendingRoll.roster = v; // a redrawn screen (another language) keeps the draft
    },
    // the setting box is this game's only while its text seeds the notes (the custom setup)
    {
      own: life.seedNotes !== undefined ? worldNoteSource() : null,
      untick: untickInForm,
      lang: app.pendingRoll && app.pendingRoll.lang,
    },
  );
  if (!again)
    cards.forEach((c, i) =>
      setTimeout(
        () => {
          if (c[3]) cueReveal(c[3]);
          else cueBlip();
        },
        i * 350 + 150,
      ),
    );
  $('#rollBtn').disabled = true;
  $('#rollBtn').textContent = life.free ? T('Your setup is set') : T('Your fate is sealed');
  document
    .querySelectorAll('#wseg button,#gseg button,#mseg button,#freeBox input,#freeBox select,#freeBox button')
    .forEach(b => (b.disabled = true));
  $('#acceptBtn').onclick = async () => {
    if (!platform.sample && !(await ensureSample())) {
      toast(T('Claude needs to be connected'));
      return;
    }
    const style = styleFromForm(inherit);
    if (style) beginLife(style);
  };
}
// style: the form's prose style (styleFromForm)
async function beginLife({ style, styleNoteId }) {
  const { life, inherit, lang, roster } = app.pendingRoll;
  app.pendingRoll = null;
  castDraft = ''; // the list it went into is the one kept
  const noteIds = pickedInForm() ?? startNotes(inherit); // no picker: the library is empty or unread
  const b = BASE[life.originTier];
  const skills = [
    ...(life.talent ? [{ ...life.talent, src: SKILL_SRC.TALENT }] : []),
    ...(life.extraTalents || [])
      .filter(t => !life.talent || t.name !== life.talent.name)
      .map(t => ({ ...t, src: SKILL_SRC.TALENT })),
  ];
  const seed = (life && life.seedNotes) || '';
  let past = [],
    lifeNo = 1,
    userNotes = seed,
    lore = {};
  if (life) delete life.seedNotes;
  if (inherit) {
    past = app.state.pastLives;
    lifeNo = app.state.lifeNo + 1;
    userNotes = app.state.userNotes || '';
    if (seed && !userNotes.includes(seed)) userNotes = (userNotes ? userNotes + '\n' : '') + seed;
    userNotes = userNotes.slice(0, LIMITS.userNotes);
    if (inherit.name)
      skills.push({ name: inherit.name, grade: inherit.grade, desc: inherit.desc, src: SKILL_SRC.INHERITED });
    for (const s of app.state.skills.filter(s => s.src === SKILL_SRC.INHERITED))
      if (!skills.find(x => x.name === s.name)) skills.push(s);
  }
  life.money = moneyFor(lang);
  app.state = {
    v: 1,
    goldV: 2,
    rules: inherit ? app.state.rules : snapshotRules(),
    lang,
    mode: MODE.ROGUELIKE,
    life,
    lifeNo,
    stats: Object.assign(
      { hp: b.hp, maxHp: b.hp, power: b.power, gold: b.gold * currencyOf(life)[1], fame: 0, age: life.age },
      rollSubStats(life.originTier),
    ),
    title: '',
    skills,
    lifeStart: inherit ? app.state.next : 0,
    turnNo: 0,
    quests: [],
    lore,
    relations: {},
    cast: {},
    clock: { day: 0, date: '', time: '', weather: '', place: '' },
    ...extStart(life.world.id, life.originTier),
    summaries: inherit ? app.state.summaries : [],
    summarizedUpto: inherit ? app.state.summarizedUpto : -1,
    stateNote: '',
    pastLives: past,
    userNotes,
    roster: (inherit && app.state.roster) || {}, // every world's list goes on; this life uses its own world's
    noteIds, // the library notes ticked on this screen (notes.js)
    style,
    ...(styleNoteId ? { styleNoteId } : {}),
    dead: false,
    next: inherit ? app.state.next : 0,
  };
  if (roster != null) setRoster(app.state, life.world.id, roster);
  if (!inherit) openNewSave(T("{name}'s Fate", { name: life.name }));
  else app.currentSave.lifeNo = lifeNo;
  const lifeRow = {
    n: lifeNo,
    world: life.world.name,
    race: life.race,
    origin: life.origin,
    tier: life.originTier,
    ...talentVars(life),
  };
  await pushTurn({
    kind: 'system',
    text: life.talent
      ? tIn(storyLang(), 'Life {n}: {world}, {race}, {origin} ({tier}), talent {talent} ({talentTier})', lifeRow)
      : tIn(storyLang(), 'Life {n}: {world}, {race}, {origin} ({tier}), no talent', lifeRow),
    snap: snapOf(app.state),
  });
  app.state.introText = introPrompt(app.state, inherit ? pr('introOpeningRegress') : pr('introOpeningFirst'));

  showPlay();
  await exclusive(() => runTurn(app.state.introText, null, { intro: true }));
}
// a new save's card, the open one from now on
function openNewSave(name) {
  app.currentSave = {
    id: uid(),
    name,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    parent: null,
    lifeNo: 1,
    turns: 0,
    store: 2,
    pages: 0,
  };
  turnStore.tail = null;
  NEW_SAVES.add(app.currentSave.id);
  app.turns = [];
  app.settings.lastSave = app.currentSave.id;
  saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
}

// A scenario game starts straight from the form: no rolling and no fate screen. Its life holds only the player's
// name, gender and profile; the world is the picked one (its pictures and character list) or SCENARIO_WORLD.
async function startScenario(sel) {
  const name = $('#nm').value.trim();
  if (!name) {
    toast(T('Enter a name'));
    $('#nm').focus();
    return;
  }
  const note = noteById(scenarioInForm());
  if (!note) {
    toast(T('Pick a scenario note'));
    return;
  }
  const style = styleFromForm(false);
  if (!style) return;
  if (!platform.sample && !(await ensureSample())) {
    toast(T('Claude needs to be connected'));
    return;
  }
  const lang = storyLang();
  const table = WORLDS.find(w => w.id === sel.scWorld);
  const life = {
    name,
    gender: sel.gender,
    world: table ? worldIn(table, lang) : { id: SCENARIO_WORLD, name: note.name },
    race: '',
    diff: 3,
    originTier: 'C',
    origin: '',
    talentTier: null,
    talent: null,
    age: 0,
    free: true,
    entry: 'native',
    sponsor: null,
    profile: ($('#prof').value || '').trim().slice(0, 600),
    money: moneyFor(lang),
  };
  rememberFormDefaults(life, true);
  const first = ($('#scFirst').value || '').trim();
  const verbatim = !!first && $('#scVerbatim').checked;
  const X = table && WORLD_EXT[table.id];
  const addons = { ...Object.fromEntries(ADDONS.map(k => [k, false])), ...formAddons() };
  addons.ext = !!X && addons.ext;
  const pickStep = $('#scExtStart') ? $('#scExtStart').value : '';
  const step = addons.ext && X.ladder && pickStep !== '' ? Number(pickStep) : null;
  const b = BASE.C;
  app.state = {
    v: 1,
    goldV: 2,
    rules: snapshotRules(), // dice and the gambler's fate come from the extras (rules.js rule)
    lang,
    mode: MODE.SCENARIO,
    addons,
    ...(addons.ext ? extStart(life.world.id, null, step) : {}),
    ...(addons.ext && X.ladder && step == null ? { ladderPending: true } : {}),
    scenarioId: note.id,
    scenarioName: note.name,
    firstScene: first,
    life,
    lifeNo: 1,
    stats: Object.assign({ hp: b.hp, maxHp: b.hp, power: b.power, gold: 0, fame: 0, age: 0 }, rollSubStats('C')), // kept, never shown or sent
    title: '',
    skills: [],
    lifeStart: 0,
    turnNo: 0,
    quests: [],
    lore: {},
    relations: {},
    cast: {},
    clock: { day: 0, date: '', time: '', weather: '', place: '' },
    summaries: [],
    summarizedUpto: -1,
    stateNote: '',
    pastLives: [],
    userNotes: '',
    roster: {},
    noteIds: (pickedInForm() ?? startNotes(false)).filter(id => id !== note.id), // the scenario goes once
    ...style,
    dead: false,
    next: 0,
  };
  if (castDraft.trim()) setRoster(app.state, life.world.id, castDraft);
  castDraft = '';
  openNewSave(T('{scenario} ({name})', { scenario: note.name, name }));
  await pushTurn({ kind: 'system', text: tIn(lang, 'Scenario: {name}', { name: note.name }), snap: snapOf(app.state) });
  if (!app.state) return;
  showPlay();
  if (verbatim) await exclusive(() => openVerbatim(first));
  else {
    app.state.introText = introPrompt(app.state);
    await exclusive(() => runTurn(app.state.introText, null, { intro: true }));
  }
}
// the first scene shown as the opening reply, as the player wrote it: no narrator call
async function openVerbatim(text) {
  const out = normalize({ narration: text });
  out.narration = text; // the player's own words, dashes and all
  app.state.turnNo++;
  const row = await pushTurn({
    kind: 'ai',
    out,
    deltas: {},
    newSkills: [],
    notes: [],
    img: openingFor(app.state.life.world.id, true) || {},
    clock: clone(app.state.clock),
    snap: snapOf(app.state),
  });
  if (!app.state) return;
  if (!row) {
    app.state.turnNo--;
    app.state.introText = introPrompt(app.state); // Retry asks the narrator for the opening instead
  }
  showPlay();
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  rollLife: f => (rollLife = f),
};
