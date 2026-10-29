/* ============ image pack export: a zip of the library under canonical names, plus tags.json ============ */
import { noteIgnored, toast } from './util.js';
import { setStat } from './stat.js';
import { app } from './app.js';
import { useCapability } from './boot.js';
import { IMAGE_TYPES, imgUrl, worldsOf } from './images.js';
import { logErr } from './diag.js';
import { T } from './i18n.js';
import { makeZip } from './zip.js';

// a type's first extension (jpg, not jpeg)
const EXT = Object.fromEntries(
  Object.entries(IMAGE_TYPES)
    .reverse()
    .map(([ext, type]) => [type, ext]),
);
const TIMES = ['day', 'sunset', 'night', 'indoor'];

// one canonical file name per image (no extension): the same names the upload rules read back
function baseName(x) {
  if (x.kind === 'char') {
    const set = x.set || x.name || 'unnamed';
    return `${set}_${x.emotion || 'neutral'}${x.variant ? '_' + x.variant : ''}`;
  }
  if (x.kind === 'scene') return 'bg_' + String(x.name || x.file || x.id).replace(/^bg_/i, '');
  return String(x.name || (x.file || x.id).replace(/\.[^.]+$/, ''));
}
// names are unique inside the pack: a second "female1_smile" becomes "female1_smile_2"
function nameAll(imgs, extOf) {
  const used = new Set();
  return imgs.map(x => {
    const b = baseName(x).replace(/[\\/:*?"<>|]/g, '_');
    const ext = extOf(x);
    let n = 1,
      name = `${b}.${ext}`;
    while (used.has(name.toLowerCase())) name = `${b}_${++n}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// the tags.json the import button reads, keyed by the pack's file names
export function buildTagsJson(imgs, names) {
  const out = { sets: {}, images: {}, backgrounds: {} };
  imgs.forEach((x, i) => {
    const fn = names[i];
    const ws = worldsOf(x);
    if (x.kind === 'char') {
      const k = x.set || x.name;
      if (k && !out.sets[k]) {
        const m = app.setMeta[k] || {};
        const s = {};
        if (m.gender) s.gender = m.gender;
        const sw = worldsOf(m);
        if (sw.length) s.worlds = sw;
        if (m.role) s.role = m.role;
        if (m.tier) s.tier = m.tier;
        if (m.charName) s.name = m.charName;
        if (m.aliases && m.aliases.length) s.aliases = m.aliases;
        if (m.profile) s.profile = m.profile;
        const cover = m.cover ? imgs.findIndex(y => y.id === m.cover) : -1;
        if (cover >= 0) s.cover = names[cover]; // by file name: ids are this install's
        out.sets[k] = s;
      }
      const e = { emotion: x.emotion || 'neutral', tags: x.tags || [] };
      if (ws.length) e.worlds = ws;
      out.images[fn] = e;
    } else if (x.kind === 'scene') {
      const parts = String(x.name || '').split('_');
      const time = TIMES.includes(parts[parts.length - 1]) ? parts.pop() : '';
      const e = { tags: x.tags || [] };
      if (parts.join('_')) e.place = parts.join('_');
      if (time) e.time = time;
      if (ws.length) e.worlds = ws;
      out.backgrounds[fn] = e;
    }
  });
  return out;
}

async function save(filename, blob) {
  const dl = await useCapability('downloads');
  if (!dl) {
    toast(T("This page can't save files. Open it from the published link"));
    return false;
  }
  await dl.save({ filename, data: blob });
  return true;
}

// withImages: the whole pack (pictures + tags.json); otherwise tags.json alone
export async function exportPack(withImages) {
  const say = t => {
    setStat(t);
  };
  const imgs = app.images.filter(x => x.kind === 'char' || x.kind === 'scene' || x.kind === 'fx');
  if (!imgs.length) {
    toast(T('No images to export'));
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (!withImages) {
      const names = nameAll(imgs, () => 'png');
      const json = JSON.stringify(buildTagsJson(imgs, names), null, 2);
      if (await save(`tags_${day}.json`, new Blob([json], { type: 'application/json' })))
        toast(T('Exported tags.json (file names match the names images were uploaded with)'), 4000);
      return;
    }
    const blobs = [];
    let skipped = 0;
    for (let i = 0; i < imgs.length; i++) {
      say(T('Downloading images {i}/{n}', { i: i + 1, n: imgs.length }));
      try {
        const r = await fetch(imgUrl(imgs[i].id));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blobs.push(await r.blob());
      } catch (e) {
        noteIgnored('export pack: ' + imgs[i].id, e);
        blobs.push(null);
        skipped++;
      }
    }
    const have = imgs.filter((_, i) => blobs[i]);
    const haveBlobs = blobs.filter(Boolean);
    const names = nameAll(have, x => EXT[haveBlobs[have.indexOf(x)].type] || 'png');
    const json = JSON.stringify(buildTagsJson(have, names), null, 2);
    say(T('Building the zip'));
    const zip = await makeZip([
      ...have.map((_, i) => ({ name: names[i], blob: haveBlobs[i] })),
      { name: 'tags.json', blob: new Blob([json], { type: 'application/json' }) },
    ]);
    if (await save(`dice-roguelife-images_${day}.zip`, zip))
      toast(
        T('Exported {n} {n|image|images} and tags.json as a zip ({mb}MB)', {
          n: have.length,
          mb: (zip.size / 1048576).toFixed(1),
        }) + (skipped ? T(', skipped {n} that could not be downloaded', { n: skipped }) : ''),
        5000,
      );
  } catch (e) {
    if (e && e.code === 'declined') toast(T('Cancelled'));
    else {
      logErr('export-pack', e);
      toast(T('Export failed: {err}', { err: (e && (e.code || e.message)) || e }), 5000);
    }
  } finally {
    say('');
  }
}
