// the modern world: in the picker, a life there (local money, humans only, no constellations unless the player asks),
// and the profile lean when the narrator can't read the profile (the regex fallback)
import { test, expect } from './support/test.js';
import { check, claudeMock, same, startLife } from './support/harness.js';

// the affinity prompt gets no answer, so the fallback reads the profile
const MOCK = claudeMock(
  "async p=>{window.__prompts.push(p);if(p.includes('세계 목록:'))return null;return{admin:'',narration:'장면.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false}}",
  { before: 'window.__prompts=[];' },
);

// what the fallback reads in a profile: fill it, roll with the dice, read what profileAffinity stored
async function affOf(pg, profile) {
  await pg.evaluate('DR.startNewLifeForm();0');
  await pg.waitForTimeout(300);
  await pg.fill('#nm', '진무');
  await pg.fill('#prof', profile);
  await pg.click('#rollBtn');
  await pg.waitForTimeout(800);
  return pg.evaluate(t => {
    const a = DR.app.settings.profileAff;
    return a && a.text === t ? a.data : null;
  }, profile);
}
const leanOf = async (pg, profile) => ((await affOf(pg, profile)) || {}).worlds || null;

test('modern world', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 1400] });
  await pg.waitForTimeout(600);
  const ERR = await pg.evaluate("DR.tIn('ko', '[No data (ERROR)]')"); // one roll in a hundred is the glitch race
  // 1) the picker and the guide
  const label = await pg.textContent('#wseg [data-w="modern"]');
  const guide = await pg.evaluate(
    "[...document.querySelectorAll('.newlife .odds p')].map(p=>p.textContent).find(t=>t.startsWith('세계'))",
  );
  console.log('picker:', label, '| guide:', guide);
  check(errs, 'the world picker lists 현대', label === '현대');
  check(errs, 'the guide counts every world', guide.startsWith(`세계 ${await pg.evaluate('DR.WORLDS.length')}개 중`));
  // 2) the rolls: difficulty 1-3, humans only, no constellations at random, but Yes in the custom setup gives them
  const r = await pg.evaluate(() => {
    const free = s => ({
      race: '',
      originTier: 'C',
      origin: '',
      talentTier: 'C',
      talent: '',
      talentDesc: '',
      age: '',
      sponsor: s,
    });
    const out = { n: 0, diff: new Set(), native: new Set(), transfer: new Set(), sponsor: 0, random: 0, on: 0 };
    const creature = Object.values(DR.ORIGINS)
      .flat()
      .filter(DR.creatureRace)
      .map(x => DR.tIn('ko', x)); // a dog or a cat is its own race
    for (let i = 0; i < 600; i++) {
      const l = DR.rollLife('x', 'male', 'modern', null, null);
      out.n += l.world.id === 'modern' ? 1 : 0;
      out.diff.add(l.diff);
      if (!creature.includes(l.origin)) out[l.entry === 'transfer' ? 'transfer' : 'native'].add(l.race);
      if (l.sponsor) out.sponsor++;
      if (DR.rollLife('x', 'male', 'modern', free('random'), null).sponsor) out.random++;
      if (DR.rollLife('x', 'male', 'modern', free('on'), null).sponsor) out.on++;
    }
    const other = DR.TRANSFER_RACES.other.map(x => DR.tIn('ko', x));
    return { ...out, diff: [...out.diff].sort(), native: [...out.native], transfer: [...out.transfer], other };
  });
  console.log('rolls:', JSON.stringify(r));
  check(errs, 'every roll is in the modern world', r.n === 600);
  check(errs, `difficulty covers 1-3 and no more: ${r.diff}`, same(r.diff, [1, 2, 3]));
  check(
    errs,
    `a native or a possessor is human: ${r.native}`,
    r.native.every(x => x === '인간' || x === ERR),
  );
  check(
    errs,
    `a transmigrator comes from the world of swords and magic: ${r.transfer}`,
    r.transfer.length > 0 && r.transfer.every(x => r.other.includes(x) || x === ERR),
  );
  check(errs, 'no constellations by the dice or by Random', r.sponsor === 0 && r.random === 0);
  check(errs, 'Yes in the custom setup brings constellations', r.on === 600);
  // origins and talents that need powers never come in the modern world; hunter still rolls them and never the
  // modern-only ones; every tier keeps at least two of each for the modern world
  const pool = await pg.evaluate(() => {
    const W = id => DR.WORLDS.find(w => w.id === id);
    const all = [...Object.values(DR.ORIGINS).flat(), ...Object.values(DR.TALENTS).flatMap(t => t.map(x => x[0]))];
    const ko = l => l.map(x => DR.tIn('ko', x));
    const magic = ko(all.filter(x => !DR.inPool(W('modern'), x))),
      plain = ko(all.filter(x => !DR.inPool(W('hunter'), x)));
    const got = id => {
      const s = new Set();
      for (let i = 0; i < 600; i++) {
        const l = DR.rollLife('x', 'male', id, null, null);
        s.add(l.origin).add(l.talent.name);
      }
      return [...s];
    };
    const m = got('modern'),
      h = got('hunter');
    const thin = DR.TIERS.filter(
      t =>
        DR.ORIGINS[t].filter(x => DR.inPool(W('modern'), x)).length < 2 ||
        DR.TALENTS[t].filter(x => DR.inPool(W('modern'), x[0])).length < 2,
    );
    return {
      magic: magic.length,
      plain: plain.length,
      modernMagic: m.filter(x => magic.includes(x)),
      modernPlain: m.filter(x => plain.includes(x)).length,
      hunterMagic: h.filter(x => magic.includes(x)).length,
      hunterPlain: h.filter(x => plain.includes(x)),
      thin,
    };
  });
  console.log('pools:', JSON.stringify(pool));
  check(errs, `a modern life rolls nothing that needs powers: ${pool.modernMagic}`, pool.modernMagic.length === 0);
  check(errs, 'a hunter life still rolls powers', pool.magic > 0 && pool.hunterMagic > 0);
  check(errs, `a hunter life never rolls the modern-only entries: ${pool.hunterPlain}`, pool.hunterPlain.length === 0);
  check(errs, 'a modern life does roll its own entries', pool.plain > 0 && pool.modernPlain > 0);
  check(errs, `every tier keeps two origins and two talents for modern: ${pool.thin}`, pool.thin.length === 0);
  const yen = await pg.evaluate("[DR.moneyFor('ja'),DR.currencyOf({world:{id:'modern'},money:DR.moneyFor('ja')})]");
  check(errs, `a Japanese story's modern life counts yen: ${yen}`, same(yen, ['yen', ['yen', 100]]));
  // 3) the profile lean: everyday words lean modern only when no other world's word is there
  const lean = {};
  for (const p of [
    '회사 옥상에서 게이트가 열리는 걸 봤다',
    '회사 동료와 사내 연애 중',
    '대학생, 서울 러닝 크루에서 만난 선배를 짝사랑한다',
    '현대 헌터물의 F급',
    '평범한 중소기업 회사원',
    '거대 기업 소속 해커',
    '고등학생, 같은 반 친구를 짝사랑',
    '각성자 아카데미 신입생',
  ])
    lean[p] = await leanOf(pg, p);
  console.log('lean:', JSON.stringify(lean));
  const [gate, office, college, hunter, small, megacorp, school, academy] = Object.values(lean);
  check(errs, 'a company and a gate lean hunter, not modern', same(gate, ['hunter']));
  check(errs, 'a company and dating lean modern', same(office, ['modern']));
  check(errs, 'a college student leans modern, not academy', same(college, ['modern']));
  check(errs, '현대 does not beat 헌터', same(hunter, ['hunter']));
  check(errs, 'a small-company office worker leans modern, not cyber', same(small, ['modern']));
  check(errs, 'a megacorp hacker leans cyber', same(megacorp, ['cyber']));
  check(errs, 'a high school crush leans modern, not academy', same(school, ['modern']));
  check(
    errs,
    `an awakened academy freshman leans academy: ${academy}`,
    academy.includes('academy') && !academy.includes('modern'),
  );
  // Japanese arrival words, and a profile read before the modern world existed is read again
  const tr = await affOf(pg, '異世界に転移した会社員');
  const po = await affOf(pg, '原作の悪役令嬢に憑依した');
  console.log('arrival:', tr && tr.entry, po && po.entry);
  check(
    errs,
    'Japanese arrival words: 転移 is a transfer, 憑依 a possession',
    tr.entry === 'transfer' && po.entry === 'possess',
  );
  const stale = '사내 연애 중인 회사원';
  await pg.evaluate(
    t => (DR.app.settings.profileAff = { text: t, data: { entry: null, worlds: ['murim'], races: [], keywords: [] } }),
    stale,
  );
  const fresh = await leanOf(pg, stale);
  console.log('an old cached reading:', fresh);
  check(errs, 'a reading cached before the world list changed is not reused', same(fresh, ['modern']));
  // 4) a life there: the story's money, a human, no constellation card, the world's line in the prompt
  await pg.evaluate('DR.startNewLifeForm();0');
  await pg.waitForTimeout(300);
  await pg.fill('#prof', '');
  await startLife(pg, {
    world: 'modern',
    onFate: async () => {
      const cards = await pg.evaluate("[...document.querySelectorAll('#fate .card small')].map(e=>e.textContent)");
      console.log('fate cards:', cards);
      check(errs, 'no constellation card', !cards.includes('성좌'));
    },
  });
  const s = await pg.evaluate(() => {
    const st = DR.app.state;
    return {
      world: st.life.world.id,
      name: st.life.world.name,
      money: st.life.money,
      unit: DR.moneyUnit(st.life),
      race: st.life.race,
      own: (k => k && DR.tIn('ko', DR.creatureRace(k)))(
        Object.values(DR.ORIGINS)
          .flat()
          .find(x => DR.creatureRace(x) && DR.tIn('ko', x) === st.life.origin),
      ),
      entry: st.life.entry,
      sponsor: st.life.sponsor,
      gold: st.stats.gold,
      base: DR.BASE[st.life.originTier].gold,
    };
  });
  const intro = await pg.evaluate('window.__prompts.slice(-1)[0]');
  console.log('life:', JSON.stringify(s));
  check(errs, 'the life is in 현대', s.world === 'modern' && s.name === '현대');
  check(errs, 'a Korean story counts won', s.money === 'won' && s.unit === '원' && s.gold === s.base * 1000);
  check(
    errs,
    "the race is human (or the transmigrator one, or a creature identity's own)",
    s.own ? s.race === s.own : s.entry === 'transfer' ? s.race !== '인간' : s.race === '인간' || s.race === ERR,
  );
  check(errs, 'no constellations', s.sponsor === null);
  check(
    errs,
    'the prompt names the world and what it lacks',
    intro.includes('현대 (게이트도 각성도 마법도 상태창도 없는'),
  );
  expect(errs).toEqual([]);
});
