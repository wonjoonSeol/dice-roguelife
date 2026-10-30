// The character sets as a grid: a change made to the chosen sets reaches every frame of those sets and no other, a
// filter keeps only the sets it names, and deleting the chosen sets takes their pictures and set cards with them
import { test, expect } from './support/test.js';
import { ASSET_STORE, check, claudeMock, DRAW, PICK_FILES } from './support/harness.js';

const PICTURES = `(${DRAW})([['aa_smile.png',10],['aa_joy.png',50],['bb_smile.png',100],['cc_smile.png',160],['dd_smile.png',220]])`;
const framesWith = t =>
  `Object.fromEntries(Object.entries(DR.charSetsAll()).map(([k,f])=>[k,f.map(x=>(x.tags||[]).includes(${JSON.stringify(t)}))]))`;

test('the set grid: change chosen sets, filter, delete', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(), { size: [1200, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(`(${ASSET_STORE})('a')`);
  await pg.click('[data-tab="images"]');
  await pg.waitForSelector('#upl', { state: 'attached' });
  const files = await pg.evaluate(PICTURES);
  await pg.evaluate(`(${PICK_FILES})(${JSON.stringify(files)})`);
  await pg.waitForFunction('DR.app.images.length===5', null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelector('#uplStat').textContent===''", null, { timeout: 30000 });
  await pg.waitForFunction("document.querySelectorAll('.set-tile').length===4");
  const cols = await pg.evaluate(
    () => getComputedStyle(document.querySelector('.set-grid')).gridTemplateColumns.split(' ').length,
  );
  check(errs, `four or more columns on a wide screen (${cols})`, cols >= 4);

  const pick = k => pg.locator(`[data-tile="${k}"] [data-pickset]`).check();
  await pick('aa');
  await pick('cc');
  await pg.fill('#bulkTag', 'faction:화산파');
  await pg.click('[data-bulk="tagAdd"]');
  await pg.waitForFunction(`${framesWith('faction:화산파')}.aa.every(Boolean)`, null, { timeout: 10000 });
  const tagged = await pg.evaluate(framesWith('faction:화산파'));
  console.log('tagged frames:', tagged);
  check(
    errs,
    'the tag is on every frame of the chosen sets and on no other',
    tagged.aa.every(Boolean) && tagged.cc.every(Boolean) && !tagged.bb.some(Boolean) && !tagged.dd.some(Boolean),
  );

  await pg.selectOption('[data-sflt="id"]', 'faction:화산파');
  const shown = await pg.$$eval('.set-tile', ts => ts.map(t => t.dataset.tile).sort());
  check(errs, `the affiliation filter keeps aa and cc (${shown})`, shown.join() === 'aa,cc');

  await pg.click('[data-bulk="clear"]');
  await pg.click('#setFltReset');
  await pick('aa');
  await pg.evaluate('DR.askConfirm=async()=>true;0');
  await pg.click('[data-bulk="del"]');
  await pg.waitForFunction('!DR.charSetsAll().aa', null, { timeout: 10000 });
  const left = await pg.evaluate(() => ({
    sets: Object.keys(DR.charSetsAll()).sort().join(),
    deleted: window.__deleted.length,
    card: 'aa' in DR.app.setMeta,
  }));
  console.log('after delete:', left);
  check(errs, 'only aa is gone, with both its pictures', left.sets === 'bb,cc,dd' && left.deleted === 2 && !left.card);
  expect(errs).toEqual([]);
});
