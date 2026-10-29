/* ============ prompt ============ */
import PR_DEFAULT from '../../prompts.json' with { type: 'json' };
import { kb, stripMarks, utf8Bytes } from './util.js';
import { askOf, cmdIs, moneyText, powerGrade } from './data.js';
import { ADDON, GENDER_LABEL, SCENARIO_WORLD, SKILL_SRC, STANCE_LABEL, STYLE } from './enums.js';
import { LIMITS } from './limits.js';
import { withWeekday } from './calendar.js';
import { platform, sget } from './db.js';
import { app } from './app.js';
import { choicesOff, promptLang, setting, storyLang } from './settings.js';
import { N_, T, Tc, tIn } from './i18n.js';
import { logErr } from './diag.js';
import {
  ADMIN_OFF,
  adminOn,
  addonOn,
  growthLevel,
  isScenario,
  itemBonus,
  lifeDiff,
  rollGrade,
  rule,
  statusVisible,
  titlesOn,
} from './rules.js';
import { stripOdds } from './reply-words.js';
import { activeRel, bondOf, BONDS, canonName, lastStoryReply } from './people.js';
import { charSets, fitsWorld, genderOf, setSituations } from './images.js';
import { sitHint, sitRoot } from './situations.js';
import { placeVocab } from './places.js';
import { cardIndex, cardProfile, isOpenRole, namedSetFor, namedSetOf, setIds } from './casting.js';
import { mentioned, namesOf, rosterFor, rosterNow } from './roster.js';
import { widgetOf } from './widgets.js';
import { nextStep, standingRows, worldExt } from './world-ext.js';
import { NOTES_UNREAD, notesReady, pickedNotes, scenarioNote, STYLE_GONE, styleNote } from './notes.js';

export let prompts = PR_DEFAULT; // narrator prompt text; config/prompt in the db overrides field by field
// a prompts.json map keyed by story language ("lang", "tip", "ledgerLang", "summaryLang")
export const prLang = k => ((prompts && prompts[k]) || {})[storyLang()] || '';
// a prompts.json entry; an English or Japanese story reads prompts.en's version when there is one
export const prIn = (lang, k) => {
  const en = lang !== 'ko' && prompts.en;
  return en && en[k] !== undefined ? en[k] : prompts[k];
};
export const pr = k => prIn(promptLang(), k);
export const pl = (en, vars) => tIn(promptLang(), en, vars);
// the talent fields of a life's opening prompt and first row; a life started with no talent says so
export const talentVars = life =>
  life.talent
    ? { talent: life.talent.name, talentTier: life.talentTier }
    : { talent: pl('None'), talentTier: pl('this life has no talent') };
// an enum's label in the prompt's language (an unknown value as it is)
export const plLabel = (labels, v) => (labels[v] ? pl(labels[v]).toLowerCase() : v);
export const fillTemplate = (str, v) =>
  String(str || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
export async function loadPromptConfig() {
  try {
    const v = await sget('config/prompt');
    prompts = v && v.rules ? Object.assign({}, PR_DEFAULT, v) : PR_DEFAULT;
  } catch (e) {
    prompts = PR_DEFAULT;
  }
}

export const recentBudget = () => Math.max(10000, Math.min(200000, Number(app.settings.recentBytes) || 40000)); // bytes of raw recent turns before the summaries take over
// counted in exchanges (one narrator reply with the player's line before it), the same unit as the top bar
function recentEstimate() {
  const pool = app.turns.slice(-80);
  const ai = pool.filter(t => t.kind === 'ai').length;
  if (!ai) return null;
  const bytes = pool.reduce((a, t) => a + utf8Bytes(turnText(t, true)), 0);
  return Math.max(3, Math.round(recentBudget() / Math.max(400, bytes / ai)));
}
export function recentLine() {
  if (!app.state) return '';
  const est = recentEstimate();
  return (
    T('Right now {n} {n|turn is|turns are} included. ', { n: recentWindow().filter(t => t.kind === 'ai').length }) +
    (est ? T("At this game's average turn size, up to about {m} turns fit. ", { m: est }) : '')
  );
}
export const recentWindow = () => windowOf(recentBudget()).rows;
// the newest turns, taken from the end until the budget is spent (older player turns count trimmed); at least six.
// used: the bytes they took of it
function windowOf(budget) {
  const pool = app.turns.filter(t => t.i > app.state.summarizedUpto);
  const rows = [];
  let used = 0;
  for (let i = pool.length - 1; i >= 0; i--) {
    const t = pool[i];
    const b = utf8Bytes(turnText(t, i < pool.length - 1));
    if (rows.length >= 6 && used + b > budget) break;
    rows.unshift(t);
    used += b;
  }
  return { rows, used };
}
let sent = null; // the rows the last narrator prompt carried: { save, from, to } turn numbers
// The rows the summaries keep out: the ones the last prompt sent, which a prompt over its limit cuts below the
// setting's window. Without a prompt for the latest rows of this save, the setting's window.
export function sentWindow() {
  const last = app.turns[app.turns.length - 1];
  if (!sent || !last || !app.currentSave || sent.save !== app.currentSave.id || sent.to < last.i - 1)
    return recentWindow();
  return app.turns.filter(t => t.i >= sent.from && t.i > app.state.summarizedUpto);
}
export function turnText(t, trim, noAdmin) {
  if (t.kind === 'user') {
    const x = String(t.text || '');
    return pl('Player: {text}', { text: trim && x.length > 300 ? x.slice(0, 300) + '…' : x });
  }
  if (t.kind === 'system') return pl('[System] {text}', { text: t.text });
  if (t.kind === 'ledger') return pl('[Life ledger] {text}', { text: (t.out && t.out.summary) || '' });
  const o = t.out || {};
  let s = '';
  if (o.admin && !noAdmin) s += `ADMIN: ${o.admin}\n`;
  s += stripMarks(o.narration).slice(0, 1400);
  if (o.widget)
    s += pl('\n(widget: {type}{headline})', {
      type: o.widget.type,
      headline: o.widget.headline ? ' ' + o.widget.headline : '',
    });
  if (o.choices && o.choices.length) s += pl('\nChoices: {list}', { list: o.choices.join(' / ') });
  if (o.money_done) s += '\n' + pl('[System] {text}', { text: o.money_done });
  return s;
}
// names in the screen's language, texts in the prompt's
export const ADMIN_PERSONAS = () => {
  const ko = (prompts && prompts.personas) || {};
  const en = (prompts && prompts.en && prompts.en.personas) || {};
  const out = {};
  for (const k of Object.keys(ko))
    out[k] = {
      name: en[k] && en[k].name ? T(en[k].name) : ko[k].name,
      text: (promptLang() === 'en' && en[k] && en[k].text) || ko[k].text,
    };
  out.custom = { name: T('Write your own'), text: '' };
  out[ADMIN_OFF] = { name: Tc('persona', 'Off'), text: '' };
  return out;
};
function adminBlock() {
  if (!adminOn()) return '';
  const AP = ADMIN_PERSONAS();
  const k = setting('adminPersona');
  if (k === 'custom') return app.settings.adminCustom ? `[ADMIN] ${app.settings.adminCustom}` : '';
  return (AP[k] || AP.star || AP.dealer || {}).text || '';
}
// The player's language, length, correction and prose style settings sit just before the rules list, after the
// output format. The list's heading was '규칙:' and is now 'Rules:'; with neither, the settings follow the whole rules text.
function withPlayerSettings(rules, extra) {
  if (!extra) return rules;
  // i18n-ignore: an older live prompt's heading
  for (const head of ['\nRules:\n', '\n규칙:\n']) {
    const i = rules.indexOf(head);
    if (i >= 0) return rules.slice(0, i) + '\n' + extra + rules.slice(i);
  }
  return rules + '\n\n' + extra;
}
// The blocks after the rules, in the order the narrator reads them. Empty blocks are left out.
const PROMPT_ORDER = [
  'scenario',
  'adminp',
  'cheat',
  'growth',
  'know',
  'world',
  'me',
  'profile',
  'entry',
  'sponsor',
  'stat',
  'ledger',
  'gear',
  'inv',
  'ext',
  'clock',
  'skill',
  'note',
  'quest',
  'rel',
  'lore',
  'past',
  'sum',
  'user',
  'named',
  'profiles',
  'situation',
  'bg',
  'widgets',
  'recent',
  'cmd',
  'corr',
  'redo',
  'errata',
  'fate',
  'luck',
  'nodice',
  'jcore',
  'roll',
  'input',
];
// The Dice Roguelife framing a scenario save never sends: cheating, outside knowledge from past lives, the world and
// its difficulty, arrival, constellations and past lives. ADMIN, growth pace, fate and luck, widgets and the world
// add-on come only with their extras (state.addons); stats, gear, skills and titles go in neutral words
// (scenarioBlocks, personaBlock).
const ROGUELIKE_ONLY = ['cheat', 'know', 'world', 'entry', 'sponsor', 'past'];
// the prompts.json entry a save reads: a scenario save's own version where it has one, else one without ADMIN when
// ADMIN is off (adminOff lists what to cut from each entry)
export function prFor(k) {
  if (isScenario()) return pr(SCENARIO_KEYS[k] || k);
  const t = pr(k),
    cuts = !adminOn() && (pr('adminOff') || {})[k];
  return cuts ? cuts.reduce((s, [a, b]) => s.split(a).join(b), t) : t;
}
const SCENARIO_KEYS = {
  rules: 'scenarioRules',
  styles: 'scenarioStyles',
  summary: 'scenarioSummary',
  widgets: 'scenarioWidgets',
  widgetsIdle: 'scenarioWidgetsIdle',
  cmdJudge: 'scenarioCmdJudge',
  cmdSkills: 'scenarioCmdSkills',
  growth: 'scenarioGrowth',
  fateHead: 'scenarioFateHead',
  fateDoom: 'scenarioFateDoom',
};
// recent turns for the prompt: older player turns are trimmed (the action survives, the long deliberation does not),
// and only the last three remarks ADMIN actually made are kept
const recentBlock = str => (str ? `${pl('[Recent]')}\n${str}` : '');
function recentForPrompt(recent) {
  const aiIdx = recent.map((t, i) => (t.kind === 'ai' && t.out && t.out.admin ? i : -1)).filter(i => i >= 0);
  const keepAdmin = new Set(adminOn() ? aiIdx.slice(-3) : []); // the last three remarks ADMIN actually made
  const recentStr = recent
    .map((t, i) =>
      i === recent.length - 1 ? turnText(t, false, !keepAdmin.has(i)) : turnText(t, true, !keepAdmin.has(i)),
    )
    .join('\n\n'); // older player turns are trimmed: the action survives, the long deliberation does not
  return recentStr;
}
function meBlock() {
  const l = app.state.life,
    s = app.state.stats;
  const on = titlesOn(),
    fx = app.state.titleFx || {};
  const act = on.length ? on.map(t => `${t}${fx[t] ? `(${fx[t]})` : ''}`).join(', ') : pl('None');
  const held = (app.state.titles || []).filter(t => !on.includes(t));
  return pl(
    '[Player] {name}, {gender}, age {age}, race {race}, standing {origin} ({tier}), titles {titles}, life #{n}',
    {
      name: l.name,
      gender: plLabel(GENDER_LABEL, l.gender),
      age: s.age,
      race: l.race,
      origin: l.origin,
      tier: l.originTier,
      titles: act + (held.length ? pl(' (also held: {list})', { list: held.join(', ') }) : ''),
      n: app.state.lifeNo,
    },
  );
}
function statBlock() {
  const l = app.state.life,
    s = app.state.stats,
    E = app.state.energy;
  const bonus = itemBonus();
  const energy = E
    ? `, ${E.name} ${E.cur}/${E.max}${(r =>
        r <= 0
          ? pl(' (exhausted: no power can be used and the body will not obey)')
          : r < 0.1
            ? pl(' (nearly exhausted)')
            : r < 0.3
              ? pl(' (running low)')
              : '')(E.cur / Math.max(1, E.max))}`
    : pl(', no power resource (no power system yet)');
  return (
    pl('[Stats]') +
    (statusVisible()
      ? ''
      : pl(' (the player cannot see numbers yet: when an awakening or a measurement comes, status_unlock)')) +
    pl(
      ' HP {hp}/{maxHp}, power {power}{bonus}({grade}), Constitution {con} Strength {str} Magic {mag} Agility {agi} Intelligence {int} Charm {cha} (1-10 is the human range, above it superhuman)',
      {
        hp: s.hp,
        maxHp: s.maxHp,
        power: s.power,
        bonus: bonus ? pl('+{bonus}(gear)={total}', { bonus, total: s.power + bonus }) : '',
        grade: powerGrade(s.power + bonus),
        con: s.con,
        str: s.str,
        mag: s.mag,
        agi: s.agi,
        int: s.int,
        cha: s.cha,
      },
    ) +
    energy +
    pl(', money {money}, fame {fame}', { money: moneyText(s.gold, l, promptLang()), fame: s.fame })
  );
}
// the world add-on's block (world-ext.js): its ladder and the player's standing, its own part, and the rules of the
// extras it turns on. A world without an add-on sends none of it.
function extBlock() {
  const X = worldExt(),
    L = X.ladder,
    next = nextStep();
  const where = [
    L && `${pl(L.label)} ${pl(L.steps[app.state.ladder])}${next ? pl(' (next {realm})', { realm: pl(next) }) : ''}`,
    ...standingRows(pl).map(([k, v]) => `${k} ${v}`),
  ].filter(Boolean);
  return [
    L && fillTemplate(pr('ladder'), { label: pl(L.label), steps: L.steps.map(r => pl(r)).join(' > ') }),
    where.length && pl('[Standing] {list}', { list: where.join(', ') }),
    X.prompt && X.prompt({ pl, pr }),
    X.bonds && fillTemplate(pr('bonds'), { steps: BONDS.map(b => `${b.e} ${pl(b.label).toLowerCase()}`).join(' < ') }),
  ]
    .filter(Boolean)
    .join('\n');
}
// a scenario add-on whose start was left to the story: the narrator names it once (apply.js applyWorldExt)
const ladderStart = () => {
  const L = worldExt().ladder;
  return L && app.state.ladderPending ? fillTemplate(pr('scenarioExtStart'), { label: pl(L.label) }) : '';
};
const bondMark = n => (worldExt().bonds && bondOf(n) ? bondOf(n).e : '');
function relationsBlock() {
  return Object.keys(app.state.relations).length
    ? (() => {
        const al = {};
        for (const [a, b] of Object.entries(app.state.aliases || {}))
          (al[canonName(b)] = al[canonName(b)] || []).push(a);
        const active = activeRel();
        return active.length
          ? pl('[Relations] {list}', {
              list: active
                .map(([n, v]) => `${n}${bondMark(n)}${al[n] ? `(= ${al[n].slice(0, 4).join(', ')})` : ''}: ${v}`)
                .join(' | '),
            })
          : '';
      })()
    : '';
}
// the short text after a name in the named block
const shortOf = p => [p.position, p.power].filter(Boolean).join(' ').slice(0, 16).trim();
// an epithet, after the gender in that block
const epithetOf = p => (p && p.epithet ? ', ' + p.epithet : '');
// the roster's people, each with the set card their names point to, and each card's person (the first to claim it),
// once per prompt, for the named block and the profiles
function rosterCards(ix) {
  const of = rosterNow().map(e => [e, namedSetOf(namesOf(e), { ix, exact: true })]);
  const bySet = new Map();
  for (const [e, k] of of) if (k && !bySet.has(k)) bySet.set(k, e);
  return { of, bySet };
}
// named characters, grouped by affiliation (a roster heading or faction key, a set's first identity tag) so one line
// holds a whole sect: what the story mentions first, then the player's roster, then named sets and open roles, the
// rest rotating over turns, within about 500 bytes
function namedBlock(hay, turn, sets, own) {
  const st = app.state;
  const used = new Set(Object.values(st.cast));
  const w = st.life.world.id;
  const ctx = hay + ' ' + (st.stateNote || '') + ' ' + ((st.standing || {}).faction || '');
  const groups = new Map();
  const groupOf = (name, vals) => {
    if (!groups.has(name)) groups.set(name, { name, vals: [], members: [], roster: 0 });
    const g = groups.get(name);
    for (const v of vals) if (v && !g.vals.includes(v)) g.vals.push(v);
    return g;
  };
  const sex = g => (g === 'female' ? pl('F') : g === 'male' ? pl('M') : '?');
  // met, under any of their names or wearing their set: [Relations] and the faces have them
  const known = n => st.cast[n] || (st.relations || {})[n] != null;
  for (const [e, k] of own.of) {
    if ([canonName(e.name), ...namesOf(e)].some(known) || (k && used.has(k))) continue;
    const ids = k ? setIds(k).map(i => i.val) : [];
    const g = groupOf(e.faction || ids[0] || pl('Other'), [e.faction, ...ids]);
    g.roster = 1;
    g.members.push({
      name: e.name,
      roster: 1,
      g: sex(e.gender || (k && genderOf(k))),
      epithet: epithetOf(e.profile),
      short: shortOf(e.profile),
      hit: mentioned(e, ctx) ? 1 : 0,
    });
  }
  // an open role (#key) is a set the narrator may name (casting.js isOpenRole). A scenario with no world offers only
  // its own list: every world's cast would fit it
  const list = (w === SCENARIO_WORLD ? [] : Object.keys(sets))
    .map(k => [k, app.setMeta[k] || {}])
    .filter(([k, m]) => (m.charName || isOpenRole(k)) && !used.has(k) && !own.bySet.has(k) && fitsWorld(m, w));
  for (const [k, m] of list) {
    const ids = setIds(k);
    const g = groupOf(
      ids.length ? ids[0].val : pl('Other'),
      ids.map(i => i.val),
    );
    const segs = String(m.role || '')
      .split(/[,，]/)
      .map(t => {
        for (const i of ids) t = t.split(i.val).join('');
        return t.replace(/\(.*?\)|（.*?）/g, '').trim();
      });
    // the card's position and power, else the first phrase of its role that still says something once the identity
    // is removed
    const short = shortOf(cardProfile(k) || {}) || (segs.find(t => t.length >= 3) || segs[0] || '').slice(0, 12).trim();
    g.members.push({
      name: m.charName || '#' + k,
      epithet: epithetOf(cardProfile(k)),
      open: !m.charName,
      roster: 0,
      g: sex(m.gender),
      short,
      hit: m.charName && ctx.includes(m.charName) ? 1 : 0,
    });
  }
  if (!groups.size) return '';
  const N = groups.size,
    r = app.state.next % N;
  const gs = [...groups.values()]
    .map((g, i) => [g, g.vals.some(v => v && ctx.includes(v)) ? 1 : 0, (i - r + N) % N])
    .sort((a, b) => b[1] - a[1] || b[0].roster - a[0].roster || a[2] - b[2]) // mentioned, then the roster's, then rotation
    .map(([g]) => g);
  const bytes = utf8Bytes;
  const parts = [];
  let size = 0,
    open = false,
    anyOwn = false;
  for (const g of gs) {
    const n = g.members.length,
      r2 = app.state.next % n;
    const ms = g.members
      .map((x, i) => [x, (i - r2 + n) % n])
      .sort((a, b) => b[0].hit - a[0].hit || b[0].roster - a[0].roster || a[1] - b[1])
      .map(([x]) => x);
    const names = [];
    for (const x of ms.slice(0, 6)) {
      const t = `${x.name}(${x.g}${x.epithet || ''}${x.short ? ', ' + x.short : ''})`;
      if (size + bytes(t) + bytes(g.name) + 6 > 500) break;
      names.push(t);
      size += bytes(t) + 2;
      open = open || x.open;
      anyOwn = anyOwn || !!x.roster;
    } // at most six per group, so several groups fit; the rest rotate in
    if (names.length) {
      parts.push(`${g.name}: ${names.join(', ')}`);
      size += bytes(g.name) + 4;
    }
    if (size >= 480) break;
  }
  turn.openRoles = open; // the streamed preview leaves newcomers' faces to the whole reply (turn.js pickPreview)
  if (!parts.length) return '';
  const named = fillTemplate(pr('named'), { list: parts.join(' | ') });
  return [named, open && pr('namedOpen'), anyOwn && pr('namedRoster')].filter(Boolean).join('\n');
}
// who matters this turn, most first: on stage in the last story reply, named in the recent text or this input (also by
// a roster person's or a named set's other names), then the latest relations. Each with the set they wear or would wear.
function peopleInPlay(hay, sets, ix) {
  const o = (lastStoryReply() || {}).out || {};
  const cast = app.state.cast;
  const named = [];
  for (const k of Object.keys(sets)) {
    const m = app.setMeta[k] || {};
    if (m.charName && [m.charName, ...(m.aliases || [])].some(n => hay.includes(n))) named.push(m.charName);
  }
  for (const e of rosterNow()) if (mentioned(e, hay)) named.unshift(e.name);
  const names = [
    o.speaker,
    ...(o.also_present || []).map(p => p && p.name),
    ...Object.keys(cast).filter(n => hay.includes(n)),
    ...named,
    ...activeRel()
      .map(([n]) => n)
      .reverse(),
  ];
  return [...new Set(names.filter(Boolean).map(canonName))].map(n => [n, cast[n] || namedSetFor(n, ix)]);
}
// at most this many people's profiles or picture tags per prompt, so a library of any size costs the same
const PEOPLE_MAX = 3;
// the profiles of the people who matter this turn: their roster entry (any world), else their set card's
function profilesBlock(people, own) {
  if (!worldExt().profiles && !own.of.length) return '';
  const lines = [];
  for (const [n, k] of people) {
    const r = rosterFor(n) || (k && own.bySet.get(k)); // also someone wearing the person's set under another name
    const card = k && cardProfile(k);
    // an entry with any field replaces the card whole; one with none (a name, a faction) keeps the card's
    const p = r && Object.keys(r.profile).length ? r.profile : card;
    if (!p || !Object.keys(p).length) continue; // a name and a faction alone are no profile
    const faction = r && r.faction && !String(p.position || '').includes(r.faction) ? r.faction : '';
    const epithet = p.epithet && pl('epithet {name}', { name: p.epithet }); // first: what the story calls them
    const head = [epithet, [faction, p.position].filter(Boolean).join(' '), p.power].filter(Boolean).join(', ');
    const body = [p.looks, p.traits, p.speech && pl('speech: {s}', { s: p.speech }), p.signature, p.ties];
    if (p.secret) body.push(pl('secret: {s}', { s: p.secret }));
    lines.push(`${n}${head ? `(${head})` : ''}: ${body.filter(Boolean).join('; ')}`);
    if (lines.length >= PEOPLE_MAX) break;
  }
  return lines.length ? fillTemplate(pr('profiles'), { list: lines.join(' | ') }) : '';
}
// The situations their face has pictures for (images.js setSituations), for the narrator to name as "situation": a
// family's root, then in brackets only the more specific keys this set has; each hint given once. Only people whose
// set has some, in any world.
function situationBlock(people) {
  const lines = [],
    told = new Set();
  const say = s => {
    const h = !told.has(s) && sitHint(s, promptLang());
    told.add(s);
    return h ? `${s}(${h})` : s;
  };
  for (const [n, k] of people) {
    const ks = k ? setSituations(k).slice(0, 24) : [];
    if (!ks.length) continue;
    const roots = [...new Set(ks.map(sitRoot))];
    const list = roots.map(r => {
      const sub = ks.filter(s => s !== r && sitRoot(s) === r);
      return say(r) + (sub.length ? `[${sub.map(say).join(', ')}]` : '');
    });
    lines.push(`${n}: ${list.join(', ')}`);
    if (lines.length >= PEOPLE_MAX) break;
  }
  return lines.length ? fillTemplate(pr('situation'), { list: lines.join(' | ') }) : '';
}
// a scenario's versions: no ranked quest boards, and a widget only when a command or the scenario asks
function widgetsBlock(cmd) {
  const W = prFor('widgets') || {};
  if (cmdIs(cmd, 'ask')) return '';
  if (cmd && W[cmd.type]) return fillTemplate(pr('widgetsCmd'), { schema: W[cmd.type] });
  return isScenario() && !addonOn(ADDON.WIDGETS) ? '' : prFor('widgetsIdle');
}
function cmdBlock(cmd) {
  if (!cmd) return '';
  const ask = askOf(cmd);
  if (ask) return fillTemplate(prFor(ask.prompt), { q: cmd.arg || pl(ask.q) });
  const how = cmdIs(cmd, 'browse') ? pr('cmdBrowse') : pr('cmdAct');
  return `${pl('[Command] Always fill the {type} widget. {arg}', {
    type: cmd.type,
    arg: cmd.arg ? pl('Content: {arg}', { arg: cmd.arg }) : '',
  })}\n${how}`;
}
const GRADE_WORDS = {
  critSuccess: N_('critical success'),
  success: N_('success'),
  fail: N_('failure'),
  critFail: N_('critical failure'),
};
function rollBlock(roll) {
  return !roll
    ? ''
    : roll.fixed
      ? fillTemplate(pr('roll'), { result: pl(GRADE_WORDS[rollGrade(roll)]), d: roll.d, p: roll.p })
      : roll.d != null
        ? fillTemplate(pr('rollFree'), { d: roll.d })
        : '';
}
const ifAny = (items, f) => (items.length ? f(items.join(' | ')) : '');
// the player's notes: the Memory tab's box, then each ticked library note under its own name
const noteHead = n => `\n\n${pl('[Note: {name}]', { name: n.name })}\n`;
function userBlock(memo, notes) {
  if (!memo && !notes.length) return '';
  const head = pl('[Player notes: always follow]') + (memo ? '\n' + memo : '');
  return head + notes.map(n => noteHead(n) + n.text).join('');
}
// the notes' part of that block in bytes: what the size error and the meter count
export const notesBytes = notes => notes.reduce((a, n) => a + utf8Bytes(noteHead(n)) + n.bytes, 0);
// a scenario save's note, whole, right after the base rules; like the ticked notes it is never cut
const scenarioBlock = n => (n ? `${pl('[Scenario: {name}]', { name: n.name })}\n${n.text}` : '');
// the prose style: a note's text under its name, else the chosen style's prompts.json text (none for the default)
function styleBlock() {
  if (app.state.style !== STYLE.NOTE) return (prFor('styles') || {})[app.state.style] || '';
  const n = styleNote();
  return n
    ? `${pl('[Prose style: {name}] The prose style the player chose. Write the narration this way:', { name: n.name })}\n${n.text}`
    : '';
}
// a scenario save's player character, in place of the roguelike's [Player] line, with any titles its story granted
function personaBlock(l) {
  const fx = app.state.titleFx || {};
  const titles = (app.state.titles || []).map(t => `${t}${fx[t] ? `(${fx[t]})` : ''}`);
  return (
    pl('[Player character] {name}, {gender}', { name: l.name, gender: plLabel(GENDER_LABEL, l.gender) }) +
    (titles.length ? pl(', titles {list}', { list: titles.join(', ') }) : '')
  );
}
// a scenario summary's word on the lists its save keeps (the ledger, inventory, skills), only those it has
export function trackedLine(st = app.state) {
  const has = [
    Object.keys(st.ledger || {}).length && pl('the ledger'),
    (st.items || []).length && pl('the inventory'),
    st.skills.length && pl('the skills'),
  ].filter(Boolean);
  return has.length
    ? ' ' + pl('Do not repeat the numbers and lists tracked separately: {list}.', { list: has.join(', ') })
    : '';
}
// A scenario save's numbers, gear and skills in plain words (no power grade, human range or skill grades), each only
// once the story has some: the stats once a reply changed one (state.statsUsed, apply.js)
function scenarioBlocks() {
  const st = app.state,
    s = st.stats,
    E = st.energy;
  const stat =
    st.statsUsed || E
      ? pl(
          '[Stats] HP {hp}/{maxHp}, Constitution {con} Strength {str} Magic {mag} Agility {agi} Intelligence {int} Charm {cha}, money {money}, fame {fame}',
          { ...s, money: moneyText(s.gold, st.life, promptLang()) },
        ) + (E ? `, ${E.name} ${E.cur}/${E.max}` : '')
      : '';
  const skills = st.skills.map(
    k => `${k.name}(Lv.${k.lv || 1}${k.cost ? pl(', cost {n}%', { n: k.cost }) : ''}): ${k.desc}`,
  );
  const gear = (st.equipped || []).map(n => {
    const it = (st.items || []).find(x => x.name === n) || {};
    return `${n}${it.note ? `(${it.note.slice(0, 40)})` : ''}`;
  });
  const inv = (st.items || []).map(
    it =>
      `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}${it.note && !(st.equipped || []).includes(it.name) ? ': ' + it.note.slice(0, 30) : ''}`,
  );
  return {
    stat,
    skill: ifAny(skills, list => `${pl('[Skills]')} ${list}`),
    gear: ifAny(gear, list => pl('[Gear] {list}', { list })),
    inv: ifAny(inv, list => pl('[Inventory] {list}', { list })),
  };
}
// what the ticked notes take of the prompt's limit (0 when not known yet)
export function notesShare(ids) {
  const bytes = notesBytes(pickedNotes({ noteIds: ids }));
  const max = (platform.limits && platform.limits.maxPromptBytes) || 0;
  return { bytes, max, heavy: !!max && bytes > max / 3 };
}
// fixed: the scenario and prose style note text that goes with the ticked notes
const notesTooLarge = (notes, max, fixed = '') =>
  Object.assign(
    new Error(
      fixed
        ? T(
            "Your notes ({kb}: the scenario or prose style note and the ticked notes) don't fit in this model's prompt ({max}) with the story, so nothing was sent. Shorten them, or untick some notes in the Memory tab, then try again.",
            { kb: kb(notesBytes(notes) + utf8Bytes(fixed)), max: kb(max) },
          )
        : T(
            "The ticked notes ({kb}) don't fit in this model's prompt ({max}) with the story, so nothing was sent. Untick or shorten some in the Memory tab, then try again.",
            { kb: kb(notesBytes(notes)), max: kb(max) },
          ),
    ),
    { code: 'notes_too_large', shown: true },
  );

// turn: what runTurn rolled for this reply (roll, luck, fate) and what a rewrite must fix (redo)
export function buildPrompt(text, cmd, turn = {}) {
  const { roll = null, luck = null, fate = null, redo = '' } = turn;
  const l = app.state.life,
    ck = app.state.clock;
  let win = windowOf(recentBudget());
  const recentStr = recentForPrompt(win.rows);
  const hay = recentStr.slice(-3000) + ' ' + text;
  const notes = pickedNotes();
  const sets = charSets(),
    ix = cardIndex(sets),
    own = rosterCards(ix);
  const people = peopleInPlay(hay, sets, ix);
  const loreHay = hay + ' ' + ((app.state.standing || {}).faction || ''); // the player's own sect stays in view
  const lore = Object.entries(app.state.lore)
    .filter(([k]) => loreHay.includes(k))
    .slice(0, 15);
  const vocab = placeVocab();
  const d = lifeDiff(l);
  const P = {
    adminp: adminBlock(),
    // the adjective describes the world's demands, not the narrator's attitude
    world: pl(
      "[World] {name}{desc}: {risk}. {opp}. This life's difficulty {d}/5: enemies, rivals and the world's standards and demands are {adj}.",
      {
        name: l.world.name,
        desc: l.world.desc ? ` (${l.world.desc})` : '',
        risk: l.world.risk,
        opp: l.world.opp,
        d,
        adj: d >= 5 ? pl('on the harsh side') : d <= 1 ? pl('on the lenient side') : pl('correspondingly high'),
      },
    ),
    me: meBlock(),
    cheat: prFor('cheat'), // always on: asserting things you do not have is a lie inside the fiction
    growth: (() => {
      const k = growthLevel().key;
      return k ? (prFor('growth') || {})[k] || '' : '';
    })(),
    know: rule('knowledgeGuard') !== false ? pr('knowledge') : '', // the player always brings knowledge from outside this world (their own, a past life, the character's origin); the rule is about the process, not the source
    profile: l.profile
      ? pl("[Player profile: always reflect it in this character's story and personality] {profile}", {
          profile: l.profile,
        })
      : '',
    entry:
      l.entry === 'possess'
        ? pr('entryPossess')
        : l.entry === 'transfer'
          ? fillTemplate(pr('entryTransfer'), { from: l.world.from || pl('modern-day Earth') })
          : '',
    sponsor: l.sponsor
      ? fillTemplate(app.state.channelOpen ? prFor('sponsorOpen') : prFor('sponsorClosed'), {
          stance: plLabel(STANCE_LABEL, l.sponsor.stance),
        })
      : '',
    stat: statBlock(),
    ext: extBlock(),
    clock: `${pl('[Time]')} D+${ck.day}${ck.date ? ', ' + withWeekday(ck.date) : ''}${ck.time ? ', ' + ck.time : ''}${ck.weather ? ', ' + ck.weather : ''}${ck.place ? ', ' + ck.place : ''}`,
    skill: `${pl('[Skills]')} ${app.state.skills.map(k => `${k.name}(${k.grade}, Lv.${k.lv || 1}${k.cost ? pl(', cost {n}%', { n: k.cost }) : ''}${k.src === SKILL_SRC.INHERITED ? pl(', inherited from a past life') : ''}): ${k.desc}`).join(' | ') || pl('None')}`,
    note: app.state.stateNote ? pl('[Current situation] {note}', { note: app.state.stateNote }) : '',
    quest: ifAny(
      app.state.quests.filter(q => q.status === 'active').map(q => q.title + (q.note ? ` (${q.note})` : '')),
      list => pl('[Active quests] {list}', { list }),
    ),
    ledger: ifAny(
      Object.entries(app.state.ledger || {}).map(([k, v]) => `${k}: ${v}`),
      list => pl('[Ledger] {list}', { list }),
    ),
    gear: ifAny(
      (app.state.equipped || []).map(n => {
        const it = (app.state.items || []).find(x => x.name === n) || {};
        return `${n}(${it.grade || '-'}${it.power ? ', +' + it.power : ''}${it.note ? ': ' + it.note.slice(0, 40) : ''})`;
      }),
      list => pl('[Gear] {list}', { list }),
    ),
    inv: ifAny(
      (app.state.items || []).map(
        it =>
          `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}${it.grade ? '(' + it.grade + ')' : ''}${it.note && !(app.state.equipped || []).includes(it.name) ? ': ' + it.note.slice(0, 30) : ''}`,
      ),
      list => pl('[Inventory] {list}', { list }),
    ),
    rel: relationsBlock(),
    lore: ifAny(
      lore.map(([k, v]) => `${k}: ${v}`),
      list => pl('[Related lore] {list}', { list }),
    ),
    past: ifAny(
      app.state.pastLives.slice(-5).map(p =>
        pl('life {n}: {world}/{origin} ({tier}), {epitaph}', {
          n: p.lifeNo,
          world: p.world,
          origin: p.origin,
          tier: p.tier,
          epitaph: p.epitaph,
        }),
      ),
      list => pl('[Past lives] {list}', { list }),
    ),
    sum: app.state.summaries.length
      ? `${pl('[Story so far]')}\n${app.state.summaries.map(x => '- ' + x.text).join('\n')}`
      : '',
    user: userBlock(app.state.userNotes, notes),
    named: namedBlock(hay, turn, sets, own),
    profiles: profilesBlock(people, own),
    situation: situationBlock(people),
    bg: pl('[Place words] {list}', { list: vocab.length ? vocab.join(', ') : pl('none. scene is null') }),
    recent: recentBlock(recentStr),
    widgets: widgetsBlock(cmd),
    cmd: cmdBlock(cmd),
    redo: redo ? fillTemplate(pr('redo'), { reason: redo }) : '',
    errata:
      app.state.errataNote && !cmdIs(cmd, 'browse')
        ? fillTemplate(
            pr('errata') ||
              pl(
                '[Correction] An error in the earlier record was fixed: {fact}. Smooth it over naturally in a sentence or two at the start of this reply.',
              ),
            { fact: app.state.errataNote },
          )
        : '',
    corr: (app.state.corrections || []).filter(c => c.until >= app.state.next).length
      ? `${pr('corrHead')}\n${app.state.corrections
          .filter(c => c.until >= app.state.next)
          .map(c => '- ' + c.text)
          .join('\n')}`
      : '',
    fate: fate ? prFor('fateHead') + (fate === 'jackpot' ? pr('fateJackpot') : prFor('fateDoom')) : '',
    luck: luck === 'bad' ? pr('luckBad') || '' : luck === 'good' ? pr('luckGood') || '' : '',
    nodice: rule('dice') === false ? pr('noDice') || '' : '',
    jcore: roll || (cmd && cmd.type === 'judge') ? pr('judgeCore') || '' : '',
    roll: rollBlock(roll),
    input: `${pl('[This input] {text}', { text })}\n\n${pr('jsonTail')}`,
  };
  const scen = isScenario();
  if (scen) {
    for (const k of ROGUELIKE_ONLY) P[k] = '';
    Object.assign(P, scenarioBlocks());
    P.scenario = scenarioBlock(scenarioNote());
    P.me = personaBlock(l);
    P.nodice = rule('dice') === false ? '' : pr('scenarioDice'); // the odds on choices the roguelike's rules ask for
    P.adminp = P.adminp && [P.adminp, pr('scenarioAdmin')].join('\n'); // the reply fields its rules leave out
    if (P.ext) P.ext = [pr('scenarioExt'), P.ext, ladderStart()].filter(Boolean).join('\n');
  }
  const LEN = { short: pr('lenShort'), normal: '', long: pr('lenLong') }[setting('len')] || '';
  const noChoices = choicesOff() ? pr('noChoices') : '';
  const tip = app.settings.langTip ? prLang('tip') : '';
  const extra = prLang(scen || !adminOn() ? 'scenarioLang' : 'lang') + (tip ? pl('\n[Extra output field] ') + tip : '');
  const style = styleBlock(); // after the language block, whose plain prose it replaces
  const base = prFor('rules') || '';
  const rulesWith = st => withPlayerSettings(base, [LEN, noChoices, extra, st].filter(Boolean).join('\n'));
  let rules = rulesWith(style);
  const build = skip =>
    rules +
    '\n\n' +
    PROMPT_ORDER.filter(k => P[k] && !skip.includes(k))
      .map(k => P[k])
      .join('\n\n');
  let p = build([]);
  const max = (platform.limits && platform.limits.maxPromptBytes) || 0;
  const room = max * 0.9; // the request id and a retry's format line still fit
  if (max && utf8Bytes(p) > room) {
    const skip = ['lore', 'bg', 'past'];
    p = build(skip);
    // then fewer recent turns, down to six rows; the notes are never cut
    let size = utf8Bytes(p);
    if (size > room && win.rows.length > 6) {
      while (size > room && win.rows.length > 6) {
        const was = utf8Bytes(P.recent);
        win = windowOf(win.used - (size - room));
        P.recent = recentBlock(recentForPrompt(win.rows));
        size -= was - utf8Bytes(P.recent);
      }
      p = build(skip);
      size = utf8Bytes(p);
    }
    // when the notes (with a scenario and a prose style note) alone take the prompt over, nothing is sent
    const fixed = (P.scenario || '') + (styleNote() ? style : '');
    if ((notes.length || fixed) && size > room) {
      P.user = userBlock(app.state.userNotes, []);
      P.scenario = '';
      if (styleNote()) rules = rulesWith('');
      if (utf8Bytes(build(skip)) <= room) throw notesTooLarge(notes, max, fixed);
    }
  }
  const rows = win.rows;
  sent =
    app.currentSave && rows.length ? { save: app.currentSave.id, from: rows[0].i, to: rows[rows.length - 1].i } : null;
  return p;
}

const FATAL = [
  'not_granted',
  'rate_limited',
  'refused',
  'cancelled',
  'sampling_disabled',
  'session_expired',
  'prompt_too_large',
];
export let promptStats = []; // estimated tokens of the last prompts, for the settings tab
export let lastPrompt = ''; // the last narrator prompt as sent, in memory only, for the settings tab
// one id per send: a retry of the same send reuses it, so an answer that finished while the page was away replays at no cost; anything else (a new send, a rewrite, a branch) gets a new id and never sees an old answer
const REPLAY = { gcTime: 3600000 };
const STALE_REQ = new Set(); // request ids whose cached answer was unusable: the next try asks for a fresh one
// What a reply still streaming already says: the fields the live box shows early. A field not yet complete is null,
// except the narration, which is read as far as it has come. sceneReady: enough is in to pick the banner and the face.
export function peekReply(text) {
  const str = k => {
    const m = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
  };
  const scene = str('scene'),
    speaker = str('speaker'),
    emotion = str('emotion');
  const narration = /"narration"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
  return {
    scene,
    speaker,
    emotion,
    gender: str('speaker_gender'),
    role: str('speaker_role'),
    weight: str('speaker_weight'),
    time: str('time'),
    hidden: /"speaker_hidden"\s*:\s*true/.test(text),
    look: ((/"speaker_look"\s*:\s*\[([^\]]*)\]/.exec(text) || [])[1] || '')
      .replace(/"/g, '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean),
    admin: str('admin'),
    narration: narration ? narration[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null,
    sceneReady:
      scene !== null &&
      (speaker !== null || /"speaker"\s*:\s*null/.test(text)) &&
      (emotion !== null || /"admin"/.test(text)),
  };
}
// turn: the reply being written (turn.js runTurn); its request id, its stop handle, and what to do as it streams (turn.onText)
export async function callNarrator(text, cmd, turn) {
  const req = turn.req;
  if (!(await notesReady())) throw Object.assign(new Error(T(NOTES_UNREAD)), { code: 'notes_unread', shown: true });
  if (app.state.style === STYLE.NOTE && !styleNote())
    throw Object.assign(new Error(T(STYLE_GONE)), { code: 'style_note_gone', shown: true });
  const prompt = buildPrompt(text, cmd, turn) + (req ? `\n(req ${req})` : '');
  lastPrompt = prompt;
  const cacheOpt = () => (!req ? false : STALE_REQ.has(req) ? Object.assign({ refresh: true }, REPLAY) : REPLAY);
  const stale = () => {
    if (req) STALE_REQ.add(req);
  };
  try {
    const tok = Math.round(utf8Bytes(prompt) / 2.6);
    promptStats.push(tok);
    promptStats = promptStats.slice(-20);
  } catch {
    // prompt size stats are diagnostics only
  }
  const onText = turn.onText; // what to do with the reply as it streams (turn.js streamedReply)
  const ok = o => o && (String(o.narration || '').trim().length > 0 || o.widget);
  const signal = turn.abort && turn.abort.signal;
  try {
    const o = normalize(
      await platform.sample.json(prompt, {
        modelTier: setting('tier'),
        cache: cacheOpt(),
        onText,
        signal,
      }),
    );
    if (ok(o)) return o;
    stale();
    logErr('json', {
      code: 'empty_narration',
      message: 'JSON without narration',
      text: JSON.stringify(o).slice(0, 300),
    });
  } catch (e) {
    logErr('json', e);
    if (e && FATAL.includes(e.code)) throw e;
    if (e && e.text) {
      const j = extractJson(e.text);
      if (j && ok(normalize(j))) return normalize(j);
    }
  }
  {
    // fallback 1: plain text mode, then pull the JSON out ourselves
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    try {
      const r = await platform.sample(prompt + '\n\n' + pr('fallbackText'), {
        modelTier: setting('tier'),
        cache: cacheOpt(),
        onText,
        signal,
      });
      const j = extractJson((r && r.text) || '');
      if (j && ok(normalize(j))) return normalize(j);
      stale();
      logErr('text', { code: 'no_json', message: 'text reply without usable JSON', text: r && r.text });
    } catch (e2) {
      logErr('text', e2);
      if (e2 && FATAL.includes(e2.code)) throw e2;
    }
    // fallback 2: compact retry on the quick tier
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    try {
      const r = await platform.sample(prompt + '\n\n' + pr('fallbackCompact'), {
        modelTier: 'quick',
        cache: false,
        signal,
      });
      const j = extractJson((r && r.text) || '');
      if (j && ok(normalize(j))) return normalize(j);
      logErr('compact', { code: 'no_json', message: 'compact reply without usable JSON', text: r && r.text });
    } catch (e3) {
      logErr('compact', e3);
      if (e3 && FATAL.includes(e3.code)) throw e3;
    }
    throw Object.assign(new Error(T("Couldn't read the reply (see ⚙ → Recent errors)")), {
      code: 'no_json',
      shown: true,
    });
  }
}
export function extractJson(t) {
  if (!t) return null;
  t = String(t).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'),
    b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  const body = t.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    // not plain JSON: try the lenient form below
  }
  try {
    return JSON.parse(body.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' '));
  } catch {
    // still not JSON: try closing a truncated object below
  }
  // truncated output: close open strings/brackets and retry
  let fixed = body;
  const q = (fixed.match(/(?<!\\)"/g) || []).length;
  if (q % 2) fixed += '"';
  let depth = 0;
  for (const ch of fixed) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  fixed = fixed.replace(/,\s*$/, '');
  while (depth-- > 0) fixed += '}';
  try {
    return JSON.parse(fixed);
  } catch (e) {
    return null;
  }
}
const noDash = t =>
  String(t)
    .replace(/\s*—+\s*/g, m => (/\s$/.test(m) && /^\s/.test(m) ? ', ' : ', '))
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s*,\s*\)/g, ')');
export function normalize(o) {
  if (!o || typeof o !== 'object') o = {};
  o.narration = noDash(o.narration || '');
  o.admin = noDash(o.admin || '');
  o.system = Array.isArray(o.system) ? o.system.map(x => noDash(x)).slice(0, LIMITS.perReply.system) : [];
  o.choices =
    Array.isArray(o.choices) && !choicesOff() ? o.choices.map(x => noDash(x)).slice(0, LIMITS.perReply.choices) : [];
  if (o.widget && typeof o.widget === 'object') {
    const walk = v =>
      typeof v === 'string'
        ? noDash(v)
        : Array.isArray(v)
          ? v.map(walk)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
            : v;
    o.widget = walk(o.widget);
  }
  if (o.widget && !widgetOf(o.widget)) o.widget = null;
  if (o.reasons && typeof o.reasons === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o.reasons).slice(0, LIMITS.perReply.reasons))
      if (v) r[String(k).slice(0, LIMITS.text.statKey)] = String(v).slice(0, LIMITS.text.reason);
    o.reasons = r;
  } else o.reasons = {};
  o.windfall = o.windfall === true;
  if (o.check && (typeof o.check !== 'object' || !(Number(o.check.p) > 0))) o.check = null;
  o.also_present = Array.isArray(o.also_present)
    ? o.also_present.filter(p => p && typeof p === 'object' && p.name).slice(0, LIMITS.perReply.alsoPresent)
    : [];
  o.speaker_hidden = o.speaker_hidden === true;
  o.ledger = o.ledger && typeof o.ledger === 'object' && !Array.isArray(o.ledger) ? o.ledger : null;
  if (app.state && rule('dice') === false && Array.isArray(o.choices))
    o.choices = o.choices.map(c => stripOdds(c).trim());
  o.items = Array.isArray(o.items)
    ? o.items.filter(x => x && typeof x === 'object' && x.name).slice(0, LIMITS.perReply.items)
    : [];
  o.equip = Array.isArray(o.equip) ? o.equip.map(String) : [];
  o.unequip = Array.isArray(o.unequip) ? o.unequip.map(String) : [];
  return o;
}
