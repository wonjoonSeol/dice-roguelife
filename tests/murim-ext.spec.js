// the murim add-on (world-ext.js): old saves moved out of state.murim, bonds the code moves, open roles and profiles,
// none of it in another world's prompt; and picture tags the narrator names as a situation, in every world
import { test, expect } from './support/test.js';
import { check, claudeMock, same, startLife } from './support/harness.js';

// the narrator answers window.__next (merged over a plain reply), first streaming window.__stream when set; a portrait
// pick answers "none"
const MOCK = claudeMock(String.raw`async(p,o)=>{ if(p.startsWith('Pick the portrait'))return{pick:'none'};
  window.__lastPrompt=p;
  if(o&&o.onText&&window.__stream)o.onText({text:window.__stream});
  return Object.assign({admin:'',narration:'장면.',system:[],choices:['a','b'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false},window.__next||{});}`);
const IMAGES = [
  { id: 'm1', kind: 'char', set: 'male1', emotion: 'neutral', name: 'male1_neutral1', tags: ['male1', 'neutral1'] },
  { id: 'm2', kind: 'char', set: 'male1', emotion: 'joy', name: 'male1_joy2', tags: ['male1', 'joy2'] },
  {
    id: 'm3',
    kind: 'char',
    set: 'male1',
    emotion: 'determined',
    name: 'male1_determined11',
    tags: ['male1', 'determined11', 'fighting'],
  },
  { id: 'm4', kind: 'char', set: 'male1', emotion: 'smile', name: 'male1_smile15', tags: ['male1', 'smile15', 'hug'] },
  { id: 'f1', kind: 'char', set: 'female1', emotion: 'neutral', name: 'female1_neutral1', tags: ['female1'] },
  { id: 'f2', kind: 'char', set: 'female2', emotion: 'neutral', name: 'female2_neutral1', tags: ['female2'] },
  {
    id: 'f3',
    kind: 'char',
    set: 'female2',
    emotion: 'smile',
    name: 'female2_smile15',
    tags: ['female2', 'smile15', 'hug'],
  },
];
const SETS = {
  male1: { gender: 'male', role: 'swordsman', worlds: ['murim'] },
  // no fixed name and a profile: an open role, in every world that offers profiles
  female1: {
    gender: 'female',
    role: 'swordswoman',
    profile: { position: '화산파 일대제자', traits: '무뚝뚝', secret: '혈교 첩자' },
  },
  // a named set sharing the name a reply gives the open role: the claim must win, and its profile with it
  female2: { gender: 'female', role: 'noble lady', charName: '설화', profile: { position: '남궁세가 소저' } },
};
async function turn(pg, text, next) {
  await pg.evaluate(n => (window.__next = n), next);
  await pg.fill('#input', text);
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(500);
}
const last = pg => pg.evaluate('JSON.stringify(DR.app.turns[DR.app.turns.length-1].img)').then(JSON.parse);

test('murim add-on', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 860] });
  await pg.waitForTimeout(700);

  // 1) an old murim save: realm and standing move out of state.murim, each field to its own place; twice is the same
  const old = await pg.evaluate(`(() => {
    const st = { life: { world: { id: 'murim', name: '무림' }, originTier: 'C' }, stats: { str: 1, con: 1 }, goldV: 2,
      murim: { realm: 4, neigong: 70, faction: '화산파', rank: '일대제자', alias: '매화검수', constitution: '구음절맥',
        arts: { 검법: '매화검법' } } };
    const a = DR.compat(st);
    const one = JSON.stringify({ ladder: a.ladder, standing: a.standing, murim: a.murim });
    const two = JSON.stringify((b => ({ ladder: b.ladder, standing: b.standing, murim: b.murim }))(DR.compat(a)));
    const h = DR.compat({ life: { world: { id: 'hunter', name: '헌터' }, originTier: 'C' }, stats: { str: 1, con: 1 }, goldV: 2 });
    return { one: JSON.parse(one), same: one === two, hunter: [h.ladder, h.standing, h.murim].every(x => x == null) };
  })()`);
  check(
    errs,
    'old save: realm → ladder, rank → position, alias → epithet, constitution → trait, arts as enums',
    same(old.one, {
      ladder: 4,
      standing: { faction: '화산파', position: '일대제자', epithet: '매화검수', trait: '구음절맥' },
      murim: { neigong: 70, arts: { sword: '매화검법' } },
    }),
  );
  check(errs, 'the move happens once (compat twice gives the same)', old.same);
  check(errs, 'a hunter save gets no ladder, standing or murim', old.hunter === true);

  // 2) a hunter life with the same library: none of the add-on reaches the prompt
  await withLibrary(pg);
  await startLife(pg, { world: 'hunter', dice: false });
  await turn(pg, '둘러본다', {
    memory: { relations: [{ name: '김부장', note: '상사', bond: '🙂' }] },
    situation: 'fighting',
  });
  const hp = await pg.evaluate('window.__lastPrompt');
  const ADDON = ['[현재 처지]', '[무림 rules]', '[입문]', '[호감 단계]', '"situation"', '#female1', '[인물 설정]'];
  check(
    errs,
    'hunter prompt has no add-on block, no open role',
    ADDON.every(x => !hp.includes(x)),
  );
  check(errs, 'hunter: no bonds kept', (await pg.evaluate('DR.app.state.bonds')) == null);
  // picture tags belong to the tag system: a person on stage whose set has frame tags gets them listed, in any world
  await turn(pg, '인사한다', { speaker: '설화', speaker_gender: 'female', emotion: 'neutral' });
  await turn(pg, '바라본다', {});
  const hp2 = await pg.evaluate('window.__lastPrompt');
  check(errs, 'hunter: picture tags of the person on stage', hp2.includes('[그림 태그] 설화: hug'));
  check(errs, 'hunter: still no profile block', !hp2.includes('[인물 설정]'));

  // 3) a murim life, on a fresh page
  const { pg: pm, errs: errs2 } = await game(MOCK, { size: [400, 860] });
  await pm.waitForTimeout(700);
  await murimChecks(pm, errs2);
  errs.push(...errs2);
  expect(errs).toEqual([]);
});

async function withLibrary(pg) {
  await pg.evaluate(
    ([imgs, sets]) => {
      DR.app.images.push(...imgs);
      Object.assign(DR.app.setMeta, sets);
      DR.imagesChanged();
    },
    [IMAGES, SETS],
  );
}

async function murimChecks(pg, errs) {
  await withLibrary(pg);
  await startLife(pg, { world: 'murim', dice: false });
  const p0 = await pg.evaluate('window.__lastPrompt');
  check(errs, 'murim prompt without a sect carries 입문', p0.includes('[입문]'));
  const s0 = JSON.parse(
    await pg.evaluate(
      'JSON.stringify({ladder:DR.app.state.ladder,standing:DR.app.state.standing,murim:DR.app.state.murim})',
    ),
  );
  await turn(pg, '객잔에 들어간다', {
    ladder_up: true,
    standing: { faction: '화산파', epithet: '비객' },
    murim: { neigong: 5, arts: { 검법: '매화검법' } },
    memory: { relations: [{ name: '백리운', note: '사형', bond: '🥰' }] },
  });
  const s1 = JSON.parse(
    await pg.evaluate(
      'JSON.stringify({ladder:DR.app.state.ladder,standing:DR.app.state.standing,murim:DR.app.state.murim,bonds:DR.app.state.bonds})',
    ),
  );
  check(errs, 'ladder_up: one step', s1.ladder === s0.ladder + 1);
  check(
    errs,
    'standing: faction and epithet set, the rest kept',
    same(s1.standing, { ...s0.standing, faction: '화산파', epithet: '비객' }),
  );
  check(
    errs,
    'murim: neigong +5 and the sword slot',
    s1.murim.neigong === s0.murim.neigong + 5 && s1.murim.arts.sword === '매화검법',
  );
  check(errs, 'a first meeting asking 🥰 starts at 😄 (the cap)', s1.bonds['백리운'].s === 5);

  // bonds: a rise is one step and waits BOND_GAP turns; a fall goes as far as asked
  const b = await pg.evaluate(`(() => {
    const out = [];
    out.push(DR.moveBond('백리운', 7)); // too soon after the start
    DR.app.state.bonds['백리운'].up -= 10;
    out.push(DR.moveBond('백리운', 7)); // one step, not two
    out.push(DR.moveBond('백리운', 0)); // a betrayal
    out.push(DR.bondStep('☺'), DR.bondStep('신뢰'), DR.bondStep('in love'), DR.bondStep('🙂 호감'));
    return out;
  })()`);
  check(errs, 'bond: no rise inside the gap', b[0] === null);
  check(errs, 'bond: 😄 → ☺️ only (asked 🥰)', same(b[1], [5, 6]));
  check(errs, 'bond: a fall drops straight to 😡', same(b[2], [6, 0]));
  check(
    errs,
    'bond steps read from emoji without its selector, Korean and English labels, emoji with its word',
    same(b.slice(3), [6, 5, 7, 4]),
  );

  // the prompt: the add-on block, the bond mark, no 입문 once in a sect, the open role
  await turn(pg, '수련한다', {});
  const mp = await pg.evaluate('window.__lastPrompt');
  check(
    errs,
    'murim prompt: standing, rules, bonds rule; no 입문 with a sect',
    mp.includes('[현재 처지]') && mp.includes('[무림 rules]') && mp.includes('[호감 단계]') && !mp.includes('[입문]'),
  );
  check(errs, 'relations show the bond mark', mp.includes('백리운😡'));
  check(
    errs,
    'the open role is listed with its key and the how-to',
    mp.includes('#female1(') && mp.includes('speaker_cast'),
  );

  // situation pictures: the narrator names one of the person's frame tags, and only those frames are used
  await pg.evaluate("DR.app.state.cast['백리운'] = 'male1'");
  // streamed: the face is picked before the situation arrives, and the whole reply picks it again
  await pg.evaluate(
    () =>
      (window.__stream = '{"scene":"inn","speaker":"백리운","speaker_gender":"male","emotion":"determined","admin":""'),
  );
  await turn(pg, '검을 뽑는다', {
    speaker: '백리운',
    speaker_gender: 'male',
    emotion: 'determined',
    situation: 'Fighting',
  });
  const i1 = await last(pg);
  await pg.evaluate(() => (window.__stream = null));
  const tp = await pg.evaluate('window.__lastPrompt');
  await turn(pg, '안는다', { speaker: '백리운', speaker_gender: 'male', emotion: 'joy', situation: 'hug' });
  const i2 = await last(pg);
  await turn(pg, '웃는다', { speaker: '백리운', speaker_gender: 'male', emotion: 'joy', situation: 'meditation' });
  const i3 = await last(pg);
  check(errs, 'situation Fighting (streamed, any case) picks the fighting frame', i1.char === 'm3');
  check(errs, "the person's frame tags reach the prompt", tp.includes('[그림 태그] 백리운: fighting, hug'));
  check(errs, 'situation hug picks the hug frame over the joy emotion', i2.char === 'm4');
  check(errs, 'a situation the set has no frame for is ignored (joy frame)', i3.char === 'm2');

  // a passer-by never gets an open role's face by chance
  await turn(pg, '주문한다', {
    speaker: '점소이',
    speaker_gender: 'female',
    speaker_weight: 'extra',
    emotion: 'smile',
  });
  check(
    errs,
    'an extra does not get the open role female1',
    (await pg.evaluate("DR.app.state.cast['점소이']")) !== 'female1',
  );
  // an open role claimed as listed (#key), with the claim streaming after the emotion: the invented name wears that
  // set even though a named set shares the name, and its profile reaches the next prompt
  await pg.evaluate(
    () =>
      (window.__stream = '{"scene":"inn","speaker":"설화","speaker_gender":"female","emotion":"neutral","admin":""'),
  );
  await turn(pg, '인사한다', {
    speaker: '설화',
    speaker_gender: 'female',
    speaker_weight: 'major',
    speaker_cast: '#female1',
    emotion: 'neutral',
  });
  await pg.evaluate(() => (window.__stream = null));
  const cast = await pg.evaluate("DR.app.state.cast['설화']");
  await turn(pg, '묻는다', {});
  const pp = await pg.evaluate('window.__lastPrompt');
  check(errs, 'speaker_cast gives 설화 the female1 set', cast === 'female1');
  check(
    errs,
    'the profile of the person on stage, with its secret',
    pp.includes('[인물 설정]') && pp.includes('설화(화산파 일대제자): 무뚝뚝; 비밀: 혈교 첩자'),
  );
  check(errs, 'a worn open role leaves the roster', !pp.includes('#female1('));

  // the status window shows the add-on section and the bonds
  await pg.click('#strip');
  await pg.waitForTimeout(300);
  const sw = await pg.evaluate("document.querySelector('.sw').innerText");
  check(
    errs,
    'status window: epithet, sect and a bond chip',
    sw.includes('비객') && sw.includes('화산파') && sw.includes('백리운'),
  );
  await pg.evaluate('DR.closeSheet()');

  // "-" clears a standing field; someone known from an older save gets no bond until a reply gives one, uncapped
  await pg.evaluate("DR.app.state.relations['사형'] = '옛 사형'");
  await turn(pg, '파문당한다', {
    standing: { faction: '-', epithet: '' },
    memory: { relations: [{ name: '사형', note: '여전히 사형' }] },
  });
  const k1 = JSON.parse(await pg.evaluate('JSON.stringify({s:DR.app.state.standing,b:DR.app.state.bonds})'));
  await turn(pg, '사형을 만난다', { memory: { relations: [{ name: '사형', note: '연인', bond: '🥰' }] } });
  const k2 = await pg.evaluate("DR.app.state.bonds['사형'].s");
  check(errs, '"-" clears the sect, an empty field keeps the epithet', k1.s.faction === '' && k1.s.epithet === '비객');
  check(errs, 'a known person without a step gets none from a reply without bond', !k1.b['사형']);
  check(errs, 'then their first bond is taken as given (🥰, past the first-meeting cap)', k2 === 7);
}
