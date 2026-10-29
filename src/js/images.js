/* ============ images: lookups over the image library (by id, character sets, worlds, portraits) ============ */
import { host } from './host.js';
import { esc, pick } from './util.js';
import { EMO_FB, WORLD_ALIAS, WORLDS } from './data.js';
import { frameSits, isAdultSit, sitAncestors, sitKeyOf, sitVer } from './situations.js';
import { SCENARIO_WORLD } from './enums.js';
import { app } from './app.js';
import { canonName } from './people.js';
import { T } from './i18n.js';
import { openSheet } from './sheet.js';

export const imgUrl = id => host().assetUrl(id);
// A picture in the sheet, from a tap in the image tab or in the story, where it opens at twice its shown width.
// A tap anywhere on it closes it.
export function showBigImage(id, caption, shown = 0) {
  const w = Math.round(shown * 2);
  openSheet(
    `<div class="big-image" data-close><img src="${imgUrl(id)}" alt="" class="big-image-pic"${w ? ` style="width:${w}px"` : ''}>${caption ? `<p class="muted big-image-cap">${esc(caption)}</p>` : ''}<div class="row actions centered"><button class="btn" data-close>${T('Close')}</button></div></div>`,
    { center: true, zoom: !!w },
  );
}
// picture file extensions and their types: what a zip upload takes, and the extension an exported pack gives each type
export const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};
export function sceneHtml(sc, people) {
  // background banner on top, the people present in a row underneath (never layered)
  const ppl = (people || []).filter(p => p && p.x).slice(0, 3);
  const bg = sc
    ? `<div class="scene" data-big="${esc(sc.id)}" style="background-image:url('${imgUrl(sc.id)}')"></div>`
    : '';
  const row = ppl.length
    ? `<div class="castrow n${ppl.length}">${ppl.map(p => `<figure><img class="char" alt="" data-big="${esc(p.x.id)}" data-cap="${esc(p.npc || '')}" src="${imgUrl(p.x.id)}">${p.npc ? `<figcaption>${esc(p.npc)}</figcaption>` : ''}</figure>`).join('')}</div>`
    : '';
  return bg + row;
}
export function turnPeople(ti, o) {
  // [{x,npc}] for a turn, main speaker first; older turns only have img.char
  const list =
    Array.isArray(ti.chars) && ti.chars.length ? ti.chars : ti.char ? [{ id: ti.char, npc: o.speaker || '' }] : [];
  return list.map(c => ({ x: turnImg(ti, c.id), npc: canonName(c.npc || ''), hidden: !!c.hidden })).filter(p => p.x);
}
// a picture's content keys (ARCHITECTURE.md, 저장 파일 내보내기)
export const picKeys = x => [
  ...new Set([x.shash, x.hash].filter(h => typeof h === 'string' && h).map(h => h.slice(0, 16))),
];
const listOf = v => (Array.isArray(v) ? v.filter(Boolean) : []);
export const aliasKeys = x => listOf(x.akeys);
// the content keys a row keeps for pictures retired in its favor (akeys): the newest first, never its own
export const inheritKeys = (keep, old) => {
  const own = picKeys(keep);
  return [...new Set([...picKeys(old), ...aliasKeys(old), ...aliasKeys(keep)])]
    .filter(k => !own.includes(k))
    .slice(0, 6);
};
// bumped on every write of the list (library.js), since rows also change in place; what is built from the list keys on it
let ver = 0;
export const imagesChanged = () => ver++;
export const imagesVer = () => ver;
let IX = null;
function imgIndex() {
  const list = app.images;
  if (IX && IX.list === list && IX.n === list.length && IX.ver === ver) return IX;
  IX = { list, n: list.length, ver, id: new Map(), key: new Map() };
  const aliased = [];
  for (const x of list) {
    if (!IX.id.has(x.id)) IX.id.set(x.id, x);
    for (const k of picKeys(x)) if (!IX.key.has(k)) IX.key.set(k, x);
    if (x.akeys) aliased.push(x);
  }
  // after every row's own keys, so a picture that is really here wins over an alias
  for (const x of aliased) for (const k of aliasKeys(x)) if (!IX.key.has(k)) IX.key.set(k, x);
  return IX;
}
export function imgById(id) {
  if (!id) return null;
  const ix = imgIndex();
  const m = (app.settings.dupMap || {})[id];
  return ix.id.get(id) || (m && ix.id.get(m)) || null;
}
// the content keys a turn from another install carries for one of its picture ids
export const turnKeys = (ti, id) => {
  const k = ti && ti.keys && ti.keys[id];
  return Array.isArray(k) ? k : [];
};
// a picture a turn names (ti: the turn's img): by content key first, then by id
export function turnImg(ti, id) {
  const keys = turnKeys(ti, id);
  if (!keys.length) return imgById(id);
  const ix = imgIndex();
  for (const k of keys) if (ix.key.has(k)) return ix.key.get(k);
  const x = ix.id.get(id);
  // no key matched, so a hashed row under this id is another picture; a dedupe redirect is the same picture
  if (x) return x.shash || x.hash ? null : x;
  return imgById(id);
}
export const picIds = ti =>
  [
    ti.scene,
    ti.char,
    ...listOf(ti.chars).map(c => c.id),
    ...listOf(ti.places).map(p => p.id),
    ...listOf(ti.opening),
    ti.banner,
  ].filter(Boolean);
// Openings are marked by tags on any kind of picture (ARCHITECTURE.md, 오프닝): opening or opening:<name> makes it a
// frame of that sequence, order:<n> its place; game-master marks the banner shown when no sequence fits.
const OPENING_RE = /^opening(?:\s*[:：]\s*(.*))?$/i;
const ORDER_RE = /^order\s*[:：]\s*(\d+)$/i;
const tagList = x => (x && Array.isArray(x.tags) ? x.tags.map(t => String(t).trim()) : []);
// the sequence a frame belongs to ('' for plain opening), or null for any other picture
export function openingSeq(x) {
  for (const t of tagList(x)) {
    const m = OPENING_RE.exec(t);
    if (m) return (m[1] || '').trim();
  }
  return null;
}
export const isOpening = x => openingSeq(x) !== null;
export const isGameMaster = x => tagList(x).some(t => t.toLowerCase() === 'game-master');
// the tags the game itself reads (opening, order, game-master), kept when look tags are redone
export const isSystemTag = t => {
  const s = String(t).trim();
  return OPENING_RE.test(s) || ORDER_RE.test(s) || s.toLowerCase() === 'game-master';
};
const orderOf = x => {
  const m = tagList(x)
    .map(t => ORDER_RE.exec(t))
    .find(Boolean);
  return m ? +m[1] : Infinity;
};
const fileOf = x => String(x.file || x.name || '');
// order:<n> first, then file names in natural order (panel 2 before panel 10)
const byOrder = (a, b) =>
  orderOf(a) - orderOf(b) || fileOf(a).localeCompare(fileOf(b), undefined, { numeric: true, sensitivity: 'base' });
// tags making a picture frame n of a sequence, in place of any opening tags it had
export const withOpeningTags = (tags, seq, n) => [
  seq ? 'opening:' + seq : 'opening',
  ...(n >= 1 ? ['order:' + Math.floor(n)] : []),
  ...(Array.isArray(tags) ? tags : []).filter(
    t => !OPENING_RE.test(String(t).trim()) && !ORDER_RE.test(String(t).trim()),
  ),
];
// v2.16.4 stored openings as their own kind (set: the sequence, order: the number); such a row becomes a tagged scene
export function openingKindToTags(x) {
  if (!x || x.kind !== 'opening') return x;
  x.tags = withOpeningTags(x.tags, x.set || '', x.order);
  x.kind = 'scene';
  delete x.set;
  delete x.order;
  return x;
}
// the sequence name ('' for the unnamed one) -> its frames in order
export function openingSets() {
  const m = {};
  for (const x of app.images) {
    const k = openingSeq(x);
    if (k !== null) (m[k] = m[k] || []).push(x);
  }
  for (const k in m) m[k].sort(byOrder);
  return m;
}
// a sequence fits every world any of its frames names (none: every world); a retired frame retires the sequence
export const openingWorlds = frames => [...new Set(frames.flatMap(worldsOf))];
export const openingOff = frames => frames.some(x => x.off);
// The first turn of a life: a sequence that fits the world, else a picture tagged game-master, else the admin set's
// picture. Stored on the turn's img as opening (frame ids) or banner (one id).
// noAdmin: a scenario save, which has no ADMIN to fall back on
export function openingFor(w, noAdmin = false) {
  const seqs = Object.values(openingSets()).filter(f => !openingOff(f) && fitsWorld({ worlds: openingWorlds(f) }, w));
  if (seqs.length) return { opening: pick(seqs).map(x => x.id) };
  // a face is labelled on its set card
  const fits = x => fitsWorld(x, w) && (x.kind !== 'char' || fitsWorld(app.setMeta[x.set || x.name], w));
  const gm = app.images.filter(x => isGameMaster(x) && !x.off && fits(x));
  if (gm.length) return { banner: pick(gm).id };
  if (noAdmin) return null;
  const adm = charSetsAll().admin || [];
  const emo = e => adm.find(x => (x.emotion || 'neutral') === e);
  const a = emo('neutral') || emo('smile') || adm[0];
  return a ? { banner: a.id } : null;
}
// '' when none of its pictures is in the library any more
export function openingHtml(ti) {
  const frames = listOf(ti && ti.opening)
    .map(id => turnImg(ti, id))
    .filter(Boolean);
  const one = !frames.length && ti && ti.banner && turnImg(ti, ti.banner);
  const list = frames.length ? frames : one ? [one] : [];
  if (!list.length) return '';
  return `<div class="opening${one ? ' banner' : ''}">${list.map(x => `<img class="op-frame" alt="" data-big="${esc(x.id)}" loading="lazy" decoding="async" src="${imgUrl(x.id)}">`).join('')}</div>`;
}
// The cover the player chose, else a neutral, smiling or first frame that isn't adult. play: a game screen, where a
// set with only adult frames has none; the image tab still shows one.
export function setCover(k, imgs, play = false) {
  imgs = imgs || charSetsAll()[k] || [];
  const c = (app.setMeta[k] || {}).cover;
  const safe = imgs.filter(x => !adultFrame(x));
  return (
    (c && imgs.find(x => x.id === c)) ||
    safe.find(x => x.emotion === 'neutral') ||
    safe.find(x => x.emotion === 'smile') ||
    safe[0] ||
    (play ? null : imgs[0])
  );
}
export function charSetsAll() {
  const m = {};
  for (const x of app.images) {
    if (x.kind !== 'char' || isOpening(x)) continue;
    const k = x.set || x.name;
    (m[k] = m[k] || []).push(x);
  }
  return m;
}
export function charSets() {
  const m = {};
  for (const x of app.images) {
    if (
      x.kind !== 'char' ||
      x.off ||
      (app.setMeta[x.set || x.name] || {}).off ||
      (x.set || x.name) === 'admin' ||
      isOpening(x)
    )
      continue;
    const k = x.set || x.name;
    (m[k] = m[k] || []).push(x);
  }
  return m;
}
export function genderOf(k) {
  const g = (app.setMeta[k] || {}).gender;
  if (g) return g;
  return /^female/.test(k) ? 'female' : /^male/.test(k) ? 'male' : null;
}
// possess named no background, so the label just drops
export const liveWorldIds = list => [
  ...new Set(
    list
      .map(v => (WORLD_ALIAS[v] ? (v === 'possess' ? null : WORLD_ALIAS[v][0]) : v))
      .filter(v => v && WORLDS.some(o => o.id === v)),
  ),
];
export function worldsOf(x) {
  if (!x) return [];
  let w = x.worlds;
  if (typeof w === 'string')
    w = w
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  if (Array.isArray(w)) return liveWorldIds(w);
  return x.world && x.world !== 'any' && x.world !== 'multi' ? liveWorldIds([x.world]) : [];
}
// an image or set card fits these worlds (ids); none means every world. `world` is the older single label kept in step.
export function setWorlds(x, ids) {
  x.worlds = ids;
  x.world = ids.length === 1 ? ids[0] : ids.length ? 'multi' : 'any';
}
// labels from before the modern world: a hunter picture fits it too, unless it is a monster or fantasy folk
export const withModern = ws =>
  ws.includes('hunter') && !['modern', 'monster', 'fantasy'].some(w => ws.includes(w)) ? [...ws, 'modern'] : ws;
// labels are the source of truth: list every world an image fits. A scenario save with no world fits every picture
export function fitsWorld(x, w) {
  const ws = worldsOf(x);
  return !ws.length || ws.includes(w) || w === SCENARIO_WORLD;
}
export function worldChips(sel, attr) {
  const cur = new Set(sel || []);
  return `<div class="seg world-chips">${WORLDS.map(w => `<button type="button" ${attr}="${w.id}" aria-pressed="${cur.has(w.id)}" class="chip-sm">${T(w.name)}</button>`).join('')}</div><div class="muted world-chips-note">${T('None selected means every world')}</div>`;
}
export function bgKey(x) {
  return String(x.name || '').replace(/^bg[_-]/, '');
}
const frameWords = x =>
  [...(x.tags || []), x.variant || '']
    .join(' ')
    .toLowerCase()
    .split(/[\s,_]+/)
    .filter(Boolean);
const adultFrame = x => frameSits(x).some(isAdultSit);
// The situations a set has pictures for, an adult frame counting only for its adult ones. The narrator may name one
// for the person (prompt.js situationBlock); computed once per set until the list or the dictionary changes.
let sitMemo = { ver: '', bySet: {} };
export function setSituations(k) {
  const v = ver + ':' + sitVer();
  if (sitMemo.ver !== v) sitMemo = { ver: v, bySet: {} };
  if (sitMemo.bySet[k]) return sitMemo.bySet[k];
  const out = new Set();
  for (const x of charSets()[k] || []) {
    const adult = adultFrame(x);
    for (const s of frameSits(x)) if (!adult || isAdultSit(s)) out.add(s);
  }
  return (sitMemo.bySet[k] = [...out]);
}
// a named situation counts for a set with a picture for it or for a broader one above it, never a narrower one
const situationIn = (k, situation) => {
  const s = sitKeyOf(situation);
  return s && [s, ...sitAncestors(s)].some(c => setSituations(k).includes(c)) ? s : '';
};
export const hasSituation = (k, situation) => !!situationIn(k, situation);
// the feeling, its fallbacks one after another, then neutral; with none of them, the whole list
function nearestEmotion(list, emo) {
  const chain = [];
  for (let e = emo; e && !chain.includes(e); e = EMO_FB[e]) chain.push(e);
  for (const e of [...chain, 'neutral']) {
    const c = list.filter(x => (x.emotion || 'neutral') === e);
    if (c.length) return c;
  }
  return list;
}
// Built for sets of one to three pictures (ARCHITECTURE.md, 상황 그림): the named situation's frames, then each parent's
// own; else the plain frames (no situation), else the frames that aren't adult. An adult frame shows only when an
// adult situation is named.
export function pickEmotion(k, emo, look, situation) {
  const imgs = charSets()[k];
  if (!imgs || !imgs.length) return null;
  const s = situationIn(k, situation);
  const ok = x => !adultFrame(x) || (s && isAdultSit(s));
  const named = s ? [s, ...sitAncestors(s)].map(c => imgs.filter(x => ok(x) && frameSits(x).includes(c))) : [];
  const pool = [...named, imgs.filter(x => !frameSits(x).length), imgs.filter(x => !adultFrame(x))].find(l => l.length);
  if (!pool) return null;
  let c = nearestEmotion(pool, emo);
  const want = (Array.isArray(look) ? look : []).map(x => String(x).toLowerCase()).filter(Boolean);
  if (want.length) {
    const hit = c.filter(x => frameWords(x).some(t => want.includes(t)));
    if (hit.length) c = hit;
  }
  return pick(c);
}
