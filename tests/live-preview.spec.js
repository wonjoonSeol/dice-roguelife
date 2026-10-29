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

// a life's first reply shows an opening, from the stored list: a hunter sequence of a background, a face and a
// v2.16.4 row of the old opening kind (its order:1 puts it first, then panel 2 before panel 10), a murim sequence,
// pictures tagged game-master (one for every world, one for murim) and the admin set, which only comes after them
const OPENING = [
  { id: 'o2', kind: 'scene', name: 'panel_10', file: 'panel 10.png', worlds: ['hunter'], tags: ['opening'] },
  { id: 'o1', kind: 'char', set: 'x', name: 'x_neutral', file: 'panel 2.png', worlds: ['hunter'], tags: ['opening'] },
  { id: 'o3', kind: 'opening', set: '', order: 1, name: 'opening_1', file: 'z.png', worlds: ['hunter'], tags: [] },
  { id: 'm1', kind: 'scene', name: 'm', file: 'a.png', worlds: ['murim'], tags: ['opening:murim'] },
  { id: 'g1', kind: 'char', set: 'gm', emotion: 'neutral', name: 'gm_neutral', worlds: [], tags: ['game-master'] },
  { id: 'g2', kind: 'scene', name: 'hall', worlds: ['murim'], tags: ['game-master'] },
  { id: 'a1', kind: 'char', set: 'admin', emotion: 'neutral', name: 'admin_neutral', tags: [] },
];
const STORED = `__store.set('imgidx/0000',${JSON.stringify({ p: 0, n: OPENING.length, rows: OPENING })});`;
// the first reply's stored opening, its banner, and the frames on screen in order
const openingOf = pg =>
  pg.evaluate(() => {
    const ti = DR.app.turns.find(t => t.kind === 'ai').img;
    const shown = [...document.querySelectorAll('.turn .opening .op-frame')].map(x => x.getAttribute('src'));
    return [ti.opening || null, ti.banner || null, shown];
  });
const withLibrary = async (pg, world) => {
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(L => {
    DR.app.images.push(...L.rows);
    Object.assign(DR.app.setMeta, L.sets);
  }, library());
  await startLife(pg, { world });
  await pg.waitForFunction('DR.app.turns.length>0&&DR.isIdle()', null, { timeout: 20000 });
};

test('live preview', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J, { before: STORED }), { size: [420, 900] });
  await withLibrary(pg, 'hunter');
  const op = await openingOf(pg);
  console.log('hunter opening:', JSON.stringify(op));
  if (!same(op, [['o3', 'o1', 'o2'], null, ['/_blob/o3', '/_blob/o1', '/_blob/o2']]))
    errs.push("a hunter life's first reply did not show the hunter sequence in frame order");
  const other = await game(claudeMock(J, { before: STORED }), { size: [420, 900] });
  await withLibrary(other.pg, 'modern');
  const fb = await openingOf(other.pg);
  console.log('modern opening:', JSON.stringify(fb));
  if (!same(fb, [null, 'g1', ['/_blob/g1']]))
    errs.push('with no sequence for the world, the first reply did not show the game-master picture that fits');
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
