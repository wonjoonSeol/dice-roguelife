// the date is counted by the code from the first real date; a missed midnight adds a day; time does not slip back within a day; own-calendar worlds keep the narrator's date
import { test, expect } from './support/test.js';
import { check, claudeMock, same, startLife } from './support/harness.js';

const SEQ = [
  { date: '2035년 4월 13일', time: '오후 11시 30분', days_passed: 0 }, // opening: becomes the anchor (금)
  { date: '2035년 4월 19일', time: '오후 11시 52분', days_passed: 0 }, // narrator jumps the date: ignored
  { time: '오전 12시 09분', days_passed: 0 }, // past midnight, unreported: +1 day
  { time: '오전 12시 01분', days_passed: 0 }, // slips back 8 minutes: keep 12:09
  { time: '오전 7시 20분', days_passed: 1 }, // reported day: +1
];
const J =
  'async()=>{const seq=' +
  JSON.stringify(SEQ) +
  ";const n=(window.__n=(window.__n||0)+1);const c=seq[Math.min(n,seq.length)-1];return{admin:'',narration:'장면 '+n,system:[],choices:['a'],stat_changes:{},clock:c,memory:{},dead:false}}";

test('clock', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(J), { size: [1280, 720] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  const got = [
    await pg.evaluate('JSON.stringify([DR.app.state.clock.day,DR.app.state.clock.date,DR.app.state.clock.time])'),
  ];
  for (let k = 0; k < 4; k++) {
    await pg.fill('#input', `다음 ${k}`);
    await pg.press('#input', 'Enter');
    await pg.waitForTimeout(600);
    got.push(
      await pg.evaluate('JSON.stringify([DR.app.state.clock.day,DR.app.state.clock.date,DR.app.state.clock.time])'),
    );
  }
  for (const g of got) console.log(g);
  const want = [
    '[0,"2035년 4월 13일 (금)","오후 11시 30분"]',
    '[0,"2035년 4월 13일 (금)","오후 11시 52분"]',
    '[1,"2035년 4월 14일 (토)","오전 12시 09분"]',
    '[1,"2035년 4월 14일 (토)","오전 12시 09분"]',
    '[2,"2035년 4월 15일 (일)","오전 7시 20분"]',
  ];
  console.log(
    'times parse:',
    await pg.evaluate(
      "['오후 11시 52분','오전 12시 09분','밤 12시','밤 1시','새벽 3시 반','낮 1시','정오','23:05','11시 5분'].map(DR.clockMin)",
    ),
  );
  // an older save with a date but no anchor: the next day moves the date
  await pg.evaluate(
    "DR.app.state.clock={day:5,date:'2035년 4월 23일 (월)',time:'오후 10시 40분',weather:'',place:''};0",
  );
  await pg.evaluate('window.__n=99;0');
  const old = await pg.evaluate(
    "(()=>{DR.applyOut(DR.normalize({admin:'',narration:'다음 날.',system:[],choices:[],stat_changes:{},clock:{days_passed:1,time:'오전 8시 55분'},memory:{},dead:false}));return JSON.stringify([DR.app.state.clock.day,DR.app.state.clock.date,DR.app.state.clock.anchor])})()",
  );
  console.log('older save, one day later:', old);
  check(errs, 'the date follows the anchor, a missed midnight and reported days, never the narrator', same(got, want));
  const [day, date, anchor] = JSON.parse(old);
  check(
    errs,
    'an older save without an anchor: one day later is day 6, 4월 24일 (화), anchored at its day 5 date',
    day === 6 && date === '2035년 4월 24일 (화)' && same(anchor, { date: '2035-04-23', day: 5 }),
  );
  // a world's own calendar the code can't count: the date stays the one named, and the screen and the prompt add the days
  // since; the shown date said back (with its count, or the bare base on a talk turn) is no new date; a new one resets it
  const own = clock =>
    pg.evaluate(c => {
      DR.applyOut(
        DR.normalize({
          admin: '',
          narration: '.',
          system: [],
          choices: [],
          stat_changes: {},
          clock: c,
          memory: {},
          dead: false,
        }),
      );
      const ck = DR.app.state.clock;
      return [ck.date, DR.clockDate(ck, 'ko'), DR.buildPrompt('간다', null).includes(DR.clockDate(ck, 'ko'))];
    }, clock);
  await pg.evaluate(
    "DR.app.state.clock={day:1,date:'정월 열사흘',dateDay:1,time:'오전 6시 30분',weather:'',place:''};0",
  );
  const twoLater = await own({ days_passed: 2, time: '오후 6시 40분' });
  const oneMore = await own({ days_passed: 1, time: '오전 6시 30분' });
  const echoed = await own({ days_passed: 0, time: '오전 7시', date: '정월 열사흘 (+3일)' });
  const base = await own({ days_passed: 0, time: '오전 7시 30분', date: '정월 열사흘' });
  const named = await own({ days_passed: 1, time: '오전 7시 10분', date: '정월 열이레' });
  console.log('own calendar:', JSON.stringify([twoLater, oneMore, echoed, base, named]));
  check(
    errs,
    'days without a date count from the last named one',
    twoLater[0] === '정월 열사흘' &&
      twoLater[1] === '정월 열사흘 (+2일)' &&
      oneMore[1] === '정월 열사흘 (+3일)' &&
      oneMore[2],
  );
  check(
    errs,
    'the shown date said back keeps the count',
    echoed[1] === '정월 열사흘 (+3일)' && base[1] === '정월 열사흘 (+3일)',
  );
  check(errs, 'a named date replaces the count', named[0] === '정월 열이레' && named[1] === '정월 열이레');
  // the same date respelled, a count alone, and a full-width count are no new date; a world's year-month-day is its own
  const respelled = await own({ days_passed: 1, time: '오전 8시', date: '정월열이레' });
  const countOnly = await own({ days_passed: 0, time: '오전 9시', date: '(+1일)' });
  const wide = await own({ days_passed: 0, time: '오전 10시', date: '정월 열이레（＋１日）' });
  await pg.evaluate("DR.app.state.clock={day:1,date:'',time:'오전 6시',weather:'',place:''};0");
  const empire = await own({ days_passed: 0, time: '오전 7시', date: '제국력 1203년 3월 5일' });
  const empire2 = await own({ days_passed: 1, time: '오전 7시' });
  console.log('variants:', JSON.stringify([respelled, countOnly, wide, empire, empire2]));
  check(
    errs,
    'a respelled, count-only or full-width echo keeps the count',
    [respelled, countOnly, wide].every(x => x[1] === '정월 열이레 (+1일)'),
  );
  check(
    errs,
    "a world's own year-month-day is not a real calendar",
    empire[0] === '제국력 1203년 3월 5일' && empire2[1] === '제국력 1203년 3월 5일 (+1일)',
  );
  expect(errs).toEqual([]);
});
