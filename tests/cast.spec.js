// casting by identity tags: candidate ranking, the early streamed pick, named people grouped by identity, extras' faces retiring, tag import
import { test, expect } from './support/test.js';
import { MOCK_BASE, check, claudeMock, library, same, startLife } from './support/harness.js';

const LIVE = library(); // trimmed real library (sets + tags), for casting scenarios
for (let i = 0; i < 10; i++) {
  // ten unnamed 사천당가 sets, half male, with identity tags on every frame
  const k = `tang${i}`;
  LIVE.rows.push({
    id: `t${i}`,
    kind: 'char',
    set: k,
    name: `${k}_neutral`,
    emotion: 'neutral',
    tags:
      i % 2 ? ['faction:사천당가', 'green robe', 'hidden weapon'] : ['faction:사천당가', 'dark robe', 'poison needle'],
    worlds: ['murim'],
  });
  LIVE.sets[k] = {
    gender: i % 2 ? 'female' : 'male',
    role: '사천당가 무인, 암기와 독을 다룬다',
    tier: i < 8 ? 'minor' : 'extra',
    worlds: ['murim'],
    world: 'murim',
  };
}
// named 당가 sets get identity tags the way "소속 태그 뽑기" would leave them
for (const [k, fac] of [
  ['female30', 'faction:사천당가'],
  ['female44', 'faction:사천당가'],
  ['female24', 'faction:남만야수궁'],
  ['male14', 'faction:천마신교'],
  ['female19', 'faction:천마신교'],
]) {
  for (const r of LIVE.rows) {
    if (r.set === k) r.tags = [fac, ...(r.tags || [])];
  }
}
const MOCK =
  MOCK_BASE +
  String.raw`
window.__turn=0;
window.claude={use:async(n)=>{ if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>true,can:async()=>true};
 if(n==='sample'){const f=async()=>({text:''});f.limits=async()=>({maxPromptBytes:200000});
   f.json=async(p,o)=>{window.__prompts=(window.__prompts||[]);window.__prompts.push(p);
     if(p.startsWith('Pick the portrait')){window.__pickPrompt=p;const m=/- (tang\d)/.exec(p);return{pick:m?m[1]:'none'}}
     window.__turn++;
     const t=window.__turn;
     if(o&&o.onText)o.onText({text:t===1?'{"scene":null,"speaker":"당천호","speaker_gender":"male","speaker_role":"poison user","speaker_weight":"minor","speaker_look":["fur cloak","faction:당가"],"emotion":"smirk","admin":""':'{"scene":null,"speaker":"왕소","speaker_gender":"male","speaker_role":"gate guard","speaker_weight":"extra","speaker_look":["spear","faction:사천당가"],"emotion":"smirk","admin":""'});
     return {admin:'',narration:t===1?'사천당가 앞. 당가의 무인 당천호가 당신을 본다.':'문지기 왕소가 창을 든다. 왕소는 곧 죽었다.',system:[],choices:['a','b'],stat_changes:{},clock:{days_passed:0},
       speaker:t===1?'당천호':'왕소',speaker_gender:'male',speaker_role:t===1?'poison user':'gate guard',speaker_weight:t===1?'minor':'extra',speaker_look:t===1?['fur cloak','faction:당가']:['spear','faction:사천당가'],emotion:'smirk',
       memory:t===2?{died:['왕소']}:{},dead:false};};
   return f;} return null;}};
`;

test('cast', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 860] });
  await pg.waitForTimeout(700);
  await pg.evaluate(L => {
    DR.app.images.push(...L.rows);
    Object.assign(DR.app.setMeta, L.sets);
  }, LIVE);
  const gen = await pg.evaluate('Object.keys(DR.charSets()).filter(DR.isGeneric)');
  const f71 = await pg.evaluate("DR.isGeneric('female71')");
  console.log('generic sets:', gen, '| female71 generic:', f71);
  check(
    errs,
    'no silhouette sets here; a faceless role with an explicit tier is not generic',
    same(gen, []) && f71 === false,
  );
  const cw = await pg.evaluate('[...DR.commonWords()]');
  console.log('common words sample:', cw.slice(0, 12));
  check(
    errs,
    'common words: hair (on most sets) yes, rare words no',
    cw.includes('hair') && !['poison', 'robe', 'needle'].some(w => cw.includes(w)),
  );
  const voc = await pg.evaluate('DR.tagVocab(8)');
  console.log('vocab:', voc);
  check(
    errs,
    'vocab: 8 English look tags, identity tags left out',
    voc.length === 8 && voc.every(t => /^[\x00-\x7f]*$/.test(t) && !t.includes(':')),
  );
  await startLife(pg, { world: 'murim', dice: false });
  // 1) candidates: identity beats looks; only 8 minor tang sets rank by identity, extras lower; without identity signal the same look finds nothing
  const c1 = await pg.evaluate(
    "DR.castCandidates({name:'당천호',gender:'male',role:'poison user',weight:'minor',look:['fur cloak','faction:당가']})",
  );
  console.log('cands 당가/fur cloak:', c1);
  check(
    errs,
    '1) the four male minor 당가 sets first, then the extra one, then the rest',
    same([...c1.slice(0, 4)].sort(), ['tang0', 'tang2', 'tang4', 'tang6']) && c1[4] === 'tang8',
  );
  const c2 = (
    await pg.evaluate(
      "DR.castCandidates({name:'X',gender:'male',role:'poison user',weight:'minor',look:['fur cloak','faction:무당파']})",
    )
  ).slice(0, 6);
  console.log('cands 무당파/fur cloak (mismatch -4):', c2);
  // below the four best plain faces the 당가 sets tie with the weaker ones (the beast sets that used to fill that slot
  // are no longer offered to a man), so the jitter decides that order
  check(
    errs,
    '1) another identity is a minus: the 당가 sets drop below the plain faces, none in the top four',
    !c2.slice(0, 4).some(k => k.startsWith('tang')),
  );
  const drop = await pg.evaluate(() => {
    const who = look => ({
      name: 'X',
      gender: 'male',
      role: 'poison user',
      weight: 'minor',
      look: ['fur cloak', look],
    });
    const match = DR.castScorer(who('faction:당가'));
    const other = DR.castScorer(who('faction:무당파'));
    return ['tang0', 'tang2', 'tang4', 'tang6'].map(k => match(k) - other(k));
  });
  check(
    errs,
    '1) a matching identity is worth +13 to a set, one the library never shows -4',
    drop.every(d => d === 17),
  );
  // 2) early cast: the pick resolved during streaming, so the first turn already shows the face
  const last = await pg.evaluate(
    'JSON.stringify({cast:DR.app.state.cast,castW:DR.app.state.castW,img:DR.app.turns[DR.app.turns.length-1].img,why:DR.app.state.castWhy})',
  );
  console.log('turn1:', last);
  const t1 = JSON.parse(last);
  const k = '당천호' in t1.cast ? t1.cast['당천호'] : '';
  check(
    errs,
    '2) turn 1 already shows 당천호 in a male 당가 face the model picked',
    ['tang0', 'tang2', 'tang4', 'tang6', 'tang8'].includes(k) &&
      t1.castW['당천호'] === 'minor' &&
      (t1.img || {}).char === 't' + k.slice(4) &&
      same(
        t1.img.chars.map(c => c.npc),
        ['당천호'],
      ) &&
      t1.why['당천호'].ai === true,
  );
  const pl = await pg.evaluate("(window.__pickPrompt||'').split('\\n').find(l=>l.startsWith('Character:'))");
  console.log('pick prompt line:', pl);
  check(
    errs,
    '2) the pick prompt names the identity apart from the look',
    !!pl && pl.includes('belongs faction:당가') && pl.includes('look fur cloak') && pl.includes('importance minor'),
  );
  const n = await pg.evaluate("(window.__pickPrompt||'').split('\\n').filter(l=>l.startsWith('- tang')).length");
  console.log('pick prompt tang lines:', n);
  check(errs, '2) the pick prompt offers the five male 당가 sets', n === 5);
  // 3) named list grouped by identity, story-relevant group first
  const named = await pg.evaluate(
    "(window.__prompts||[]).filter(p=>p.includes('[등장 가능한 인물]')).slice(-1)[0].split('\\n').find(l=>l.startsWith('[등장 가능한 인물]'))",
  );
  console.log('named:', named.slice(0, 420));
  const tang = named.includes('사천당가: ') ? named.split('사천당가: ')[1].split(' | ')[0] : '';
  check(
    errs,
    '3) named people grouped by identity: 당비화 and 당소소 under 사천당가, a 천마신교 group',
    tang.includes('당비화') && tang.includes('당소소') && named.includes('천마신교: '),
  );
  // 4) an extra with an identity tag gets a real same-faction extra face; that face retires when the extra dies (a silhouette would not)
  await pg.fill('#input', '문을 지난다');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(1500);
  let t2 = await pg.evaluate(
    'JSON.stringify({cast:DR.app.state.cast,chars:DR.app.turns[DR.app.turns.length-1].img.chars.map(c=>[c.npc,!!c.hidden]),dead:DR.app.state.deadNpc,retired:[...DR.retiredSets()]})',
  );
  console.log('turn2 extra face (matched by faction):', t2);
  t2 = JSON.parse(t2);
  check(
    errs,
    '4) the extra 왕소 wears the extra 당가 face, shown, and it retires when he dies',
    t2.cast['왕소'] === 'tang8' &&
      same(t2.chars, [['왕소', false]]) &&
      (t2.dead['왕소'] || {}).set === 'tang8' &&
      t2.retired.includes('tang8'),
  );
  const named2 = await pg.evaluate(
    "(window.__prompts||[]).filter(p=>p.includes('[등장 가능한 인물]')).slice(-1)[0].split('\\n').find(l=>l.startsWith('[등장 가능한 인물]'))",
  );
  console.log('named after 당가 turn:', named2.slice(0, 300));
  check(
    errs,
    '3) after a 당가 scene the 사천당가 group comes first',
    named2.startsWith('[등장 가능한 인물] 사천당가: '),
  );
  // 5) tags.json with sets[k].tags lands on every frame, identity tags exempt from the cap
  await pg.evaluate('DR.askConfirm=async()=>true');
  const tj = {
    sets: { female3: { tags: ['faction:은빛 마탑', 'silver hair', 'navy dress'] } },
    images: { 'female3_anger.png': { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] } },
  };
  await pg.evaluate(j => DR.importTags({ text: async () => JSON.stringify(j) }), tj);
  await pg.waitForTimeout(800);
  const f3 = await pg.evaluate('DR.charSetsAll().female3.map(x=>[x.name,x.tags])');
  console.log('female3 frames:', JSON.stringify(f3.slice(0, 2)));
  const ang = Object.fromEntries(f3)['female3_anger'] || [];
  check(
    errs,
    '5) set tags on every frame; the identity tag does not count against the 10 description tags',
    f3.every(([, t]) => ['faction:은빛 마탑', 'silver hair', 'navy dress'].every(x => (t || []).includes(x))) &&
      ang.filter(t => !t.includes(':')).length === 10 &&
      ang.includes('faction:은빛 마탑'),
  );
  const ids = await pg.evaluate("DR.setIds('female3')");
  console.log('female3 ids:', ids);
  check(errs, '5) female3 has the one identity', same(ids, [{ key: 'faction', val: '은빛 마탑' }]));
  const tr = await pg.evaluate(
    "(async()=>{DR.platform.sample.json=async()=>['x'];return await DR.toEnglishTags(['faction:사천당가'])})()",
  );
  console.log('translation skips ids:', tr);
  check(errs, '5) identity tags are never sent for translation', same(tr, ['faction:사천당가']));
  // 6) a frame the file lists with no tags of its own loses its old tags (file-name tokens, an old identity) in replace mode
  const first = await pg.evaluate(
    "(()=>{const x=DR.charSetsAll().female3[0];x.tags=['neutral113','faction:옛 학교'];return x.name})()",
  );
  const tj2 = { sets: { female3: { tags: ['silver hair'] } }, images: { [first + '.png']: { tags: [] } } };
  await pg.evaluate(j => DR.importTags({ text: async () => JSON.stringify(j) }), tj2);
  await pg.waitForTimeout(800);
  const after = await pg.evaluate("DR.charSetsAll().female3.find(x=>x.name==='" + first + "').tags");
  console.log('frame with no own tags after replace import:', JSON.stringify(after));
  check(errs, '6) a listed frame with empty tags keeps only the set tags', same(after, ['silver hair']));
  expect(errs).toEqual([]);
});

// A person's faction rules out another group's face on every casting path. The library itself says 정파 goes with
// 화산파 (one set carries both), so a 정파 face and a faction-free one stay; with only other groups left, a lead gets a
// silhouette, and never one of another group. Each filter is checked where the -30 alone would not do it
test('casting keeps the faction', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(), { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await startLife(pg);
  await pg.waitForFunction('DR.app.state && DR.app.state.life && DR.isIdle()', null, { timeout: 20000 });
  const got = await pg.evaluate(() => {
    const px = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const LOOKS = ['old man', 'white beard', 'elder', 'scar', 'blue robe', 'sword', 'tall', 'topknot'];
    const sets = {
      hwasan_f: ['faction:정파', 'faction:화산파', 'woman'],
      cheong_elder: ['faction:정파', 'faction:청성파', ...LOOKS],
      mudang_m: ['faction:정파', 'faction:무당파', 'old man', 'white beard'],
      jeongpa_m: ['faction:정파', 'young man'],
      plain_elder: ['old man', 'white beard'],
      tang_m: ['clan:唐', 'young man'],
    };
    const load = list => {
      DR.app.images = Object.entries(list).map(([k, tags], i) => ({
        id: 'c' + i,
        kind: 'char',
        set: k,
        name: k + '_neutral',
        emotion: 'neutral',
        url: px,
        tags,
      }));
      for (const k of Object.keys(list))
        DR.app.setMeta[k] = k.startsWith('shadow')
          ? { gender: 'male', tier: 'generic' }
          : { gender: k === 'hwasan_f' ? 'female' : 'male' };
      DR.imagesChanged();
      DR.app.state.cast = {};
    };
    const who = (name, weight, look = ['white beard', 'old man', 'faction:화산파']) => ({
      name,
      gender: 'male',
      weight,
      look,
    });
    load(sets);
    const cands = DR.castCandidates(who('학송 장로', 'major'), 12);
    const both = DR.castCandidates(
      who('학송 장로', 'major', ['white beard', 'old man', 'faction:정파', 'faction:화산파']),
      12,
    );
    const clan = DR.castCandidates(who('당호', 'major', ['young man', 'clan:唐']), 12);
    // the word-scored lead: the rival elder matches eight look words, the faction-free face none
    load({ hwasan_f: sets.hwasan_f, cheong_elder: sets.cheong_elder, young_plain: ['young man'] });
    const lead = DR.castFor(who('학송 장로', 'major', [...LOOKS, 'faction:화산파']));
    // an extra whose only look match is the rival: a silhouette instead
    load({ hwasan_f: sets.hwasan_f, cheong_elder: sets.cheong_elder, shadow_male: [] });
    const extra = DR.castFor(who('화산 노복', 'extra'));
    load({ hwasan_f: sets.hwasan_f, cheong_elder: sets.cheong_elder, shadow_male: [] });
    const only = DR.castCandidates(who('학송 장로', 'major'), 12);
    // only another sect's real face, and a 사파 silhouette that matches all eight look words: the plain silhouette
    load({
      hwasan_f: sets.hwasan_f,
      cheong_elder: sets.cheong_elder,
      shadow_male: [],
      shadow_sapa: ['faction:사파', ...LOOKS],
    });
    const lone = DR.castFor(who('학송 장로', 'major', [...LOOKS, 'faction:화산파']));
    return { cands, both, clan, lead, extra, only, lone };
  });
  console.log('faction casting:', JSON.stringify(got));
  const other = k => k === 'cheong_elder' || k === 'mudang_m';
  check(errs, 'another sect is out though its looks fit best', !got.cands.some(other));
  check(
    errs,
    'the same camp and a faction-free face stay',
    got.cands.includes('jeongpa_m') && got.cands.includes('plain_elder'),
  );
  check(errs, 'naming the camp too keeps another sect out', !got.both.some(other));
  check(errs, 'a one-letter value keeps its own face', got.clan.includes('tang_m'));
  check(errs, 'the word-scored lead skips another sect even with eight look matches', got.lead === 'young_plain');
  check(errs, 'an extra takes a silhouette over another sect', got.extra === 'shadow_male');
  check(
    errs,
    'with only another sect left, a lead is offered a silhouette, not that sect',
    !got.only.includes('cheong_elder') && got.only.includes('shadow_male'),
  );
  check(errs, "a lead's silhouette is never another group's, whatever its looks", got.lone === 'shadow_male');
  expect(errs).toEqual([]);
});
