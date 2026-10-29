/* ============ situations: the library's situation dictionary (ARCHITECTURE.md, 상황 그림) ============ */
import { clone, nowIso } from './util.js';
import { platform, sget } from './db.js';
import { app } from './app.js';
import { uiLang } from './i18n.js';

const PATH = 'config/situations';
// i18n-ignore-start: the starting entries are library data, Korean with Japanese labels and English hints
export const SIT_DEFAULTS = {
  battle: {
    label: '싸움',
    label_ja: '戦闘',
    hint: '싸우거나 무공, 마법을 쓰는 중일 때',
    hint_en: 'fighting, or using martial arts or magic',
  },
  injured: { label: '부상', label_ja: '負傷', hint: '다쳤거나 피를 흘릴 때', hint_en: 'hurt or bleeding' },
  eating: {
    label: '식사',
    label_ja: '食事',
    hint: '먹거나 마실 때, 술자리 포함',
    hint_en: 'eating or drinking, a drinking party included',
  },
  sleep: {
    label: '잠',
    label_ja: '睡眠',
    hint: '자거나 누워 있을 때, 잠옷 포함',
    hint_en: 'asleep or lying in bed, sleepwear included',
  },
  bath: { label: '목욕', label_ja: '入浴', hint: '목욕하거나 물가에 있을 때', hint_en: 'bathing, or in or by water' },
  hug: { label: '포옹', label_ja: '抱擁', hint: '안거나 안길 때', hint_en: 'hugging or being hugged' },
  kiss: { label: '입맞춤', label_ja: 'キス', hint: '입을 맞출 때', hint_en: 'kissing' },
  formal: {
    label: '예복',
    label_ja: '礼装',
    hint: '연회, 의식, 격식 있는 자리',
    hint_en: 'a banquet, a ceremony, a formal occasion',
  },
  undress: { label: '알몸', label_ja: '裸', hint: '알몸이나 속옷 차림', hint_en: 'nude or in underwear', adult: true },
  nsfw: { label: '성인', label_ja: '成人', hint: '성인 장면', hint_en: 'adult scenes', adult: true, parent: 'undress' },
};
// i18n-ignore-end
export const SIT_MAX = { label: 20, hint: 80 };
export const SIT_KEY_RE = /^[a-z][a-z0-9 _-]{0,23}$/;
export const sitKey = v =>
  String(v == null ? '' : v)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

let ver = 0;
let loaded = false; // false after a failed read: a save then would overwrite the stored dictionary with the defaults
export const sitVer = () => ver;
export const sitDict = () => app.situations || SIT_DEFAULTS;
export const sitKeys = () => Object.keys(sitDict());

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
// one entry as stored: unknown fields drop, adult only when true; cleanDict checks the parent
export function cleanSit(e) {
  const o = {};
  for (const f of ['label', 'label_ja']) if (str(e && e[f], SIT_MAX.label)) o[f] = str(e[f], SIT_MAX.label);
  for (const f of ['hint', 'hint_en']) if (str(e && e[f], SIT_MAX.hint)) o[f] = str(e[f], SIT_MAX.hint);
  if (e && e.adult === true) o.adult = true;
  if (e && sitKey(e.parent)) o.parent = sitKey(e.parent);
  return o;
}
// a parent must be another entry, and following parents must never come back around
export function cleanDict(d) {
  const out = {};
  for (const [k, e] of Object.entries(d && typeof d === 'object' ? d : {})) {
    const key = sitKey(k);
    if (SIT_KEY_RE.test(key) && !out[key]) out[key] = cleanSit(e);
  }
  for (const [k, e] of Object.entries(out)) {
    const seen = new Set([k]);
    for (let p = e.parent; p; p = out[p] && out[p].parent) {
      if (!out[p] || seen.has(p)) {
        delete e.parent;
        break;
      }
      seen.add(p);
    }
  }
  return out;
}
function use(d) {
  app.situations = d;
  ver++;
}
// a missing document is the starting dictionary
export async function loadSituations() {
  try {
    const d = await sget(PATH);
    use(d && d.items ? cleanDict(d.items) : clone(SIT_DEFAULTS));
    loaded = true;
  } catch (e) {
    use(clone(SIT_DEFAULTS));
    loaded = false;
    throw e;
  }
}
export const situationsStored = async () => !!(await sget(PATH));
export async function saveSituations(d) {
  if (!loaded) {
    await loadSituations();
    const err = new Error('the situation dictionary was not read');
    err.code = 'unread';
    throw err;
  }
  const next = cleanDict(d);
  await platform.shared.doc(PATH).set({ items: next, updatedAt: nowIso() });
  use(next);
}

// the parent, its parent and so on (cleanDict leaves no loops)
export function sitAncestors(k) {
  const d = sitDict(),
    out = [];
  for (let p = (d[k] || {}).parent; p && d[p] && !out.includes(p); p = d[p].parent) out.push(p);
  return out;
}
export const sitRoot = k => sitAncestors(k).pop() || k;
// adult when it or any parent above it is
export const isAdultSit = k => [k, ...sitAncestors(k)].some(a => !!(sitDict()[a] || {}).adult);
// every key with its children right after it, and how deep it sits
export function sitTree() {
  const d = sitDict(),
    out = [];
  const add = (k, depth) => {
    out.push([k, depth]);
    for (const c of Object.keys(d)) if (d[c].parent === k) add(c, depth + 1);
  };
  for (const k of Object.keys(d)) if (!d[k].parent || !d[d[k].parent]) add(k, 0);
  return out;
}
// on screen: the Korean or Japanese label, the key itself in English
export function sitLabel(k, lang = uiLang()) {
  const e = sitDict()[k] || {};
  return (lang === 'ko' ? e.label : lang === 'ja' ? e.label_ja || e.label : '') || k;
}
// for the narrator: a Korean story reads hint, the others hint_en
export function sitHint(k, lang) {
  const e = sitDict()[k] || {};
  return (lang === 'ko' ? e.hint || e.hint_en : e.hint_en || e.hint) || '';
}
// what a reply or a file names: a key, or a label in any language
export function sitKeyOf(v) {
  const d = sitDict(),
    k = sitKey(v);
  if (!k) return '';
  if (d[k]) return k;
  return Object.keys(d).find(x => [d[x].label, d[x].label_ja].some(l => l && sitKey(l) === k)) || '';
}
// a frame's situations: its own list, the keys still in the dictionary
export function frameSits(x) {
  const d = sitDict();
  const own = Array.isArray(x && x.situations) ? x.situations : [];
  return [...new Set(own.map(sitKey))].filter(k => d[k]);
}
export function setFrameSits(x, list) {
  const keep = [...new Set(list.map(sitKey).filter(Boolean))];
  if (keep.length) x.situations = keep;
  else delete x.situations;
}
// The tag words v2.17.1 read as situations ('formal' was a look then and stays one). library.js moves them into a
// frame's situations once per library, and importTags does the same for a pack from before situations.
const OLD_SIT_TAGS = ['battle', 'injured', 'eating', 'sleep', 'bath', 'hug', 'kiss', 'nsfw'];
// true when the frame changed
export function tagsToSits(x) {
  if (!x || x.kind !== 'char') return false;
  const d = sitDict();
  const old = (x.tags || []).filter(t => OLD_SIT_TAGS.includes(sitKey(t)) && d[sitKey(t)]);
  if (!old.length) return false;
  x.tags = x.tags.filter(t => !old.includes(t));
  setFrameSits(x, [...(x.situations || []), ...old]);
  return true;
}
