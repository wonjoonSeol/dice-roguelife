// the banner and face are picked once per streaming reply: a redraw of the log in the middle of the stream keeps them
import { test, expect } from './support/test.js';
import { claudeMock, library, same, startLife } from './support/harness.js';

// the reply streams in two chunks with a redraw of the log between them, as a toast or a tab switch would cause
const J = String.raw`async(p,o)=>{
  if(window.__stream&&o&&o.onText){
    o.onText({text:'{"admin":"어서 와","scene":"alley, day","speaker":null,"narration":"골목으로'});
    window.__first=DR.app.turn&&DR.app.turn.preview; window.__shown1=!!document.querySelector('#liveBox .scene');
    DR.renderLog('live'); window.__shown2=!!document.querySelector('#liveBox .scene');
    o.onText({text:'{"admin":"어서 와","scene":"alley, day","speaker":null,"narration":"골목으로 들어선다'});
    window.__same=DR.app.turn&&DR.app.turn.preview===window.__first; window.__text=document.querySelector('#livePrev').textContent;}
  return {admin:'',narration:'골목으로 들어선다.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false,scene:'alley, day'}}`;

// a life's first reply shows an opening: a hunter sequence (listed out of order), a murim one, bg_game-master
// backgrounds (one for every world, one for murim) and the admin set, which only comes after them
const OPENING = [
  { id: 'o2', kind: 'opening', set: '', order: 2, name: 'opening_2', worlds: ['hunter'], world: 'hunter', tags: [] },
  { id: 'o1', kind: 'opening', set: '', order: 1, name: 'opening_1', worlds: ['hunter'], world: 'hunter', tags: [] },
  { id: 'm1', kind: 'opening', set: 'murim', order: 1, name: 'opening_murim_1', worlds: ['murim'], world: 'murim' },
  { id: 'g1', kind: 'scene', name: 'game-master_indoor', worlds: [], world: 'any', tags: [] },
  { id: 'g2', kind: 'scene', name: 'game-master_hall', worlds: ['murim'], world: 'murim', tags: [] },
  { id: 'a1', kind: 'char', set: 'admin', emotion: 'neutral', name: 'admin_neutral', tags: [] },
];
// the first reply's stored opening, its banner, and the frames on screen in order
const openingOf = pg =>
  pg.evaluate(() => {
    const ti = DR.app.turns.find(t => t.kind === 'ai').img;
    const shown = [...document.querySelectorAll('.turn .opening .op-frame')].map(x => x.getAttribute('src'));
    return [ti.opening || null, ti.banner || null, shown];
  });
const withLibrary = async (pg, world) => {
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(
    ([L, O]) => {
      DR.app.images.push(...L.rows, ...O);
      Object.assign(DR.app.setMeta, L.sets);
    },
    [library(), OPENING],
  );
  await startLife(pg, { world });
  await pg.waitForFunction('DR.app.turns.length>0&&DR.isIdle()', null, { timeout: 20000 });
};

test('live preview', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J), { size: [420, 900] });
  await withLibrary(pg, 'hunter');
  const op = await openingOf(pg);
  console.log('hunter opening:', JSON.stringify(op));
  if (!same(op, [['o1', 'o2'], null, ['/_blob/o1', '/_blob/o2']]))
    errs.push("a hunter life's first reply did not show the hunter sequence in frame order");
  const other = await game(claudeMock(J), { size: [420, 900] });
  await withLibrary(other.pg, 'modern');
  const fb = await openingOf(other.pg);
  console.log('modern opening:', JSON.stringify(fb));
  if (!same(fb, [null, 'g1', ['/_blob/g1']]))
    errs.push('with no sequence for the world, the first reply did not show the bg_game-master banner that fits');
  errs.push(...other.errs);
  const n = await pg.evaluate('DR.app.turns.length');
  await pg.evaluate('window.__stream=true;0');
  await pg.fill('#input', '골목으로 간다');
  await pg.press('#input', 'Enter');
  await pg.waitForFunction(`DR.app.turns.length>${n}+1&&DR.isIdle()`, null, { timeout: 20000 });
  const r = await pg.evaluate(
    '({first:!!window.__first, shown1:window.__shown1, shown2:window.__shown2, same:window.__same, text:window.__text, img:DR.app.turns[DR.app.turns.length-1].img.scene, picked:window.__first&&window.__first.scene})',
  );
  console.log(
    'preview picked:',
    r.first,
    '| banner before / after the redraw:',
    r.shown1,
    r.shown2,
    '| same pick after it:',
    r.same,
    '| live text:',
    JSON.stringify(r.text),
    '| reply banner is the pick:',
    same(r.img, r.picked),
  );
  if (!(r.first && r.shown1 && r.shown2 && r.same && same(r.img, r.picked))) {
    errs.push('the preview was lost or picked again after a redraw');
  }
  if (r.text !== '골목으로 들어선다') errs.push('the live narration did not follow the stream');
  expect(errs).toEqual([]);
});
