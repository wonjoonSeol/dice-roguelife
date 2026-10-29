/* ============ death & ledger ============ */
import { esc, nowIso, toast } from './util.js';
import { tierRank, TIERS } from './data.js';
import { platform } from './db.js';
import { app, currentRun, exclusive } from './app.js';
import { setting } from './settings.js';
import { cueScore } from './sound.js';
import { persist, pushTurn } from './persistence.js';
import { renderLog } from './log.js';
import { sampleError } from './turn.js';
import { fillTemplate, pl, pr, prLang, sampleJson, turnText } from './prompt.js';
import { askConfirm } from './sheet.js';
import { T } from './i18n.js';

export function deathPanel() {
  if (app.state.pendingInherit !== undefined)
    return `<div class="turn"><div class="row death-actions"><button class="btn primary" id="regressBtn">${T('Regress')}</button></div></div>`;
  return `<div class="turn death"><h4>${T('Death')}</h4><p class="death-lead">${T('Life {n} has ended.', { n: app.state.lifeNo })}</p><button class="btn primary" id="ledgerBtn">${T('Life Review')}</button></div>`;
}
export function ledgerCard(o, ti) {
  if (!o) return '';
  return `<div class="death"><h4>${T('Life Review')}</h4><div class="row ledger-score-row"><span class="score">${esc(o.score)}</span><span class="muted">${T('pts')}</span></div>
   <p class="ledger-epitaph">${esc(o.epitaph || '')}</p><p class="muted ledger-summary">${esc(o.summary || '')}</p>
   ${(o.highlights || []).map(h => `<div class="skill"><div><p class="ledger-highlight">${esc(h)}</p></div></div>`).join('')}
   ${o.inherit && o.inherit.name ? `<div class="item ledger-inherit"><div class="m">${T('Carried into the next life')}</div><div class="t"><span class="tier ${o.inherit.grade}">${o.inherit.grade}</span> ${esc(o.inherit.name)}</div><div class="m">${esc(o.inherit.desc || '')}</div></div>` : ''}
   ${ti !== undefined ? `<div class="row actions"><button class="btn" data-card="${ti}">${T('Share card')}</button>${platform.memMode || platform.localMode ? '' : `<button class="btn ${o.hallId ? 'ghost' : 'primary'}" data-hall="${ti}" ${o.hallId ? 'disabled' : ''}>${o.hallId ? T('In the Hall') : T('Post to the Hall')}</button>`}</div>` : ''}</div>`;
}
export function runLedger() {
  return exclusive(writeLedger);
}
// A scenario save never dies, so its story ends when the player says so: an ending card without a score, kept in the
// save (state.endings, shown in Memory and carried in the save file). Play can go on after it. True once written.
export async function runEnding() {
  if (!(await askConfirm(T('End the story here and write its ending card? You can keep playing after it.'))))
    return false;
  return exclusive(writeEnding);
}
// what the ledger and an ending card read: this life's summaries, and the last turns up to 8000 characters
const lifeSummary = st =>
  st.summaries
    .filter(x => x.life === st.lifeNo)
    .map(x => x.text)
    .join(' ');
const recentForLedger = () => app.turns.slice(-16).map(turnText).join('\n\n').slice(-8000);
async function writeEnding() {
  const run = currentRun();
  toast(T('Writing the ending'));
  try {
    const st = app.state;
    const o = await sampleJson(
      fillTemplate(pr('scenarioEnding'), {
        scenario: st.scenarioName || st.life.world.name,
        name: st.life.name,
        summary: lifeSummary(st),
        recent: recentForLedger(),
        langLine: prLang('ledgerLang'),
      }),
      { modelTier: setting('tier'), cache: false },
    );
    if (run.abandoned) return false;
    const line = (v, n) =>
      String(v || '')
        .trim()
        .slice(0, n);
    const last = app.turns[app.turns.length - 1];
    st.endings = [
      ...(st.endings || []),
      {
        at: last ? last.i : 0,
        date: nowIso(),
        title: line(o.title, 60),
        epitaph: line(o.epitaph, 120),
        summary: line(o.summary, 600),
        highlights: (Array.isArray(o.highlights) ? o.highlights : [])
          .map(h => line(h, 160))
          .filter(Boolean)
          .slice(0, 4),
      },
    ].slice(-30);
    await persist();
    toast(T('Ending saved in Memory'));
    return true;
  } catch (e) {
    if (!run.abandoned) sampleError(e);
    return false;
  }
}
async function writeLedger() {
  const run = currentRun();
  app.phase = 'ledger';
  renderLog();
  const best = app.state.skills.reduce(
    (b, k) => (tierRank(k.grade) < tierRank(b) ? k.grade : b),
    app.state.life.originTier,
  );
  const cap = TIERS[Math.min(TIERS.length - 1, Math.max(tierRank(best), tierRank('SSS')))];
  try {
    const o = await sampleJson(
      fillTemplate(pr('ledger'), {
        name: app.state.life.name,
        cap,
        world: app.state.life.world.name,
        race: app.state.life.race,
        origin: app.state.life.origin,
        tier: app.state.life.originTier,
        age: app.state.stats.age,
        power: app.state.stats.power,
        title: app.state.title || pl('None'),
        skills: app.state.skills.map(k => k.name + '(' + k.grade + ')').join(', '),
        summary: lifeSummary(app.state),
        recent: recentForLedger(),
        langLine: prLang('ledgerLang'),
      }),
      { modelTier: setting('tier'), cache: false },
    );
    if (run.abandoned) return; // the save was left while the ledger was being written
    const inh =
      o.inherit && o.inherit.name
        ? {
            name: String(o.inherit.name).slice(0, 30),
            grade:
              TIERS.includes(o.inherit.grade) && tierRank(o.inherit.grade) >= tierRank(cap) ? o.inherit.grade : cap,
            desc: String(o.inherit.desc || '').slice(0, 120),
          }
        : {};
    o.inherit = inh;
    app.state.pastLives.push({
      lifeNo: app.state.lifeNo,
      world: app.state.life.world.name,
      origin: app.state.life.origin,
      tier: app.state.life.originTier,
      epitaph: String(o.epitaph || '').slice(0, 120),
      score: o.score,
    });
    app.state.pastLives = app.state.pastLives.slice(-30);
    app.state.pendingInherit = inh;
    app.phase = 'busy';
    cueScore(o.score || 0);
    await pushTurn({ kind: 'ledger', out: o });
  } catch (e) {
    if (run.abandoned) return; // the save was left: the phase belongs to whatever runs now
    app.phase = 'busy';
    sampleError(e);
  }
  renderLog();
}
