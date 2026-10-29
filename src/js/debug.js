/* ============ debug handle ============ */
import * as hostClaude from './host-claude.js';
import * as host from './host.js';
import * as util from './util.js';
import * as i18n from './i18n.js';
import * as enums from './enums.js';
import * as replyWords from './reply-words.js';
import * as data from './data.js';
import * as limits from './limits.js';
import * as calendar from './calendar.js';
import * as db from './db.js';
import * as turnStore from './turn-store.js';
import * as app from './app.js';
import * as settings from './settings.js';
import * as diag from './diag.js';
import * as rules from './rules.js';
import * as people from './people.js';
import * as roster from './roster.js';
import * as notes from './notes.js';
import * as compat from './compat.js';
import * as sheet from './sheet.js';
import * as shell from './shell.js';
import * as sound from './sound.js';
import * as boot from './boot.js';
import * as library from './library.js';
import * as images from './images.js';
import * as places from './places.js';
import * as casting from './casting.js';
import * as newLife from './new-life.js';
import * as persistence from './persistence.js';
import * as status from './status.js';
import * as murim from './murim.js';
import * as worldExt from './world-ext.js';
import * as log from './log.js';
import * as facePicker from './face-picker.js';
import * as widgets from './widgets.js';
import * as composer from './composer.js';
import * as settingsSheet from './settings-sheet.js';
import * as update from './update.js';
import * as turn from './turn.js';
import * as apply from './apply.js';
import * as prompt from './prompt.js';
import * as reroll from './reroll.js';
import * as summaries from './summaries.js';
import * as death from './death.js';
import * as hall from './hall.js';
import * as savesView from './saves-view.js';
import * as memoryView from './memory-view.js';
import * as rosterView from './roster-view.js';
import * as notesView from './notes-view.js';
import * as imagesView from './images-view.js';
import * as zip from './zip.js';

// window.DR: the modules of this page, for the tests and for looking into a live game from the browser console.
//   DR.app.state, DR.send('...'), DR.turnStore.pageMax = 900   any export of any module (modules' own bindings are read-only)
//   DR.toast = fn, or DR.mock('toast', fn)                       replace a function a module lists in its `mocks`
//   DR.mock('toast', null)                                        put the original back
const MODULES = [
  hostClaude,
  host,
  i18n,
  enums,
  replyWords,
  util,
  data,
  limits,
  calendar,
  db,
  turnStore,
  app,
  settings,
  diag,
  rules,
  people,
  roster,
  notes,
  murim,
  worldExt,
  compat,
  sheet,
  shell,
  sound,
  boot,
  library,
  images,
  places,
  casting,
  newLife,
  persistence,
  status,
  log,
  facePicker,
  widgets,
  composer,
  settingsSheet,
  update,
  turn,
  apply,
  prompt,
  reroll,
  summaries,
  death,
  hall,
  savesView,
  memoryView,
  rosterView,
  notesView,
  imagesView,
  zip,
];
const originals = new Map();

function owner(name) {
  return MODULES.find(m => Object.prototype.hasOwnProperty.call(m, name));
}
function mock(name, fn) {
  const m = MODULES.find(x => x.mocks && Object.prototype.hasOwnProperty.call(x.mocks, name));
  if (!m) throw new TypeError(`DR: ${name} cannot be replaced (no module lists it in its mocks)`);
  if (!originals.has(name)) originals.set(name, m[name]);
  m.mocks[name](fn == null ? originals.get(name) : fn);
}
export function exposeDebugHandle() {
  window.DR = new Proxy(
    {},
    {
      get: (_, name) => (name === 'mock' ? mock : name === 'mocks' ? undefined : owner(name)?.[name]),
      set: (_, name, fn) => {
        mock(name, fn);
        return true;
      },
      has: (_, name) => name === 'mock' || !!owner(name),
    },
  );
}
