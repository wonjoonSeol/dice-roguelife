// a reply written with single line breaks reads as paragraphs, and markdown comment lines never show
import { test, expect } from './support/test.js';
import { check, claudeMock, startLife } from './support/harness.js';

// comments as chat-site prompts ask for, a list, and after a blank line a mark and a window, as a correction appends
const ONE_BREAK =
  '[//]: # (Never describe the {user}\'s actions predictively)\n민지는 시선을 거뒀다.\n한민지 | "들을게요."\n아래층에서 상자가 떨어졌다.\n- 상자 두 개\n- 열쇠 하나\n\n[//]: # (state: hall)\n\n[[경비원]]\n[ 정정 반영: 복도 ]';
// blank lines only next to a list (as a /skills answer has), and a place mark with no picture between paragraphs
const WITH_LIST =
  '릴이 돌아간다.\n\n[[@reel, casino]]\n\n- 첫 번째 릴, 게이트.\n- 두 번째 릴, 슬라임.\n\n당신은 숨을 고른다.\n주위가 조용해진다.';
const MOCK = claudeMock(
  `async(p)=>(window.__prompt=p,{admin:'',narration:window.__narr||${JSON.stringify(ONE_BREAK)},system:[],choices:['기다린다'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false})`,
);
// the last finished turn's narration as text, without its windows
const lastNarr = `(() => { const n = [...document.querySelectorAll('.turn .narr:not(#livePrev)')].at(-1).cloneNode(true);
  n.querySelectorAll('.sysmsg').forEach(e => e.remove()); return n.textContent; })()`;

test('narration line breaks and markdown comments', async ({ game }) => {
  const { pg, errs } = await game(MOCK);
  await startLife(pg, { world: 'hunter', dice: false });
  const one = await pg.evaluate(lastNarr);
  check(
    errs,
    'comments are hidden; single breaks between prose become paragraphs, despite the blank line before the window, and the list stays together: ' +
      JSON.stringify(one),
    one.trim() ===
      '민지는 시선을 거뒀다.\n\n한민지 | "들을게요."\n\n아래층에서 상자가 떨어졌다.\n- 상자 두 개\n- 열쇠 하나',
  );

  await pg.evaluate(`window.__narr=${JSON.stringify(WITH_LIST)};0`);
  await pg.fill('#input', '기다린다');
  await pg.press('#input', 'Enter');
  // a reply with blank lines keeps its single breaks, and a mark with no picture leaves its paragraphs apart
  await expect
    .poll(() => pg.evaluate(lastNarr))
    .toBe('릴이 돌아간다.\n\n- 첫 번째 릴, 게이트.\n- 두 번째 릴, 슬라임.\n\n당신은 숨을 고른다.\n주위가 조용해진다.');
  check(
    errs,
    "the narrator's history keeps its own comment lines, which steer it",
    await pg.evaluate("String(window.__prompt).includes('[//]: # (Never describe')"),
  );

  // paragraphs apart only around a mark still count as paragraphs: their own single breaks stay
  const marked = '비가 왔다.\n우산은 없었다.\n\n[[행인]]\n\n누군가 웃었다.\n발소리가 멀어졌다.';
  await pg.evaluate(`window.__narr=${JSON.stringify(marked)};0`);
  await pg.fill('#input', '기다린다');
  await pg.press('#input', 'Enter');
  await expect.poll(() => pg.evaluate(lastNarr)).toBe(marked.replace('[[행인]]\n\n', ''));
  expect(errs).toEqual([]);
});
