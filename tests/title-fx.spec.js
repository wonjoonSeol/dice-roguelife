// a title window shows the title's effect, in the scene and at the end, for new and old turns
import { test, expect } from './support/test.js';
import { claudeMock, shot, startLife } from './support/harness.js';

const A =
  "async()=>({admin:'',narration:'골목의 서열이 한눈에 들어온다.\\n\\n[ 칭호 획득 : 사다리 아래 ]\\n\\n민수가 뛰어간다.',system:['[ 칭호 획득: 사다리 아래 ]'],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false,title:'사다리 아래',title_effect:'빈민가 아이들의 상납 서열을 한눈에 읽는다'})";

test('title fx', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(A), { size: [390, 900], scale: 2 });
  await pg.waitForTimeout(500);
  await startLife(pg);
  await pg.fill('#input', '지켜본다');
  await pg.press('#input', 'Enter');
  await pg.waitForFunction("[...document.querySelectorAll('.turn')].at(-1)?.querySelector('.win .fx')", null, {
    timeout: 15000,
  });
  const wins = await pg.evaluate(
    "[...[...document.querySelectorAll('.turn')].slice(-1)[0].querySelectorAll('.win')].map(w=>w.innerText.replace(/\\n/g,' / '))",
  );
  console.log('title windows:', wins);
  // a locator, not a handle: the log may redraw after the window shows
  await pg
    .locator('.turn')
    .last()
    .screenshot({ path: shot('title_fx.png') });
  const ok = wins.some(w => w.includes('빈민가 아이들의 상납 서열'));
  if (!ok) errs.push('no effect line');
  expect(errs).toEqual([]);
});
