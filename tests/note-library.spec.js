// The note library (notes.js): notes uploaded once, kept for every save, and ticked per save. Only the ticked ones
// reach the narrator, whole, and nothing else gets them; the pick survives a reload, a rewrite and the next lives, and a
// new game starts with the last save's. Same names ask once; a note over 32 KB is refused; the game trims its own
// blocks around a big note; a save file brings its notes along.
import { test, expect } from './support/test.js';
import { check, claudeMock, keptStore, startLife } from './support/harness.js';

// the library can't be read while sessionStorage says so (a connection that fails at the start)
const NOTES_DOWN = `(()=>{const col=window.__dbmock.collection;window.__dbmock.collection=c=>sessionStorage.getItem('__notes_down')&&c.endsWith('/notes/items')?{limit:()=>({get:async()=>{throw new Error('notes down')}})}:col(c);})();`;
// every request is kept (window.__prompts); an image request is a tagging one. The mock database is kept in
// sessionStorage, so a reload boots on what the page wrote
const MOCK = claudeMock(
  String.raw`async(p,o)=>{(window.__prompts=window.__prompts||[]).push({p,images:!!(o&&o.images)});
  if(o&&o.images)return{kind:'char',emotion:'smile',tags:['tagged']};
  return{admin:'',narration:'장면.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false,
    summary:'요약된 이야기',score:10,epitaph:'끝',highlights:[],inherit:{name:'기억',grade:'F',desc:'기억한다'}}}`,
  { before: keptStore() + NOTES_DOWN },
);
const A = '# Alpha\n- ALPHA-RULE: every inn has a cat.\n\n## More\nAlpha keeps going.';
const B = '# Beta\n- BETA-RULE: it always rains on Tuesdays.';
const B2 = '# Beta\n- BETA-EDITED: it never rains.';
const MEMO = '전투는 짧게.';

const idle = pg => pg.waitForFunction('DR.isIdle()', null, { timeout: 15000 });
const prompts = pg => pg.evaluate('(window.__prompts||[]).length');
// the narrator prompt of this input, sent after request n
const promptFor = (pg, n, text) =>
  pg.evaluate(([n, t]) => (window.__prompts.slice(n).find(x => !x.images && x.p.includes(t)) || {}).p || '', [n, text]);
async function turn(pg, text) {
  const n = await prompts(pg);
  await pg.evaluate(t => DR.send(t), text);
  await idle(pg);
  return promptFor(pg, n, text);
}
// files picked in the Memory tab's library at once: [name, text]. Several readable files ask once what they are for:
// general notes here
async function upload(pg, files) {
  await pg.click('[data-tab="memory"]');
  await pg.setInputFiles(
    '#noteLib [data-lib-upload]',
    files.map(([name, text]) => ({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.isBuffer(text) ? text : Buffer.from(text),
    })),
  );
  if (files.length > 1)
    await pg
      .locator('[data-ask-type="general"]')
      .click({ timeout: 1500 })
      .catch(() => {}); // not asked when only one of them can be added
}
const noteIds = pg => pg.evaluate('DR.app.state.noteIds.join()');
const ticked = (pg, id) => pg.evaluate(id => !!document.querySelector(`#nlNote-${id}`)?.checked, id);
// started from the fate screen: waits for the opening reply
async function begin(pg, opts) {
  const n = await pg.evaluate('DR.app.state ? DR.app.turns.length : 0');
  await startLife(pg, opts);
  await pg.waitForFunction(n => DR.app.turns.length >= n + 2 && DR.isIdle(), n, { timeout: 15000 });
}

test('ticked notes reach the narrator, and only narrator turns', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  check(
    errs,
    'an empty library: the new game screen points to the Memory tab, with no picker',
    await pg.evaluate(
      "!document.querySelector('#nlNotes') && /기억 탭/.test(document.querySelector('#nlNotesBox').textContent)",
    ),
  );
  await begin(pg, {});
  await upload(pg, [
    ['Alpha.md', A],
    ['Beta.txt', B],
  ]);
  await pg.waitForFunction('DR.app.notes.length===2');
  const ids = await pg.evaluate("({a:DR.noteByName('Alpha').id,b:DR.noteByName('Beta').id})");
  await pg.fill('#notes', MEMO);
  await pg.click('#saveNotes');
  await pg.check(`[data-lib-use="${ids.a}"]`);
  await pg.waitForFunction(a => DR.app.state.noteIds.join() === a, ids.a);

  // 1) the ticked note, and not the other one: whole, under its name, after the notes box
  let p = await turn(pg, '첫 걸음');
  check(errs, 'the ticked note goes to the narrator, whole', p.includes(A));
  check(errs, 'the unticked note does not', !p.includes('BETA-RULE') && !p.includes('[노트: Beta]'));
  const memo = p.indexOf(MEMO),
    head = p.indexOf('[노트: Alpha]');
  check(errs, 'under its own name, after the notes box', memo > 0 && head > memo && p.indexOf(A) > head);

  // 2) a reload keeps the pick
  await pg.reload();
  await pg.waitForFunction('DR.app.state && DR.app.notes && DR.app.turns.length > 0 && DR.isIdle()', null, {
    timeout: 15000,
  });
  check(errs, 'the pick survives a reload', (await noteIds(pg)) === ids.a);
  p = await turn(pg, '둘째 걸음');
  check(errs, 'and still reaches the narrator after it', p.includes('ALPHA-RULE') && !p.includes('BETA-RULE'));

  // 3) Beta instead, then a rewrite: the story goes back a reply, the pick made since stays
  await pg.click('[data-tab="memory"]');
  await pg.uncheck(`[data-lib-use="${ids.a}"]`);
  await pg.check(`[data-lib-use="${ids.b}"]`);
  await pg.waitForFunction(b => DR.app.state.noteIds.join() === b, ids.b);
  let n = await prompts(pg);
  await pg.evaluate('DR.reroll();0');
  await idle(pg);
  p = await promptFor(pg, n, '둘째 걸음');
  check(
    errs,
    'a rewrite sends the pick made since the last reply',
    p.includes('BETA-RULE') && !p.includes('ALPHA-RULE'),
  );
  check(errs, 'and keeps it in the save', (await noteIds(pg)) === ids.b);

  // 4) an edit is in the next turn's prompt
  await pg.click('[data-tab="memory"]');
  await pg.click(`[data-lib-edit="${ids.b}"]`);
  await pg.fill('#noteText', B2);
  await pg.click('#noteSave');
  await pg.waitForFunction(() => DR.noteByName('Beta').text.includes('BETA-EDITED'));
  p = await turn(pg, '셋째 걸음');
  check(errs, 'an edited note goes out as edited', p.includes(B2) && !p.includes('BETA-RULE'));

  // 5) the next life of this save starts with its pick, which its screen shows
  const first = await pg.evaluate('DR.app.currentSave.id');
  await pg.evaluate("DR.showTab('play');DR.startNewLifeForm({});0");
  check(errs, "the next life's screen ticks the save's notes", (await ticked(pg, ids.b)) && !(await ticked(pg, ids.a)));
  n = await prompts(pg);
  await begin(pg, { name: '', world: 'murim' });
  check(errs, 'the next life keeps the pick', (await noteIds(pg)) === ids.b);
  p = await pg.evaluate(
    n =>
      window.__prompts
        .slice(n)
        .map(x => x.p)
        .join('\n'),
    n,
  );
  check(errs, 'and its opening reply gets the note', p.includes('BETA-EDITED'));

  // 6) a new game starts with the last save's pick
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  check(
    errs,
    "a new game's screen ticks the last save's notes",
    (await ticked(pg, ids.b)) && !(await ticked(pg, ids.a)),
  );
  await begin(pg, { name: '설화' });
  const second = await pg.evaluate('DR.app.currentSave.id');
  check(errs, 'a new save', second !== first);
  check(errs, 'which uses the same notes', (await noteIds(pg)) === ids.b);

  // 7) summaries, the Life Review and tagging never get a note
  n = await prompts(pg);
  await pg.evaluate(async () => {
    const turns = DR.app.turns,
      next = DR.app.state.next;
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
    DR.app.state.summarizedUpto = -1;
    DR.app.state.summaries = [];
  });
  const summaries = await pg.evaluate(n => window.__prompts.length - n, n);
  await pg.evaluate(async () => {
    DR.app.state.dead = true;
    await DR.persist();
    await DR.runLedger();
  });
  const reviews = await pg.evaluate(n => window.__prompts.length - n, n);
  // tagging: one untagged picture in the owner's file store
  await pg.evaluate(() => {
    const f = window.fetch;
    window.fetch = async (u, ...a) =>
      String(u).startsWith('/_blob/')
        ? new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
        : f(u, ...a);
    DR.app.images.push({
      id: 'c1',
      kind: 'char',
      name: 'female9_neutral',
      set: 'female9',
      emotion: 'neutral',
      tags: [],
    });
    DR.platform.limits = Object.assign({}, DR.platform.limits, { images: true });
    DR.platform.assets = {
      list: async () => ({ files: [], usage: { files: 1, maxFiles: 500, bytes: 0, maxBytes: 1e8 } }),
    };
  });
  await pg.click('[data-tab="images"]');
  await pg.waitForSelector('#autoTag');
  await pg.click('#autoTag');
  await pg.waitForFunction("DR.app.images.find(x=>x.id==='c1').autoTagged===true", null, { timeout: 20000 });
  const other = await pg.evaluate(n => window.__prompts.slice(n), n);
  check(
    errs,
    `a summary, a Life Review and a tagging request were made (${summaries}, ${reviews - summaries}, ${other.filter(x => x.images).length})`,
    summaries > 0 && reviews > summaries && other.some(x => x.images),
  );
  check(
    errs,
    'none of them got a note',
    other.every(x => !x.p.includes('BETA-EDITED') && !x.p.includes('[노트:')),
  );

  // 8) a delete says how many saves use the note, and those saves stop sending it
  await pg.evaluate("window.__asked='';DR.askConfirm=async m=>{window.__asked=m;return true};0");
  await pg.click('[data-tab="memory"]');
  await pg.click(`[data-lib-del="${ids.b}"]`);
  await pg.waitForFunction(b => !DR.noteById(b), ids.b);
  check(errs, 'the delete names the two saves that use it', /저장 2개/.test(await pg.evaluate('window.__asked')));
  check(errs, 'the open save drops it', !(await noteIds(pg)).includes(ids.b));
  await pg.evaluate(id => DR.openSave(id), first);
  await idle(pg);
  p = await turn(pg, '넷째 걸음');
  check(errs, 'another save that ticked it no longer sends it', !!p && !p.includes('BETA') && !p.includes('[노트:'));
  check(
    errs,
    'one database document per note',
    await pg.evaluate(() => {
      const docs = [...window.__store.entries()].filter(([k]) => k.includes('/notes/items/'));
      return (
        docs.length === 1 &&
        docs.every(([, d]) => Object.keys(d).sort().join() === 'name,text,type,updatedAt') &&
        docs[0][1].text === DR.noteByName('Alpha').text
      );
    }),
  );
  expect(errs).toEqual([]);
});

test('same names ask once for the batch; a note over 32 KB is refused', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate('window.__toasts=[];DR.toast=m=>window.__toasts.push(m);0');
  // no game open: the Memory tab still holds the library
  await upload(pg, [['Alpha.md', 'one']]);
  await pg.waitForFunction("DR.app.notes.length===1&&!!DR.noteByName('Alpha')");
  const id = await pg.evaluate("DR.noteByName('Alpha').id");

  await upload(pg, [
    ['Alpha.md', 'two'],
    ['Gamma.txt', 'g'],
  ]);
  await pg.waitForSelector('#libSkip');
  const asked = await pg.evaluate("document.querySelector('#sheetInner').textContent");
  check(errs, 'one question names the taken name only', asked.includes('Alpha') && !asked.includes('Gamma'));
  await pg.click('#libSkip');
  await pg.waitForFunction("!!DR.noteByName('Gamma')");
  check(errs, 'skip keeps the old note and adds the others', await pg.evaluate("DR.noteByName('Alpha').text==='one'"));

  await upload(pg, [['Alpha.md', 'three']]);
  await pg.click('#libReplace');
  await pg.waitForFunction("DR.noteByName('Alpha').text==='three'");
  check(
    errs,
    'replace keeps the note and its id',
    await pg.evaluate(id => DR.noteByName('Alpha').id === id && DR.app.notes.length === 2, id),
  );

  await upload(pg, [
    ['Alpha.md', 'four'],
    ['Delta.md', 'd'],
  ]);
  await pg.click('#libCancel');
  await pg.waitForTimeout(300);
  check(
    errs,
    'cancel adds nothing of the batch',
    await pg.evaluate("DR.noteByName('Alpha').text==='three'&&!DR.noteByName('Delta')"),
  );

  // two files of one name in a batch: both kept, the second as "name (2)"
  await upload(pg, [
    ['style.md', 's1'],
    ['style.txt', 's2'],
  ]);
  await pg.waitForFunction("!!DR.noteByName('style (2)')");
  check(
    errs,
    'a batch keeps both files of one name',
    await pg.evaluate("DR.noteByName('style').text==='s1'&&DR.noteByName('style (2)').text==='s2'"),
  );

  // 32,768 bytes is the most a note holds, counted in UTF-8 (11,000 Korean letters are 33,000 bytes)
  await pg.evaluate('window.__toasts=[]');
  await upload(pg, [
    ['Edge.md', 'a'.repeat(32768)],
    ['Big.md', 'b'.repeat(33 * 1024)],
    ['Korean.md', '가'.repeat(11000)],
  ]);
  await pg.waitForFunction("!!DR.noteByName('Edge')");
  await pg.waitForTimeout(200);
  const said = await pg.evaluate('window.__toasts.join(" | ")');
  check(errs, 'a note of exactly 32 KB is taken', await pg.evaluate("DR.noteByName('Edge').text.length===32768"));
  check(errs, 'over 32 KB is refused', await pg.evaluate("!DR.noteByName('Big')&&!DR.noteByName('Korean')"));
  check(
    errs,
    `the toast names what was refused (${said})`,
    /Big/.test(said) && /Korean/.test(said) && /32KB/.test(said),
  );

  // a file saved by Notepad in the Korean Windows encoding (CP949), one with a UTF-8 BOM, and a name macOS wrote in
  // decomposed Hangul: read as written, and the name matches the same name typed here
  const nfd = '노트'.normalize('NFD');
  await upload(pg, [
    ['Ansi.txt', Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0x41, 0x4e, 0x53, 0x49])],
    ['Bom.md', Buffer.from([0xef, 0xbb, 0xbf, 0x42, 0x4f, 0x4d])],
    [nfd + '.md', 'decomposed'],
  ]);
  await pg.waitForFunction("!!DR.noteByName('Ansi')");
  check(errs, 'a CP949 file is read as Korean', await pg.evaluate("DR.noteByName('Ansi').text==='한글 ANSI'"));
  check(errs, 'a BOM is dropped', await pg.evaluate("DR.noteByName('Bom').text==='BOM'"));
  check(errs, 'a decomposed name is stored composed', await pg.evaluate("DR.noteByName('노트')?.text==='decomposed'"));
  await upload(pg, [['노트.md', 'composed']]);
  await pg.waitForSelector('#libSkip');
  await pg.click('#libSkip');
  check(
    errs,
    'and the same name typed here is the same name',
    await pg.evaluate("DR.noteByName('노트').text==='decomposed'"),
  );

  // a file that can't be read: the others are added, and it is named
  const lost = await pg.evaluate(async () => {
    window.__toasts = [];
    const broken = { name: 'Broken.md', arrayBuffer: () => Promise.reject(new Error('gone')) };
    try {
      await DR.uploadNotes([new File(['GOOD'], 'Good.md'), broken]);
    } catch {
      // checked below: the readable file must still be added
    }
    return window.__toasts.join(' | ');
  });
  check(errs, 'an unreadable file leaves the others in', await pg.evaluate("DR.noteByName('Good')?.text==='GOOD'"));
  check(errs, `and is named (${lost.slice(0, 60)})`, /Broken/.test(lost));

  // the editor holds the same rules
  await pg.click('[data-lib-new]');
  await pg.fill('#noteName', 'Alpha');
  await pg.fill('#noteText', 'x');
  // a tap outside the editor leaves it open with what was typed; Cancel still closes it
  await pg.mouse.click(5, 5);
  check(
    errs,
    'a tap outside keeps the editor and its text',
    await pg.evaluate(
      "!document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#noteText').value==='x'",
    ),
  );
  await pg.click('#noteSave');
  await pg.waitForTimeout(200);
  check(
    errs,
    'a new note may not take a used name',
    (await pg.evaluate("DR.app.notes.filter(n=>n.name==='Alpha').length")) === 1,
  );
  await pg.fill('#noteName', 'Long');
  await pg.fill('#noteText', 'z'.repeat(32769));
  await pg.click('#noteSave');
  await pg.waitForTimeout(200);
  check(errs, 'nor be over 32 KB', !(await pg.evaluate("DR.noteByName('Long')")));
  await pg.fill('#noteText', 'fits');
  await pg.click('#noteSave');
  await pg.waitForFunction("!!DR.noteByName('Long')");
  check(errs, 'and a fitting one is saved', await pg.evaluate("DR.noteByName('Long').text==='fits'"));
  expect(errs).toEqual([]);
});

test('ticked notes are never cut: the recent window shrinks only when the prompt is over, and the summaries follow it', async ({
  game,
}) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate('window.__toasts=[];DR.toast=m=>window.__toasts.push(m);0');
  await begin(pg, {});
  const BIG = 'BIG-START\n' + '- 규칙 하나. 장면마다 비가 온다.\n'.repeat(700) + 'BIG-END';
  await upload(pg, [
    ['Big.md', BIG],
    ['Tiny.md', 'TINY-RULE'],
  ]);
  await pg.waitForFunction('DR.app.notes.length===2');
  const ids = await pg.evaluate("({big:DR.noteByName('Big').id,tiny:DR.noteByName('Tiny').id})");
  // a long story so far (each TURN-k row's turn number kept), and lore the input names
  await pg.evaluate(() => {
    const st = DR.app.state;
    window.__rowOf = {};
    for (let k = 0; k < 40; k++) {
      window.__rowOf[k] = st.next;
      DR.app.turns.push({ i: st.next++, kind: 'ai', out: { narration: `TURN-${k} ` + '가'.repeat(1000) } });
    }
    st.lore['서울'] = '서울 설정. '.repeat(400);
  });
  const look = () =>
    pg.evaluate(() => {
      const p = DR.buildPrompt('서울로 간다', null, {});
      return { bytes: DR.utf8Bytes(p), turns: (p.match(/TURN-\d+/g) || []).length, lore: p.includes('서울 설정.'), p };
    });
  // the prompt's size without the lore, and a limit that leaves this much room for the prompt
  const withoutLore = () =>
    pg.evaluate(() => {
      const st = DR.app.state,
        lore = st.lore['서울'];
      delete st.lore['서울'];
      const b = DR.utf8Bytes(DR.buildPrompt('서울로 간다', null, {}));
      st.lore['서울'] = lore;
      return b;
    });
  const room = bytes => pg.evaluate(max => (DR.platform.limits = { maxPromptBytes: max }), Math.ceil(bytes / 0.9));
  // the smallest prompt the game can make (no lore, six recent rows), without the notes
  const smallest = () =>
    pg.evaluate(() => {
      const st = DR.app.state,
        was = [DR.platform.limits, st.noteIds];
      DR.platform.limits = { maxPromptBytes: 1 };
      st.noteIds = [];
      const b = DR.utf8Bytes(DR.buildPrompt('서울로 간다', null, {}));
      [DR.platform.limits, st.noteIds] = was;
      return b;
    });
  const tick = async (on, off) => {
    await pg.click('[data-tab="memory"]');
    if (off) await pg.uncheck(`[data-lib-use="${off}"]`);
    await pg.check(`[data-lib-use="${on}"]`);
    await pg.waitForFunction(id => DR.app.state.noteIds.join() === id, on);
  };

  // a) under a roomy limit a 31 KB note leaves the recent window as it is
  await pg.evaluate(() => (DR.platform.limits = { maxPromptBytes: 262144 }));
  const plain = await look();
  await tick(ids.big);
  const big = await look();
  check(errs, 'the note goes whole', big.p.includes(BIG));
  check(
    errs,
    `a roomy prompt keeps the whole recent window with the note (${plain.turns} → ${big.turns})`,
    big.turns === plain.turns && plain.turns > 6,
  );

  // the meter: a third of the prompt's limit or more is flagged
  const share = async max => {
    await pg.evaluate(max => (DR.platform.limits = { maxPromptBytes: max }), max);
    await pg.click('[data-tab="memory"]');
    return pg.evaluate(() => {
      const el = document.querySelector('#noteLib [data-note-size]');
      return { warn: el.classList.contains('warn'), text: el.textContent };
    });
  };
  const nb = await pg.evaluate(() => DR.notesBytes(DR.pickedNotes()));
  let size = await share(nb * 2);
  check(errs, `half the limit is flagged (${size.text})`, size.warn && /3분의 1/.test(size.text));
  size = await share(nb * 10);
  check(errs, `a tenth is not (${size.text})`, !size.warn);

  // a limit the prompt fits once the lore is out: the lore goes, the window and the note stay
  await room((await withoutLore()) + 500);
  const fit = await look();
  check(errs, 'the lore goes out to make room', !fit.lore && fit.p.includes(BIG));
  check(errs, `and the recent window stays (${fit.turns})`, fit.turns === plain.turns);
  let p = await turn(pg, '서울로 간다');
  check(errs, 'a real turn sends the note whole', p.includes(BIG) && !p.includes('서울 설정.'));

  await pg.waitForFunction('DR.app.state.summaries.length>0', null, { timeout: 15000 }); // the summary runs after the turn

  // b) a limit the note forces a trim under: fewer rows go, and the summary keeps out exactly the rows that went
  await pg.evaluate(() => {
    DR.app.state.summaries = [];
    DR.app.state.summarizedUpto = -1;
  });
  await room((await withoutLore()) - 9000);
  p = await turn(pg, '더 간다');
  await pg.waitForFunction('DR.app.state.summaries.length>0', null, { timeout: 15000 }); // the summary runs after the turn
  const sentTurns = (p.match(/TURN-\d+/g) || []).map(x => +x.slice(5));
  const oldest = await pg.evaluate(k => window.__rowOf[k], Math.min(...sentTurns));
  const to = await pg.evaluate('(DR.app.state.summaries.at(-1)||{}).to');
  check(errs, 'the note still goes whole', p.includes(BIG));
  check(
    errs,
    `the trimmed prompt sends fewer rows (${plain.turns} → ${sentTurns.length})`,
    sentTurns.length < plain.turns && sentTurns.length > 0,
  );
  // the summary ends two rows before the sent window starts, as it always has
  check(errs, `the summary keeps out the window that was sent (to ${to}, sent from ${oldest})`, to === oldest - 3);

  // a limit the note can't fit beside the smallest story: the turn says so and nothing is sent
  await room((await smallest()) + nb / 2);
  let n = await prompts(pg);
  await pg.evaluate(t => DR.send(t), '다시 간다');
  await idle(pg);
  check(errs, 'nothing was sent', (await prompts(pg)) === n);
  let said = await pg.evaluate('window.__toasts.join(" | ")');
  check(errs, `the turn says why (${said.slice(0, 60)})`, /들어가지 않아서 아무것도 보내지 않았어요/.test(said));

  // a tiny note while even the smallest story is over the limit: the note isn't blamed, and the turn goes as before
  await tick(ids.tiny, ids.big);
  await room((await smallest()) - 3000);
  await pg.evaluate('window.__toasts=[]');
  n = await prompts(pg);
  p = await turn(pg, '또 간다');
  said = await pg.evaluate('window.__toasts.join(" | ")');
  check(errs, 'the turn is sent, with the note', p.includes('TINY-RULE'));
  check(errs, `and the note is not blamed (${said.slice(0, 60)})`, !/들어가지 않아서/.test(said));
  expect(errs).toEqual([]);
});

test('a save file carries its notes, under new ids: a deleted note never comes back to the saves that ticked it', async ({
  game,
}) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await pg.evaluate('window.__toasts=[];DR.toast=m=>window.__toasts.push(m);0');
  await begin(pg, {});
  const s1 = await pg.evaluate('DR.app.currentSave.id');
  await upload(pg, [['Scenario.md', A]]);
  await pg.waitForFunction("!!DR.noteByName('Scenario')");
  const id = await pg.evaluate("DR.noteByName('Scenario').id");
  await pg.check(`[data-lib-use="${id}"]`);
  await pg.waitForFunction(id => DR.app.state.noteIds.join() === id, id);
  await pg.evaluate(
    "DR.useCapability=async n=>n==='downloads'?{save:async({data})=>{window.__exp=await data.text()}}:null;0",
  );
  await pg.evaluate(id => DR.exportSaveFile(id), s1);
  await pg.waitForFunction('!!window.__exp', null, { timeout: 15000 });
  // a second save that ticks it too
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  await begin(pg, { name: '설화' });
  const s2 = await pg.evaluate('DR.app.currentSave.id');
  check(errs, 'both saves tick the note', (await noteIds(pg)) === id);
  // deleted with no game open: both saves keep its id
  await pg.evaluate('DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();DR.askConfirm=async()=>true;0');
  await pg.click('[data-tab="memory"]');
  await pg.click(`[data-lib-del="${id}"]`);
  await pg.waitForFunction(id => !DR.noteById(id), id);

  const imported = async (file = 'window.__exp') => {
    const before = await pg.evaluate('DR.app.saves.length');
    await pg.evaluate(`DR.importSaveFile({text:async()=>${file}})`);
    await pg.waitForFunction(b => DR.app.saves.length > b, before, { timeout: 20000 });
    return pg.evaluate(async () => {
      const card = DR.app.saves.find(s => /가져옴/.test(s.name) && !(window.__seen || []).includes(s.id));
      (window.__seen = window.__seen || []).push(card.id);
      const st = await DR.dget('states/items/' + card.id);
      return { id: card.id, ticks: st.noteIds, card: card.noteIds };
    });
  };
  // an old export brings the note back once, under a new id the imported save ticks
  let imp = await imported();
  const back = await pg.evaluate(() => DR.app.notes.map(n => ({ id: n.id, name: n.name, text: n.text })));
  check(
    errs,
    'the note comes back once, under a new id',
    back.length === 1 && back[0].name === 'Scenario' && back[0].text === A && back[0].id !== id,
  );
  check(
    errs,
    'ticked in the imported save and its card',
    imp.ticks.join() === back[0].id && imp.card.join() === back[0].id,
  );
  for (const [s, which] of [
    [s1, 'first'],
    [s2, 'second'],
  ]) {
    await pg.evaluate(s => DR.openSave(s), s);
    await idle(pg);
    const p = await turn(pg, '옛 걸음');
    check(
      errs,
      `the ${which} save, which ticked the deleted note, doesn't get it back`,
      !!p && !p.includes('ALPHA-RULE'),
    );
  }
  await pg.evaluate(s => DR.openSave(s), imp.id);
  await idle(pg);
  check(errs, 'the imported save sends it', (await turn(pg, '가져온 걸음')).includes(A));

  // the same file again: the note with that name and text is used, not copied
  imp = await imported();
  check(
    errs,
    'a note with the same name and text is not copied',
    (await pg.evaluate('DR.app.notes.length')) === 1 && imp.ticks.join() === back[0].id,
  );
  // other text under that name here: both stay, the file's renamed
  await pg.evaluate(id => DR.saveNote({ id, name: 'Scenario', text: 'my own version' }), back[0].id);
  imp = await imported();
  const lib = await pg.evaluate(() => DR.app.notes.map(n => [n.name, n.text]));
  check(
    errs,
    `the same name with other text: both kept (${lib.map(x => x[0]).join(', ')})`,
    lib.length === 2 &&
      lib.some(([n, t]) => n === 'Scenario' && t === 'my own version') &&
      lib.some(([n, t]) => n === 'Scenario (2)' && t === A),
  );
  check(
    errs,
    "the imported save ticks the file's note",
    imp.ticks.join() === (await pg.evaluate("DR.noteByName('Scenario (2)').id")),
  );

  // a file note over 32 KB is named and left out; a nameless one gets a name
  await pg.evaluate(async () => {
    const f = JSON.parse(window.__exp);
    const j = await DR.gunzipBytes(DR.z85dec(f.d, f.n));
    j.notes.push(
      { id: 'huge1', name: 'Huge', text: 'x'.repeat(33000) },
      { id: 'nameless1', name: ' ', text: 'NAMELESS' },
    );
    j.state.noteIds.push('huge1', 'nameless1');
    window.__exp2 = JSON.stringify(j);
    window.__toasts = [];
  });
  imp = await imported('window.__exp2');
  const said = await pg.evaluate('window.__toasts.join(" | ")');
  check(errs, `a note over 32 KB is named (${said.slice(0, 80)})`, /Huge/.test(said));
  check(errs, 'and not added', !(await pg.evaluate("!!DR.noteByName('Huge')")));
  const untitled = await pg.evaluate("DR.app.notes.find(n=>n.text==='NAMELESS')");
  check(
    errs,
    'a nameless note gets a name',
    !!untitled && untitled.name === '제목 없음' && imp.ticks.includes(untitled.id),
  );

  // a note that can't be written: the save comes in without it, ticking nothing missing, and the toast names it
  await pg.evaluate(() => {
    const j = JSON.parse(window.__exp2);
    j.notes = [{ id: 'stuck1', name: 'Stuck', text: 'STUCK' }];
    j.state.noteIds = ['stuck1'];
    window.__exp3 = JSON.stringify(j);
    window.__toasts = [];
    const set = window.__store.set;
    window.__setWas = set;
    window.__store.set = (k, v) => {
      if (k.includes('/notes/items/')) throw new Error('disk full');
      return set(k, v);
    };
  });
  imp = await imported('window.__exp3');
  await pg.evaluate('window.__store.set=window.__setWas');
  const stuck = await pg.evaluate('window.__toasts.join(" | ")');
  check(
    errs,
    `the import says which note didn't come in (${stuck.slice(0, 80)})`,
    /Stuck/.test(stuck) && /가져옴/.test(stuck),
  );
  check(
    errs,
    'and its save ticks no missing note',
    !(await pg.evaluate("!!DR.noteByName('Stuck')")) && imp.ticks.length === 0 && imp.card.length === 0,
  );

  // an import whose save can't be written adds no notes
  await pg.evaluate(async () => {
    const j = JSON.parse(window.__exp2);
    j.notes = [{ id: 'fresh1', name: 'Fresh', text: 'FRESH' }];
    j.state.noteIds = ['fresh1'];
    const set = window.__store.set;
    window.__store.set = (k, v) => {
      if (k.includes('/states/items/')) throw new Error('disk full');
      return set(k, v);
    };
    try {
      await DR.importSaveFile({ text: async () => JSON.stringify(j) });
    } finally {
      window.__store.set = set;
    }
  });
  check(errs, 'a failed import leaves no note behind', !(await pg.evaluate("!!DR.noteByName('Fresh')")));
  expect(errs).toEqual([]);
});

test("an unread library: the new game says so, keeps the last save's notes, and sends nothing without them", async ({
  game,
}) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await begin(pg, {});
  await upload(pg, [['Alpha.md', A]]);
  await pg.waitForFunction("!!DR.noteByName('Alpha')");
  const id = await pg.evaluate("DR.noteByName('Alpha').id");
  await pg.check(`[data-lib-use="${id}"]`);
  await pg.waitForFunction(id => DR.app.state.noteIds.join() === id, id);
  await pg.evaluate("sessionStorage.setItem('__notes_down','1')");
  await pg.reload();
  await pg.waitForFunction('DR.app.state && DR.isIdle()', null, { timeout: 15000 });
  await pg.evaluate('window.__toasts=[];DR.toast=m=>window.__toasts.push(m);0');
  check(errs, 'the library could not be read', await pg.evaluate('DR.app.notes===null'));
  await pg.click('[data-tab="memory"]');
  check(
    errs,
    'the Memory tab says so, with a retry',
    await pg.evaluate("!!document.querySelector('#noteLib [data-lib-retry]')"),
  );

  // a new game: the picker says so, the game starts with the last save's notes, and its opening isn't sent
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  check(
    errs,
    'the picker says the library was not read',
    await pg.evaluate("!!document.querySelector('#nlNotesBox [data-nl-retry]')&&!document.querySelector('#nlNotes')"),
  );
  const n = await prompts(pg);
  await startLife(pg, { name: '설화' });
  await idle(pg);
  check(errs, "the new save keeps the last save's notes", (await noteIds(pg)) === id);
  check(errs, 'nothing was sent without them', (await prompts(pg)) === n);
  const said = await pg.evaluate('window.__toasts.join(" | ")');
  check(errs, `the turn says why (${said.slice(0, 60)})`, /노트 보관함을 읽지 못했어요/.test(said));

  // once the library is back, the picker's retry reads it, with the last save's notes ticked
  await pg.evaluate(
    "sessionStorage.removeItem('__notes_down');DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0",
  );
  await pg.click('#nlNotesBox [data-nl-retry]');
  await pg.waitForSelector('#nlNotes');
  check(errs, 'the picker shows the library again, the notes ticked', await ticked(pg, id));
  expect(errs).toEqual([]);
});

// the save played last and the save changed last differ here: the new game follows the one played
test('a new game starts with the notes of the save played last, and its own picks are kept', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await begin(pg, {});
  const s1 = await pg.evaluate('DR.app.currentSave.id');
  await upload(pg, [
    ['Alpha.md', A],
    ['Beta.md', B],
  ]);
  await pg.waitForFunction('DR.app.notes.length===2');
  const ids = await pg.evaluate("({a:DR.noteByName('Alpha').id,b:DR.noteByName('Beta').id})");
  await pg.check(`[data-lib-use="${ids.a}"]`);
  await pg.waitForFunction(a => DR.app.state.noteIds.join() === a, ids.a);

  // a second save, with Beta picked on its own screen instead
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  check(errs, "the picker starts with the first save's notes", (await ticked(pg, ids.a)) && !(await ticked(pg, ids.b)));
  await pg.uncheck(`#nlNote-${ids.a}`);
  await pg.check(`#nlNote-${ids.b}`);
  await pg.click(`#nlNotes [data-nl-open="${ids.a}"]`);
  check(
    errs,
    "a note's name in the picker opens it, and only its box ticks",
    (await pg.inputValue('#noteName')) === 'Alpha' &&
      (await pg.inputValue('#noteText')) === A &&
      !(await ticked(pg, ids.a)),
  );
  await pg.click('#sheet [data-close]');
  await begin(pg, { name: '설화' });
  check(errs, 'the second save keeps what its screen ticked', (await noteIds(pg)) === ids.b);

  // the first save opened again: played last, while the second is the newest
  await pg.evaluate(id => DR.openSave(id), s1);
  await idle(pg);
  const order = await pg.evaluate(() => ({ last: DR.app.settings.lastSave, newest: DR.app.saves[0].id }));
  check(errs, 'the fixture: played last and changed last differ', order.last === s1 && order.newest !== s1);
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  check(errs, 'a new game follows the save played last', (await ticked(pg, ids.a)) && !(await ticked(pg, ids.b)));
  expect(errs).toEqual([]);
});

// another device added a note and ticked it after this page read the library
test('ticks keep the notes another device added, and the next turn reads them in', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await begin(pg, {});
  await upload(pg, [['Alpha.md', A]]);
  await pg.waitForFunction("!!DR.noteByName('Alpha')");
  const a = await pg.evaluate("DR.noteByName('Alpha').id");
  const behind = (id, name, text) =>
    pg.evaluate(
      async ([id, name, text]) => {
        window.__store.set(`${DR.platform.userPath}/notes/items/${id}`, {
          name,
          text,
          updatedAt: '2026-10-29T00:00:00Z',
        });
        DR.app.state.noteIds = [...DR.app.state.noteIds, id];
        await DR.persist();
      },
      [id, name, text],
    );
  await behind('late1', 'Late', 'LATE-RULE');
  check(errs, "this page hasn't read the late note", !(await pg.evaluate("!!DR.noteById('late1')")));
  await pg.click('[data-tab="memory"]');
  await pg.check(`[data-lib-use="${a}"]`);
  await pg.waitForFunction(a => DR.app.state.noteIds.includes(a), a);
  check(
    errs,
    'a tick here keeps the late note',
    (await noteIds(pg)).split(',').sort().join() === [a, 'late1'].sort().join(),
  );
  const p = await turn(pg, '늦은 걸음');
  check(
    errs,
    'the next turn reads the library again and sends it',
    p.includes('LATE-RULE') && p.includes('ALPHA-RULE'),
  );

  // a new game's picker keeps one it can't show either
  await behind('late2', 'Later', 'LATER-RULE');
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  await begin(pg, { name: '설화' });
  check(errs, 'a new game keeps the note its picker could not show', (await noteIds(pg)).split(',').includes('late2'));
  expect(errs).toEqual([]);
});

// while a new life's screen is up, the Memory tab has no ticks: the screen's picker holds them
test('the Memory tab ticks only an open save, never one a new life is replacing', async ({ game }) => {
  const { pg, errs } = await game(MOCK, { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  await begin(pg, {});
  await upload(pg, [
    ['Alpha.md', A],
    ['Beta.md', B],
  ]);
  await pg.waitForFunction('DR.app.notes.length===2');
  const ids = await pg.evaluate("({a:DR.noteByName('Alpha').id,b:DR.noteByName('Beta').id})");
  const boxes = async () => {
    await pg.click('[data-tab="memory"]');
    return pg.evaluate(() => ({
      n: document.querySelectorAll('#noteLib [data-lib-use]').length,
      hint: document.querySelector('#noteLib .mem-hint').textContent,
    }));
  };
  check(errs, 'an open save has its ticks', (await boxes()).n === 2);

  // a new game's screen: the save it left stays as it was
  await pg.evaluate("DR.showTab('play');DR.startNewLifeForm();0");
  let seen = await boxes();
  check(
    errs,
    `a new game's screen leaves no ticks here (${seen.n})`,
    seen.n === 0 && /플레이어 설정 아래/.test(seen.hint),
  );

  // a regression's screen: its picker decides, and nothing here overrides it
  await pg.evaluate("DR.showTab('play');DR.app.state=null;DR.app.turns=[];DR.startNewLifeForm();0");
  await begin(pg, { name: '설화' });
  await pg.evaluate("DR.showTab('play');DR.startNewLifeForm({});0");
  seen = await boxes();
  check(errs, `a regression's screen leaves no ticks here (${seen.n})`, seen.n === 0);
  await pg.evaluate("DR.showTab('play')");
  await pg.check(`#nlNote-${ids.b}`);
  await begin(pg, { name: '', world: 'murim' });
  check(errs, "the next life takes its screen's ticks", (await noteIds(pg)) === ids.b);
  expect(errs).toEqual([]);
});
