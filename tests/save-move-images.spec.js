// A save moved to another install: the other install mints its own asset ids, and once it has the same pictures (the
// image pack, or the same files uploaded) past turns show them again, found by content (img.keys in the save file).
import { unzipSync } from 'fflate';
import { test, expect } from './support/test.js';
import { ASSET_STORE, B64, check, claudeMock, DRAW, PICK_FILES, same, startLife } from './support/harness.js';

// four distinct png pictures named the way the upload reads them; they are stored as webp, so the stored file differs
const PICTURES = `(${DRAW})([['female1_smile.png',10,60,100],['male1_neutral.png',120,60,100],['bg_street_day.png',200,120,70],['bg_market_night.png',300,120,70]])`;

// the content keys a save file's turns carry, by turn
const KEYS = String.raw`async text=>{const f=JSON.parse(text);const j=await DR.gunzipBytes(DR.z85dec(f.d,f.n));
  return Object.fromEntries(j.turns.filter(t=>t.img&&t.img.keys).map(t=>[t.i,t.img.keys]))}`;

// what each of the turns i shows, as picture names
const SHOWN = String.raw`list=>Object.fromEntries(list.map(i=>{const t=DR.app.turns.find(x=>x.i===i);
  return [i,[...DR.renderTurn(t,false).matchAll(/\/_blob\/([a-z0-9]+)/g)].map(m=>(DR.app.images.find(x=>x.id===m[1])||{}).name).sort()]}))`;

async function upload(pg, files) {
  await pg.click('[data-tab="images"]');
  await pg.waitForSelector('#upl', { state: 'attached' });
  await pg.evaluate(`(${PICK_FILES})(${JSON.stringify(files)})`);
  await pg.waitForFunction(`DR.app.images.length===${files.length}`, null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
}

// the first install: pictures, a life whose last two replies show them, then the save file and the image pack
async function firstInstall(game) {
  const { pg, errs } = await game(claudeMock(), { size: [900, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(`(${ASSET_STORE})('a')`);
  await startLife(pg);
  for (const k of [0, 1]) {
    await pg.fill('#input', `간다 ${k}`);
    await pg.press('#input', 'Enter');
    await pg.waitForFunction('DR.isIdle()', null, { timeout: 15000 });
  }
  const originals = await pg.evaluate(PICTURES);
  await upload(pg, originals);
  check(
    errs,
    'stored files differ from the uploaded ones',
    await pg.evaluate('DR.app.images.every(x=>x.shash&&x.hash!==x.shash)'),
  );
  // one older-style reply (img.char only), one with a scene, two people and a marked place
  const turns = await pg.evaluate(async () => {
    const id = n => DR.app.images.find(x => x.name === n).id;
    const ai = DR.app.turns.filter(t => t.kind === 'ai').slice(-2);
    ai[0].img = { scene: id('market_night'), char: id('male1_neutral'), chars: {} }; // a malformed list is skipped
    DR.app.setMeta.female1 = Object.assign(DR.app.setMeta.female1 || {}, { cover: id('female1_smile') });
    ai[0].out.speaker = '도윤';
    ai[1].out.narration = '골목을 지나 [[@시장]] 쪽으로 간다.';
    ai[1].img = {
      scene: id('street_day'),
      char: id('female1_smile'),
      chars: [
        { id: id('female1_smile'), npc: '민아' },
        { id: id('male1_neutral'), npc: '도윤' },
      ],
      places: [{ name: '시장', id: id('market_night'), base: 'market' }],
    };
    for (const t of ai) await DR.turnStore.update(t);
    return ai.map(t => t.i);
  });
  const shown = await pg.evaluate(`(${SHOWN})(${JSON.stringify(turns)})`);
  check(errs, 'the older-style reply shows its scene and speaker', shown[turns[0]].length === 2);
  check(errs, 'the full reply shows the scene, two people and the place', shown[turns[1]].length === 4);
  await pg.evaluate(`DR.exportSaveFile(DR.app.currentSave.id)`);
  await pg.click('#expPack');
  await pg.waitForFunction('Object.keys(window.__files).length===2', null, { timeout: 15000 });
  const { save, pack } = await pg.evaluate(`(async()=>{const fs=Object.entries(window.__files);
    return {save:await fs.find(([n])=>n.endsWith('.json'))[1].text(),pack:await (${B64})(fs.find(([n])=>n.endsWith('.zip'))[1])}})()`);
  check(
    errs,
    'the export leaves this install’s rows as they are',
    !(await pg.evaluate('DR.app.turns.some(t=>t.img&&t.img.keys)')),
  );
  const entries = Object.entries(unzipSync(Buffer.from(pack, 'base64')));
  const tags = Buffer.from(entries.find(([n]) => n === 'tags.json')[1]).toString('utf8');
  check(
    errs,
    'tags.json names the set cover by file name',
    /^female1_smile./.test(JSON.parse(tags).sets.female1.cover),
  );
  const keys = await pg.evaluate(`(${KEYS})(${JSON.stringify(save)})`);
  check(
    errs,
    'the save file carries keys for both replies',
    turns.every(i => keys[i]),
  );
  return {
    errs,
    save,
    keys,
    tags,
    pack: entries.filter(([n]) => n !== 'tags.json').map(([n, u8]) => [n, Buffer.from(u8).toString('base64')]),
    originals,
    turns,
    shown,
  };
}

// the second install: the save file first, then the pictures (new ids); the past replies show what they showed there.
// reencoded: this install stores other bytes, so only the uploaded file's hash can match
async function secondInstall(game, A, files, { reencoded = false } = {}) {
  const { pg, errs } = await game(claudeMock(), { size: [900, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(`(${ASSET_STORE})('b')`);
  await pg.evaluate(`DR.importSaveFile({text:async()=>${JSON.stringify(A.save)}})`);
  await pg.waitForFunction('DR.app.saves.length===1', null, { timeout: 20000 });
  await pg.evaluate('DR.openSave(DR.app.saves[0].id)');
  await pg.waitForFunction('DR.app.turns.length>2&&DR.isIdle()', null, { timeout: 20000 });
  // exported again before the pictures are here: the keys go on as they came
  await pg.evaluate('window.__files={};DR.exportSaveFile(DR.app.currentSave.id)');
  await pg.waitForFunction('Object.keys(window.__files).length===1', null, { timeout: 15000 });
  const again = await pg.evaluate(`(async()=>(${KEYS})(await Object.values(window.__files)[0].text()))()`);
  check(errs, 'a re-export before the pictures arrive keeps the keys', same(again, A.keys));
  await upload(pg, files);
  if (reencoded)
    await pg.evaluate(() => {
      DR.app.images.forEach((x, k) => (x.shash = String(k).padStart(4, '0') + 'e'.repeat(60)));
      DR.imagesChanged();
    });
  const ids = await pg.evaluate('DR.app.images.map(x=>x.id)');
  check(
    errs,
    'this install minted its own ids',
    ids.every(i => i.startsWith('b')),
  );
  const shown = await pg.evaluate(`(${SHOWN})(${JSON.stringify(A.turns)})`);
  for (const i of A.turns) check(errs, `reply ${i} shows the same pictures`, same(shown[i], A.shown[i]));
  // the log on screen and the story export use this install's files
  await pg.click('[data-tab="play"]');
  await pg.evaluate('DR.renderLog()');
  const inLog = await pg.evaluate(
    "[...document.querySelector('#log').innerHTML.matchAll(/\\/_blob\\/([a-z0-9]+)/g)].map(m=>m[1])",
  );
  check(errs, 'the log shows all four pictures', new Set(inLog).size === 4 && inLog.every(i => ids.includes(i)));
  await pg.evaluate(`(async()=>{
    DR.toDataUrl=async id=>'data:image/webp;base64,'+id;
    DR.useCapability=async n=>n==='downloads'?{save:async({data})=>{window.__html=await data.text()}}:null;
    await DR.exportStory(DR.app.currentSave.id,'html','all',true,()=>{});
  })()`);
  const html = await pg.evaluate('window.__html');
  check(
    errs,
    'the story export embeds every picture',
    ids.every(i => html.includes('base64,' + i)),
  );
  return { pg, errs };
}

test('a save and its image pack moved to another install show the same pictures', async ({ game }) => {
  const A = await firstInstall(game);
  const B = await secondInstall(game, A, A.pack);
  // keys first; an id is trusted only when its picture has no keys of its own
  const won = await B.pg.evaluate(() => {
    const [x, y] = DR.app.images;
    const at = keys => DR.turnImg({ scene: x.id, keys: { [x.id]: keys } }, x.id);
    // a picture cleaned up as a duplicate points to the one kept
    DR.app.settings.dupMap = { gone: x.id };
    const kept = DR.turnImg({ scene: 'gone', keys: { gone: ['0000'] } }, 'gone') === x;
    DR.app.settings.dupMap = {};
    return at(DR.picKeys(y)) === y && at(undefined) === x && at(['0000']) === null && kept;
  });
  check(B.errs, 'keys first, and a different picture under the same id is not shown', won);
  // the cover comes back through tags.json, as this install's id
  const cover = await B.pg.evaluate(async json => {
    DR.askConfirm = async () => true;
    await DR.importTags(new File([json], 'tags.json', { type: 'application/json' }));
    return DR.app.setMeta.female1.cover === DR.app.images.find(x => x.name === 'female1_smile').id;
  }, A.tags);
  check(B.errs, 'the set cover is restored from tags.json', cover);
  // the list for copies carries the cover by file hash, and the restored card is saved with this install's id
  const copied = await B.pg.evaluate(async () => {
    const x = DR.app.images.find(i => i.name === 'female1_smile');
    await DR.restoreFromManifest({ items: [], sets: { female1: { cover: x.shash } } });
    const stored = (await DR.platform.shared.doc('sets/female1').get()).data();
    return DR.app.setMeta.female1.cover === x.id && stored.cover === x.id;
  });
  check(B.errs, 'the list for copies restores the set cover', copied);
  expect(A.errs).toEqual([]);
  expect(B.errs).toEqual([]);
});

test('a moved save shows its pictures once the same original files are uploaded there', async ({ game }) => {
  const A = await firstInstall(game);
  const B = await secondInstall(game, A, A.originals, { reencoded: true });
  expect(A.errs).toEqual([]);
  expect(B.errs).toEqual([]);
});
