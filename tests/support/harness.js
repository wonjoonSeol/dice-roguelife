// Shared test helpers: the mock database, a fake Claude, starting a life, soft checks.
//
// Test snippets reach the page's modules through window.DR (src/js/debug.js): DR.app.state, DR.send('...'), and
// DR.toast = fn (or DR.mock('toast', fn)) to replace a function a module lists in its `mocks`.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS = process.env.DR_SHOTS || join(HERE, 'shots'); // screenshots to eyeball, never committed

// the page under test: set once per run by global-setup.js (or by the release, which passes its own build)
export const pageUrl = () => process.env.DR_URL;

// the mock database (support/dbmock.js) starts with config/prompt holding prompts.json, as the live database does
const PROMPTS = readFileSync(join(ROOT, 'prompts.json'), 'utf8');
export const MOCK_BASE = `window.__DR_PROMPT=${PROMPTS};\n` + readFileSync(join(HERE, 'support', 'dbmock.js'), 'utf8');

export const ANSWER =
  "async()=>({admin:'',narration:'장면.',system:[],choices:['a'],stat_changes:{},clock:{days_passed:0},memory:{},dead:false})";

// the mock database plus a fake window.claude whose sample.json is `json` (JS source)
export function claudeMock(json = ANSWER, { owner = true, text = "async()=>({text:''})", before = '' } = {}) {
  return (
    MOCK_BASE +
    before +
    `
window.claude={use:async(n)=>{ if(n==='db')return window.__dbmock; if(n==='user')return{id:async()=>'u_test',isOwner:async()=>${owner},can:async()=>true};
 if(n==='sample'){const f=${text};f.limits=async()=>({maxPromptBytes:262144});f.json=${json};return f;} return null;}};
`
  );
}

// fill the new-game form and start. dice: the per-save luck mode. name: '' on a regression's form, which has none.
// onFate: run on the fate screen, before accepting
export async function startLife(
  pg,
  { world = 'hunter', dice = false, name = '진무', free = false, wait = 1500, onFate = null } = {},
) {
  if (name) await pg.fill('#nm', name);
  await pg.click(`[data-w="${world}"]`);
  if (free) await pg.click('#mseg [data-m="free"]');
  await pg.evaluate(d => {
    const x = document.querySelector('#diceMode');
    if (x) x.checked = d;
  }, dice);
  await pg.click('#rollBtn');
  await pg.waitForTimeout(wait);
  if (onFate) await onFate();
  await pg.click('#acceptBtn');
  await pg.waitForTimeout(700);
}

// A soft expectation: when ok is false, label goes into errs (the test ends with expect(errs).toEqual([]), so every
// failed check of a run is reported together). ok must be a real boolean: an array or an object is always truthy in
// JavaScript, so a check that hands one in is a bug in the check and fails as one.
export function check(errs, label, ok) {
  if (typeof ok !== 'boolean') {
    errs.push(`${label} (check got ${typeof ok}, not a boolean)`);
    return false;
  }
  if (!ok) {
    errs.push(label);
    console.log('  check failed:', label);
  }
  return ok;
}

// deep equality of arrays and objects
export const same = (a, b) => isDeepStrictEqual(a, b);

// page.evaluate(fn, arg) calls a function but never a string, so a snippet kept as text that takes an argument is
// turned into a function first: String(pageFn(src)) === src, so the page still gets exactly that text
export const pageFn = src => new Function(`return ${src}`)();

// path for a screenshot under tests/shots/ (or DR_SHOTS)
export function shot(name) {
  mkdirSync(SHOTS, { recursive: true });
  return join(SHOTS, name);
}

// a fresh copy of fixtures/library.json: a trimmed real image library (set cards and image rows, no image files)
export const library = () => JSON.parse(readFileSync(join(HERE, 'fixtures', 'library.json'), 'utf8'));
