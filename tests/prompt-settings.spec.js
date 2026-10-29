// the player's language, length, correction and prose style settings reach the prompt, just before the rules list,
// even when a prompt near the size limit is rebuilt without its lore, background and past lives
import { test, expect } from './support/test.js';
import { ANSWER, check, claudeMock, startLife } from './support/harness.js';

const CHECK = String.raw`(()=>{const p=DR.buildPrompt('간다',null);const at=s=>s?p.indexOf(s):-2;const rules=p.indexOf('\nRules:\n');
  return {ko:at(DR.prompts.lang.ko),lang:at(DR.prompts.lang.en),len:at(DR.pr('lenLong')),tip:at(DR.prompts.tip.en),
  style:at(DR.pr('styles').jinyong),rules,bytes:new Blob([p]).size}})()`;
// every prompt the page sends, in order
const RECORD = `async(p)=>{(window.__p=window.__p||[]).push(p);return (${ANSWER})()}`;

test('prompt settings', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(RECORD), { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await startLife(pg);
  await pg.waitForFunction('DR.app.turns.length>0&&DR.isIdle()', null, { timeout: 20000 });
  const plain = await pg.evaluate(CHECK);
  console.log('default settings:', plain);
  if (plain.lang !== -1 || plain.len !== -1 || plain.tip !== -1) errs.push('blocks present with default settings');
  if (plain.ko < 0 || plain.ko > plain.rules) errs.push('a Korean story is not told to answer in Korean');
  check(errs, 'a new save has the default prose style, which adds nothing', plain.style === -1);
  // the Memory tab switches the open save to Jin Yong: its narrator prompts get the style, its summaries don't
  await pg.click('[data-tab="memory"]');
  await pg.click('#memStyle [data-sty="jinyong"]');
  await pg.waitForFunction("DR.app.state.style==='jinyong'&&DR.lastSaveCard().style==='jinyong'");
  const jy = await pg.evaluate(CHECK);
  check(errs, 'a Jin Yong save gets its style before the rules list', jy.style > 0 && jy.style < jy.rules);
  const sums = await pg.evaluate(async () => {
    const turns = DR.app.turns,
      next = DR.app.state.next,
      n = window.__p.length;
    DR.app.turns = Array.from({ length: 80 }, (_, i) => ({
      i,
      kind: 'ai',
      out: { narration: '긴 이야기. '.repeat(120) },
    }));
    DR.app.state.next = 80;
    DR.app.state.summarizedUpto = -1;
    await DR.maybeSummarize();
    DR.app.turns = turns;
    DR.app.state.next = next;
    const sent = window.__p.slice(n);
    return { n: sent.length, styled: sent.filter(p => p.includes(DR.pr('styles').jinyong)).length };
  });
  check(errs, `a summary was asked for (${sums.n}) without the style`, sums.n > 0 && sums.styled === 0);
  // the story language belongs to the save (the settings' one is for new games)
  await pg.evaluate("DR.app.state.lang='en';DR.app.settings.len='long';DR.app.settings.langTip=true;0");
  const on = await pg.evaluate(CHECK);
  console.log('english, long, correction, Jin Yong:', on);
  for (const k of ['lang', 'len', 'tip', 'style']) {
    if (on[k] < 0) errs.push(`${k} block missing`);
    else if (on[k] > on.rules) errs.push(`${k} block is not before the rules list`);
  }
  await pg.evaluate(`DR.platform.limits={maxPromptBytes:${Math.floor(on.bytes / 2)}};0`);
  const small = await pg.evaluate(CHECK);
  console.log('rebuilt smaller:', small);
  if (small.bytes >= on.bytes) errs.push('prompt was not rebuilt smaller');
  if (Math.min(small.lang, small.len, small.tip, small.style) < 0) errs.push('blocks lost in the smaller rebuild');
  expect(errs).toEqual([]);
});

// A scenario save: its note takes the place of the roguelike's rules and framing, a first scene ticked to show as it
// is opens the story with no model call, and a roguelike save started after it still gets the roguelike's prompt
const SCEN = '# 비 오는 서점\n{{user}}는 늘 비가 오는 골목 서점의 새 점원이다. SCEN-RULE: 아무도 해를 말하지 않는다.';
const FIRST = '사흘째 비가 그치지 않는다... 문에 달린 종이 울린다.';
const STYLE_TEXT = 'STYLE-RULE: 짧은 문장만 쓴다.';
// what a scenario prompt never carries: the roguelike's name, ADMIN, constellations, regression, grades (words or the
// letter ladder), the combat-power scale, or a line saying something does not apply
const ROGUELIKE_WORDS =
  /Dice Roguelife|주사위가 정한 인생|ADMIN|성좌|회귀|등급|\bEX\b|SSS|S\|A\|B|\(C, Lv|전투력|does not apply|적용되지/i;
test('scenario mode', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(RECORD), { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate(async t => {
    await DR.saveNote({ name: '비 오는 서점', text: t, type: 'scenario' });
    await DR.saveNote({ name: '다른 노트', text: 'OTHER-NOTE' });
    // a note from before note types: no type on its document
    await DR.userDoc('notes/items/old1').set({ name: '옛 노트', text: 'OLD', updatedAt: '2026-01-01T00:00:00Z' });
    await DR.loadNotes();
    DR.libraryChanged();
  }, SCEN);
  await pg.click('#playseg [data-pm="scenario"]');
  check(errs, 'the scenario form hides the roll and shows the start', !(await pg.isVisible('#rollBtn')));
  // a picker lists its own type first and the others behind a toggle; a note's type moves it between pickers
  const where = () =>
    pg.evaluate(() => ({
      type: DR.noteById('old1').type,
      scOther: !!document.querySelector('#scNoteBox details #scNote-old1'),
      tickOther: !!document.querySelector('#nlNotes details #nlNote-old1'),
    }));
  const before = await where();
  check(errs, 'an old note counts as general', before.type === 'general' && !before.tickOther && before.scOther);
  await pg.evaluate(async () => {
    await DR.saveNote({ id: 'old1', name: '옛 노트', text: 'OLD', type: 'scenario' });
    DR.libraryChanged();
  });
  const after = await where();
  check(errs, 'made a scenario, it moves to the scenario picker', !after.scOther && after.tickOther);
  await pg.fill('#nm', '진무');
  const id = await pg.evaluate("DR.noteByName('비 오는 서점').id");
  await pg.check(`#scNote-${id}`);
  await pg.fill('#scFirst', FIRST);
  await pg.check('#scVerbatim');
  const sent = () => pg.evaluate('(window.__p||[]).length');
  const n0 = await sent();
  await pg.click('#scStart');
  await pg.waitForFunction('DR.app.turns.length>=2&&DR.isIdle()', null, { timeout: 15000 });
  const open = await pg.evaluate(() => ({
    mode: DR.app.state.mode,
    sid: DR.app.state.scenarioId,
    card: DR.app.currentSave.scenarioName,
    out: DR.app.turns[1].out.narration,
    strip: document.querySelector('#strip').textContent,
  }));
  check(errs, `the verbatim opening makes no model call (${(await sent()) - n0})`, (await sent()) === n0);
  check(errs, 'the opening is the first scene as written', open.out === FIRST);
  check(errs, 'the save is a scenario save of that note', open.mode === 'scenario' && open.sid === id);
  check(
    errs,
    'the card and the strip name the scenario',
    open.card === '비 오는 서점' && open.strip.includes('비 오는 서점'),
  );
  // one turn: the scenario's rules and note, none of the roguelike's framing
  await pg.evaluate(() => DR.send('책장을 정리한다'));
  await pg.waitForFunction('DR.isIdle()&&DR.app.turns.length>=4', null, { timeout: 15000 });
  const sc = await pg.evaluate(() => {
    const p = window.__p.filter(x => x.includes('책장을 정리한다')).pop() || '';
    return {
      p,
      base: p.startsWith(DR.pr('scenarioRules').slice(0, 120)),
      admin: Object.values(DR.ADMIN_PERSONAS()).some(a => a.text && p.includes(a.text)),
      rl: p.includes(DR.pr('rules').slice(0, 120)),
    };
  });
  check(errs, 'a scenario turn starts from the scenario rules', sc.base);
  check(errs, 'the scenario note goes whole under its own head', sc.p.includes('[시나리오: 비 오는 서점]\n' + SCEN));
  check(errs, 'the scenario is not sent twice as a ticked note', !sc.p.includes('[노트: 비 오는 서점]'));
  check(errs, 'no Dice Roguelife rules or name', !sc.rl && !/Dice Roguelife|주사위가 정한 인생/.test(sc.p));
  check(errs, 'no ADMIN persona block', !sc.admin && !sc.p.includes('[ADMIN]'));
  check(
    errs,
    'no world difficulty, and no stats or skills before the story has any',
    !/\n\[(스탯|스킬|세계)\]/.test(sc.p), // a block starts its line; the rules only name them
  );
  check(errs, 'the persona goes as the player character', sc.p.includes('[플레이어 캐릭터] 진무'));
  // the dice on, a prose style from a note that is also ticked (it goes once, as the style), and the story's own
  // quest, item and skill, which come back in plain words
  const sid = await pg.evaluate(async t => {
    const n = await DR.saveNote({ name: '건조체', text: t });
    Object.assign(DR.app.state, {
      style: 'note',
      styleNoteId: n.id,
      noteIds: [...DR.app.state.noteIds, n.id],
      quests: [{ title: '젖은 편지', status: 'active' }],
      items: [{ name: '우산', qty: 1, grade: 'C' }],
      skills: [{ name: '제본', grade: 'C', desc: '책을 묶는다', lv: 2 }],
    });
    DR.app.state.rules.dice = true;
    return n.id;
  }, STYLE_TEXT);
  await pg.evaluate(() => DR.send('창밖을 본다'));
  await pg.waitForFunction('DR.isIdle()&&DR.app.turns.length>=6', null, { timeout: 15000 });
  const dice = await pg.evaluate(() => window.__p.filter(x => x.includes('창밖을 본다')).pop() || '');
  const [opening, skillCmd] = await pg.evaluate(() => [
    DR.buildPrompt(DR.introPrompt(DR.app.state), null),
    DR.buildPrompt('/skill', DR.parseCmd('/skill')),
  ]);
  check(errs, 'the style note goes once, as the style', dice.split(STYLE_TEXT).length === 2 && !!sid);
  check(errs, 'under its style head', dice.includes('[문체: 건조체]') && !dice.includes('[노트: 건조체]'));
  check(errs, 'a dice turn gets its check blocks', dice.includes('[판정 주사위]') && dice.includes('[주사위]'));
  check(
    errs,
    'the quest, item and skill go, without grades',
    dice.includes('[진행 중 의뢰] 젖은 편지') && dice.includes('[소지품] 우산') && dice.includes('[스킬] 제본(Lv.2)'),
  );
  check(errs, 'a command still has its block', skillCmd.includes('[스킬 조회]'));
  for (const [what, p] of [
    ['opening', opening],
    ['turn', sc.p],
    ['dice turn', dice],
    ['skill command', skillCmd],
  ]) {
    const hit = p.match(ROGUELIKE_WORDS);
    check(errs, `the ${what} prompt has nothing of Dice Roguelife (${hit && hit[0]})`, !hit);
  }
  // a roguelike game after it still gets the roguelike's rules and ADMIN
  await pg.click('[data-tab="saves"]');
  await pg.click('#newGame');
  await pg.click('#playseg [data-pm="roguelike"]');
  await startLife(pg);
  await pg.waitForFunction("DR.isIdle()&&DR.app.state.mode==='roguelike'&&DR.app.turns.length>=2", null, {
    timeout: 20000,
  });
  const rl = await pg.evaluate(() => {
    const p = DR.buildPrompt('간다', null);
    return {
      base: p.startsWith(DR.pr('rules').slice(0, 120)),
      admin: p.includes(DR.ADMIN_PERSONAS().star.text),
      scen: p.includes('[시나리오') || p.includes(DR.pr('scenarioRules').slice(0, 120)),
    };
  });
  check(errs, 'a roguelike save keeps the roguelike rules and ADMIN', rl.base && rl.admin && !rl.scen);
  expect(errs).toEqual([]);
});
