// Labels from before the modern world: the one-time library migration (hunter sets and backgrounds gain modern unless
// they are monsters or fantasy folk), that it runs once per library even when empty (a chip taken off, or never put on,
// stays that way across a reload), the same rule for a tags.json made before the world, and a modern life's face
import { test, expect } from './support/test.js';
import { check, claudeMock, same, startLife } from './support/harness.js';

// candidates that differ: of the women, only hunter1 should fit the modern world after the migration
const SETS = {
  hunter1: { gender: 'female', role: 'office worker', worlds: ['hunter', 'academy'], world: 'multi' },
  hunter2: { gender: 'female', role: 'office worker', worlds: ['hunter'], world: 'hunter' },
  legacy1: { gender: 'male', role: 'guild member', worlds: ['gamehunter'], world: 'gamehunter' },
  drake1: {
    gender: 'female',
    role: 'drake',
    worlds: ['monster', 'fantasy', 'tower', 'hunter', 'vrmmo'],
    world: 'multi',
  },
  knight1: { gender: 'female', role: 'knight', worlds: ['fantasy', 'rofan', 'hunter'], world: 'multi' },
  murim1: { gender: 'female', role: 'swordswoman', worlds: ['murim'], world: 'murim' },
  any1: { gender: 'male', role: 'passer-by', world: 'any' },
};
const char = k => ({
  id: k + '_neutral',
  kind: 'char',
  set: k,
  emotion: 'neutral',
  name: k + '_neutral',
  file: k + '_neutral.png',
});
const scene = (name, worlds) => ({
  id: 'bg_' + name,
  kind: 'scene',
  name,
  file: 'bg_' + name + '.png',
  ...(worlds ? { worlds, world: worlds.length === 1 ? worlds[0] : 'multi' } : { world: 'any' }),
});
const ROWS = [
  ...Object.keys(SETS).map(char),
  scene('cafe_day', ['hunter']),
  scene('dungeon_night', ['hunter', 'fantasy']),
  scene('street_day', null),
];
// the mock database survives a reload (sessionStorage), so the second boot sees what the first one wrote. fail: the
// documents whose writes fail during the first load
const mock = (seed, fail = []) =>
  claudeMock(
    "async()=>({admin:'',narration:'장면.',speaker:'한서윤',speaker_gender:'female',speaker_role:'office worker',speaker_weight:'major',speaker_look:['suit'],emotion:'neutral',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false})",
    {
      before: String.raw`
(()=>{const KEY='__dr_store',saved=sessionStorage.getItem(KEY);
 if(saved){for(const [k,v] of JSON.parse(saved))__store.set(k,v);}
 else if(${seed}){for(const [k,v] of Object.entries(${JSON.stringify(SETS)}))__store.set('sets/'+k,v);
   const rows=${JSON.stringify(ROWS)};__store.set('imgidx/0000',{p:0,n:rows.length,rows});}
 const set=__store.set.bind(__store),del=__store.delete.bind(__store),keep=()=>sessionStorage.setItem(KEY,JSON.stringify([...__store]));
 const FAIL=saved?[]:${JSON.stringify(fail)};
 __store.set=(k,v)=>{if(FAIL.includes(k))throw new Error('write failed');const r=set(k,v);keep();return r};__store.delete=k=>{const r=del(k);keep();return r};keep();})();
`,
    },
  );
// the stored labels: set cards by key, background rows by name
const labels = pg =>
  pg.evaluate(() => {
    const out = {};
    for (const [k, v] of window.__store)
      if (k.startsWith('sets/')) out[k.slice(5)] = DR.worldsOf(v);
      else if (k.startsWith('imgidx/'))
        for (const x of v.rows || []) if (x.kind === 'scene') out[x.name] = DR.worldsOf(x);
    return out;
  });
const flagOf = pg => pg.evaluate("(window.__store.get('config/migrations')||{}).modernLabels||null");
// the page has booted and the library upkeep has run
const ready = async pg => {
  await pg.waitForSelector('#rollBtn');
  await pg.waitForTimeout(1200);
};
const reload = async pg => {
  await pg.reload();
  await ready(pg);
};

test('modern labels migration', async ({ game }) => {
  const { pg, errs } = await game(mock(true), { size: [420, 1000] });
  await ready(pg);
  // 1) the first load: hunter sets and backgrounds gain modern (an old alias too), monsters, fantasy folk and the rest
  // stay as they were
  let l = await labels(pg);
  const flag = await flagOf(pg);
  console.log('after the first load:', JSON.stringify(l), '| flag:', flag);
  check(
    errs,
    'hunter sets gain modern',
    same(l.hunter1, ['hunter', 'academy', 'modern']) && same(l.hunter2, ['hunter', 'modern']),
  );
  check(errs, 'an old hunter label becomes hunter and gains modern', same(l.legacy1, ['hunter', 'modern']));
  check(
    errs,
    'a monster or a fantasy set labeled hunter does not gain modern',
    same(l.drake1, SETS.drake1.worlds) && same(l.knight1, SETS.knight1.worlds),
  );
  check(errs, 'a murim-only set stays murim', same(l.murim1, ['murim']));
  check(errs, 'an unlabeled set stays unlabeled', same(l.any1, []));
  check(
    errs,
    'a hunter background gains modern, a fantasy one and an unlabeled one do not',
    same(l.cafe_day, ['hunter', 'modern']) && same(l.dungeon_night, ['hunter', 'fantasy']) && same(l.street_day, []),
  );
  check(errs, 'the library marks the migration done', !!flag);
  // 2) the owner takes the chip off one set, then the page reloads: the migration does not run again
  await pg.evaluate(async () => {
    const m = DR.app.setMeta.hunter2;
    DR.setWorlds(
      m,
      DR.worldsOf(m).filter(w => w !== 'modern'),
    );
    await DR.SETDOC('hunter2').set(m);
  });
  await reload(pg);
  l = await labels(pg);
  const mem = await pg.evaluate('DR.worldsOf(DR.app.setMeta.hunter2)');
  console.log('after the reload:', JSON.stringify(l), '| in memory:', mem);
  check(errs, 'a chip taken off stays off after a reload', same(l.hunter2, ['hunter']) && same(mem, ['hunter']));
  check(errs, 'the other sets keep what the first load gave them', same(l.hunter1, ['hunter', 'academy', 'modern']));
  // 3) a modern life: the woman in the scene gets the hunter set's face
  await startLife(pg, { world: 'modern' });
  await pg.waitForTimeout(800);
  const cands = await pg.evaluate(
    "DR.castCandidates({name:'한서윤',gender:'female',role:'office worker',weight:'major',look:['suit']})",
  );
  const face = await pg.evaluate("DR.app.state.cast['한서윤']||null");
  console.log('candidates:', cands, '| 한서윤 wears:', face);
  check(errs, 'only the migrated hunter set fits a woman in the modern world', same(cands, ['hunter1']));
  check(errs, 'a modern life picks a face from a hunter set', face === 'hunter1');
  expect(errs).toEqual([]);
});

// pictures added to the open library: rows in the image list, set cards with these labels
const addPictures = (pg, sets, bgs) =>
  pg.evaluate(
    async ([sets, rows]) => {
      for (const [k, m] of Object.entries(sets)) {
        DR.app.setMeta[k] = m;
        await DR.SETDOC(k).set(m);
      }
      DR.app.images.push(...rows);
      await DR.IMGX.flush(rows.map(x => x.id));
    },
    [sets, [...Object.keys(sets).map(char), ...bgs]],
  );
const importTags = (pg, j) =>
  pg.evaluate(async j => {
    DR.askConfirm = async () => true;
    await DR.importTags({ text: async () => JSON.stringify(j) });
  }, j);

test('modern labels in a new library and in imported packs', async ({ game }) => {
  const { pg, errs } = await game(mock(false), { size: [420, 1000] });
  await ready(pg);
  // 1) an empty library marks the migration done on its first owner boot, so a hunter-only chip set by hand stays so
  const flag = await flagOf(pg);
  await addPictures(pg, { own1: { gender: 'female', worlds: ['hunter'], world: 'hunter' } }, []);
  await reload(pg);
  let l = await labels(pg);
  console.log('fresh library flag:', flag, '| own1 after a reboot:', l.own1);
  check(errs, 'an empty library marks the migration done', !!flag);
  check(errs, 'a hunter-only chip set by hand stays hunter-only after a reboot', same(l.own1, ['hunter']));
  // 2) a pack made before the modern world: its hunter sets and backgrounds get the same rule as the migration
  await addPictures(pg, { old1: {}, old2: {}, new1: {}, new2: {} }, [
    scene('office_day', null),
    scene('cave_night', null),
  ]);
  await importTags(pg, {
    sets: { old1: { worlds: ['hunter'] }, old2: { worlds: ['hunter', 'fantasy'] } },
    backgrounds: {
      'bg_office_day.png': { place: 'office', worlds: ['hunter'] },
      'bg_cave_night.png': { place: 'cave', worlds: ['hunter', 'monster'] },
    },
  });
  await pg.waitForTimeout(500);
  l = await labels(pg);
  console.log('old pack:', JSON.stringify({ old1: l.old1, old2: l.old2, office: l.office_day, cave: l.cave_night }));
  check(
    errs,
    'an old pack: a hunter set and background gain modern, a fantasy set and a monster background do not',
    same(l.old1, ['hunter', 'modern']) &&
      same(l.old2, ['hunter', 'fantasy']) &&
      same(l.office_day, ['hunter', 'modern']) &&
      same(l.cave_night, ['hunter', 'monster']),
  );
  // 3) a pack that already names the modern world is used as it is
  await importTags(pg, { sets: { new1: { worlds: ['hunter', 'modern'] }, new2: { worlds: ['hunter'] } } });
  await pg.waitForTimeout(500);
  l = await labels(pg);
  console.log('new pack:', JSON.stringify({ new1: l.new1, new2: l.new2 }));
  check(
    errs,
    'a new pack keeps exactly its own labels',
    same(l.new1, ['hunter', 'modern']) && same(l.new2, ['hunter']),
  );
  expect(errs).toEqual([]);
});

test('modern labels after a failed write', async ({ game }) => {
  const { pg, errs } = await game(mock(true, ['sets/hunter2', 'imgidx/0000']), { size: [420, 1000] });
  await ready(pg);
  // 1) two writes fail: no flag, and memory keeps the old labels of what was not written
  let l = await labels(pg);
  const mem = await pg.evaluate(() => [
    DR.worldsOf(DR.app.setMeta.hunter2),
    DR.worldsOf(DR.app.images.find(x => x.name === 'cafe_day')),
  ]);
  const flag = await flagOf(pg);
  console.log('after failed writes:', JSON.stringify(l), '| memory:', JSON.stringify(mem), '| flag:', flag);
  check(errs, 'no flag after a failed write', flag === null);
  check(errs, 'a set that was written gains modern', same(l.hunter1, ['hunter', 'academy', 'modern']));
  check(
    errs,
    'a set and a background whose writes failed keep their old labels, in memory too',
    same(l.hunter2, ['hunter']) && same(l.cafe_day, ['hunter']) && same(mem, [['hunter'], ['hunter']]),
  );
  // 2) the next boot finishes the job and marks it done
  await reload(pg);
  l = await labels(pg);
  console.log('after the retry:', JSON.stringify(l), '| flag:', await flagOf(pg));
  check(
    errs,
    'the next boot finishes and marks the migration done',
    same(l.hunter2, ['hunter', 'modern']) && same(l.cafe_day, ['hunter', 'modern']) && !!(await flagOf(pg)),
  );
  expect(errs).toEqual([]);
});
