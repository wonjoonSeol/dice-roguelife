/* ============ hall of lives (shared) ============ */
import { $, esc, noteIgnored, nowIso, toast } from './util.js';
import { locale, T } from './i18n.js';
import { platform, userCol } from './db.js';
import { turnStore } from './turn-store.js';
import { app } from './app.js';
import { saveSettings } from './settings.js';
import { askConfirm, askPrompt, openSheet } from './sheet.js';
import { renderLog } from './log.js';

export function entryFrom(o, t) {
  const life = t && t.snap ? t.snap.life : app.state.life;
  const st = t && t.snap ? t.snap : app.state;
  return {
    uid: platform.userId,
    nick: (app.settings.nick || '').slice(0, 20),
    charName: life.name,
    world: life.world.name,
    origin: life.origin,
    tier: life.originTier,
    talent: life.talent ? life.talent.name : '',
    lifeNo: st.lifeNo,
    age: st.stats.age,
    score: Math.max(0, Math.min(100, Math.round(Number(o.score) || 0))),
    epitaph: String(o.epitaph || '').slice(0, 120),
    summary: String(o.summary || '').slice(0, 400),
    highlights: (o.highlights || []).slice(0, 4).map(x => String(x).slice(0, 80)),
    inherit: o.inherit && o.inherit.name ? `${o.inherit.name} (${o.inherit.grade})` : '',
    createdAt: nowIso(),
  };
}
export async function shareToHall(i) {
  const t = app.turns.find(x => x.i === i);
  if (!t || !t.out || t.out.hallId) return;
  if (!app.settings.nick) {
    const n = await askPrompt(T('Name to show in the Hall'), app.state.life.name);
    if (n === null) return;
    app.settings.nick = n.trim().slice(0, 20) || app.state.life.name;
    await saveSettings();
  }
  try {
    const e = entryFrom(t.out, t);
    e.public = true;
    const ref = await platform.shared.collection('hall').add(e);
    t.out.hallId = ref.id;
    await turnStore.update(t);
    toast(T('Posted to the Hall'));
    renderLog();
  } catch (e) {
    toast(
      e.code === 'permission_denied' || e.code === 'not_granted'
        ? T("You don't have permission to post")
        : T('Failed: {err}', { err: e.message || e.code }),
    );
  }
}
async function setHallVisibility(r, pub) {
  const from = r.public ? 'hall' : `${platform.userPath}/hall/items`,
    to = pub ? 'hall' : `${platform.userPath}/hall/items`;
  if (from === to) return;
  const data = Object.assign({}, r, { public: pub });
  delete data.id;
  delete data._private;
  const dbFor = path => (path.startsWith('hall') ? platform.shared : platform.db);
  try {
    await dbFor(to).doc(`${to}/${r.id}`).set(data);
    await dbFor(from).doc(`${from}/${r.id}`).delete();
    toast(pub ? T('Made public') : T('Made private'));
    renderHall();
  } catch (e) {
    toast(T("Couldn't change it"));
  }
}
export async function renderHall() {
  const box = $('#hallBox');
  box.innerHTML = `<p class="muted">${T('Loading...')}</p>`;
  let rows = [];
  try {
    const q = await platform.shared.collection('hall').orderBy('score', 'desc').limit(100).get();
    rows = q.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (e) {
    box.innerHTML = `<p class="muted">${T("Couldn't load the Hall.")}</p>`;
    return;
  }
  try {
    const q = await userCol('hall/items').limit(100).get();
    rows = rows.concat(q.docs.map(d => Object.assign({ id: d.id, _private: true, public: false }, d.data())));
  } catch (e) {
    noteIgnored('hall: private entries', e);
  }
  rows.sort((a, b) => b.score - a.score);
  box.innerHTML = `<div class="row view-head hall-head"><h3 class="view-title">${T('Hall of Lives')}</h3><button class="btn ghost hall-nick" id="nickBtn">${esc(app.settings.nick || T('Display name'))}</button></div>
   <p class="muted hall-intro">${T('Lives posted from their Life Review. Tap one to open its share card.')}</p>
   <div class="list">${
     rows
       .map(
         (
           r,
           idx,
         ) => `<div class="item hall-entry" data-row="${r.id}"><div class="row hall-entry-head"><div class="t">${idx + 1}. ${esc(r.charName)} <span class="tier ${r.tier}">${r.tier}</span> <span class="muted hall-by">${esc(r.nick || '')}${r._private ? ' 🔒' : ''}</span></div><b class="hall-score">${r.score}</b></div>
     <div class="m">${esc(r.world)}, ${esc(r.origin)}, ${T('life {n}', { n: r.lifeNo })}, ${T('age {n}', { n: r.age })}</div><div class="hall-epitaph">${esc(r.epitaph)}</div>
     ${r.uid === platform.userId ? `<div class="row hall-tools"><button class="x hall-tool" data-vis="${r.id}">${r._private ? T('Make public') : T('Only me')}</button><button class="x hall-tool" data-delh="${r.id}">${T('Take down')}</button></div>` : ''}</div>`,
       )
       .join('') || `<p class="muted">${T('No one yet.')}</p>`
   }</div>`;
  $('#nickBtn').onclick = async () => {
    const n = await askPrompt(T('Name to show in the Hall'), app.settings.nick || '');
    if (n === null) return;
    app.settings.nick = n.trim().slice(0, 20);
    await saveSettings();
    renderHall();
  };
  box.querySelectorAll('[data-row]').forEach(
    el =>
      (el.onclick = e => {
        if (e.target.dataset.delh || e.target.dataset.vis) return;
        openShareCard(rows.find(r => r.id === el.dataset.row));
      }),
  );
  box.querySelectorAll('[data-vis]').forEach(
    b =>
      (b.onclick = () => {
        const r = rows.find(x => x.id === b.dataset.vis);
        setHallVisibility(r, !!r._private);
      }),
  );
  box.querySelectorAll('[data-delh]').forEach(
    b =>
      (b.onclick = async () => {
        if (!(await askConfirm(T('Take this down from the Hall?')))) return;
        const r = rows.find(x => x.id === b.dataset.delh);
        try {
          await (r._private ? platform.db : platform.shared)
            .doc(`${r._private ? platform.userPath + '/hall/items' : 'hall'}/${r.id}`)
            .delete();
          renderHall();
        } catch (e) {
          toast(T("Couldn't take it down"));
        }
      }),
  );
}
export function openShareCard(r) {
  if (!r) return;
  const text = `${T('[Dice Roguelife] {name}, life {n}: {score} points', { name: r.charName, n: r.lifeNo, score: r.score })}\n${r.world} / ${r.origin}(${r.tier}) / ${T('age {n}', { n: r.age })}\n"${r.epitaph}"${r.highlights && r.highlights.length ? '\n- ' + r.highlights.join('\n- ') : ''}`;
  openSheet(
    `<div class="sharecard tier-${r.tier}"><div class="sc-top"><span>${T('Dice Roguelife')}</span><span>${T('Life {n}', { n: r.lifeNo })}</span></div>
    <div class="sc-name">${esc(r.charName)} <span class="tier ${r.tier}">${r.tier}</span></div>
    <div class="sc-meta">${esc(r.world)}, ${esc(r.origin)}, ${T('age {n}', { n: r.age })}${r.talent ? ', ' + T('talent {name}', { name: esc(r.talent) }) : ''}</div>
    <div class="sc-score"><b>${r.score}</b><small>${T('pts')}</small></div>
    <p class="sc-epi">${esc(r.epitaph)}</p>
    ${(r.highlights || []).map(h => `<div class="sc-h">${esc(h)}</div>`).join('')}
    ${r.inherit ? `<div class="sc-inh">${T('Inherited: {skill}', { skill: esc(r.inherit) })}</div>` : ''}
    <div class="sc-foot">${esc(r.nick || '')}${r.createdAt ? ' · ' + new Date(r.createdAt).toLocaleDateString(locale()) : ''}</div></div>
   <div class="row card-actions"><button class="btn" id="copyCard">${T('Copy text')}</button><button class="btn ghost" data-close>${T('Close')}</button></div>`.replace(
      ' · ',
      ', ',
    ),
  );
  $('#copyCard').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(T('Copied!'));
    } catch (e) {
      toast(T("Couldn't copy"));
    }
  };
}
