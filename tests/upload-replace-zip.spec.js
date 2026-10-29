// Uploading a picture under a name the library already has, with other content, replaces it: the player's labels, the
// set cover and past turns follow the new picture. A zip goes in whole, its tags.json too. None of it calls a model.
import { crc32, deflateRawSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { test, expect } from './support/test.js';
import { ANSWER, ASSET_STORE, check, claudeMock, DRAW, PICK_FILES, same, startLife } from './support/harness.js';

// every model call the page makes, counted where the fake Claude answers
const COUNTED = claudeMock(`async(...a)=>{window.__model=(window.__model||0)+1;return (${ANSWER})(...a)}`, {
  text: "async()=>{window.__model=(window.__model||0)+1;return{text:''}}",
});

// A zip the way other tools write one: entries [name (text, or the raw bytes), data, { deflate, flags, method, utf8 }].
// A deflated entry's local header carries an extra field the central directory doesn't, as Info-ZIP writes it; names
// are flagged UTF-8 unless utf8 is false.
function zipOf(entries) {
  const local = [],
    central = [];
  let off = 0;
  for (const [path, data, o = {}] of entries) {
    const name = Buffer.isBuffer(path) ? path : Buffer.from(path, 'utf8');
    const body = o.deflate ? deflateRawSync(data) : data;
    const method = o.method ?? (o.deflate ? 8 : 0);
    const flags = (o.utf8 === false ? 0 : 0x0800) | (o.flags || 0);
    const extra = o.deflate ? Buffer.from([0x55, 0x54, 5, 0, 1, 0, 0, 0, 0]) : Buffer.alloc(0);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(flags, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(extra.length, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    local.push(h, name, extra, body);
    central.push(c, name);
    off += 30 + name.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
const bytes = ([, b64]) => Buffer.from(b64, 'base64');
const json = o => Buffer.from(JSON.stringify(o), 'utf8');

// the image store, toasts kept in window.__toasts, and each question kept in window.__asked and answered from
// window.__answers in turn
async function setup(game, locale) {
  const { pg, errs } = await game(COUNTED, { size: [900, 900], ...(locale ? { locale } : {}) });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(`(${ASSET_STORE})()`);
  await pg.evaluate(() => {
    window.__toasts = [];
    window.__asked = [];
    window.__answers = [];
    DR.toast = m => window.__toasts.push(m);
    DR.askConfirm = async m => {
      window.__asked.push(m);
      return window.__answers.length ? window.__answers.shift() : false;
    };
  });
  check(errs, 'image jobs hold a Web Lock here, so a test can wait for one', await pg.evaluate('!!navigator.locks'));
  return { pg, errs };
}

// waits for the image job (an upload with its tags.json, 중복 정리, saving the list) to end
const jobDone = pg =>
  expect
    .poll(
      () =>
        pg.evaluate(async () => {
          const q = await navigator.locks.query();
          return q.held.length + q.pending.length;
        }),
      { timeout: 30000 },
    )
    .toBe(0);

// picks the files and answers the questions in turn; model calls, toasts and questions are counted from here
async function upload(pg, files, answers = []) {
  await pg.evaluate(a => {
    window.__model = 0;
    window.__toasts = [];
    window.__asked = [];
    window.__answers = a;
  }, answers);
  await pg.click('[data-tab="images"]');
  await pg.waitForSelector('#upl', { state: 'attached' });
  await pg.evaluate(`(${PICK_FILES})(${JSON.stringify(files)})`);
  await jobDone(pg);
}

const row = (pg, file) => pg.evaluate(f => DR.app.images.find(x => x.file === f) || null, file);
const toastHas = (got, text) => got.toasts.some(m => m.includes(text));
// a row's own content keys, as the page computes them (16 hex characters of shash, then of hash)
const ownKeys = x => [...new Set([x.shash, x.hash].filter(Boolean).map(h => h.slice(0, 16)))];

test('a picture uploaded again with other content replaces the old one, keeping its labels, cover and turns', async ({
  game,
}) => {
  const { pg, errs } = await setup(game);
  await startLife(pg);
  const [A0, B0, A1] = await pg.evaluate(
    `(${DRAW})([['aria_smile.png',10],['aria_neutral.png',120],['aria_smile.png',220]])`,
  );
  await upload(pg, [A0, B0]);
  // labels set by hand that the file name doesn't say: the replacement must not read the name again
  const A = await pg.evaluate(async () => {
    const x = DR.app.images.find(i => i.file === 'aria_smile.png');
    Object.assign(x, {
      set: 'heroine',
      name: 'heroine_joy',
      emotion: 'joy',
      tags: ['red dress', 'faction:Moon Order'],
      createdAt: '2020-01-02T03:04:05.000Z',
    });
    DR.setWorlds(x, ['fantasy', 'modern']);
    await DR.IMGDOC(x.id).set(x);
    DR.app.setMeta.heroine = { gender: 'female', cover: x.id };
    await DR.SETDOC('heroine').set(DR.app.setMeta.heroine);
    DR.app.settings.dupMap = { ghost: x.id }; // a picture cleaned up into this one earlier
    const ai = DR.app.turns.filter(t => t.kind === 'ai').pop();
    ai.img = { char: x.id, chars: [{ id: x.id, npc: 'Aria' }] };
    await DR.turnStore.update(ai);
    return { row: JSON.parse(JSON.stringify(x)), keys: DR.picKeys(x), turn: ai.i };
  });
  const sent = await pg.evaluate('window.__uploads');
  await upload(pg, [A1], [true]);
  const got = await pg.evaluate(async a => {
    const x = DR.app.images.find(i => i.file === 'aria_smile.png');
    const t = DR.app.turns.find(u => u.i === a.turn);
    const pages = (await DR.platform.shared.collection('imgidx').get()).docs;
    const [exported] = await DR.withPicKeys([t], () => {});
    // a turn that came with keys of its own: those come before the old picture's, which only fill what is left
    const foreign = ['ab'.repeat(8), 'cd'.repeat(8)];
    const [moved] = await DR.withPicKeys([{ ...t, img: { ...t.img, keys: { [a.row.id]: foreign } } }], () => {});
    return {
      x,
      n: DR.app.images.length,
      shown: [...DR.renderTurn(t, false).matchAll(/\/_blob\/([a-z0-9]+)/g)].map(m => m[1]),
      byKeys: (DR.turnImg({ char: 'zz9', keys: { zz9: a.keys } }, 'zz9') || {}).id,
      exportedKeys: exported.img.keys[a.row.id] || [],
      movedKeys: moved.img.keys[a.row.id] || [],
      foreign,
      dup: DR.app.settings.dupMap,
      storedDup: ((await DR.dget('settings')) || {}).dupMap || {},
      cover: DR.app.setMeta.heroine.cover,
      storedCover: (await DR.platform.shared.doc('sets/heroine').get()).data().cover,
      listed: pages.flatMap(d => d.data().rows.map(r => r.id)),
      deleted: window.__deleted,
      uploads: window.__uploads,
      model: window.__model,
      asked: window.__asked,
      toasts: window.__toasts,
    };
  }, A);
  const id = got.x.id;
  check(errs, 'the new picture has its own id', id !== A.row.id);
  check(errs, 'one upload for one replaced picture', got.uploads === sent + 1);
  check(errs, 'asked once, naming the file', got.asked.length === 1 && got.asked[0].includes('aria_smile.png'));
  check(errs, 'the library still holds two pictures', got.n === 2);
  for (const k of ['kind', 'set', 'name', 'emotion', 'tags', 'worlds', 'world'])
    check(errs, `${k} carried over from the old row`, same(got.x[k], A.row[k]));
  check(errs, 'it is dated now, so "newest first" shows it on top', got.x.createdAt > A.row.createdAt);
  check(errs, 'the content is the new file', got.x.hash !== A.row.hash && got.x.shash !== A.row.shash);
  check(errs, "the old picture's content keys stay on the new row", same(got.x.akeys, A.keys));
  check(errs, 'the set cover moved to the new picture', got.cover === id);
  check(errs, 'the set card was saved with it', got.storedCover === id);
  check(errs, 'past turns are redirected to the new picture', got.dup[A.row.id] === id);
  check(errs, 'the redirect is saved', got.storedDup[A.row.id] === id);
  check(errs, 'an older redirect to the old picture now points at the new one', got.dup.ghost === id);
  check(errs, 'the past turn shows the new picture', got.shown.includes(id) && !got.shown.includes(A.row.id));
  check(errs, "a turn with the old picture's keys and an unknown id finds the new one", got.byKeys === id);
  check(
    errs,
    "a save exported now carries the new picture's keys and the old one's",
    same(got.exportedKeys.slice(0, 2), ownKeys(got.x)) && A.keys.every(k => got.exportedKeys.includes(k)),
  );
  check(
    errs,
    "keys a moved turn came with keep their place before the old picture's",
    same(got.movedKeys, [...ownKeys(got.x), ...got.foreign]),
  );
  check(errs, 'the old row left the saved list', !got.listed.includes(A.row.id) && got.listed.includes(id));
  check(errs, "the old picture's file was deleted", same(got.deleted, [A.row.id]));
  check(errs, 'the toast counts the replaced picture', toastHas(got, '1장을 바꿨어요'));
  check(errs, 'no model was called', got.model === 0);

  // the list for copies carries the keys, and a copy restored from it keeps them
  await pg.click('#saveMan');
  await jobDone(pg);
  const copy = await pg.evaluate(async x => {
    const blobs = Object.values(window.__blobs).filter(b => b.type === 'application/json');
    const m = JSON.parse(await blobs[blobs.length - 1].text());
    const item = m.items.find(i => i.shash === x.shash) || {};
    DR.app.images = DR.app.images.filter(i => i.id !== x.id);
    DR.platform.assets.list = async () => ({ assets: [{ id: x.id, contentType: 'image/webp' }] });
    const hit = await DR.restoreFromManifest(m);
    return { item: item.akeys, hit, restored: (DR.app.images.find(i => i.id === x.id) || {}).akeys };
  }, got.x);
  check(errs, 'the list for copies holds the old keys', same(copy.item, A.keys));
  check(errs, 'a copy restored from it keeps them', copy.hit === 1 && same(copy.restored, A.keys));
  expect(errs).toEqual([]);
});

test('keeping the old ones changes nothing, and is told apart from a duplicate', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0, A1] = await pg.evaluate(`(${DRAW})([['bg_harbor_day.png',10,120,70],['bg_harbor_day.png',220,120,70]])`);
  await upload(pg, [A0]);
  const before = await pg.evaluate(() => JSON.stringify({ images: DR.app.images, meta: DR.app.setMeta }));
  const sent = await pg.evaluate('window.__uploads');
  await upload(pg, [A1], [false]);
  const got = await pg.evaluate(() => ({
    now: JSON.stringify({ images: DR.app.images, meta: DR.app.setMeta }),
    dup: DR.app.settings.dupMap || {},
    deleted: window.__deleted,
    uploads: window.__uploads,
    asked: window.__asked.length,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(errs, 'the player was asked', got.asked === 1);
  check(errs, 'the library is as it was', got.now === before);
  check(errs, 'nothing was uploaded', got.uploads === sent);
  check(errs, 'nothing was deleted', got.deleted.length === 0);
  check(errs, 'no redirect', Object.keys(got.dup).length === 0);
  check(errs, 'it is told as an old picture kept', toastHas(got, '원래 그림 1장을 그대로 뒀어요'));
  check(errs, 'not as one already in the library', !toastHas(got, '이미 있는 이미지'));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

test('the same name and the same content is skipped without a question', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0] = await pg.evaluate(`(${DRAW})([['bg_harbor_day.png',10,120,70]])`);
  await upload(pg, [A0]);
  const before = await pg.evaluate(() => JSON.stringify(DR.app.images));
  const sent = await pg.evaluate('window.__uploads');
  await upload(pg, [A0], [true]);
  const got = await pg.evaluate(() => ({
    now: JSON.stringify(DR.app.images),
    uploads: window.__uploads,
    asked: window.__asked.length,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(errs, 'no question', got.asked === 0);
  check(errs, 'nothing was uploaded', got.uploads === sent);
  check(errs, 'the library is as it was', got.now === before);
  check(errs, 'counted as already in the library', toastHas(got, '이미 있는 이미지 1장은 건너뛰었어요'));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// a row saved without the original file's hash has only the stored file's, which never matches a png sent again
test('a picture without the original hash is still skipped by its name', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0] = await pg.evaluate(`(${DRAW})([['bg_harbor_day.png',10,120,70]])`);
  await upload(pg, [A0]);
  const before = await pg.evaluate(async () => {
    const x = DR.app.images[0];
    delete x.hash;
    await DR.IMGDOC(x.id).set(x);
    return JSON.stringify(DR.app.images);
  });
  const sent = await pg.evaluate('window.__uploads');
  await upload(pg, [A0], [true]);
  const got = await pg.evaluate(() => ({
    now: JSON.stringify(DR.app.images),
    uploads: window.__uploads,
    asked: window.__asked.length,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(errs, 'no question', got.asked === 0);
  check(errs, 'nothing was uploaded', got.uploads === sent);
  check(errs, 'the library is as it was', got.now === before);
  check(errs, 'counted as already in the library', toastHas(got, '이미 있는 이미지 1장은 건너뛰었어요'));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// an exact file name wins over a base name; a base name (any extension or case) counts only when one picture has it
test('a name matches exactly first, then by its base name only when one picture has it', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const files = await pg.evaluate(
    `(${DRAW})([['bg_pose_day.png',40,120,70],['bg_pose_day.webp',80,120,70],['bg_solo_day.webp',150,120,70],
      ['bg_pose_day.png',200,120,70],['BG_POSE_DAY.jpg',250,120,70],['Bg_Solo_Day.PNG',300,120,70]])`,
  );
  await upload(pg, files.slice(0, 3));
  const ids = await pg.evaluate(() => Object.fromEntries(DR.app.images.map(x => [x.file, x.id])));
  await upload(pg, files.slice(3), [true]);
  const got = await pg.evaluate(() => ({
    files: Object.fromEntries(DR.app.images.map(x => [x.file, x.id])),
    asked: window.__asked,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(
    errs,
    'asked about the exact match and the one base-name match',
    got.asked.length === 1 && got.asked[0].includes('bg_pose_day.png') && got.asked[0].includes('Bg_Solo_Day.PNG'),
  );
  check(
    errs,
    'bg_pose_day.png replaced its own row',
    !!got.files['bg_pose_day.png'] && got.files['bg_pose_day.png'] !== ids['bg_pose_day.png'],
  );
  check(errs, 'bg_pose_day.webp is untouched', got.files['bg_pose_day.webp'] === ids['bg_pose_day.webp']);
  check(
    errs,
    'bg_solo_day.webp was replaced by Bg_Solo_Day.PNG',
    !got.files['bg_solo_day.webp'] && !!got.files['Bg_Solo_Day.PNG'],
  );
  check(errs, 'a base name two pictures share is skipped', !got.files['BG_POSE_DAY.jpg']);
  check(
    errs,
    'and said so by name',
    got.toasts.some(m => m.includes('BG_POSE_DAY.jpg') && m.includes('여러 장')),
  );
  check(errs, 'three pictures, as before', Object.keys(got.files).length === 3);
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

test('a step that fails keeps both pictures and puts the redirect and the cover back', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0, A1] = await pg.evaluate(`(${DRAW})([['aria_smile.png',10],['aria_smile.png',220]])`);
  await upload(pg, [A0]);
  const oldId = await pg.evaluate(async () => {
    const x = DR.app.images[0];
    DR.app.setMeta.aria = { cover: x.id };
    await DR.SETDOC('aria').set(DR.app.setMeta.aria);
    DR.app.settings.dupMap = { ghost: x.id };
    // the settings document can't be written from here on
    const db = window.__dbmock;
    const doc = db.doc;
    db.doc = p => {
      const d = doc(p);
      if (/\/settings$/.test(p))
        d.set = async () => {
          throw Object.assign(new Error('full'), { code: 'quota_exceeded' });
        };
      return d;
    };
    return x.id;
  });
  await upload(pg, [A1], [true]);
  const got = await pg.evaluate(async () => ({
    ids: DR.app.images.filter(x => x.file === 'aria_smile.png').map(x => x.id),
    listed: (await DR.platform.shared.collection('imgidx').get()).docs.flatMap(d => d.data().rows.map(r => r.id)),
    dup: DR.app.settings.dupMap,
    cover: DR.app.setMeta.aria.cover,
    deleted: window.__deleted,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(errs, 'both pictures are in the library', got.ids.length === 2 && got.ids.includes(oldId));
  check(
    errs,
    'and in the saved list',
    got.ids.every(i => got.listed.includes(i)),
  );
  check(errs, 'the redirect is as it was', same(got.dup, { ghost: oldId }));
  check(errs, 'the cover is as it was', got.cover === oldId);
  check(errs, 'no file was deleted', got.deleted.length === 0);
  check(errs, 'the player is told', toastHas(got, '원래 그림도 남겨 뒀어요'));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

test('a zip goes in with its pictures from folders and its tags.json, replacing like loose files', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [old, smile, anger, dock] = await pg.evaluate(
    `(${DRAW})([['zara_smile.png',30],['zara_smile.png',300],['zara_anger.png',330],['bg_dock_night.png',200,120,70]])`,
  );
  await upload(pg, [old]);
  const oldId = (await row(pg, 'zara_smile.png')).id;
  const tags = {
    sets: { zara: { gender: 'female', role: 'dock smuggler', tags: ['faction:Harbor Guild'] } },
    images: { 'zara_smile.png': { emotion: 'smile', tags: ['scar', 'coat'] } },
    backgrounds: { 'bg_dock_night.png': { place: 'dock', time: 'night', tags: ['harbor'] } },
  };
  const zip = zipOf([
    ['deep/old/tags.json', json({ sets: { zara: { role: 'from the deeper file' } } })],
    ['pack/chars/zara_smile.png', bytes(smile), { deflate: true }],
    ['pack/chars/zara_anger.png', bytes(anger)],
    ['pack/bg/bg_dock_night.png', bytes(dock), { deflate: true }],
    ['__MACOSX/pack/chars/._zara_smile.png', Buffer.from('mac resource fork')],
    ['pack/.DS_Store', Buffer.from('finder')],
    ['README.txt', Buffer.from('read me'), { deflate: true }],
    ['tags.json', json(tags), { deflate: true }],
  ]);
  check(errs, 'the test zip itself is sound', Object.keys(unzipSync(zip)).length === 8);
  await upload(pg, [['pack.zip', zip.toString('base64')]], [true, true]);
  const got = await pg.evaluate(() => ({
    files: DR.app.images.map(x => x.file).sort(),
    smile: DR.app.images.find(x => x.file === 'zara_smile.png'),
    dock: DR.app.images.find(x => x.file === 'bg_dock_night.png'),
    meta: DR.app.setMeta.zara || {},
    asked: window.__asked,
    model: window.__model,
  }));
  check(
    errs,
    'the pictures from the folders are in, nothing else',
    same(got.files, ['bg_dock_night.png', 'zara_anger.png', 'zara_smile.png']),
  );
  check(errs, 'the picture with the same name was asked about first', /zara_smile\.png/.test(got.asked[0] || ''));
  check(errs, 'then the tags.json import asked its own question', got.asked.length === 2);
  check(errs, 'zara_smile.png was replaced', got.smile.id !== oldId);
  check(errs, 'the shallowest tags.json was used', got.meta.role === 'dock smuggler');
  check(
    errs,
    "the tags landed on the replacement and the set's tag on its frames",
    same(got.smile.tags, ['faction:Harbor Guild', 'scar', 'coat']),
  );
  check(errs, 'the background got its tags', got.dock.tags.includes('harbor') && got.dock.kind === 'scene');
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// a/x/smile.png and b/x/smile.png are two people: as one name, the second would be skipped or replace the first.
// The zip's tags.json still finds them, by path, and a name it used twice matches nothing (not the library's smile).
test('same names in a zip get the folders that tell them apart, and its tags.json still finds them', async ({
  game,
}) => {
  const { pg, errs } = await setup(game);
  const [lib, ax, bx, al, c] = await pg.evaluate(
    `(${DRAW})([['bg_smile.png',300,120,70],['smile.png',15],['smile.png',195],['smile.png',255],['female1_smile.webp',100]])`,
  );
  await upload(pg, [lib]);
  await pg.evaluate(async () => {
    const x = DR.app.images[0]; // a background named smile, nothing to do with the zip
    x.tags = ['mine'];
    await DR.IMGDOC(x.id).set(x);
  });
  const tags = {
    images: {
      'pack/a/x/smile.png': { tags: ['from path'] },
      'smile.png': { tags: ['which one'] },
      'female1_smile.webp': { tags: ['by its own name'] },
    },
  };
  const zip = zipOf([
    ['pack/a/x/smile.png', bytes(ax), { deflate: true }],
    ['pack/b/x/SMILE.png', bytes(bx)],
    ['pack/alice/smile.png', bytes(al)],
    ['CommonPack/tagged/female1_smile.webp', bytes(c)],
    ['tags.json', json(tags)],
  ]);
  await upload(pg, [['people.zip', zip.toString('base64')]], [true]);
  const got = await pg.evaluate(() => ({
    rows: Object.fromEntries(DR.app.images.map(x => [x.file, { set: x.set, emotion: x.emotion, tags: x.tags }])),
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(
    errs,
    'each kept their picture, under the folders that tell them apart',
    same(Object.keys(got.rows).sort(), [
      'a-x_smile.png',
      'alice_smile.png',
      'b-x_SMILE.png',
      'bg_smile.png',
      'female1_smile.webp',
    ]),
  );
  check(errs, 'the folders are the set', same(got.rows['a-x_smile.png'].set, 'a-x'));
  check(errs, 'one folder when that is enough', same(got.rows['alice_smile.png'].set, 'alice'));
  check(errs, 'nothing was skipped', !toastHas(got, '건너뛰었어요'));
  check(errs, "tags.json's path finds the renamed picture", same(got.rows['a-x_smile.png'].tags, ['from path']));
  check(errs, 'a unique name finds its picture', same(got.rows['female1_smile.webp'].tags, ['by its own name']));
  check(
    errs,
    "a name the zip used three times doesn't reach the library",
    same(got.rows['bg_smile.png'].tags, ['mine']),
  );
  check(errs, 'nor any of the three', !Object.values(got.rows).some(r => r.tags.includes('which one')));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// Japanese Windows writes names in Shift_JIS, whose kana bytes also pass as EUC-KR: the screen language decides
test("a zip's Shift_JIS names are read first as Japanese on a Japanese screen", async ({ game }) => {
  const { pg, errs } = await setup(game, 'ja-JP');
  const [port] = await pg.evaluate(`(${DRAW})([['port.png',40,120,70]])`);
  const sjis = Buffer.concat([
    Buffer.from('bg_'),
    Buffer.from([0x82, 0xdd, 0x82, 0xc8, 0x82, 0xc6]),
    Buffer.from('_day.png'),
  ]); // みなと
  const zip = zipOf([
    [sjis, bytes(port), { utf8: false }],
    ['tags.json', json({ backgrounds: { 'bg_みなと_day.png': { tags: ['port'] } } })],
  ]);
  await upload(pg, [['minato.zip', zip.toString('base64')]], [true]);
  const got = await pg.evaluate(() => ({
    rows: Object.fromEntries(DR.app.images.map(x => [x.file, x.tags])),
    model: window.__model,
  }));
  check(errs, 'the name is read as Japanese', same(got.rows['bg_みなと_day.png'], ['port']));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// a damaged entry has no content to compare, so it is not offered as a replacement: it fails, saying why
test('a damaged zip entry under a name the library has fails without a question', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0] = await pg.evaluate(`(${DRAW})([['bg_harbor_day.png',10,120,70]])`);
  await upload(pg, [A0]);
  const before = await pg.evaluate(() => JSON.stringify(DR.app.images));
  const zip = zipOf([['bg_harbor_day.png', Buffer.from('this is not deflated data'), { method: 8 }]]);
  await upload(pg, [['broken.zip', zip.toString('base64')]], [true]);
  const got = await pg.evaluate(() => ({
    now: JSON.stringify(DR.app.images),
    asked: window.__asked.length,
    failed: (document.querySelector('.upl-failed') || {}).textContent || '',
    model: window.__model,
  }));
  check(errs, 'no question', got.asked === 0);
  check(errs, 'the library is as it was', got.now === before);
  check(errs, 'it is listed as failed, saying why', /bg_harbor_day\.png.*손상/.test(got.failed));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// the entries of a tags.json image: an object with tags (maybe none), or the tags alone, as a list or a string
test('tags.json images without tags clear them when replacing and keep them when merging', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const pics = await pg.evaluate(
    `(${DRAW})([['zed_smile.png',10],['zed_anger.png',60],['zed_joy.png',110],['zed_shy.png',160]])`,
  );
  await upload(pg, pics);
  const images = {
    'zed_smile.png': { emotion: 'smile' },
    'zed_anger.png': { tags: '' },
    'zed_joy.png': ['red', 'blue'],
    'zed_shy.png': 'green, gold',
  };
  const run = merge =>
    pg.evaluate(
      async ([j, merge]) => {
        for (const x of DR.app.images) x.tags = ['old'];
        window.__answers = [true];
        await DR.importTags({ text: async () => JSON.stringify({ ...j, ...(merge ? { merge_tags: true } : {}) }) });
        return Object.fromEntries(DR.app.images.map(x => [x.file, x.tags]));
      },
      [{ images }, merge],
    );
  const replaced = await run(false);
  const merged = await run(true);
  check(
    errs,
    'replace: none is none, a list or a string is the tags',
    same(replaced, {
      'zed_smile.png': [],
      'zed_anger.png': [],
      'zed_joy.png': ['red', 'blue'],
      'zed_shy.png': ['green', 'gold'],
    }),
  );
  check(
    errs,
    'merge: the old tags stay',
    same(merged, {
      'zed_smile.png': ['old'],
      'zed_anger.png': ['old'],
      'zed_joy.png': ['old', 'red', 'blue'],
      'zed_shy.png': ['old', 'green', 'gold'],
    }),
  );
  check(errs, 'no model was called', (await pg.evaluate('window.__model')) === 0);
  expect(errs).toEqual([]);
});

// a step that fails after some writes landed puts the stored copies back too, so a reload also finds both pictures
test('a failed step after the cover was written puts the stored redirect and cover back', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [A0, A1] = await pg.evaluate(`(${DRAW})([['aria_smile.png',10],['aria_smile.png',220]])`);
  await upload(pg, [A0]);
  const oldId = await pg.evaluate(async () => {
    const x = DR.app.images[0];
    DR.app.setMeta.aria = { cover: x.id };
    await DR.SETDOC('aria').set(DR.app.setMeta.aria);
    DR.app.settings.dupMap = { ghost: x.id };
    await DR.saveSettings();
    DR.IMGX.dropMany = async () => {
      throw Object.assign(new Error('full'), { code: 'quota_exceeded' });
    };
    return x.id;
  });
  await upload(pg, [A1], [true]);
  const got = await pg.evaluate(async () => ({
    ids: DR.app.images.map(x => x.id),
    storedDup: ((await DR.dget('settings')) || {}).dupMap || {},
    storedCover: (await DR.platform.shared.doc('sets/aria').get()).data().cover,
    dup: DR.app.settings.dupMap,
    cover: DR.app.setMeta.aria.cover,
    deleted: window.__deleted,
    model: window.__model,
  }));
  check(errs, 'both pictures are kept', got.ids.length === 2 && got.ids.includes(oldId));
  check(errs, 'the stored redirect is as it was', same(got.storedDup, { ghost: oldId }));
  check(errs, 'the stored cover is as it was', got.storedCover === oldId);
  check(errs, 'and memory agrees', same(got.dup, { ghost: oldId }) && got.cover === oldId);
  check(errs, 'no file was deleted', got.deleted.length === 0);
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// Korean Windows writes names in its code page without the UTF-8 flag; macOS writes decomposed Hangul (NFD)
test("a zip's Korean names match its tags.json whether written by Windows or a Mac", async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [day, night, rain] = await pg.evaluate(
    `(${DRAW})([['day.png',40,120,70],['night.png',160,120,70],['rain.png',280,120,70]])`,
  );
  const cp949 = Buffer.concat([Buffer.from('bg_'), Buffer.from([0xc7, 0xd7, 0xb1, 0xb8]), Buffer.from('_day.png')]); // 항구
  const tags = {
    backgrounds: {
      'bg_항구_day.png': { tags: ['windows'] },
      'bg_항구_night.png': { tags: ['mac'] },
      'bg_항구_rain.png': { tags: ['flagged'] },
    },
  };
  const zip = zipOf([
    [cp949, bytes(day), { utf8: false }],
    ['bg_항구_night.png'.normalize('NFD'), bytes(night), { utf8: false, deflate: true }],
    ['bg_항구_rain.png', bytes(rain)],
    ['tags.json', json(tags)],
  ]);
  await upload(pg, [['harbor.zip', zip.toString('base64')]], [true]);
  const got = await pg.evaluate(() => ({
    rows: Object.fromEntries(DR.app.images.map(x => [x.file, x.tags])),
    model: window.__model,
  }));
  check(errs, 'the code page name is read', same(got.rows['bg_항구_day.png'], ['windows']));
  check(errs, 'the decomposed name is composed', same(got.rows['bg_항구_night.png'], ['mac']));
  check(errs, 'the flagged UTF-8 name is read', same(got.rows['bg_항구_rain.png'], ['flagged']));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

test('a zip without tags.json brings just its pictures, and says which entries it could not open', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [cave, lake, locked, odd] = await pg.evaluate(
    `(${DRAW})([['bg_cave_day.png',20,120,70],['bg_lake_day.png',90,120,70],['bg_locked_day.png',160,120,70],['bg_odd_day.png',230,120,70]])`,
  );
  const zip = zipOf([
    ['a/b/bg_cave_day.png', bytes(cave), { deflate: true }],
    ['bg_lake_day.png', bytes(lake)],
    ['bg_locked_day.png', bytes(locked), { flags: 1 }],
    ['bg_odd_day.png', bytes(odd), { method: 12 }],
    ['notes.txt', Buffer.from('notes')],
  ]);
  await upload(pg, [['scenes.zip', zip.toString('base64')]]);
  const got = await pg.evaluate(() => ({
    files: DR.app.images.map(x => x.file).sort(),
    asked: window.__asked.length,
    toasts: window.__toasts,
    model: window.__model,
  }));
  check(errs, 'the readable pictures are in', same(got.files, ['bg_cave_day.png', 'bg_lake_day.png']));
  check(errs, 'no tags.json, so no import question', got.asked === 0);
  check(
    errs,
    'the encrypted entry and the unknown method are told',
    got.toasts.some(
      m => m.includes('scenes.zip') && m.includes('2개') && m.includes('비밀번호') && m.includes('압축 방식'),
    ),
  );
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});

// 중복 정리 retires a copy the same way: the cover moves, the keeper takes the copy's keys, then the copy's file goes
test('중복 정리 moves the cover and hands the copy its keeper', async ({ game }) => {
  const { pg, errs } = await setup(game);
  const [Z] = await pg.evaluate(`(${DRAW})([['zed_smile.png',70]])`);
  await upload(pg, [Z]);
  const keepId = await pg.evaluate(async () => {
    const x = DR.app.images[0];
    // the same stored file under another id, sent from another original (another hash)
    window.__blobs.dup1 = window.__blobs[x.id];
    DR.app.images.push({ ...x, id: 'dup1', hash: 'f'.repeat(64), createdAt: '2999-01-01T00:00:00.000Z' });
    DR.app.setMeta.zed = { cover: 'dup1' };
    await DR.SETDOC('zed').set(DR.app.setMeta.zed);
    window.__model = 0;
    return x.id;
  });
  await pg.click('#dedupe');
  await pg.waitForSelector('.review-list', { timeout: 30000 });
  await pg.click('#rvOk');
  await jobDone(pg);
  const got = await pg.evaluate(async id => {
    const keep = DR.app.images.find(x => x.id === id);
    const pages = (await DR.platform.shared.collection('imgidx').get()).docs;
    return {
      ids: DR.app.images.map(x => x.id),
      akeys: keep.akeys,
      storedKeys: (pages.flatMap(d => d.data().rows).find(r => r.id === id) || {}).akeys,
      dup: ((await DR.dget('settings')) || {}).dupMap || {},
      cover: (await DR.platform.shared.doc('sets/zed').get()).data().cover,
      deleted: window.__deleted,
      model: window.__model,
    };
  }, keepId);
  check(errs, 'the copy is gone', same(got.ids, [keepId]));
  check(errs, 'past turns follow it to the keeper', got.dup.dup1 === keepId);
  check(errs, 'the cover moved to the keeper', got.cover === keepId);
  check(errs, "the keeper holds the copy's other key", same(got.akeys, ['f'.repeat(16)]));
  check(errs, 'saved with the list', same(got.storedKeys, ['f'.repeat(16)]));
  check(errs, "the copy's file was deleted", same(got.deleted, ['dup1']));
  check(errs, 'no model was called', got.model === 0);
  expect(errs).toEqual([]);
});
