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
