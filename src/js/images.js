/* ============ images: lookups over the image library (by id, character sets, worlds, portraits) ============ */
import { host } from './host.js';
import { esc, pick } from './util.js';
import { EMO_FB, EMOS, WORLD_ALIAS, WORLDS } from './data.js';
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
export function setCover(k, imgs) {
  imgs = imgs || charSetsAll()[k] || [];
  const c = (app.setMeta[k] || {}).cover;
  return (
    (c && imgs.find(x => x.id === c)) ||
    imgs.find(x => x.emotion === 'neutral') ||
    imgs.find(x => x.emotion === 'smile') ||
    imgs[0]
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
const lowTags = x => (x.tags || []).map(t => String(t).toLowerCase().trim());
// The tags that tell one frame of a set from the others (fighting, hug, tired): on some frames but not all, and not
// the set's own key, an emotion, a numbered emotion (anger8) or an identity tag. The narrator may name one as the
// person's situation (prompt.js situationBlock); computed once per set until the image list changes.
let tagMemo = { ver: -1, bySet: {} };
export function frameTags(k) {
  if (tagMemo.ver !== ver) tagMemo = { ver, bySet: {} };
  if (tagMemo.bySet[k]) return tagMemo.bySet[k];
  const imgs = charSets()[k] || [];
  const count = new Map();
  for (const x of imgs) for (const t of new Set(lowTags(x))) count.set(t, (count.get(t) || 0) + 1);
  const skip = t => t === k || t.includes(':') || EMOS.includes(t) || /^[a-z]+\d+$/.test(t) || /^\d+$/.test(t);
  return (tagMemo.bySet[k] = [...count].filter(([t, n]) => n < imgs.length && !skip(t)).map(([t]) => t));
}
const situationIn = (k, situation) => {
  const s = String(situation || '')
    .toLowerCase()
    .trim();
  return s && frameTags(k).includes(s) ? s : '';
};
export const hasSituation = (k, situation) => !!situationIn(k, situation);
// situation: one of the set's frame tags the narrator named; only its frames are used, chosen by the feeling as usual.
// With none named, a situation's frames (fighting, hug, nsfw) stay out unless the set has nothing else.
export function pickEmotion(k, emo, look, situation) {
  let imgs = charSets()[k];
  if (!imgs || !imgs.length) return null;
  const s = situationIn(k, situation);
  if (s) imgs = imgs.filter(x => lowTags(x).includes(s));
  else {
    const special = frameTags(k);
    const plain = imgs.filter(x => !lowTags(x).some(t => special.includes(t)));
    if (plain.length) imgs = plain;
  }
  const by = e => imgs.filter(x => (x.emotion || 'neutral') === e);
  let c = by(emo);
  if (!c.length && EMO_FB[emo]) c = by(EMO_FB[emo]);
  if (!c.length) c = by('neutral');
  if (!c.length) c = imgs;
  const want = (Array.isArray(look) ? look : []).map(x => String(x).toLowerCase()).filter(Boolean);
  if (want.length) {
    const hit = c.filter(x => frameWords(x).some(t => want.includes(t)));
    if (hit.length) c = hit;
  }
  return pick(c);
}
