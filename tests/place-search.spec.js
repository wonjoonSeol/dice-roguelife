// places are searched by English words, kind first; a wrong picture is worse than none
import { test, expect } from './support/test.js';
import { MOCK_BASE, library, startLife } from './support/harness.js';

const LIVE = library();
const MOCK =
  MOCK_BASE +
  String.raw`
window.claude={use:async(n)=>{ if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>true,can:async()=>true};
 if(n==='sample'){const f=async()=>({text:''});f.limits=async()=>({maxPromptBytes:262144});f.json=async(p)=>({admin:'',narration:'첫 문단.\n\n[[@subway, platform]]\n\n아래로.\n\n[[@hwasanpa, pine path, stone steps, morning mist]]\n\n끝.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0,time:'오전 10시',place:'역 물품보관함 앞'},memory:{},dead:false,scene:'station, locker'});return f;} return null;}};
`;
const CASES = [
  ['station, locker', 'station-lobby'],
  ['station, stairs', 'station-lobby'],
  ['subway, platform', 'subway'],
  ['bus stop', 'bus-stop'],
  ['bus-stop', 'bus-stop'],
  ['alley, back', ['alley', 'terno-back-alley']],
  ['abandoned house, redevelopment', null],
  ['pc room', null],
  ['computer room', 'computer-room'],
  ['phone shop, repair', null],
  ['shop, phone', 'shop'],
  ['convenience store', 'convenience-store'],
  ['motel, room', null],
  ['office, corporate', 'office'],
  ['hospital, ward', 'hospital'],
  ['guild hall', null],
  ['guild', 'guild'],
  ['tavern, crowded', 'tavern'],
  ['inn, room', 'inn-room'],
  ['street, market', 'street'],
  ['warehouse, dark', 'warehouse'],
  ['police station', null],
];

test('place search', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 860] });
  await pg.waitForTimeout(500);
  await pg.evaluate(L => {
    DR.app.images.push(...L.rows);
    Object.assign(DR.app.setMeta, L.sets);
  }, LIVE);
  await startLife(pg, { world: 'hunter', dice: false });
  let bad = 0;
  console.log('spot remembered by the turn:', await pg.evaluate('JSON.stringify(DR.app.state.placeMap)'));
  for (const [q, want] of CASES) {
    const got = await pg.evaluate(q => {
      const f = DR.findPlace(q, '오전 10시', '');
      return f ? f.base : null;
    }, q);
    const ok = Array.isArray(want) ? want.includes(got) : got === want;
    bad += Number(!ok);
    console.log(`${ok ? 'ok ' : 'BAD'} ${q.padEnd(32)} -> ${got}${ok ? '' : '   (want ' + JSON.stringify(want) + ')'}`);
  }
  // a spot seen before keeps its picture even when the words find nothing
  const mem = await pg.evaluate(
    "(()=>{DR.app.state.placeMap={'재개발 구역 빈집':'cottage-room'};const f=DR.findPlace('house, empty','오전 7시','재개발 구역 빈집');return f?f.base+' '+f.via:null})()",
  );
  console.log('memory:', mem);
  bad += Number(mem !== 'cottage-room memory');
  // a long mark the narrator wrote (a proper noun and a list) is never shown as raw text in the story
  const raw = await pg.evaluate(() => document.querySelector('#log').textContent.includes('[['));
  console.log('raw mark in the story:', raw);
  bad += Number(raw);
  const v = await pg.evaluate(
    "(()=>{const v=DR.placeVocab();return[v.length,new TextEncoder().encode(v.join(', ')).length]})()",
  );
  console.log('vocab words', v[0], 'bytes', v[1]);
  const t = await pg.evaluate(
    'JSON.stringify({img:DR.app.turns[DR.app.turns.length-1].img,map:DR.app.state.placeMap})',
  );
  console.log('end-to-end turn:', t);
  expect(bad).toEqual(0);
  expect(errs).toEqual([]);
});
