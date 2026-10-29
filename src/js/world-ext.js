/* ============ world add-ons: systems only some worlds have ============ */
import { MURIM } from './murim.js';
import { app } from './app.js';
import { isScenario } from './rules.js';

// by world id; what an add-on may hold is in ARCHITECTURE.md, in the world add-on section
export const WORLD_EXT = {
  get murim() {
    return MURIM;
  },
};
const NONE = Object.freeze({});
export const STANDING_KEYS = ['faction', 'position', 'epithet', 'trait'];

// a world without an add-on gets an empty one, so callers read its fields directly. A scenario save's world only
// picks its pictures, so it has none
export const extOf = st => (st && st.life && st.life.world && !isScenario(st) && WORLD_EXT[st.life.world.id]) || NONE;
export const worldExt = () => extOf(app.state);

// what a new life of this world starts with
export function extStart(worldId, tier) {
  const ext = WORLD_EXT[worldId] || NONE;
  const st = {};
  if (ext.ladder) st.ladder = ext.ladder.start[tier] || 0;
  if (ext.standing) st.standing = Object.fromEntries(STANDING_KEYS.map(k => [k, '']));
  if (ext.init) st[worldId] = ext.init(tier);
  return st;
}
// fills in what an older save of an add-on world lacks
export function extFill(st) {
  if (extOf(st) === NONE) return;
  for (const [k, v] of Object.entries(extStart(st.life.world.id, st.life.originTier))) if (st[k] == null) st[k] = v;
}
// a reply that may not change the story (a browse command) keeps none of the add-on's keys
export function extMask(out) {
  out.ladder_up = false;
  out.standing = null;
  if (worldExt().init) out[app.state.life.world.id] = null;
}
// the next step up the ladder, or '' at the top
export function nextStep() {
  const L = worldExt().ladder,
    i = app.state.ladder;
  return L && i < L.steps.length - 1 ? L.steps[i + 1] : '';
}
// the standing as [label, value] pairs, in the language tr gives (T for the screen, pl for the prompt)
export function standingRows(tr) {
  const X = worldExt().standing,
    S = app.state.standing || {};
  if (!X) return [];
  return [
    [tr(X.faction), (S.faction || tr('None')) + (S.position ? '/' + S.position : '')],
    [tr(X.epithet), S.epithet || tr('None')],
    ...(S.trait ? [[tr(X.trait), S.trait]] : []),
  ];
}
