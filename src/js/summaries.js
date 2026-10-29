/* ============ memory: summaries ============ */
import { noteIgnored, utf8Bytes } from './util.js';
import { turnStore } from './turn-store.js';
import { app } from './app.js';
import { persist } from './persistence.js';
import { fillTemplate, pr, prFor, prLang, sampleJson, sentWindow, trackedLine, turnText } from './prompt.js';

export async function maybeSummarize() {
  const lastI = app.state.next - 1;
  const keep = sentWindow().length;
  if (lastI - app.state.summarizedUpto < keep + 22) return; // summarize only what has fallen out of the raw window, in chunks of at least 22
  const upto = lastI - keep - 2;
  let chunk = app.turns.filter(t => t.i > app.state.summarizedUpto && t.i <= upto);
  if (app.turns.length && app.turns[0].i > app.state.summarizedUpto + 1) {
    try {
      const all = await turnStore.loadRange(app.currentSave.id, app.state.summarizedUpto, upto);
      if (all.length) chunk = all;
    } catch (e) {
      noteIgnored('summaries: load older turns (summarizing what is loaded)', e);
    }
  }
  if (chunk.length < 6) return;
  try {
    const ctext = chunk.map(turnText).join('\n\n').slice(0, 40000);
    const nsent = Math.max(4, Math.min(12, Math.round(utf8Bytes(ctext) / 4000)));
    const r = await sampleJson(
      fillTemplate(prFor('summary'), {
        lang: prLang('summaryLang'),
        n: `${nsent}~${nsent + 2}`,
        chunk: ctext,
        tracked: trackedLine(), // only the scenario summary has a place for it
      }),
      { modelTier: 'quick', cache: false },
    );
    if (r && r.summary) {
      app.state.summaries.push({
        life: app.state.lifeNo,
        from: app.state.summarizedUpto + 1,
        to: upto,
        text: String(r.summary).slice(0, 1600),
      });
      app.state.summarizedUpto = upto;
    }
    if (app.state.summaries.length > 10) {
      const old = app.state.summaries.slice(0, 6);
      const r2 = await sampleJson(fillTemplate(pr('summaryMerge'), { list: old.map(x => '- ' + x.text).join('\n') }), {
        modelTier: 'quick',
        cache: false,
      });
      if (r2 && r2.summary)
        app.state.summaries = [
          {
            life: app.state.lifeNo,
            from: old[0].from,
            to: old[5].to,
            text: String(r2.summary).slice(0, 1200),
            era: true,
          },
          ...app.state.summaries.slice(6),
        ];
    }
    await persist();
  } catch (e) {
    console.warn('summary', e);
  }
}
