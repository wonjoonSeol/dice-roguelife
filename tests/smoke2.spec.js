// one murim turn: the speaker's face, the realm step and arts, the code-counted clock and age, the backdrop, and a prompt with this world's place words only
import { test, expect } from './support/test.js';
import { MOCK_BASE, check, same, shot, startLife } from './support/harness.js';

const MOCK =
  MOCK_BASE +
  String.raw`
window.claude={use:async(n)=>{
 if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>true,can:async()=>true};
 if(n==='sample'){const f=async()=>({text:''});
   f.limits=async()=>({maxPromptBytes:200000});
   f.json=async(p,o)=>{ window.__lastPrompt=p;
     return {admin:'',narration:'객잔에서 검객이 당신을 본다.',system:[],choices:['인사한다','무시한다'],stat_changes:{hp:-1},
       clock:{date:'대명력 31년 3월 15일',time:'13:00',weather:'비',place:'낙양 객잔',days_passed:400},
       ladder_up:true,standing:{epithet:'비객'},murim:{neigong:5,arts:{'검법':'매화검법'}},
       scene:'inn_night',speaker:'백리운',speaker_gender:'male',speaker_role:'검객',emotion:'smile',memory:{},dead:false};};
   return f;}
 return null;}};
`;

test('smoke2', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 860] });
  await pg.waitForTimeout(700);
  await pg.evaluate(
    "DR.app.images.push({id:'a1',kind:'char',set:'male1',emotion:'neutral',name:'male1_neutral'},{id:'a2',kind:'char',set:'male1',emotion:'joy',name:'male1_joy'},{id:'a3',kind:'char',set:'female1',emotion:'smile',name:'female1_smile'},{id:'b1',kind:'scene',name:'inn_night',world:'murim'},{id:'b2',kind:'scene',name:'castle_day',world:'fantasy'})",
  );
  await startLife(pg, { world: 'murim', dice: false });
  const s0 = JSON.parse(
    await pg.evaluate(
      'JSON.stringify({murim:DR.app.state.murim,ladder:DR.app.state.ladder,day:DR.app.state.clock.day,age:DR.app.state.stats.age,lim:DR.LIMITS.move,top:DR.REALMS.length-1})',
    ),
  );
  await pg.fill('#input', '객잔에 들어간다');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(500);
  let r = await pg.evaluate(
    'JSON.stringify({cast:DR.app.state.cast,murim:DR.app.state.murim,ladder:DR.app.state.ladder,standing:DR.app.state.standing,clock:DR.app.state.clock,age:DR.app.state.stats.age,lastImg:DR.app.turns[DR.app.turns.length-1].img})',
  );
  console.log(r);
  r = JSON.parse(r);
  const M = r.murim;
  const M0 = s0.murim;
  const c = r.clock;
  check(errs, 'the speaker 백리운 gets the male face', same(r.cast, { 백리운: 'male1' }));
  check(
    errs,
    'murim: one realm step, +5 years of neigong, epithet and art recorded',
    r.ladder === Math.min(s0.ladder + 1, s0.top) &&
      M.neigong === M0.neigong + Math.min(5, s0.lim.neigong) &&
      r.standing.epithet === '비객' &&
      M.arts.sword === '매화검법', // the Korean slot name in a reply is stored as its enum
  );
  const day = s0.day + Math.min(400, s0.lim.days);
  check(
    errs,
    'clock: the code counts the days and the age; time, weather, place and a fictional-era date as reported',
    c.day === day &&
      r.age === s0.age + Math.floor(day / 365) - Math.floor(s0.day / 365) &&
      same([c.date, c.time, c.weather, c.place], ['대명력 31년 3월 15일', '13:00', '비', '낙양 객잔']),
  );
  check(
    errs,
    'the murim inn backdrop and 백리운 smiling (joy frame)',
    r.lastImg.scene === 'b1' && r.lastImg.char === 'a2' && same(r.lastImg.chars, [{ id: 'a2', npc: '백리운' }]),
  );
  const pr = await pg.evaluate('window.__lastPrompt');
  console.log(
    'prompt bytes',
    Buffer.byteLength(pr, 'utf8'),
    '| has bg list:',
    pr.includes('[장소 단어]'),
    '| castle leak:',
    pr.includes('castle_day'),
    '| murim rules:',
    pr.includes('[무림 rules]'),
  );
  check(
    errs,
    'the prompt lists the place words of this world only and carries the murim rules',
    pr.includes('[장소 단어]') && !pr.includes('castle_day') && pr.includes('[무림 rules]'),
  );
  await pg.screenshot({ path: shot('m1.png') });
  await pg.click('#strip');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: shot('m2.png') });
  await pg.evaluate("DR.closeSheet();DR.showTab('images')");
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: shot('m3.png'), fullPage: true });
  expect(errs).toEqual([]);
});
