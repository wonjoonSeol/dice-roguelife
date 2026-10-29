/* ============ enums: stored values; labels are shown through T() ============ */
import { N_ } from './i18n.js';

export const GENDER = Object.freeze({ MALE: 'male', FEMALE: 'female', OTHER: 'other' });
export const GENDERS = Object.freeze(Object.values(GENDER));
export const GENDER_LABEL = Object.freeze({ male: N_('Male'), female: N_('Female'), other: N_('Other') });

export const ENTRY_LABEL = Object.freeze({
  native: N_('Native'),
  transfer: N_('Transmigrator'),
  possess: N_('Possessor'),
});

export const MONEY = Object.freeze({ WON: 'won', YEN: 'yen', DOLLARS: 'dollars' }); // a modern life's money

// a save's game mode (state.mode), fixed when it starts: the rolled roguelike, or a story from the player's own
// scenario note (state.scenarioId)
export const MODE = Object.freeze({ ROGUELIKE: 'roguelike', SCENARIO: 'scenario' });
export const MODES = Object.freeze(Object.values(MODE));
export const MODE_LABEL = Object.freeze({ roguelike: N_('Dice roguelike'), scenario: N_('Scenario') });
// a library note's job (note.type): ticked and sent every turn, a scenario, a prose style, character sheets to import.
// A note without one is general. Only the pickers go by it; a ticked note is sent whatever its type
export const NOTE_TYPE = Object.freeze({ GENERAL: 'general', SCENARIO: 'scenario', STYLE: 'style', CAST: 'cast' });
export const NOTE_TYPES = Object.freeze(Object.values(NOTE_TYPE));
export const NOTE_TYPE_LABEL = Object.freeze({
  general: N_('General'),
  scenario: N_('Scenario'),
  style: N_('Prose style'),
  cast: N_('Cast'),
});
// A scenario save's extras (state.addons): the game's own systems it takes on, each one bringing only its own prompt
// blocks and reply fields. ext is the world add-on of its world chip (world-ext.js), named by the add-on itself
export const ADDON = Object.freeze({
  ADMIN: 'admin',
  EXT: 'ext',
  DICE: 'dice',
  LUCK: 'luck',
  WIDGETS: 'widgets',
  GROWTH: 'growth',
});
export const ADDONS = Object.freeze(Object.values(ADDON));
export const ADDON_LABEL = Object.freeze({
  admin: N_('ADMIN (constellation) commentary'),
  dice: N_('🎲 Dice checks: risky choices show a chance and a d100 decides'),
  luck: N_('Luck events: jackpot, doom and daily luck'),
  widgets: N_('Widgets on their own: news or a board after a big event'),
  growth: N_('Growth pace from the ⚙ settings'),
});
// the world id of a scenario save that picked no world: every picture fits it, and its character list is kept under it
export const SCENARIO_WORLD = 'scenario';

// a save's prose style (state.style): prompts.json styles holds each one's text, none for the default; note is a
// library note's text (state.styleNoteId)
export const STYLE = Object.freeze({ DEFAULT: 'default', JINYONG: 'jinyong', NOTE: 'note' });
export const STYLES = Object.freeze(Object.values(STYLE));
export const STYLE_LABEL = Object.freeze({ default: N_('Default'), jinyong: N_('Jin Yong'), note: N_('From a note') });

export const STANCE = Object.freeze({ INDIFFERENT: 'indifferent', RIVAL: 'rival', HOSTILE: 'hostile', ALLY: 'ally' });
export const STANCES = Object.freeze(Object.values(STANCE)); // the order data.js STANCE_P weighs them in
export const STANCE_LABEL = Object.freeze({
  indifferent: N_('Indifferent'),
  rival: N_('Rivals'),
  hostile: N_('Hostile'),
  ally: N_('Allies'),
});

export const SKILL_SRC = Object.freeze({
  TALENT: 'talent',
  INHERITED: 'inherited', // from a past life
  GAINED: 'gained',
  EVOLVED: 'evolved',
  MERGED: 'merged',
});
export const SKILL_SRC_LABEL = Object.freeze({
  talent: N_('Talent'),
  inherited: N_('Inherited'),
  gained: N_('Gained'),
  evolved: N_('Evolved'),
  merged: N_('Merged'),
});

// state.murim.arts keys
export const ART_SLOT = Object.freeze({ SWORD: 'sword', MIND: 'mind', MOVEMENT: 'movement', OTHER: 'other' });
export const ART_SLOTS = Object.freeze(Object.values(ART_SLOT));
export const ART_SLOT_LABEL = Object.freeze({
  sword: N_('Sword art'),
  mind: N_('Inner art'),
  movement: N_('Lightness skill'),
  other: N_('Other art'),
});

// Korean values in saves before v2.5 (compat.js) and in Korean replies (apply.js)
// i18n-ignore-start
export const LEGACY = Object.freeze({
  stance: { 무관심: STANCE.INDIFFERENT, 경쟁: STANCE.RIVAL, 적대: STANCE.HOSTILE, 협력: STANCE.ALLY },
  skillSrc: {
    재능: SKILL_SRC.TALENT,
    계승: SKILL_SRC.INHERITED,
    획득: SKILL_SRC.GAINED,
    진화: SKILL_SRC.EVOLVED,
    합성: SKILL_SRC.MERGED,
  },
  artSlot: { 검법: ART_SLOT.SWORD, 심법: ART_SLOT.MIND, 경공: ART_SLOT.MOVEMENT, 기타: ART_SLOT.OTHER },
  noTitle: '없음',
});
// i18n-ignore-end
export const fromLegacy = (kind, value) => (LEGACY[kind] && LEGACY[kind][value]) || value;
// martial arts keyed by slot value, from keys that may be the old Korean slot names
export const artsToEnums = arts => {
  const out = {};
  for (const [k, v] of Object.entries(arts || {})) out[fromLegacy('artSlot', String(k).trim().toLowerCase())] = v;
  return out;
};
