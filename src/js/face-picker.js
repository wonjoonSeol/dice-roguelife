/* ============ face picker: choose the portrait set for one person ============ */
import { $, esc, noteIgnored, toast } from './util.js';
import { normEmo } from './data.js';
import { platform } from './db.js';
import { turnStore } from './turn-store.js';
import { app, isIdle } from './app.js';
import { logErr } from './diag.js';
import { T } from './i18n.js';
import { closeSheet, openSheet } from './sheet.js';
import { IMGX, SETDOC } from './library.js';
import {
  charSets,
  charSetsAll,
  fitsWorld,
  genderOf,
  imgUrl,
  pickEmotion,
  setCover,
  setsChanged,
  turnPeople,
} from './images.js';
import {
  capTags,
  castCandidates,
  castFor,
  castScorer,
  holderOf,
  isIdTag,
  presentOf,
  speakerOf,
  toEnglishTags,
  wordSet,
} from './casting.js';
import { persist } from './persistence.js';
import { renderLog } from './log.js';

// The sheet behind a reply's face button. It shows the person's clues (looks and role the narrator gave), the tags of
// the face they have now, and the sets that could replace it, best matches first. A pick applies to that reply and
// to every later one. `p` below is one open picker:
//   npc, t       the person and the reply the button was on
//   cur, g, w    their current set, its gender, the world of this life
//   why, clues   the clues kept for them (app.state.castWhy) and the same as one list
//   sets, q      the usable character sets and the search text
//   shown        how many of the matching sets the grid shows ("Show more" adds a page)
//   score        castScorer for these clues
function openPicker(npc, ti) {
  const cur = app.state.cast[npc];
  const why = (app.state.castWhy || {})[npc] || { look: [], role: [] };
  const p = {
    npc,
    t: app.turns.find(x => x.i === +ti),
    cur,
    g: cur ? genderOf(cur) : null,
    w: app.state.life.world.id,
    why,
    clues: [...why.look, ...why.role],
    sets: charSets(),
    q: '',
    shown: FACE_PAGE,
    score: null,
  };
  p.score = scorer(p);
  return p;
}
function roleIn(p) {
  const o = p.t && p.t.out;
  if (!o) return '';
  return (p.npc === o.speaker ? o.speaker_role : ((o.also_present || []).find(x => x.name === p.npc) || {}).role) || '';
}
function scorer(p) {
  return castScorer({
    name: p.npc,
    gender: p.g,
    role: roleIn(p),
    weight: (app.state.castW || {})[p.npc] || 'minor',
    look: p.clues,
  });
}
const faceOf = (p, k) => setCover(k, p.sets[k] || [], true); // null for a set with only adult pictures
const tagsOf = k => [...new Set((charSetsAll()[k] || []).flatMap(x => x.tags || []))];
function hitsOf(p, k) {
  const m = app.setMeta[k] || {};
  const h = wordSet([k, m.role || '', ...(m.kw || []), ...tagsOf(k)]);
  return p.clues.filter(w => h.has(w));
}
async function saveSetTags(k, fn) {
  const imgs = charSetsAll()[k] || [];
  for (const x of imgs) x.tags = capTags(fn(x.tags || []));
  try {
    await IMGX.flush(imgs.map(x => x.id));
  } catch (e) {
    toast(T('Save failed: {err}', { err: e.code || e.message }));
  }
}

/* ---- drawing ---- */
function pickerHtml(p) {
  const cf = p.cur && faceOf(p, p.cur);
  return `<h3 class="fp-name">${esc(p.npc)}</h3><p class="muted sheet-lead">${T('Current face: {face}. Your pick applies to this turn and the turns after it.', { face: p.cur ? esc((app.setMeta[p.cur] || {}).charName || p.cur) : T('none') })}</p>
    ${cf ? `<img src="${imgUrl(cf.id)}" alt="" class="fp-cover">` : ''}
    <div id="castWhy" class="fp-why"></div>
    <div class="row fp-tools"><button class="btn" id="castAuto">${T('Pick again automatically')}</button>${p.cur ? `<button class="btn ghost" id="castOff">${T('Retire this set')}</button>` : ''}<button class="btn ghost" id="castNone">${T('No face')}</button></div>
    <p class="muted fp-hint">${T('Faces that match the clues come first (✓ count). A face with a name tag is in use by someone else, so picking it swaps the two; ✝ marks the face of someone who died and cannot be used.')}</p>
    <input id="castQ" placeholder="${T('Search by name, role or tag')}" class="fp-search">
    <div id="castGrid" class="fp-grid"></div>
    <div class="row actions"><button class="btn" data-close>${T('Close')}</button></div>`;
}
// the clues, and the current face's tags (green where a clue meets one): a tag can be removed, or added by typing
function drawWhy(p) {
  const box = $('#castWhy');
  if (!box) return;
  const { cur, why, clues } = p;
  const hits = cur ? hitsOf(p, cur) : [];
  box.innerHTML = `${why.ai ? `<div class="muted fp-why-head">${why.none ? T('The AI found no face that fits. Add tags or pick one yourself.') : T("The AI picked this person's face from the candidates.")}</div>` : ''}<div class="fp-why-words"><span class="muted">${T("This person's clues:")}</span> ${clues.length ? clues.map(w => `<b class="fp-word${hits.includes(w) ? ' hit' : ''}">${esc(w)}</b>`).join('') : `<span class="muted">${T("None (an older turn, or the narrator didn't describe their looks)")}</span>`}</div>
      ${
        cur
          ? `<div class="fp-tags"><span class="muted">${T("Current face's tags (matches in green):")}</span></div><div class="seg fp-tag-list">${tagsOf(
              cur,
            )
              .map(
                tag =>
                  `<button type="button" data-rmtag="${esc(tag)}" class="fp-tag${clues.some(w => wordSet([tag]).has(w)) ? ' hit' : ''}">${esc(tag)} ✕</button>`,
              )
              .join(
                '',
              )}<input id="addTag" placeholder="${T('+ tag (Korean is turned into English)')}" class="fp-add-tag"></div>`
          : ''
      }`;
  box.querySelectorAll('[data-rmtag]').forEach(
    b =>
      (b.onclick = async () => {
        const tag = b.dataset.rmtag;
        await saveSetTags(cur, a => a.filter(x => x !== tag));
        drawWhy(p);
        drawGrid(p);
      }),
  );
  const add = $('#addTag');
  if (add)
    add.onkeydown = async e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      let tag = add.value.trim();
      if (!tag) return;
      add.disabled = true;
      tag = (await toEnglishTags([tag]))[0];
      await saveSetTags(cur, a => [...new Set([...a, tag])]);
      drawWhy(p);
      drawGrid(p);
      const n = $('#addTag');
      if (n) n.focus();
    };
}
// the sets that fit the world and the gender (and the search), most clue matches first, a page at a time ("Show more"
// adds one). Sets labeled other (기타) are offered to anyone here: the player choosing by hand may want a beast's face
// that casting never gives
const FACE_PAGE = 24;
function drawGrid(p) {
  const { npc, cur, g, w, sets, q } = p;
  const all = Object.keys(sets)
    .filter(
      k =>
        k !== cur &&
        fitsWorld(app.setMeta[k] || {}, w) &&
        (!g || !genderOf(k) || genderOf(k) === g || (app.setMeta[k] || {}).gender === 'other'),
    )
    .filter(k => {
      if (!q) return true;
      const m = app.setMeta[k] || {};
      return [k, m.charName, m.role, ...(sets[k] || []).flatMap(x => x.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    })
    // scored once each: the sort compares them many times
    .map(k => ({ k, hits: hitsOf(p, k).length, score: p.score(k) }))
    .sort((a, b) => b.hits - a.hits || b.score - a.score);
  const cands = all.slice(0, p.shown),
    left = all.length - cands.length;
  const cells = cands
    .map(({ k, hits }) => {
      const f = faceOf(p, k);
      const m = app.setMeta[k] || {};
      const o = holderOf(npc, k);
      const rt = o && app.state.deadNpc && app.state.deadNpc[o];
      return `<button type="button" data-pick="${esc(k)}" ${rt ? `disabled title="${T('The face of someone who died in this life; it cannot be used again')}"` : ''} class="fp-cell">${f ? `<img src="${imgUrl(f.id)}" loading="lazy" alt="" class="fp-thumb${o ? ' taken' : ''}">` : '<span class="fp-thumb"></span>'}${o ? `<span class="fp-badge">${rt ? '✝ ' : ''}${esc(o)}</span>` : ''}<span class="fp-label">${esc(m.charName || k)}${hits ? ` <b class="fp-hits">✓${hits}</b>` : ''}</span></button>`;
    })
    .join('');
  $('#castGrid').innerHTML =
    (cells || `<p class="muted empty">${T('No matching sets.')}</p>`) +
    (left
      ? `<button type="button" class="btn ghost fp-more" id="castMore">${T('Show more ({n} left)', { n: left })}</button>`
      : '');
  $('#castGrid')
    .querySelectorAll('[data-pick]:not([disabled])')
    .forEach(b => (b.onclick = () => applyFace(p, b.dataset.pick)));
  const more = $('#castMore');
  if (more)
    more.onclick = () => {
      p.shown += FACE_PAGE;
      drawGrid(p);
    };
}

/* ---- changes ---- */
// k: the set to give the person, or null for none. A face another person holds is swapped, so nobody gets a twin; a
// faceless figure (isGeneric) is shared instead
async function applyFace(p, k) {
  const { npc, cur, t } = p;
  app.state.noFace = (app.state.noFace || []).filter(n => n !== npc);
  const other = k && holderOf(npc, k);
  if (other) {
    if (cur) app.state.cast[other] = cur;
    else delete app.state.cast[other];
    toast(T('Swapped faces with {name}', { name: other }));
  }
  if (k) app.state.cast[npc] = k;
  else delete app.state.cast[npc];
  if (t && t.img) {
    const o = t.out || {};
    const main = npc === o.speaker;
    const ap = (o.also_present || []).find(x => x.name === npc) || {};
    const kk = k || castFor(main ? { ...speakerOf(o), name: npc } : presentOf({ ...ap, name: npc }));
    const im = kk
      ? pickEmotion(kk, normEmo(main ? o.emotion : ap.emotion), main ? o.speaker_look : [], (main ? o : ap).situation)
      : null;
    if (!Array.isArray(t.img.chars)) t.img.chars = t.img.char ? [{ id: t.img.char, npc: o.speaker || '' }] : [];
    const e = t.img.chars.find(c => c.npc === npc);
    if (e) {
      if (im) e.id = im.id;
      else t.img.chars = t.img.chars.filter(c => c !== e);
    } else if (im) t.img.chars.push({ id: im.id, npc });
    if (main) t.img.char = im ? im.id : null;
    try {
      await turnStore.update(t);
    } catch (e) {
      noteIgnored('face change: save the turn', e);
    }
  }
  await persist();
  closeSheet();
  renderLog('keep');
  if (!other) toast(T("Changed {name}'s face", { name: npc }));
}
// the person as the reply on this button describes them: the speaker, or one of the others present
function personIn(p) {
  const o = (p.t && p.t.out) || {};
  const ap = (o.also_present || []).find(x => x.name === p.npc);
  return p.npc === o.speaker || !ap ? { ...speakerOf(o), name: p.npc } : presentOf({ ...ap, name: p.npc });
}
// a new automatic pick, never the same set again unless it is the only one: the best other candidate, under the same
// rules as any automatic pick (world, gender, faces others wear)
async function pickAgain(p) {
  const { npc, cur } = p;
  const person = personIn(p);
  delete app.state.cast[npc];
  let k = castFor(person);
  if (k === cur) {
    delete app.state.cast[npc];
    k = castCandidates(person, 40).find(x => x !== cur) || cur;
  }
  await applyFace(p, k);
}
// the current set is never assigned again (its set card is marked off), and the person gets a new automatic pick
async function retireSet(p) {
  const { npc, cur } = p;
  const m = (app.setMeta[cur] = app.setMeta[cur] || {});
  m.off = true;
  setsChanged();
  try {
    await SETDOC(cur).set(m);
  } catch (e) {
    noteIgnored('face retire: save the set card', e);
  }
  delete app.state.cast[npc];
  await applyFace(p, castFor(personIn(p)));
  toast(T('{set}: will not be assigned from now on', { set: cur }));
}
// this person shows no face from now on
async function noFace(p) {
  const { npc, t } = p;
  delete app.state.cast[npc];
  app.state.noFace = [...new Set([...(app.state.noFace || []), npc])];
  if (t && t.img) {
    if (Array.isArray(t.img.chars)) t.img.chars = t.img.chars.filter(c => c.npc !== npc);
    if ((t.out || {}).speaker === npc) t.img.char = null;
    try {
      await turnStore.update(t);
    } catch (e) {
      noteIgnored('face retire: save the turn', e);
    }
  }
  await persist();
  closeSheet();
  renderLog('keep');
}
// clues the narrator wrote in Korean cannot meet English tags: turn them into English once (vocabulary-aware), keep
// the identity tags as they are
async function translateClues(p) {
  try {
    const src = p.clues.filter(w => !isIdTag(w));
    const en = await toEnglishTags(src);
    if (!en || en.length !== src.length) return;
    const map = new Map(
      src.map((w, i) => [
        w,
        String(en[i] || w)
          .toLowerCase()
          .trim(),
      ]),
    );
    const fix = a => [...new Set(a.map(w => (isIdTag(w) ? w : map.get(w) || w)))];
    p.why.look = fix(p.why.look || []);
    p.why.role = fix(p.why.role || []);
    p.clues = [...p.why.look, ...p.why.role];
    app.state.castWhy = app.state.castWhy || {};
    app.state.castWhy[p.npc] = p.why;
    p.score = scorer(p);
    await persist();
    if ($('#castGrid')) {
      drawGrid(p);
      drawWhy(p);
    }
  } catch (e) {
    logErr('clues', e);
  }
}

// the face button on a turn: with one person on screen it opens the face window, with several it asks whose first
export function changeFaceIn(ti) {
  try {
    if (!isIdle()) {
      toast(T('A reply is being written. You can change it when it is done'));
      return;
    }
    const t = app.turns.find(x => x.i === ti);
    if (!t) {
      toast(T("Couldn't find this turn. Reload and try again"));
      return;
    }
    const names = turnPeople(t.img || {}, t.out || {})
      .map(p => p.npc)
      .filter(Boolean);
    if (!names.length) {
      toast(T('No faces to change in this scene'));
      return;
    }
    if (names.length <= 1) {
      openCast(names[0], t.i);
      return;
    }
    openSheet(
      `<h3 class="sheet-title">${T('Whose face do you want to change?')}</h3><div class="choices">${names.map(n => `<button data-who="${esc(n)}">${esc(n)}</button>`).join('')}</div><div class="row who-actions"><button class="btn" data-close>${T('Close')}</button></div>`,
    );
    $('#sheetInner')
      .querySelectorAll('[data-who]')
      .forEach(
        x =>
          (x.onclick = () => {
            try {
              closeSheet();
              openCast(x.dataset.who, t.i);
            } catch (e) {
              logErr('face', e);
              toast(T('Something went wrong opening the face picker'));
            }
          }),
      );
  } catch (e) {
    logErr('face', e);
    toast(T('Something went wrong opening the face picker'));
  }
}
export let openCast = async function openCast(npc, ti) {
  const p = openPicker(npc, ti);
  openSheet(pickerHtml(p));
  drawGrid(p);
  drawWhy(p);
  if (platform.sample && p.clues.some(w => /[^\x00-\x7F]/.test(w) && !isIdTag(w))) translateClues(p);
  let qt = null;
  $('#castQ').oninput = e => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      p.q = e.target.value.trim().toLowerCase();
      p.shown = FACE_PAGE;
      drawGrid(p);
    }, 200);
  };
  $('#castAuto').onclick = () => pickAgain(p);
  const off = $('#castOff');
  if (off) off.onclick = () => retireSet(p);
  $('#castNone').onclick = () => noFace(p);
};

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  openCast: f => (openCast = f),
};
