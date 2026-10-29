/* ============ murim: what only a murim life has ============ */
import { N_, T } from './i18n.js';
import { ART_SLOT_LABEL, ART_SLOTS, artsToEnums } from './enums.js';
import { LIMITS } from './limits.js';
import { app } from './app.js';

export const REALMS = [
  N_('Unranked'),
  N_('Third-rate'),
  N_('Second-rate'),
  N_('First-rate'),
  N_('Peak'),
  N_('Transcendent'),
  N_('Harmony'),
  N_('Mystic'),
  N_('Life and Death'),
];
const NEIGONG_START = { EX: 120, SSS: 60, S: 20, A: 10, B: 3 };
const GAPJA = 60;

function applyMurim(ctx) {
  const u = ctx.reply.murim;
  if (!u || typeof u !== 'object') return;
  const M = app.state.murim;
  const ng = Math.max(-LIMITS.move.neigong, Math.min(LIMITS.move.neigong, Math.round(Number(u.neigong) || 0)));
  if (ng) {
    M.neigong = Math.max(0, M.neigong + ng);
    ctx.deltas.neigong = ng;
  }
  // the Korean prompt names slots by their Korean words
  const arts = artsToEnums(u.arts && typeof u.arts === 'object' ? u.arts : {});
  for (const k of ART_SLOTS)
    if (arts[k]) {
      const v = String(arts[k]).slice(0, LIMITS.text.label);
      if (M.arts[k] !== v) {
        M.arts[k] = v;
        ctx.notes.push(`${T(ART_SLOT_LABEL[k])}: ${v}`);
      }
    }
}

// prompt.js lends its pl and pr, which this module cannot import
function murimPrompt({ pl, pr }) {
  const M = app.state.murim;
  const arts = ART_SLOTS.filter(k => M.arts[k])
    .map(k => pl(ART_SLOT_LABEL[k]) + ':' + M.arts[k])
    .join(' / ');
  return [
    pr('murim'),
    pl('[Murim status] inner energy {neigong} years, arts {arts}', { neigong: M.neigong, arts: arts || pl('None') }),
    app.state.standing.faction ? '' : pr('murimJoin'),
  ]
    .filter(Boolean)
    .join('\n');
}

const yearsText = n => {
  const g = Math.floor(n / GAPJA),
    y = n % GAPJA;
  return T('{n} yrs', { n }) + (g ? ` (${T('{g} gapja', { g })}${y ? ' ' + T('{n} yrs', { n: y }) : ''})` : '');
};

// The add-on a murim life gets (world-ext.js): realms as its ladder, inner energy and arts as its own state, and the
// extras it turns on
export const MURIM = {
  name: N_('Murim add-on (tracks realm, standing and bonds)'), // a scenario's extra (enums.js ADDON)
  ladder: {
    label: N_('Realm'),
    next: N_('Next realm'),
    up: N_('Realm up: {realm}'),
    steps: REALMS,
    start: { EX: 6, SSS: 4, S: 3, A: 2, B: 1 },
  },
  standing: { faction: N_('Faction'), epithet: N_('Epithet'), trait: N_('Physique') }, // the words for its fields
  profiles: true,
  bonds: true,
  title: N_('MURIM'),
  init: tier => ({ neigong: NEIGONG_START[tier] || 0, arts: {} }),
  apply: applyMurim,
  prompt: murimPrompt,
  strip: () => T('Inner energy <b>{n}</b> yrs', { n: app.state.murim.neigong }),
  cells: () => [[T('Inner energy'), yearsText(app.state.murim.neigong)]],
  rows: () => ART_SLOTS.filter(k => app.state.murim.arts[k]).map(k => [T(ART_SLOT_LABEL[k]), app.state.murim.arts[k]]),
};
