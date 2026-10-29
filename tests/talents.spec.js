// free setup takes up to five talents, each its own skill; non-owners stay capped at C on every row
import { test, expect } from './support/test.js';
import { MOCK_BASE, check, same } from './support/harness.js';

function mock(owner) {
  return (
    MOCK_BASE +
    String.raw`
window.__prompts=[];
window.claude={use:async(n)=>{ if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>${owner ? 'true' : 'false'},can:async()=>true};
 if(n==='sample'){const f=async()=>({text:''});f.limits=async()=>({maxPromptBytes:262144});f.json=async(p)=>{window.__prompts.push(p);return{admin:'',narration:'장면.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false}};return f;} return null;}};
`
  );
}

test('talents owner', async ({ game }) => {
  // owner: three talents with their own grades
  const { pg, errs } = await game(mock(true), { size: [420, 1300] });
  await pg.waitForTimeout(700);
  await pg.fill('#nm', '진무');
  await pg.click('[data-w="murim"]');
  await pg.click('#mseg [data-m="free"]');
  const rows = [
    ['B', '검에 대한 집착', '검을 잡으면 집중력이 오른다'],
    ['A', '독 내성', '웬만한 독에 버틴다'],
    ['C', '잔재주', '요리와 청소'],
  ];
  for (const [k, [g, n, d]] of rows.entries()) {
    if (k) await pg.click('#addTalent');
    const r = `#talents .trow >> nth=${k}`;
    await pg.selectOption(r + ' >> .tt', g);
    await pg.fill(r + ' >> .tn', n);
    await pg.fill(r + ' >> .td', d);
  }
  for (let i = 0; i < 5; i++) {
    if (!(await pg.evaluate("document.querySelector('#addTalent').disabled"))) await pg.click('#addTalent');
  }
  const many = await pg.evaluate("document.querySelectorAll('#talents .trow').length");
  const capped = await pg.evaluate("document.querySelector('#addTalent').disabled");
  console.log('rows after many +:', many, '| + disabled at max:', capped);
  check(errs, 'at most five talent rows, and + turns off at five', many === 5 && capped === true);
  await pg.click('#talents .trow >> nth=4 >> .tx');
  const fewer = await pg.evaluate("document.querySelectorAll('#talents .trow').length");
  console.log('after one ×:', fewer);
  check(errs, '× removes one row', fewer === 4);
  await pg.click('#rollBtn');
  await pg.waitForTimeout(1500);
  await pg.click('#acceptBtn');
  await pg.waitForTimeout(800);
  const skills = JSON.parse(await pg.evaluate('JSON.stringify(DR.app.state.skills.map(k=>[k.name,k.grade,k.src]))'));
  console.log('skills:', skills);
  // the three filled rows; the two empty ones add nothing
  check(
    errs,
    'each filled talent becomes its own skill with its own grade',
    same(skills, [
      ['검에 대한 집착', 'B', 'talent'],
      ['독 내성', 'A', 'talent'],
      ['잔재주', 'C', 'talent'],
    ]),
  );
  const line = (await pg.evaluate('window.__prompts.slice(-1)[0]')).split('\n').find(l => l.startsWith('[스킬]')) || '';
  console.log('in prompt:', line.slice(0, 160));
  check(
    errs,
    'the narrator sees every talent with its grade and description',
    ['검에 대한 집착(B, Lv.1): 검을 잡으면', '독 내성(A, Lv.1): 웬만한 독', '잔재주(C, Lv.1): 요리와 청소'].every(x =>
      line.includes(x),
    ),
  );
  expect(errs).toEqual([]);
});

test('talents non owner', async ({ game }) => {
  // non-owner: every talent row, including added ones, is capped at C, and Random (the fair odds) stays open
  const { pg, errs } = await game(mock(false), { size: [420, 1300] });
  await pg.waitForTimeout(700);
  await pg.waitForTimeout(300);
  await pg.evaluate("document.querySelector('#addTalent').click();0");
  await pg.waitForTimeout(100);
  const rows = await pg.evaluate(
    "[...document.querySelectorAll('#talents .tt')].map(s=>[s.value,[...s.options].filter(o=>o.disabled).length])",
  );
  console.log('non-owner rows locked:', rows);
  check(
    errs,
    'every row, the added one too, sits at Random with the grades above C locked',
    rows.length === 2 && rows.every(([v, locked]) => v === 'random' && locked > 0 && locked === rows[0][1]),
  );
  // the default Random rolls the usual odds; a picked grade stays
  const g = await pg.evaluate(() => {
    const ot = document.querySelector('#fOT'),
      tt = document.querySelector('#talents .tt');
    const roll = () => {
      const o = new Set(),
        t = new Set();
      for (let i = 0; i < 300; i++) {
        const l = DR.rollLife(
          'x',
          'male',
          'murim',
          { race: '', originTier: ot.value, talentTier: tt.value, age: '' },
          null,
        );
        o.add(l.originTier);
        t.add(l.talentTier);
      }
      return [o.size, t.size, [...o, ...t].join()];
    };
    const open = roll();
    ot.value = 'D';
    tt.value = 'C';
    return { open, picked: roll() };
  });
  console.log('grades:', JSON.stringify(g));
  check(
    errs,
    'the default Random gives many grades, a picked one is pinned',
    g.open[0] > 1 && g.open[1] > 1 && same(g.picked, [1, 1, 'D,C']),
  );
  expect(errs).toEqual([]);
});
