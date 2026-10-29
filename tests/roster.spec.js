// a save's character list (roster.js): what the parser reads and skips, the prompt it costs (constant, roster before
// library, roster profile over a set card's), faces by name and alias, and the list surviving a redraw, a rewrite, a
// branch and the next lives
import { test, expect } from './support/test.js';
import { check, claudeMock, same, startLife } from './support/harness.js';

// the narrator answers window.__next (merged over a plain reply); a portrait pick keeps its prompt and answers "none"
const MOCK =
  claudeMock(String.raw`async(p,o)=>{ if(p.startsWith('Pick the portrait')){window.__pick=p;return{pick:'none'};}
  window.__lastPrompt=p;
  return Object.assign({admin:'',narration:'장면.',system:[],choices:['a','b'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false},window.__next||{});}`);
const img = (id, set) => ({ id, kind: 'char', set, emotion: 'neutral', name: set + '_neutral1', tags: [set] });
const IMAGES = [
  img('m2', 'male2'),
  img('f1', 'female1'),
  img('f2', 'female2'),
  img('f3', 'female3'),
  img('f4', 'female4'),
  img('f5', 'female5'),
];
const SETS = {
  // a named set whose alias is a roster name, with its own profile: the roster's must win, whole
  male2: {
    gender: 'male',
    role: 'swordsman',
    charName: '단리유',
    aliases: ['리유'],
    profile: { position: '청성파 장로', looks: '백발' },
    worlds: ['murim'],
  },
  female1: { gender: 'female', role: 'swordswoman', profile: { position: '화산파 일대제자' } }, // an open role
  female2: { gender: 'female', role: 'noble lady', charName: '설화', profile: { position: '남궁세가 소저' } },
  female3: { gender: 'female', role: 'lady' },
  female4: { gender: 'female', role: 'maid' },
  // a named set with a profile for a roster entry that has no fields of its own: the card's stays
  female5: { gender: 'female', role: 'nun', charName: '연화', profile: { position: '아미파 장문' }, worlds: ['murim'] },
};
const ROSTER = `# 점창파
이름: 리유
별칭: 단소저
직책: 이대제자
실력: 이류
성격: 깐죽거림
말투: '허~접♡'
비밀: 마교의 첩자

이름: 모용혜 / 소속: 모용세가 / 성별: 여 / 직책: 소가주 / 외모: 흑발`;

async function turn(pg, text, next) {
  await pg.evaluate(n => (window.__next = n), next);
  await pg.fill('#input', text);
  await pg.press('#input', 'Enter');
  await pg.waitForFunction('DR.isIdle()', null, { timeout: 15000 });
  await pg.waitForTimeout(200);
}
// roll a life in this world and begin it, with this text in the fate screen's character list (null: leave it); name ''
// on a regression's form. Waits for the opening reply
async function begin(pg, { world, roster = null, name = '진무', check: onFate }) {
  const n = await pg.evaluate('DR.app.state ? DR.app.turns.length : 0');
  await startLife(pg, {
    world,
    name,
    onFate: async () => {
      await pg.waitForSelector('#acceptBtn');
      if (roster != null) {
        await pg.evaluate(() => (document.querySelector('#fate .roster-box').open = true));
        await pg.fill('#fate [data-roster]', roster);
      }
      if (onFate) await onFate();
    },
  });
  await pg.waitForFunction(n => DR.app.turns.length >= n + 2 && DR.isIdle(), n, { timeout: 15000 });
  await pg.waitForTimeout(300);
}
// the preview's summary once it shows this text (it waits for a pause in typing)
const previewSays = async (pg, sel, text) => {
  await pg.waitForFunction(([s, t]) => (document.querySelector(s) || {}).textContent?.includes(t), [sel, text], {
    timeout: 3000,
  });
  return pg.evaluate(s => document.querySelector(s).textContent, sel);
};
// a prompt block by its heading (blocks are separated by a blank line; the heading may also be quoted inside another)
const block = (p, head) => {
  const i = p.indexOf('\n\n' + head);
  if (i < 0) return '';
  const end = p.indexOf('\n\n', i + 2);
  return p.slice(i + 2, end < 0 ? undefined : end);
};
const NAMED = '[등장 가능한 인물]';
const PROFILES = '[인물 설정]';

test('roster', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [400, 900] });
  await pg.waitForTimeout(700);

  // 1) the parser
  const TEXT = [
    '# 점창파', // 1
    '이름: 단리유(段離幽)', // 2: the bracket is an alias
    '별칭: 리유, 리', // 3: one letter is too short for an alias
    '직책: 이대제자',
    '실력: 이류',
    '성격: 깐죽거림, 까불거림',
    "말투: '허~접♡', '쓸모없어/진짜'", // 7: a slash inside quotes does not split
    '나이: 17', // 8: an unknown key stays as a detail
    '비밀: 마교의 첩자',
    '',
    '- **이름**: 백리운 / 소속: 화산파 / 대표 무공: 매화검법 / 호칭: 사형', // 11: own faction over the heading; a form of address is no alias
    '- 단리유 / 점창파 이대제자 / 이류', // 12: a part without a key: skipped, and the person above ends
    '말투: 하오체', // 13: no person above any more
    '',
    "Name: Seol-hwa / Gender: female / Personality: Ri-un's rival", // 15: an apostrophe is no quote
    '名前: 雪花 / 性別: 女 / 別名: 雪姫 / 口調：「ふん/まあね」', // 16
    '이름: 진무 / 말투: 반말', // 17: the player
    '말투: 이 줄은 진무의 것', // 18: the player's own block, dropped quietly
    '',
    '이름: 모용혜 / 직책: 소가주', // 20
    // 21: listed again: this one is kept. A slash splits only before a key: the looks, the rank and the URL stay whole
    '이름: 모용혜 / 직책: 가주 / 외모: 흑발 / 붉은 눈 / 실력: S/A급 / 관계: https://x.y/z',
    '',
    '이름: 하린 / 별칭: 진무, 백리운, 린아', // 23: the player's name and another person's name are no aliases
    '이름: 하연 / 별칭: 린아, 연아', // 24: 린아 is 하린's already
  ].join('\n');
  const P = await pg.evaluate(t => DR.parseRoster(t, '진무'), TEXT);
  const by = n => P.people.find(e => e.name === n) || {};
  check(
    errs,
    'people in order',
    same(
      P.people.map(e => e.name),
      ['단리유', '백리운', 'Seol-hwa', '雪花', '모용혜', '하린', '하연'],
    ),
  );
  check(
    errs,
    'a block: keys by label, the bracket an alias, an unknown key in traits, quotes keep their slash',
    same(by('단리유'), {
      name: '단리유',
      aliases: ['段離幽', '리유'],
      faction: '점창파',
      gender: null,
      profile: {
        position: '이대제자',
        power: '이류',
        traits: '깐죽거림, 까불거림, 나이: 17',
        speech: "'허~접♡', '쓸모없어/진짜'",
        secret: '마교의 첩자',
      },
      line: 2,
    }),
  );
  check(errs, "a person's own faction beats the heading", by('백리운').faction === '화산파');
  check(
    errs,
    "a skipped line ends the person above (하오체 is not 백리운's); 호칭 is a detail, not an alias",
    same(by('백리운').profile, { signature: '매화검법', traits: '호칭: 사형' }) && same(by('백리운').aliases, []),
  );
  check(
    errs,
    'the later 모용혜 replaces the earlier; a slash not before a key stays in the value',
    same(by('모용혜').profile, { position: '가주', power: 'S/A급', looks: '흑발 / 붉은 눈', ties: 'https://x.y/z' }),
  );
  check(
    errs,
    "one name, one person: no alias that is the player's or another person's name, the first claim keeps it",
    same(by('하린').aliases, ['린아']) && same(by('하연').aliases, ['연아']),
  );
  check(errs, 'the heading is the faction when a person has none', by('모용혜').faction === '점창파');
  check(
    errs,
    'en and ja keys, ja gender, a full-width colon, quotes 「」',
    by('Seol-hwa').gender === 'female' &&
      by('Seol-hwa').profile.traits === "Ri-un's rival" &&
      by('雪花').gender === 'female' &&
      same(by('雪花').aliases, ['雪姫']) &&
      by('雪花').profile.speech === '「ふん/まあね」',
  );
  check(
    errs,
    'notes: unknown keys, unlabeled part, no person, the player, listed again, aliases dropped',
    same(
      P.notes.map(x => [x.line, x.why, x.alias || '']),
      [
        [8, 'other', ''],
        [11, 'other', ''],
        [12, 'unlabeled', ''],
        [13, 'noName', ''],
        [17, 'me', ''],
        [21, 'again', ''],
        [23, 'aliasMe', '진무'],
        [23, 'aliasTaken', '백리운'],
        [24, 'aliasTaken', '린아'],
      ],
    ),
  );
  const caps = await pg.evaluate(() => {
    const many = Array.from({ length: 121 }, (_, i) => `이름: 사람${i} / 직책: 제자`).join('\n');
    const long = DR.parseRoster('이름: 길이 / 비밀: ' + '가'.repeat(200));
    return { many: DR.parseRoster(many), long };
  });
  check(
    errs,
    'at most 120 people, said once',
    caps.many.people.length === 120 &&
      same(
        caps.many.notes.map(x => x.why),
        ['over'],
      ),
  );
  check(
    errs,
    'a field past its length is cut, and said',
    caps.long.people[0].profile.secret.length <= 120 && caps.long.notes.some(x => x.why === 'cut'),
  );
  const ex = await pg.evaluate(() =>
    ['en', 'ko', 'ja'].map(l => {
      const r = DR.parseRoster(DR.tIn(l, DR.ROSTER_EXAMPLE));
      return [r.people.length, r.notes.length, r.people[0] && r.people[0].aliases.length];
    }),
  );
  check(
    errs,
    "every language's example reads as two people, nothing skipped",
    same(ex, [
      [2, 0, 2],
      [2, 0, 2],
      [2, 0, 2],
    ]),
  );

  // a name in Latin letters is mentioned as a whole word, any case; a Korean one anywhere (particles attach to it)
  const words = await pg.evaluate(() => {
    const one = n => ({ name: n, aliases: [] });
    return [
      DR.mentioned(one('Al'), 'it also works'),
      DR.mentioned(one('Kai'), 'the Kaiser came'),
      DR.mentioned(one('Kai'), 'said kai.'),
      DR.mentioned(one('리운'), '리운이 웃었다'),
    ];
  });
  check(
    errs,
    "mentioned: 'Al' not in 'also', 'Kai' not in 'Kaiser' but in 'kai.', 리운 in 리운이",
    same(words, [false, false, true, true]),
  );
  // a name never takes a part glued on after a slash: the part goes, with a note, and the person stays
  const glued = await pg.evaluate(() => DR.parseRoster('Name: Baek Ri-un / swordsman / Power: first-rate'));
  check(
    errs,
    'a slash part after a name is cut off the name and noted',
    glued.people.length === 1 &&
      glued.people[0].name === 'Baek Ri-un' &&
      glued.people[0].profile.power === 'first-rate' &&
      same(
        glued.notes.map(x => [x.why, x.text]),
        [['nameCut', 'swordsman']],
      ),
  );

  // 2) a murim life with the list typed on the fate screen; a redraw (another screen language) keeps the draft
  await pg.evaluate(
    ([imgs, sets]) => {
      DR.app.images.push(...imgs);
      Object.assign(DR.app.setMeta, sets);
      DR.imagesChanged();
    },
    [IMAGES, SETS],
  );
  let kept = null;
  await begin(pg, {
    world: 'murim',
    roster: ROSTER,
    check: async () => {
      await pg.evaluate('DR.redrawNewLifeForm()');
      kept = await pg.evaluate("document.querySelector('#fate [data-roster]').value");
      const sum = await previewSays(pg, '#fate .roster-sum', '2명');
      check(
        errs,
        'the fate preview: 2 read, 1 with a face (by the alias 리유)',
        sum.includes('2명') && sum.includes('1명'),
      );
    },
  });
  check(errs, 'a redraw keeps the typed list', kept === ROSTER);
  check(errs, 'the list is kept for murim', (await pg.evaluate('DR.app.state.roster.murim')) === ROSTER);
  const p0 = await pg.evaluate('window.__lastPrompt');
  const n0 = block(p0, NAMED);
  check(
    errs,
    'named block: roster people with their roster words, the roster sentence, the matched set not listed twice',
    n0.includes('모용혜(여, 소가주)') &&
      n0.includes('리유(남, 이대제자 이류)') &&
      !n0.includes('단리유(') &&
      n0.includes('플레이어가 이 이야기에 정해 둔 인물'),
  );
  check(
    errs,
    'roster people come before library named sets',
    n0.indexOf('모용혜(') >= 0 &&
      n0.indexOf('설화(') > n0.indexOf('모용혜(') &&
      n0.indexOf('설화(') > n0.indexOf('리유('),
  );
  // met under any of their names, or wearing their matched set: no longer someone to bring in
  const metBy = await pg.evaluate(() => {
    const st = DR.app.state,
      keep = [st.cast, st.relations];
    const listed = () => DR.buildPrompt('둘러본다', null, {}).includes('리유(남, 이대제자');
    st.cast = {};
    st.relations = {};
    const none = listed();
    st.cast = { 단리유: 'male2' }; // the matched set, worn under its own name
    const bySet = listed();
    st.cast = {};
    st.relations = { 단소저: '사매' }; // notes kept under an alias
    const byAlias = listed();
    [st.cast, st.relations] = keep;
    return { none, bySet, byAlias };
  });
  check(errs, 'not met: listed', metBy.none === true);
  check(errs, 'met wearing the matched set under its own name: not listed', metBy.bySet === false);
  check(errs, 'met under an alias: not listed', metBy.byAlias === false);

  // a roster alias is that person: their face (the set named by the roster name) and one relation
  await turn(pg, '말을 건다', {
    speaker: '단소저',
    speaker_gender: 'female',
    speaker_weight: 'major',
    emotion: 'neutral',
    memory: { relations: [{ name: '단소저', note: '사매' }] },
  });
  const met = await pg.evaluate('({cast:{...DR.app.state.cast},rel:Object.keys(DR.app.state.relations)})');
  check(
    errs,
    'speaker 단소저 is kept as 리유, with the set whose alias is 리유',
    met.cast['리유'] === 'male2' && !met.cast['단소저'],
  );
  check(errs, 'the relation is under the roster name', same(met.rel, ['리유']));
  // someone wearing the matched set under its own name gets the roster profile too, never the card's
  await turn(pg, '묻는다', { speaker: '단리유', speaker_gender: 'male', emotion: 'neutral' });
  await turn(pg, '모용혜를 찾아간다', {
    speaker: '모용혜',
    speaker_gender: 'female',
    speaker_weight: 'major',
    emotion: 'neutral',
  });
  const p3 = await pg.evaluate('window.__lastPrompt');
  const pr3 = block(p3, PROFILES);
  check(
    errs,
    "the roster profile, whole, over the set card's (no 청성파, no 백발)",
    pr3.includes("단리유(점창파 이대제자, 이류): 깐죽거림; 말투: '허~접♡'; 비밀: 마교의 첩자") &&
      !pr3.includes('청성파') &&
      !pr3.includes('백발'),
  );
  check(
    errs,
    'a faceless roster person named in the input gets their profile',
    pr3.includes('모용혜(모용세가 소가주): 흑발'),
  );
  check(errs, 'met people leave the named block', !block(p3, NAMED).includes('리유('));
  const pick = await pg.evaluate('window.__pick || ""');
  check(
    errs,
    "the face pick for a roster person sees the list's faction, position and looks",
    pick.includes("In the player's cast list: 모용세가, 소가주, 흑발"),
  );
  // a death reported under a roster alias retires the face kept under the roster name
  await turn(pg, '쓰러진다', { memory: { died: ['단소저'] } });
  const dead = await pg.evaluate('({ ...(DR.app.state.deadNpc || {}) })');
  check(
    errs,
    "a death under a roster alias retires the roster name's face",
    !!dead['리유'] && dead['리유'].set === 'male2' && !dead['단소저'],
  );

  // the prompt costs the same however long the list: the named block within its budget, at most three profiles
  const size = await pg.evaluate(() => {
    const st = DR.app.state,
      keep = st.roster.murim;
    const one = (i, f) => `이름: 무명${i}호 / 소속: 문파${f} / 직책: 제자 / 성격: ${'조용함, '.repeat(6)}끝`;
    const list = n => Array.from({ length: n }, (_, i) => one(i, i % 8)).join('\n');
    const at = n => {
      DR.setRoster(st, 'murim', list(n));
      return new TextEncoder().encode(DR.buildPrompt('둘러본다', null, {})).length;
    };
    const small = at(5),
      big = at(40);
    const named = DR.buildPrompt('둘러본다', null, {});
    const said = DR.buildPrompt(Array.from({ length: 10 }, (_, i) => `무명${i}호`).join(' '), null, {});
    DR.setRoster(st, 'murim', keep);
    return { small, big, named, said };
  });
  const list40 = (/\[등장 가능한 인물\] (.*?)\. 이 세계에/.exec(size.named) || [])[1] || '';
  check(
    errs,
    `40 people cost at most the named budget more than 5 (${size.big - size.small} bytes)`,
    size.big - size.small <= 520,
  );
  check(errs, 'the named list stays within about 500 bytes', new TextEncoder().encode(list40).length <= 500);
  check(errs, 'ten people named in the input: three profiles', block(size.said, PROFILES).split(' | ').length === 3);
  // a roster entry without a field keeps the set card's profile; one with a field replaces it whole
  const fb = await pg.evaluate(() => {
    const st = DR.app.state,
      keep = st.roster.murim;
    const at = more => {
      DR.setRoster(st, 'murim', keep + '\n\n' + more);
      return DR.buildPrompt('연화를 만난다', null, {});
    };
    const bare = at('이름: 연화 / 소속: 아미파'),
      own = at('이름: 연화 / 소속: 아미파 / 성격: 온화함');
    DR.setRoster(st, 'murim', keep);
    return { bare, own };
  });
  check(
    errs,
    "a roster entry with no field: the set card's profile",
    block(fb.bare, PROFILES).includes('연화(아미파 장문)'),
  );
  check(
    errs,
    'a roster entry with a field: its own, whole',
    block(fb.own, PROFILES).includes('연화(아미파): 온화함') && !block(fb.own, PROFILES).includes('장문'),
  );

  // 3) a list saved in the memory tab: what the story kept under an alias moves to the roster name, unless that name
  // holds its own; the edits survive a rewrite and a branch, and the notes with them
  await turn(pg, '옛 사람들을 떠올린다', {
    memory: {
      relations: [
        { name: '남궁소저', note: '옛 인연', bond: '🙂' },
        { name: '현아', note: '어릴 적 친구' },
        { name: '제갈현', note: '정혼자' },
      ],
    },
  });
  await turn(pg, '쉰다', {});
  const EDIT = ROSTER + '\n\n이름: 남궁현 / 직책: 소가주 / 별칭: 남궁소저\n\n이름: 제갈현 / 별칭: 현아';
  const busy = await pg.evaluate(e => {
    DR.renderMemory();
    const rs = document.querySelector('#memBox .mem-roster');
    rs.querySelector('[data-roster]').value = e;
    DR.app.phase = 'narrating';
    rs.querySelector('[data-roster-save]').click();
    DR.app.phase = 'idle';
    return DR.app.state.roster.murim;
  }, EDIT);
  check(errs, 'no saving the list while a reply is being written', busy === ROSTER);
  await pg.evaluate(e => {
    DR.renderMemory();
    const rs = document.querySelector('#memBox .mem-roster');
    const ta = rs.querySelector('[data-roster]');
    ta.value = e;
    ta.dispatchEvent(new Event('input'));
    document.querySelector('#notes').value = '노트 고침'; // typed, not saved yet
    rs.querySelector('[data-roster-save]').click();
  }, EDIT);
  await pg.waitForTimeout(500);
  const sv = await pg.evaluate(() => ({
    draft: document.querySelector('#notes').value,
    notes: DR.app.state.userNotes,
    rel: { ...DR.app.state.relations },
    bonds: Object.keys(DR.app.state.bonds || {}),
  }));
  const memSum = await previewSays(pg, '#memBox .roster-sum', '4명');
  check(
    errs,
    'saving the list keeps the notes typed but not saved',
    sv.draft === '노트 고침' && sv.notes !== '노트 고침',
  );
  check(
    errs,
    "an alias's notes and bond move to the roster name",
    sv.rel['남궁현'] === '옛 인연' &&
      !('남궁소저' in sv.rel) &&
      sv.bonds.includes('남궁현') &&
      !sv.bonds.includes('남궁소저'),
  );
  check(
    errs,
    'an alias and a roster name that both hold notes keep both',
    sv.rel['현아'] === '어릴 적 친구' && sv.rel['제갈현'] === '정혼자',
  );
  check(errs, 'the memory tab preview: 4 read', memSum.includes('4명'));
  await pg.evaluate(() => document.querySelector('#saveNotes').click());
  await pg.waitForTimeout(300);
  // the rewrite goes back to the story before the last reply, where the notes still sat under the alias
  await pg.evaluate('DR.reroll();0');
  await pg.waitForFunction('DR.isIdle()', null, { timeout: 15000 });
  await pg.waitForTimeout(300);
  const after = await pg.evaluate(
    '({r:DR.app.state.roster.murim,n:DR.app.state.userNotes,rel:{...DR.app.state.relations}})',
  );
  check(errs, 'a rewrite keeps the roster edited since the last reply', after.r === EDIT);
  const packed = await pg.evaluate(async () => {
    const rows = await DR.turnStore.loadAll(DR.app.currentSave.id);
    const snaps = rows.filter(t => t.snap);
    return {
      n: snaps.length,
      // a secret only the list says
      lists: snaps.filter(t => 'roster' in t.snap || JSON.stringify(t.snap).includes('마교의 첩자')).length,
    };
  });
  check(errs, "the saved turns' snapshots hold no character list", packed.n > 2 && packed.lists === 0);
  check(errs, 'a rewrite keeps the notes edited since the last reply', after.n === '노트 고침');
  check(
    errs,
    'after the rewrite the alias notes are under the roster name again',
    after.rel['남궁현'] === '옛 인연' && !('남궁소저' in after.rel),
  );
  const at = await pg.evaluate(
    "DR.app.turns.find(t=>t.kind==='ai'&&t.snap&&t.snap.relations&&t.snap.relations['남궁소저']).i",
  );
  const orig = await pg.evaluate('DR.app.currentSave.id');
  await pg.evaluate(`(async()=>{DR.askConfirm=async()=>true;await DR.fork(${at})})()`);
  await pg.waitForFunction(`DR.app.currentSave.id!=='${orig}' && DR.isIdle()`, null, { timeout: 15000 });
  const br = await pg.evaluate(
    '({r:DR.app.state.roster.murim,n:DR.app.state.userNotes,rel:{...DR.app.state.relations}})',
  );
  check(errs, 'a branch from an older reply keeps the latest roster and notes', br.r === EDIT && br.n === '노트 고침');
  // a saved state that fell behind its turns is rebuilt from the newest snapshot, keeping the saved state's list
  const rebuilt = await pg.evaluate(async () => {
    const id = DR.app.currentSave.id;
    const key = [...window.__store.keys()].find(k => k.endsWith('/states/items/' + id));
    const doc = window.__store.get(key);
    doc.next = 0;
    doc.userNotes = '복구 노트';
    window.__store.set(key, doc);
    await DR.openSave(id);
    const st = DR.app.state;
    return {
      list: (st.roster || {}).murim,
      notes: st.userNotes,
      rel: { ...st.relations },
      next: st.next,
      last: DR.app.turns.at(-1).i,
    };
  });
  check(errs, 'the state was rebuilt from a snapshot', rebuilt.next === rebuilt.last + 1);
  check(errs, 'a state rebuilt from a snapshot keeps the list', rebuilt.list === EDIT);
  check(errs, "and the saved state's notes", rebuilt.notes === '복구 노트');
  check(
    errs,
    "and the snapshot's alias notes go to the roster name",
    rebuilt.rel['남궁현'] === '옛 인연' && !('남궁소저' in rebuilt.rel),
  );
  check(errs, 'and its alias notes go to the roster name', br.rel['남궁현'] === '옛 인연' && !('남궁소저' in br.rel));

  // 4) the next lives: another world keeps the murim list but does not use it; murim again uses it
  await pg.evaluate('DR.startNewLifeForm({});0');
  await pg.waitForTimeout(300);
  let box = null;
  await begin(pg, {
    world: 'hunter',
    name: '',
    check: async () => (box = await pg.evaluate("document.querySelector('#fate [data-roster]').value")),
  });
  const h = await pg.evaluate(
    '({murim:DR.app.state.roster.murim,hunter:DR.app.state.roster.hunter,now:DR.rosterNow().length,p:window.__lastPrompt})',
  );
  check(errs, 'a hunter life starts with an empty box', box === '');
  check(errs, 'the murim list goes on, unused in a hunter life', h.murim === EDIT && h.hunter == null && h.now === 0);
  check(
    errs,
    // the last life's lines may still be in the recent turns; what only the list says must not be
    'no roster words in the hunter prompt',
    !h.p.includes('모용세가') && !h.p.includes('모용혜(') && !h.p.includes('플레이어가 이 이야기에 정해 둔 인물'),
  );
  // a hunter list: its profiles go out without set-card profiles or open roles (the world has none)
  await pg.evaluate(() =>
    DR.setRoster(DR.app.state, 'hunter', '이름: 김부장 / 직책: 팀장 / 성격: 깐깐함\n\n이름: 박과장 / 소속: 영업팀'),
  );
  await turn(pg, '김부장과 설화와 박과장을 만난다', {});
  const hp = await pg.evaluate('window.__lastPrompt');
  check(
    errs,
    "hunter: the roster profile, no set card's, no open role",
    block(hp, PROFILES).includes('김부장(팀장): 깐깐함') &&
      !block(hp, PROFILES).includes('남궁세가') &&
      !hp.includes('#female1'),
  );
  check(
    errs,
    "hunter: the named list shows a set card's role, not its profile",
    block(hp, NAMED).includes('설화(여, noble lady)') && !block(hp, NAMED).includes('남궁세가'),
  );
  check(errs, 'an entry with only a faction, and no card, sends no profile', !block(hp, PROFILES).includes('박과장'));
  await pg.evaluate('DR.startNewLifeForm({});0');
  await pg.waitForTimeout(300);
  await begin(pg, {
    world: 'murim',
    name: '',
    check: async () => (box = await pg.evaluate("document.querySelector('#fate [data-roster]').value")),
  });
  check(errs, 'murim again: the box holds the murim list', box === EDIT);
  check(errs, 'and this life uses it', (await pg.evaluate('DR.rosterNow().length')) === 4);
  // a set card by name: an exact name or alias for any of a person's names first, then a card name inside the main one
  const byName = await pg.evaluate(() => {
    const mk = (id, set) => ({ id, kind: 'char', set, emotion: 'neutral', name: set + '_neutral1', tags: [set] });
    DR.app.images.push(mk('p1', 'setP'), mk('q1', 'setQ'), mk('r1', 'setR'));
    Object.assign(DR.app.setMeta, {
      setP: { charName: '청운' },
      setQ: { charName: '청운검' },
      setR: { charName: '궁청' },
    });
    DR.imagesChanged();
    return [DR.namedSetOf(['백청운', '청운검']), DR.namedSetOf(['무명객', '남궁청']), DR.namedSetOf(['백청운'])];
  });
  check(
    errs,
    "namedSetOf: an alias's exact card beats a card name inside the main name, and no card name inside an alias",
    same(byName, ['setQ', null, 'setP']),
  );
  // only cards of this life's world bind: a hunter 청아 card listed first, a murim one after
  const world = await pg.evaluate(() => {
    const mk = (id, set) => ({ id, kind: 'char', set, emotion: 'neutral', name: set + '_neutral1', tags: [set] });
    DR.app.images.push(mk('h1', 'setH'), mk('m9', 'setM'));
    Object.assign(DR.app.setMeta, {
      setH: { charName: '청아', worlds: ['hunter'] },
      setM: { charName: '청아', worlds: ['murim'] },
    });
    DR.imagesChanged();
    return DR.namedSetFor('청아');
  });
  check(errs, "a card of another world does not bind: the murim 청아's", world === 'setM');
  // a roster person's face by exact names only; a name from the story still finds a card name inside it
  const strict = await pg.evaluate(() => {
    const st = DR.app.state,
      keep = st.roster.murim;
    DR.setRoster(st, 'murim', '이름: 설화\n\n이름: 남궁설화');
    const out = [DR.namedSetFor('설화'), DR.namedSetFor('남궁설화'), DR.namedSetFor('백설화')];
    DR.setRoster(st, 'murim', keep);
    return out;
  });
  check(
    errs,
    'roster 남궁설화 gets no face from the 설화 card; a story name 백설화 still does',
    same(strict, ['female2', null, 'female2']),
  );
  // the order in the named block: what the story mentions first (groups and members), then the roster, then rotation
  const order = await pg.evaluate(() => {
    const mk = (id, set, faction) => ({
      id,
      kind: 'char',
      set,
      emotion: 'neutral',
      name: set + '_neutral1',
      tags: [set, 'faction:' + faction],
    });
    DR.app.images.push(mk('c1', 'cs1', '청성파'), mk('c2', 'cs2', '청성파'), mk('c3', 'cs3', '아미파'));
    Object.assign(DR.app.setMeta, {
      cs1: { gender: 'male', charName: '송학', worlds: ['murim'] },
      cs2: { gender: 'female', profile: { position: '청성파 제자' }, worlds: ['murim'] }, // an open role
      cs3: { gender: 'female', charName: '혜정', worlds: ['murim'] },
    });
    DR.imagesChanged();
    const st = DR.app.state,
      keep = st.roster.murim;
    const one = (i, f) => `이름: 무명${i}호 / 소속: 문파${f} / 직책: 제자`;
    DR.setRoster(st, 'murim', Array.from({ length: 40 }, (_, i) => one(i, i % 8)).join('\n'));
    const t = {};
    const big = DR.buildPrompt('청성파로 간다', null, t);
    DR.setRoster(st, 'murim', '이름: 운학 / 소속: 아미파 / 직책: 장로');
    const small = DR.buildPrompt('혜정을 찾아간다', null, {});
    DR.setRoster(st, 'murim', keep);
    return { big, open: t.openRoles, small };
  });
  const nb = block(order.big, NAMED),
    ns = block(order.small, NAMED);
  check(
    errs,
    'a long roster does not push out the mentioned group: its card and #role make the block',
    nb.includes('송학(') && nb.includes('#cs2(') && order.open === true,
  );
  check(
    errs,
    'within a group a mentioned card comes before an unmentioned roster person',
    ns.indexOf('혜정(') >= 0 && ns.indexOf('운학(') > ns.indexOf('혜정('),
  );

  // 4) Import characters from the save's notes: one model call, only once Read is pressed; the people join the list
  // ({user} is the player, left out) and, with the box ticked, the notes keep only the rest
  const listBefore = await pg.evaluate(() => {
    DR.app.state.userNotes = '세계: 마교가 강하다.\n### 은둔고수\n-황보엽:48세+男/권왕/무뚝뚝\n-{user}:주인공';
    window.__next = {
      roster: '# 은둔고수\n이름: 황보엽 / 별칭: 권왕 / 성별: 남 / 직책: 48세\n이름: {user} / 직책: 주인공',
      rest: '세계: 마교가 강하다.',
    };
    window.__lastPrompt = '';
    DR.showTab('memory');
    return DR.app.state.roster.murim;
  });
  await pg.click('#memBox .mem-roster [data-roster-import]');
  await pg.waitForSelector('#impRead');
  const askedEarly = await pg.evaluate('window.__lastPrompt');
  await pg.click('#impRead');
  await pg.click('#impAdd');
  await pg.waitForFunction(() => !DR.app.state.userNotes.includes('황보엽'));
  const imp = await pg.evaluate(() => ({
    asked: window.__lastPrompt,
    notes: DR.app.state.userNotes,
    list: DR.app.state.roster.murim,
    names: DR.rosterNow().map(e => e.name),
    alias: (DR.rosterFor('권왕') || {}).name,
  }));
  await pg.evaluate('window.__next = null');
  check(errs, 'no model call before Read is pressed', askedEarly === '');
  check(errs, 'the import reads the notes', imp.asked.includes('-황보엽:48세+男') && imp.asked.includes('"roster"'));
  check(
    errs,
    'the imported people join the list after its own, without {user}',
    imp.list.startsWith(listBefore) && imp.alias === '황보엽' && !imp.names.includes('{user}') && imp.names.length > 1,
  );
  check(errs, 'the notes keep only the rest', imp.notes === '세계: 마교가 강하다.');
  expect(errs).toEqual([]);
});
