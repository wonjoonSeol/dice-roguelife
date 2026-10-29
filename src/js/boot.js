/* ============ boot ============ */
import { host } from './host.js';
import { $, esc, noteIgnored, nowIso, toast } from './util.js';
import { dget, loadWhitelist, memDB, platform, thaw, userCol } from './db.js';
import { app, lastSaveCard } from './app.js';
import { settingsLoaded } from './settings.js';
import { okLang, T, uiLang } from './i18n.js';
import { applyUiLang } from './settings-sheet.js';
import { applyDiscreet } from './shell.js';
import { loadImages, loadSets, migrateLegacy } from './library.js';
import { startNewLifeForm } from './new-life.js';
import { openSave } from './persistence.js';
import { renderLog, syncInputHint } from './log.js';
import { loadPromptConfig } from './prompt.js';
import { loadNotes } from './notes.js';

export async function boot() {
  setTimeout(() => {
    if (!app.state && $('#log > p.muted.pad')) bootTrouble(T('Loading is taking too long. '));
  }, 12000);
  renderLog();
  try {
    await bootInner();
  } catch (e) {
    console.error(e);
    bootTrouble(
      T('Something went wrong while starting: {err}', { err: esc((e && (e.code || e.message)) || e) }) + '<br>',
    );
  }
}
function bootTrouble(lead) {
  // the start went wrong or is taking too long: reload, or leave whatever was loading and start a new game
  $('#log').innerHTML =
    `<div class="notice">${lead}<button class="btn boot-action" data-boot="reload">${T('Try again')}</button> <button class="btn ghost boot-action" data-boot="new">${T('Start a new game')}</button></div>`;
  $('#log [data-boot="reload"]').onclick = () => location.reload();
  $('#log [data-boot="new"]').onclick = () => {
    app.state = null;
    app.turns = [];
    startNewLifeForm();
  };
}
// one of the host's capabilities (host.js), or null when this page does not have it
export let useCapability = function useCapability(n) {
  return host().connect(n);
};
var sampleTries = 0;
let noSampleKind = null; // 'waiting' | 'failed' while #noSample shows
function showNoSample(kind) {
  noSampleKind = kind;
  const n = $('#noSample');
  const retry = `<button class="btn inline-action" id="retrySample">${T('Reconnect to Claude')}</button>`;
  n.innerHTML =
    kind === 'waiting'
      ? `${T('Not connected to Claude yet.')} ${retry}`
      : `${T("This page can't call Claude. Check that you are signed in to Claude and try again.")} ${retry}` +
        (sampleTries >= 2
          ? `<br><span class="boot-note">${T("If it still doesn't work, send the contents of ⚙ → Diagnostics to the app's owner.")}</span>`
          : '');
  n.classList.remove('hidden');
  $('#retrySample').onclick = ensureSample;
}
export function redrawNoSample() {
  if (noSampleKind) showNoSample(noSampleKind);
}
export async function ensureSample() {
  if (platform.sample) return platform.sample;
  sampleTries++;
  toast(T('Connecting to Claude...'), 2000);
  platform.sample = await useCapability('sample');
  if (platform.sample) {
    try {
      platform.limits = await platform.sample.limits();
    } catch (e) {
      noteIgnored('boot: sample limits', e);
    }
    noSampleKind = null;
    $('#noSample').classList.add('hidden');
    if (app.state && !app.state.dead) {
      $('#composer').classList.remove('hidden');
      syncInputHint();
    }
    renderLog('keep');
  } else showNoSample('failed');
  return platform.sample;
}
async function bootInner() {
  const [db, sample, assets, user] = await Promise.all([
    useCapability('db'),
    useCapability('sample'),
    useCapability('assets'),
    useCapability('user'),
  ]);
  platform.sample = sample;
  platform.assets = assets;
  platform.user = user;
  if (db) {
    platform.db = db;
  } else {
    platform.db = memDB();
    platform.memMode = true;
  }
  if (user) {
    try {
      const id = await user.id();
      if (id) {
        platform.userPath = `data/users/${id}`;
        platform.userId = id;
      }
    } catch (e) {
      noteIgnored('boot: user id (staying on the local path)', e);
    }
  }
  platform.shared = platform.db; // shared root collections (images, sets, hall) always go through the platform db
  if (db) {
    try {
      await platform.db.doc(`${platform.userPath}/probe`).set({ t: nowIso() });
    } catch (e) {
      platform.db = memDB('dr-db-' + platform.userId);
      platform.localMode = true;
      toast(T('Read-only access: your progress is saved on this device only'), 5000);
    }
  }
  if (!platform.sample) {
    showNoSample('waiting');
    setTimeout(() => {
      if (!platform.sample) ensureSample();
    }, 1500);
  }
  if (platform.memMode) toast(T('Running without storage: everything is lost on reload'), 4000);
  if (platform.sample) {
    try {
      platform.limits = await platform.sample.limits();
    } catch (e) {
      noteIgnored('boot: sample limits', e);
    }
  }
  await migrateLegacy();
  const stored = await dget('settings');
  app.settings = Object.assign(app.settings, stored || {});
  settingsLoaded();
  resolveUiLang(!!stored);
  applyDiscreet();
  await loadPromptConfig();
  await loadWhitelist();
  await loadImages();
  await loadSets();
  await Promise.all([loadNotes(), loadSaves()]);
  const last = lastSaveCard();
  if (last) await openSave(last.id);
  else startNewLifeForm();
}

// players from before the setting existed keep Korean; new players keep the detected language
function resolveUiLang(returning) {
  if (!okLang(app.settings.uiLang)) app.settings.uiLang = returning ? 'ko' : uiLang();
  if (app.settings.uiLang !== uiLang()) applyUiLang(app.settings.uiLang);
}

export async function loadSaves() {
  try {
    const q = await userCol('saves/items').orderBy('updatedAt', 'desc').limit(100).get();
    app.saves = q.docs.map(d => thaw(d.data()));
  } catch (e) {
    app.saves = [];
  }
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  useCapability: f => (useCapability = f),
};
