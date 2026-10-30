// the face button opens the picker on older turns, says why when it cannot, and errors are written down
import { test, expect } from './support/test.js';
import { claudeMock, startLife } from './support/harness.js';

const J =
  "async()=>{const n=(window.__n=(window.__n||0)+1);return{admin:'',narration:'[[칼자국]]\\n\\n\"왔냐.\" 장면 '+n,speaker:'칼자국',speaker_gender:'male',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false}}";

test('face button', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J), { size: [420, 900] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  for (let k = 0; k < 3; k++) {
    await pg.fill('#input', `간다 ${k}`);
    await pg.press('#input', 'Enter');
    await pg.waitForTimeout(500);
  }
  await pg.evaluate(`(()=>{const px='data:image/gif;base64,R0lGODlhAQABAAAAACw=';DR.app.images=[{id:'f1',kind:'char',set:'male1',name:'male1',url:px,tags:['male']},{id:'f2',kind:'char',set:'male2',name:'male2',url:px,tags:['male']}];
      for(const t of DR.app.turns)if(t.kind==='ai')t.img={chars:[{id:'f1',npc:'칼자국'}]};DR.renderLog('keep')})();0`);
  const btns = await pg.evaluate("[...document.querySelectorAll('[data-face]')].map(b=>+b.dataset.face)");
  await pg.evaluate(`document.querySelector('[data-face="${btns[0]}"]').click();0`);
  await pg.waitForTimeout(300);
  const opened = await pg.evaluate("!document.querySelector('#sheet').classList.contains('hidden')");
  await pg.evaluate(
    "DR.closeSheet();DR.app.phase='narrating';window.__t=[];const t0=DR.toast;DR.toast=(m,ms)=>{window.__t.push(m);t0(m,ms)};0",
  );
  await pg.evaluate(`document.querySelector('[data-face="${btns[0]}"]').click();DR.app.phase='idle';0`);
  const said = await pg.evaluate("window.__t.slice(-1)[0]||''");
  await pg.evaluate("DR.openCast=()=>{throw new Error('boom')};0");
  await pg.evaluate(`document.querySelector('[data-face="${btns[0]}"]').click();0`);
  await pg.waitForTimeout(200);
  const logged = await pg.evaluate("DR.ERRLOG.some(e=>e.stage==='face'&&e.msg.includes('boom'))");
  console.log(
    'older turn opens:',
    opened,
    '| while busy says:',
    JSON.stringify(said),
    '| a failure is logged:',
    logged,
  );
  if (!(opened && said.includes('답을 쓰는 중') && logged)) errs.push('face button not robust');
  expect(errs).toEqual([]);
});

// a faceless figure is shared by any number of people; a real face another person holds is swapped
test('a silhouette is shared, a face is swapped', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J), { size: [420, 900] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  await pg.fill('#input', '간다');
  await pg.press('#input', 'Enter');
  await pg.waitForFunction('DR.isIdle()&&DR.app.turns.some(t=>t.kind==="ai"&&t.out.narration.includes("장면"))');
  await pg.evaluate(`(()=>{const px='data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    DR.app.images=['male1','male2','shadow_male'].map((k,i)=>({id:'f'+i,kind:'char',set:k,name:k+'_neutral',emotion:'neutral',url:px,tags:['male']}));
    Object.assign(DR.app.setMeta,{male1:{gender:'male'},male2:{gender:'male'},shadow_male:{gender:'male',tier:'generic'}});
    DR.imagesChanged&&DR.imagesChanged();DR.setsChanged&&DR.setsChanged();
    DR.app.state.cast={'칼자국':'male1','행인':'shadow_male','도적':'male2'};
    const t=[...DR.app.turns].reverse().find(t=>t.kind==='ai');t.img={chars:[{id:'f0',npc:'칼자국'}]};DR.renderLog('keep')})();0`);
  const pick = async k => {
    await pg.evaluate("[...document.querySelectorAll('[data-face]')].pop().click();0");
    await pg.waitForSelector(`#castGrid [data-pick="${k}"]`, { timeout: 5000 });
    await pg.click(`#castGrid [data-pick="${k}"]`);
    await pg.waitForTimeout(300);
    return pg.evaluate('JSON.stringify(DR.app.state.cast)');
  };
  const shared = JSON.parse(await pick('shadow_male'));
  const swapped = JSON.parse(await pick('male2'));
  console.log('after the silhouette:', shared, '| after the face:', swapped);
  if (!(shared['칼자국'] === 'shadow_male' && shared['행인'] === 'shadow_male'))
    errs.push('the silhouette was not shared');
  if (!(swapped['칼자국'] === 'male2' && swapped['도적'] === 'shadow_male')) errs.push('a held face was not swapped');
  expect(errs).toEqual([]);
});

// the picker's filters: this person's group keeps another sect's face and silhouette out, the kind keeps silhouettes
test('the face picker filters by group and kind', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J), { size: [420, 900] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  await pg.fill('#input', '간다');
  await pg.press('#input', 'Enter');
  await pg.waitForFunction('DR.isIdle()&&DR.app.turns.some(t=>t.kind==="ai"&&t.out.narration.includes("장면"))');
  await pg.evaluate(`(()=>{const px='data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const S={plain_m:['young man'],hwasan_m:['faction:정파','faction:화산파'],cheong_m:['faction:정파','faction:청성파'],shadow_male:[],shadow_sapa:['faction:사파']};
    DR.app.images=Object.entries(S).map(([k,tags],i)=>({id:'f'+i,kind:'char',set:k,name:k+'_neutral',emotion:'neutral',url:px,tags}));
    for(const k of Object.keys(S))DR.app.setMeta[k]=k.startsWith('shadow')?{gender:'male',tier:'generic'}:{gender:'male'};
    DR.imagesChanged();DR.setsChanged();
    DR.app.state.cast={'칼자국':'plain_m'};DR.app.state.castWhy={'칼자국':{look:['faction:화산파'],role:[]}};
    const t=[...DR.app.turns].reverse().find(t=>t.kind==='ai');t.img={chars:[{id:'f0',npc:'칼자국'}]};DR.renderLog('keep')})();0`);
  await pg.evaluate("[...document.querySelectorAll('[data-face]')].pop().click();0");
  await pg.waitForSelector('#castGrid [data-pick]');
  const grid = () =>
    pg.$$eval('#castGrid [data-pick]', bs =>
      bs
        .map(b => b.dataset.pick)
        .sort()
        .join(),
    );
  await pg.selectOption('[data-fpf="id"]', 'own');
  const own = await grid();
  await pg.selectOption('[data-fpf="id"]', '');
  await pg.selectOption('[data-fpf="kind"]', 'generic');
  const gens = await grid();
  console.log('own group:', own, '| silhouettes:', gens);
  if (own !== 'hwasan_m,shadow_male') errs.push("this person's group lets another group in: " + own);
  if (gens !== 'shadow_male,shadow_sapa') errs.push('the kind filter is off: ' + gens);
  expect(errs).toEqual([]);
});
