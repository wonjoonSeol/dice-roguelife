/* ============ saves / turns persistence ============ */
import { $, clone, fmt, noteIgnored, nowIso, toast } from './util.js';
import { T } from './i18n.js';
import { cmdIs } from './data.js';
import { dget, dset, platform, userDoc } from './db.js';
import { DB_DOC_CAP, GONE_SAVES, NEW_SAVES, turnStore } from './turn-store.js';
import { abandonAction, app } from './app.js';
import { saveSettings } from './settings.js';
import { logErr } from './diag.js';
import { compat } from './compat.js';
import { extFill } from './world-ext.js';
import { isScenario } from './rules.js';
import { scenarioName } from './notes.js';
import { adoptRosterNames } from './people.js';
import { closeSheet, openSheet } from './sheet.js';
import { showTab } from './shell.js';
import { forgetPendingCasts } from './casting.js';
import { startNewLifeForm } from './new-life.js';
import { renderStrip } from './status.js';
import { renderLog, syncInputHint } from './log.js';
import { parseCmd, restoreDraft, setSendMode } from './composer.js';
import { renderSaves } from './saves-view.js';

// Adds a row to the open save. Returns the row, or null when it could not be saved: the row is then off the page
// again, and a conflict or a deleted save has already been handled (the save reloaded or closed).
export async function pushTurn(t) {
  {
    const lastI = app.turns.length ? app.turns[app.turns.length - 1].i : -1;
    if (app.state.next <= lastI) app.state.next = lastI + 1;
  } /* never reuse a number already on the page */
  t.i = app.state.next++;
  t.at = nowIso();
  app.turns.push(t);
  if (app.turns.length > 160 && !platform.memMode) app.turns = app.turns.slice(-120);
  let err = null;
  try {
    await turnStore.append(t);
  } catch (e) {
    err = e;
  }
  if (err && !(err.code === 'conflict' || err.code === 'quota_exceeded')) {
    logErr('store', err);
    await new Promise(r => setTimeout(r, 800));
    try {
      await turnStore.append(t);
      err = null;
    } catch (e) {
      err = e;
    }
  } // one more try for a passing failure
  if (err) {
    app.turns = app.turns.filter(x => x !== t);
    app.state.next--;
    logErr('store', err);
    await storeError(err);
    return null;
  } // never save a state whose turn is not on the page
  await persist();
  if (!app.state) return null; // the save turned out to be gone
  return t;
}
// Leaving the open save for another one, a new game or nothing: an action still running for it (a reply being
// written, a rewrite) is abandoned, and the faces it was still picking are forgotten, so nothing lands in the next save.
export function leaveOpenSave({ keepAction = false } = {}) {
  if (!keepAction) abandonAction();
  forgetPendingCasts();
  setSendMode(null); // the stop button belonged to the abandoned reply
}
export function closeGone(id, msg) {
  // a save deleted here or on another device: close it instead of writing it back into existence
  GONE_SAVES.add(id);
  app.saves = app.saves.filter(x => x.id !== id);
  if (app.settings.lastSave === id) {
    delete app.settings.lastSave;
    saveSettings().catch(e => noteIgnored('persistence: dset settings', e));
  }
  if (app.currentSave && app.currentSave.id === id) {
    leaveOpenSave();
    app.currentSave = null;
    app.state = null;
    app.turns = [];
    turnStore.tail = null;
    $('#strip').classList.add('hidden');
    $('#composer').classList.add('hidden');
    startNewLifeForm();
    showTab('saves');
  }
  renderSaves();
  if (msg) toast(msg, 4500);
}
// what a save's card repeats from its state, read without opening the save (the saves tab, how many saves use a note)
export const cardFields = st => ({
  turns: st.next,
  lifeNo: st.lifeNo,
  noteIds: st.noteIds,
  style: st.style,
  ...(st.styleNoteId ? { styleNoteId: st.styleNoteId } : {}),
  ...(st.turnNo != null ? { lifeTurns: st.turnNo } : {}),
  ...(isScenario(st) ? { mode: st.mode, scenarioId: st.scenarioId, scenarioName: scenarioName(st) } : {}),
});
let persistQueue = Promise.resolve();
// one state write at a time, so they never trip each other's check
export function persist() {
  const p = persistQueue.then(persistNow, persistNow);
  persistQueue = p.catch(() => {}); // the queue only orders the writes: whoever awaits p gets its error
  return p;
}
export async function staleSave(id) {
  /* someone else saved this save since we loaded it (another device, an old tab, a fix made in the database) */
  try {
    const ex = await userDoc(`saves/items/${id}`).get();
    if (!ex.exists) return 'gone';
    const rv = (ex.data() || {}).sv || 0;
    return app.currentSave && app.currentSave.id === id && app.currentSave.sv != null && rv !== app.currentSave.sv
      ? 'changed'
      : '';
  } catch (e) {
    return '';
  }
}
async function persistNow() {
  if (!app.currentSave || !app.state || GONE_SAVES.has(app.currentSave.id)) return;
  const id = app.currentSave.id;
  if (!NEW_SAVES.has(id)) {
    const st = await staleSave(id);
    if (st === 'gone') {
      closeGone(id, T('This save was deleted somewhere else, so it was closed'));
      return;
    }
    if (st === 'changed') {
      toast(T('This save changed somewhere else; reloading the latest'), 4000);
      await openSave(id);
      return;
    }
  } /* never write an older copy over a newer one */
  if (!app.currentSave || app.currentSave.id !== id) return;
  // the card's version (sv) goes up only with a write that landed: a failed write must not look like a change made elsewhere
  const card = Object.assign(
    {},
    app.currentSave,
    { sv: (app.currentSave.sv || 0) + 1, updatedAt: nowIso() },
    cardFields(app.state),
  );
  try {
    await dset(`states/items/${id}`, app.state);
    await dset(`saves/items/${id}`, card);
    NEW_SAVES.delete(id);
    if (app.currentSave && app.currentSave.id === id) Object.assign(app.currentSave, card);
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
  }
  if (!app.currentSave || app.currentSave.id !== id) return; // closed or switched while writing
  const i = app.saves.findIndex(s => s.id === id);
  if (i >= 0) app.saves[i] = clone(app.currentSave);
  else app.saves.unshift(clone(app.currentSave));
}
// What the player wrote or chose is not story: a snapshot brought back (a rewrite, a branch, a saved state that fell
// behind) keeps the notes, character lists and prose style of the state open now (snapshots hold no lists, roster.js snapOf)
const PLAYER_KEYS = ['userNotes', 'roster', 'noteIds', 'style', 'styleNoteId', 'addons'];
export function fromSnap(snap) {
  const st = compat(clone(snap));
  for (const k of PLAYER_KEYS) if (app.state && app.state[k] !== undefined) st[k] = clone(app.state[k]);
  extFill(st); // an add-on ticked after that snapshot
  adoptRosterNames(st); // the older story, with the latest list
  return st;
}
// keepAction: the running action opens this save itself (a new branch) and goes on holding the game
export async function openSave(id, { keepAction = false } = {}) {
  if (GONE_SAVES.has(id)) return;
  const meta = app.saves.find(s => s.id === id);
  if (!meta) return;
  let st;
  try {
    st = await dget(`states/items/${id}`);
  } catch (e) {
    toast(T("Couldn't load the save. Open it again in a moment ({err})", { err: e.code || e.message }), 4500); // a failed read is not a missing save
    if (!app.state) startNewLifeForm();
    return;
  }
  if (!st) {
    toast(T("Can't find the save data"));
    if (app.settings.lastSave === id) {
      delete app.settings.lastSave;
      saveSettings().catch(e => noteIgnored('persistence: dset settings', e));
    }
    if (!app.state) startNewLifeForm();
    return;
  }
  if (!app.currentSave || app.currentSave.id !== id) leaveOpenSave({ keepAction }); // a reload of the same save keeps its action
  app.currentSave = clone(meta);
  app.state = compat(st);
  try {
    await turnStore.ensure(id, m => toast(m, 3000));
    const m2 = app.saves.find(s => s.id === id) || {};
    app.currentSave.store = m2.store || app.currentSave.store;
    app.currentSave.pages = m2.pages || app.currentSave.pages;
  } catch (e) {
    console.warn('migrate', e);
    toast(T('Will retry updating the save format next time'), 3000);
  }
  try {
    app.turns = await turnStore.loadAll2Latest(id);
  } catch (e) {
    console.warn(e);
    app.turns = [];
  }
  {
    // state and turns are written separately; if the state doc fell behind, rebuild it from the newest snapshot
    const lastRow = app.turns[app.turns.length - 1];
    if (lastRow && app.state.next <= lastRow.i) {
      const snapT = [...app.turns].reverse().find(t => t.snap);
      if (snapT) {
        app.state = fromSnap(snapT.snap); // with the saved state's notes and lists
        app.state.next = lastRow.i + 1;
        toast(T('Restored to the last saved point'), 3000);
        persist().catch(e => noteIgnored('persistence: persist', e));
      }
    }
  }
  try {
    const sd = await userDoc(`saves/items/${id}`).get();
    if (sd.exists && app.currentSave && app.currentSave.id === id) app.currentSave.sv = (sd.data() || {}).sv || 0;
  } catch (e) {
    noteIgnored('open save: refresh sv', e);
  }
  app.settings.lastSave = id;
  saveSettings().catch(e => noteIgnored('persistence: dset settings', e));
  showPlay();
  if (app.state && app.state.turnNo == null) {
    const sid = id;
    countLifeTurns(sid, app.state.lifeStart || 0)
      .then(n => {
        if (app.state && app.currentSave && app.currentSave.id === sid && app.state.turnNo == null && n != null) {
          app.state.turnNo = n;
          persist().catch(e => noteIgnored('persistence: persist', e));
          renderStrip();
        }
      })
      .catch(e => noteIgnored('persistence: countLifeTurns.then', e));
  }
}
async function countLifeTurns(id, start) {
  const rows = await turnStore.loadAll(id);
  let n = 0;
  for (let k = 0; k < rows.length; k++) {
    const t = rows[k];
    if (t.kind !== 'ai' || t.i < start) continue;
    const u = rows[k - 1];
    const pc = u && u.kind === 'user' ? parseCmd(u.text || '') : null;
    if (cmdIs(pc, 'browse')) continue;
    n++;
  }
  return n;
}
export async function loadEarlier() {
  const first = app.turns[0];
  if (!first) return;
  try {
    const older = await turnStore.loadBefore(app.currentSave.id, first.i, 80);
    if (!older.length) {
      toast(T('No earlier history'));
      return;
    }
    const log = $('#log');
    const h = log.scrollHeight;
    app.turns = [...older, ...app.turns];
    renderLog();
    log.scrollTop = log.scrollHeight - h;
  } catch (e) {
    toast(T('Loading failed'));
  }
}
export function showPlay() {
  showTab('play');
  renderStrip();
  renderLog();
  $('#composer').classList.toggle('hidden', !platform.sample || app.state.dead);
  syncInputHint();
  try {
    restoreDraft();
  } catch (e) {
    noteIgnored('open save: restore draft', e);
  }
}
export async function storeError(e) {
  if (e && e.code === 'conflict') {
    const id = app.currentSave && app.currentSave.id;
    if (id) {
      let ex = true;
      try {
        ex = (await userDoc(`saves/items/${id}`).get()).exists;
      } catch (e) {
        noteIgnored('store error: does the save still exist', e);
      }
      if (!ex) {
        closeGone(id, T('This save was deleted somewhere else, so it was closed'));
        return;
      }
    }
    toast(T('This save moved on from another device; reloading it'), 4000);
    if (id) await openSave(id);
    return;
  }
  if (e && e.code === 'quota_exceeded') {
    showQuotaFull();
    return;
  }
  toast(T('Save failed: {err}', { err: (e && (e.code || e.message)) || T('unknown') }));
}
function showQuotaFull() {
  openSheet(
    `<h3>${T('Storage is full')}</h3><p class="quota-lead">${T("This app's storage holds at most {n} documents. What just happened was not saved.", { n: fmt(DB_DOC_CAP) })}</p><p class="muted quota-note">${T('In the Saves tab, keep old saves or branches as files with <b>Export story</b>, then delete them to make room. Then send again or try again to carry on.')}</p><div class="row"><button class="btn primary" id="quotaSaves">${T('Go to Saves')}</button><button class="btn ghost" data-close>${T('Close')}</button></div>`,
  );
  $('#quotaSaves').onclick = () => {
    closeSheet();
    showTab('saves');
  };
}
