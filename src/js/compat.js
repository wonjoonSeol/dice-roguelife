/* ============ compat: old saves brought up to date ============ */
import { currencyOf, normGender, rollSubStats, WORLD_ALIAS, WORLDS, worldIn } from './data.js';
import { ADDONS, artsToEnums, fromLegacy, LEGACY, MODE, MODES, STYLE } from './enums.js';
import { dedupeQuests, snapshotRules } from './rules.js';
import { okLang } from './i18n.js';
import { extFill } from './world-ext.js';

export function compat(st) {
  st.cast = st.cast || {};
  st.noteIds = st.noteIds || [];
  st.style = st.style || STYLE.DEFAULT;
  if (st.style === STYLE.NOTE && !st.styleNoteId) st.style = STYLE.DEFAULT;
  if (!MODES.includes(st.mode)) st.mode = MODE.ROGUELIKE; // saves before scenarios were all roguelike
  // scenario saves from before the extras kept only their dice choice
  if (st.mode === MODE.SCENARIO)
    st.addons = {
      ...Object.fromEntries(ADDONS.map(k => [k, false])),
      dice: !!(st.rules && st.rules.dice === true),
      ...st.addons,
    };
  if (st.life && st.life.world && WORLD_ALIAS[st.life.world.id]) {
    const [bg, en] = WORLD_ALIAS[st.life.world.id];
    const nw = WORLDS.find(w => w.id === bg);
    if (nw) {
      st.life.world = worldIn(nw, 'ko'); // saves this old are Korean
      if (en && !st.life.entry) st.life.entry = en;
    }
  }
  if (st.life && !st.life.entry) st.life.entry = 'native';
  if (!st.rules) st.rules = snapshotRules();
  if (Array.isArray(st.quests)) st.quests = dedupeQuests(st.quests);
  if (!st.goldV && st.stats && st.life && st.life.world) {
    const m = currencyOf(st.life)[1];
    if (m > 1) st.stats.gold = Math.round((st.stats.gold || 0) * m);
    st.goldV = 2;
  }
  if (st.title === LEGACY.noTitle) st.title = '';
  st.titles = Array.isArray(st.titles) ? st.titles : st.title ? [st.title] : [];
  if (st.stats && st.stats.str === undefined) Object.assign(st.stats, rollSubStats(st.life ? st.life.originTier : 'C'));
  if (st.stats && st.stats.con === undefined) st.stats.con = rollSubStats(st.life ? st.life.originTier : 'C').con;
  st.clock = st.clock || { day: 0, date: '', time: '', weather: '', place: '' };
  murimStanding(st);
  extFill(st);
  if (!okLang(st.lang)) st.lang = langOfLife(st.life);
  toEnums(st);
  return st;
}
// before v2.12 the realm and the standing lived in state.murim
const OLD_STANDING = { faction: 'faction', rank: 'position', alias: 'epithet', constitution: 'trait' };
function murimStanding(st) {
  const M = st.murim;
  if (!M || typeof M.realm !== 'number') return;
  st.ladder = M.realm;
  st.standing = Object.fromEntries(Object.entries(OLD_STANDING).map(([a, b]) => [b, M[a] || '']));
  st.murim = { neigong: M.neigong, arts: M.arts };
}
// Saves from before v2.6 followed the settings' story language. The world's name was written in the story language
// (never typed by the player), so it tells which one the save was played in; saves older than v2.5 are Korean.
function langOfLife(life) {
  const w = String((life && life.world && life.world.name) || '');
  return /[가-힣]/.test(w) || !w ? 'ko' : /[぀-ヿ]/.test(w) ? 'ja' : 'en';
}
// Korean values stored before v2.5 (enums.js LEGACY)
function toEnums(st) {
  if (st.life) {
    st.life.gender = normGender(st.life.gender) || st.life.gender;
    if (st.life.sponsor) st.life.sponsor.stance = fromLegacy('stance', st.life.sponsor.stance);
  }
  for (const k of st.skills || []) if (k && k.src) k.src = fromLegacy('skillSrc', k.src);
  if (st.murim && st.murim.arts) st.murim.arts = artsToEnums(st.murim.arts);
}
