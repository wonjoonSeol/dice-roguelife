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

// Page snippets for the images tab, run as pg.evaluate(`(${SNIPPET})(args)`).

// A file store that keeps what is uploaded and serves it at /_blob/<id>; each install mints its own ids (tag + n). It
// counts uploads (window.__uploads) and keeps deleted ids (window.__deleted) and downloaded files (window.__files).
export const ASSET_STORE = String.raw`(tag='a')=>{
  window.__blobs={};window.__files={};window.__deleted=[];window.__uploads=0;let n=0;
  DR.platform.assets={
    upload:async blob=>{const id=tag+(++n);window.__uploads++;window.__blobs[id]=blob;return{id}},
    list:async()=>({assets:[],files:0,usage:{files:0,maxFiles:5000,bytes:0,maxBytes:1e9}}),
    delete:async id=>{window.__deleted.push(id)},
  };
  const f=window.fetch;
  window.fetch=(u,...a)=>{const s=String(u);if(!s.startsWith('/_blob/'))return f(u,...a);const b=window.__blobs[s.slice(7)];
    return Promise.resolve(b?new Response(b):new Response('',{status:404}))};
  DR.platform.limits=Object.assign({},DR.platform.limits,{images:true});
  DR.useCapability=async c=>c==='downloads'?{save:async({filename,data})=>{window.__files[filename]=data}}:null;
}`;

// a blob's bytes as base64
export const B64 = String.raw`async blob=>{const u8=new Uint8Array(await blob.arrayBuffer());let s='';
  for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode(...u8.subarray(i,i+0x8000));return btoa(s)}`;

// png pictures ([name, hue, w = 60, h = 100]) as [name, base64]: a flat colour with a dark block, so the same hue and
// size draw the same bytes
export const DRAW = String.raw`async list=>{
  const out=[];
  for(const [name,hue,w,h] of list){
    const cv=document.createElement('canvas');cv.width=w||60;cv.height=h||100;const c=cv.getContext('2d');
    c.fillStyle='hsl('+hue+',60%,50%)';c.fillRect(0,0,cv.width,cv.height);
    c.fillStyle='#111';c.fillRect(cv.width/4,cv.height/4,cv.width/3,cv.height/5);
    out.push([name,await (${B64})(await new Promise(r=>cv.toBlob(r,'image/png')))]);
  }
  return out;
}`;

// picks files ([name, base64]) in the images tab's upload button
export const PICK_FILES = String.raw`list=>{
  const TYPE={webp:'image/webp',png:'image/png',jpg:'image/jpeg',zip:'application/zip'};
  const dt=new DataTransfer();
  for(const [name,b64] of list)dt.items.add(new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],name,
    {type:TYPE[name.split('.').pop().toLowerCase()]||''}));
  const inp=document.querySelector('#upl');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
}`;
