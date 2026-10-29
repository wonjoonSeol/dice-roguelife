// worlds: entry and constellation roll rates, retired worlds in old saves and image labels, a constellation life's channel
import { test, expect } from './support/test.js';
import { MOCK_BASE, check, library, same, pageFn } from './support/harness.js';

const LIVE = library();

const MOCK =
  MOCK_BASE +
  String.raw`
window.__t=0;
window.claude={use:async(n)=>{ if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>true,can:async()=>true};
 if(n==='sample'){const f=async()=>({text:''});f.limits=async()=>({maxPromptBytes:200000});
   f.json=async(p,o)=>{window.__prompts=(window.__prompts||[]);window.__prompts.push(p);const t=++window.__t;
     return {admin:'',narration:'장면.',system:[],choices:['a','b'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false,channel_open:t===2}};
   return f;} return null;}};
`;

test('worlds', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 860] });
  await pg.waitForTimeout(600);
  // 1) the roll: every world rolls an entry and maybe constellations
  const [dist, off] = await pg.evaluate(
    "(()=>{const c={};for(let i=0;i<4000;i++){const l=DR.rollLife('x','남','random',null,null);const k=l.world.id;c[k]=c[k]||{n:0,transfer:0,possess:0,sponsor:0};c[k].n++;if(l.entry!=='native')c[k][l.entry]++;if(l.sponsor)c[k].sponsor++}\n" +
      '      const off=DR.WORLDS.filter(w=>{const v=c[w.id],e=w.entry||{};return !v||[[v.transfer,e.transfer],[v.possess,e.possess],[v.sponsor,w.sponsor]].some(([x,p])=>Math.abs(x/v.n-(p||0))>0.15)}).map(w=>w.id);\n' +
      '      return [Object.fromEntries(Object.entries(c).map(([k,v])=>[k,`n${v.n} tr${Math.round(v.transfer/v.n*100)} po${Math.round(v.possess/v.n*100)} sp${Math.round(v.sponsor/v.n*100)}`])),off]})()',
  );
  console.log('rolls:', dist);
  check(
    errs,
    'every world rolls, entry and constellation rates within 15 points of its settings: ' + JSON.stringify(off),
    off.length === 0,
  );
  const TR = await pg.evaluate(
    "(()=>{const t=DR.TRANSFER_RACES,k=l=>l.map(x=>DR.tIn('ko',x));return {other:k(t.other),earth:k(t.earth)}})()",
  );
  const ERR = '[데이터 없음(ERROR)]'; // one roll in a hundred is the glitch race
  const hr = await pg.evaluate(
    "(()=>{for(let i=0;i<500;i++){const l=DR.rollLife('x','남','hunter',null,null);if(l.entry==='transfer')return l.race}})()",
  );
  console.log('hunter transfer race:', hr);
  const fr = await pg.evaluate(
    "(()=>{for(let i=0;i<500;i++){const l=DR.rollLife('x','남','fantasy',null,null);if(l.entry==='transfer')return l.race}})()",
  );
  console.log('fantasy transfer race:', fr);
  check(
    errs,
    'a transfer into the modern hunter world comes from the other world, into fantasy from ours',
    [...TR.other, ERR].includes(hr) && [...TR.earth, ERR].includes(fr),
  );
  const fb = await pg.evaluate("DR.rollLife('x','남','possess',null,null).world.id!=='possess'");
  console.log('old world choice falls back:', fb);
  check(errs, 'a retired world choice falls back to a live world', fb);
  // 2) old saves: a retired world becomes background + entry
  const cp = await pg.evaluate(
    "JSON.stringify(['isekai','reverse','possess','gamehunter','murim'].map(id=>{const st=DR.compat({life:{world:{id,name:id},originTier:'C'},stats:{str:1,con:1},goldV:2});return[id,st.life.world.id,st.life.entry]}))",
  );
  console.log('compat:', cp);
  check(
    errs,
    'old saves: a retired world becomes its background and entry, a live one stays native',
    same(JSON.parse(cp), [
      ['isekai', 'fantasy', 'transfer'],
      ['reverse', 'hunter', 'transfer'],
      ['possess', 'rofan', 'possess'],
      ['gamehunter', 'hunter', 'native'],
      ['murim', 'murim', 'native'],
    ]),
  );
  // 3) labels: alias at read time, rewrite in the db once
  await pg.evaluate(pageFn('(L)=>{DR.app.images.push(...L.rows);Object.assign(DR.app.setMeta,L.sets)}'), LIVE);
  const al = await pg.evaluate(
    "[DR.worldsOf({worlds:['gamehunter','possess','isekai']}),DR.worldsOf({world:'reverse'})]",
  );
  console.log('alias read:', al);
  check(
    errs,
    'old labels read as their background world; possess named none and drops',
    same(al, [['hunter', 'fantasy'], ['hunter']]),
  );
  const before = await pg.evaluate(
    '[Object.values(DR.app.setMeta).filter(m=>(m.worlds||[]).some(v=>DR.WORLD_ALIAS[v])).length,DR.app.images.filter(x=>(x.worlds||[]).some(v=>DR.WORLD_ALIAS[v])).length]',
  );
  await pg.evaluate('DR.migrateWorldLabels()');
  await pg.waitForTimeout(1500);
  const after = await pg.evaluate(
    '[Object.values(DR.app.setMeta).filter(m=>(m.worlds||[]).some(v=>DR.WORLD_ALIAS[v])).length,DR.app.images.filter(x=>(x.worlds||[]).some(v=>DR.WORLD_ALIAS[v])).length]',
  );
  const stored = await pg.evaluate(
    '(async()=>{const k=Object.keys(DR.app.setMeta)[0];const d=await DR.SETDOC(k).get();return d.exists?d.data().worlds:null})()',
  );
  console.log('labels before/after:', before, after, '| a stored card:', stored);
  check(
    errs,
    'the migration rewrites every old label, in memory and in the db',
    before.reduce((a, b) => a + b, 0) > 0 &&
      same(after, [0, 0]) &&
      !!stored &&
      stored.length > 0 &&
      !stored.some(v => ['gamehunter', 'isekai', 'reverse', 'possess'].includes(v)),
  );
  // 4) a constellation life: blocks, slot card, channel opens once; a plain life ignores channel_open
  // the next two random draws come out 0.01
  await pg.evaluate('DR.rnd=(()=>{let i=0;return()=>{i++;return i<=2?0.01:Math.random()}})();0');
  await pg.evaluate(
    "(()=>{const o=DR.rollLife;DR.rollLife=(...a)=>{const l=o(...a);l.world=DR.worldIn(DR.WORLDS.find(w=>w.id==='hunter'),'ko');l.entry='possess';l.sponsor={stance:'hostile'};return l}})()",
  );
  await pg.fill('#nm', '진무');
  await pg.click('#rollBtn');
  await pg.waitForTimeout(1800);
  const cards = await pg.evaluate("[...document.querySelectorAll('#fate .card small')].map(e=>e.textContent)");
  console.log('fate cards:', cards);
  check(
    errs,
    'a possessor with a constellation gets entry and constellation cards',
    same(cards, ['세계', '종족', '신분', '재능', '출신', '성좌']),
  );
  await pg.click('#acceptBtn');
  await pg.waitForTimeout(900);
  const intro = await pg.evaluate('window.__prompts.slice(-1)[0]');
  console.log(
    'intro extra:',
    intro.includes('출신 빙의자') && intro.includes('성좌 있음(ADMIN과 적대)'),
    '| entry block:',
    intro.includes('[출신] 빙의자'),
    '| closed block:',
    intro.includes('채널은 아직 닫혀'),
  );
  check(
    errs,
    'the opening prompt names the entry and the constellation, and the channel starts closed',
    intro.includes('출신 빙의자') &&
      intro.includes('성좌 있음(ADMIN과 적대)') &&
      intro.includes('[출신] 빙의자') &&
      intro.includes('채널은 아직 닫혀'),
  );
  await pg.fill('#input', '간다');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(900);
  await pg.fill('#input', '또 간다');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(900);
  const last = await pg.evaluate('window.__prompts.slice(-1)[0]');
  let co = await pg.evaluate('DR.app.state.channelOpen');
  console.log('channel open:', co, '| open block:', last.includes('성좌 채널이 열려'));
  check(
    errs,
    'the channel opens when the narrator says so and the next prompt says it is open',
    co === true && last.includes('성좌 채널이 열려') && !last.includes('채널은 아직 닫혀'),
  );
  await pg.evaluate('DR.app.state.life.sponsor=null;DR.app.state.channelOpen=false');
  await pg.evaluate("DR.applyOut(DR.normalize({narration:'x',choices:['a'],channel_open:true}))");
  co = await pg.evaluate('DR.app.state.channelOpen');
  console.log('plain life ignores channel_open:', co);
  check(errs, 'a life without a constellation ignores channel_open', co === false);
  expect(errs).toEqual([]);
});
