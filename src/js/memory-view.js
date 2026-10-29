/* ============ memory view ============ */
import { $, esc, toast } from './util.js';
import { LIMITS } from './limits.js';
import { T } from './i18n.js';
import { app, isIdle } from './app.js';
import { renamePerson, saveRoster } from './people.js';
import { rosterNow, rosterTextOf } from './roster.js';
import { bindRosterEditor, rosterEditorHtml } from './roster-view.js';
import { askConfirm } from './sheet.js';
import { charSets } from './images.js';
import { persist } from './persistence.js';
import { seenSpan } from './reroll.js';
import { bindOnePicker, pickedStyle, renderNoteLibrary } from './notes-view.js';
import { isScenario } from './rules.js';
import { noteById, scenarioName, scenarioNote } from './notes.js';
import { ADDON, STYLE } from './enums.js';
import { addonRowsHtml, bindChoice, styleChips, styleNoteHtml } from './new-life.js';
import { extFill, WORLD_EXT, worldExt } from './world-ext.js';
import { renderStrip } from './status.js';
import { runEnding } from './death.js';

const endingsHtml = () => {
  const list = app.state.endings || [];
  return `<div class="sec"><h4>${T('Endings ({n})', { n: list.length })}</h4>${
    list
      .map(
        e =>
          `<div class="lore ending"><b>${esc(e.title)}</b><p>${esc(e.epitaph)}</p><p class="muted">${esc(e.summary)}</p>${e.highlights.map(h => `<p class="ending-moment">${esc(h)}</p>`).join('')}</div>`,
      )
      .join('') || `<p class="muted empty">${T('None yet')}</p>`
  }<button class="btn ghost" id="endStory">${T('End the story')}</button></div>`;
};
export function renderMemory() {
  const box = $('#memBox');
  if (!app.state) {
    box.innerHTML = `<h3 class="view-title mem-empty-title">${T('Memory')}</h3><p class="muted mem-empty">${T("No game in progress yet. Once you start one, this save's notes, summaries, lore, relationships and casting gather here.<br>App settings are under the ⚙ button at the top.")}</p><div class="sec note-lib" id="noteLib"></div>`;
    renderNoteLibrary();
    return;
  }
  const none = `<span class="muted">${T('None')}</span>`;
  const styleOpen = !!app.currentSave && !$('#log .newlife'); // a new life's screen picks it while it is up
  const scen = isScenario();
  box.innerHTML = `<h3 class="view-title">${T('Memory')}</h3><p class="muted mem-intro">${T('This applies to this save slot only. It never mixes with other saves or other chats.')}</p>
   ${scen ? `<div class="field"><label>${T('Scenario')}</label><p class="lore mem-profile">${esc(scenarioName())}${scenarioNote() ? '' : ` <span class="muted">${T('(not in your note library)')}</span>`}</p></div><div class="field mem-addons"><label>${T('Extras')}</label>${addonRowsHtml('mem', app.state.addons || {}, WORLD_EXT[app.state.life.world.id])}<p class="muted field-note">${T('Each extra brings in only its own part of the game, from the next reply on.')}</p></div>` : ''}
   <div class="field"><label>${T('Character profile (fixed for this life; you can change it on the new game screen of your next life)')}</label><p class="lore mem-profile">${app.state.life.profile ? esc(app.state.life.profile) : none}</p></div>
   <div class="field"><label>${T('Prose style')}</label><div class="seg" id="memStyle">${styleChips(app.state.style, !styleOpen)}</div>${styleOpen ? styleNoteHtml('msty', app.state.style, app.state.styleNoteId) : ''}<p class="muted field-note">${styleOpen ? T('How the narrator writes this save, from the next reply on.') : T('Pick it on the new life screen.')}</p></div>
   <div class="field"><label for="notes">${T('Notes: sent to Claude every turn')}</label><textarea id="notes" rows="5" maxlength="${LIMITS.userNotes}" placeholder="${T('e.g. Make ADMIN more cynical. Keep fight scenes short. There is no magic in this world. My childhood friend Seoyun lives next door.')}">${esc(app.state.userNotes)}</textarea>
    <div class="row"><button class="btn" id="saveNotes">${T('Save notes')}</button><span class="muted count-note" id="notesCount">${app.state.userNotes.length}/${LIMITS.userNotes}</span></div></div>
   <div class="sec note-lib" id="noteLib"></div>
   <div class="sec mem-roster"><h4>${T('Characters ({n})', { n: rosterNow().length })}</h4><p class="muted mem-hint">${scen ? T("For this story. A name that matches a set card's name or alias in the Images tab wears that face.") : T("For {world} lives in this save; a life in another world keeps its own list. A name that matches a set card's name or alias in the Images tab wears that face.", { world: esc(app.state.life.world.name) })}</p>${rosterEditorHtml(rosterTextOf(app.state, app.state.life.world.id))}
    <div class="row"><button class="btn" data-roster-save>${T('Save characters')}</button></div></div>
   <div class="sec"><h4>${T('Current situation')}</h4><p class="lore mem-state">${app.state.stateNote ? esc(app.state.stateNote) : none}</p></div>
   <div class="sec"><h4>${T('Story so far ({n})', { n: app.state.summaries.length })}</h4><p class="muted mem-hint">${T('Long-term memory. If a wrong fact sticks, fix it here. Sent to Claude every turn.')}</p>${app.state.summaries.map((x, i) => `<div class="lore"><b>${x.era ? T('Era') : T('life {n}', { n: x.life })}</b><textarea data-esum="${i}" rows="3" maxlength="1600" class="mem-edit">${esc(x.text)}</textarea><button class="x" data-dsum="${i}" aria-label="${T('Delete')}">✕</button></div>`).join('') || `<p class="muted mem-note">${T('Once more than 22 turns have scrolled out of the window, they are summarized automatically.')}</p>`}</div>
   <div class="sec"><h4>${T('Lore ({n})', { n: Object.keys(app.state.lore).length })}</h4><p class="muted mem-hint">${T('Long-term memory. Sent to Claude only when a name comes up in recent turns. Fix or delete wrong lore here.')}</p>
    ${
      Object.entries(app.state.lore)
        .map(
          ([k, v]) =>
            `<div class="lore"><b>${esc(k)}</b><input data-elore="${esc(k)}" value="${esc(v)}" maxlength="300" class="mem-edit"><button class="x" data-dlore="${esc(k)}" aria-label="${T('Delete')}">✕</button></div>`,
        )
        .join('') || `<p class="muted empty">${T('None')}</p>`
    }
    <div class="row mem-add"><input id="loreK" placeholder="${T('Name')}" class="mem-add-input mem-add-key"><input id="loreV" placeholder="${T('Description')}" class="mem-add-input grow"><button class="btn" id="addLore">${T('Add')}</button></div></div>
   <div class="sec"><h4>${T('Relationships ({n})', { n: Object.keys(app.state.relations).length })}</h4>${Object.keys(app.state.relations).length > 1 ? `<p class="muted mem-hint-sm">${T('If one person split into several name tags, tie them together with "Merge with the same person". From then on that name counts as the merged one.')}</p>` : ''}${
     Object.entries(app.state.relations)
       .map(
         ([k, v]) =>
           `<div class="lore"><div class="row mem-merge"><b>${esc(k)}${seenSpan(k)}</b><select data-merge="${esc(k)}" class="mem-merge-select"><option value="">${T('Merge with the same person…')}</option>${Object.keys(
             app.state.relations,
           )
             .filter(o => o !== k)
             .map(o => `<option>${esc(o)}</option>`)
             .join('')}</select></div><p>${esc(v)}</p></div>`,
       )
       .join('') || `<p class="muted empty">${T('None')}</p>`
   }</div>
   ${
     (app.state.corrections || []).filter(c => c.until >= app.state.next).length
       ? `<div class="sec"><h4>${T('Recent corrections')}</h4><p class="muted mem-hint">${T('Reasons picked in Rewrite are passed on for 10 turns.')}</p>${app.state.corrections
           .filter(c => c.until >= app.state.next)
           .map(
             (c, i) =>
               `<div class="lore"><b>${T('{n} {n|turn|turns}', { n: c.until - app.state.next })}</b><p>${esc(c.text)}</p><button class="x" data-dcorr="${i}" aria-label="${T('Delete')}">✕</button></div>`,
           )
           .join('')}</div>`
       : ''
   }
   <div class="sec"><h4>${T('Casting ({n})', { n: Object.keys(app.state.cast).length })}</h4><p class="muted mem-hint">${T('A face is picked at random when someone first appears, and it stays for this save.')}</p>
    ${
      Object.entries(app.state.cast)
        .map(
          ([n, k]) =>
            `<div class="lore"><b>${esc(n)}</b><select data-cast="${esc(n)}" class="set-select grow">${Object.keys(
              charSets(),
            )
              .map(x => `<option ${x === k ? 'selected' : ''}>${esc(x)}</option>`)
              .join(
                '',
              )}</select><button class="x" data-uncast="${esc(n)}" aria-label="${T('Unassign')}">✕</button></div>`,
        )
        .join('') || `<p class="muted empty">${T('None yet')}</p>`
    }</div>
   ${scen ? endingsHtml() : `<div class="sec"><h4>${T('Past lives ({n})', { n: app.state.pastLives.length })}</h4>${app.state.pastLives.map(p => `<div class="lore"><b>${T('life {n}', { n: p.lifeNo })}</b><p>${esc(p.world)}, ${esc(p.origin)}(${esc(p.tier)}), ${T('{score} pts.', { score: esc(p.score) })} ${esc(p.epitaph)}</p></div>`).join('') || `<p class="muted empty">${T('None yet')}</p>`}</div>`}
   <p class="muted mem-footer">${T('App settings (model, language and more) are under the ⚙ button at the top.')}</p>`;
  renderNoteLibrary();
  // From a note takes effect once a note is picked under it (or with the save's last one)
  const setStyle = async (style, styleNoteId) => {
    app.state.style = style;
    if (styleNoteId) app.state.styleNoteId = styleNoteId;
    await persist();
    toast(T('Prose style changed'));
  };
  bindChoice(box, '#memStyle', 'sty', async v => {
    const wrap = $('#mstyWrap');
    if (wrap) wrap.classList.toggle('hidden', v !== STYLE.NOTE);
    const s = pickedStyle('msty', v);
    if (s) await setStyle(s.style, s.styleNoteId);
  });
  bindOnePicker('msty', id => noteById(id) && setStyle(STYLE.NOTE, id));
  box.querySelectorAll('.mem-addons [data-addon]').forEach(
    c =>
      (c.onchange = async () => {
        const k = c.dataset.addon;
        app.state.addons = { ...app.state.addons, [k]: c.checked };
        // an add-on ticked mid-story starts its state, and the narrator names where on its ladder the story is
        if (k === ADDON.EXT && c.checked && app.state.ladder == null) {
          extFill(app.state);
          if (worldExt().ladder) app.state.ladderPending = true;
        }
        await persist();
        renderStrip();
        toast(T('Saved'));
      }),
  );
  const end = $('#endStory');
  if (end) end.onclick = () => runEnding().then(ok => ok && renderMemory());
  $('#notes').oninput = e => ($('#notesCount').textContent = e.target.value.length + '/' + LIMITS.userNotes);
  $('#saveNotes').onclick = async () => {
    app.state.userNotes = $('#notes').value.trim().slice(0, LIMITS.userNotes);
    await persist();
    toast(T('Notes saved'));
  };
  const rs = box.querySelector('.mem-roster');
  const busy = () => (isIdle() ? '' : T('A reply is being written. You can change it when it is done'));
  const saveCharacters = async () => {
    saveRoster(app.state.life.world.id, rs.querySelector('[data-roster]').value);
    await persist();
    // moved notes and faces show in the tab again; what is typed in the other boxes and not saved stays
    const drafts = ['notes', 'loreK', 'loreV'].map(id => [id, $('#' + id) && $('#' + id).value]);
    renderMemory();
    for (const [id, v] of drafts)
      if (v != null && $('#' + id)) {
        $('#' + id).value = v;
        $('#' + id).dispatchEvent(new Event('input'));
      }
  };
  bindRosterEditor(rs, app.state.life.world.id, app.state.life.name, null, {
    own: {
      label: T('Your notes for this save'),
      text: () => $('#notes').value,
      put: rest => {
        $('#notes').value = rest.slice(0, LIMITS.userNotes);
        app.state.userNotes = $('#notes').value.trim(); // kept with the list (saveCharacters)
      },
    },
    untick: id => (app.state.noteIds = app.state.noteIds.filter(x => x !== id)), // kept with the list too
    busy,
    commit: saveCharacters,
  });
  rs.querySelector('[data-roster-save]').onclick = async () => {
    if (busy()) return toast(busy());
    await saveCharacters();
    toast(T('Characters saved'));
  };
  box.querySelectorAll('[data-merge]').forEach(
    sel =>
      (sel.onchange = async () => {
        const from = sel.dataset.merge,
          to = sel.value;
        if (!to) return;
        if (!isIdle()) {
          toast(T('A reply is being written. You can merge once it is done'));
          sel.value = '';
          return;
        }
        if (
          !(await askConfirm(
            T(
              "Merge '{from}' into '{to}'?\nThe relationship notes and face of '{from}' move to '{to}', and from now on '{from}' counts as '{to}'.",
              { from, to },
            ),
            T('Merge'),
          ))
        ) {
          sel.value = '';
          return;
        }
        renamePerson(from, to);
        await persist();
        toast(T("Merged into one person: '{to}'", { to }));
        renderMemory();
      }),
  );
  box.querySelectorAll('[data-esum]').forEach(
    t =>
      (t.onchange = async () => {
        const x = app.state.summaries[+t.dataset.esum];
        if (!x) return;
        x.text = t.value.trim().slice(0, 1600);
        await persist();
        toast(T('Summary updated'));
      }),
  );
  box.querySelectorAll('[data-elore]').forEach(
    t =>
      (t.onchange = async () => {
        app.state.lore[t.dataset.elore] = t.value.trim().slice(0, 300);
        await persist();
        toast(T('Lore updated'));
      }),
  );
  box.querySelectorAll('[data-dlore]').forEach(
    b =>
      (b.onclick = async () => {
        delete app.state.lore[b.dataset.dlore];
        await persist();
        renderMemory();
      }),
  );
  $('#addLore').onclick = async () => {
    const k = $('#loreK').value.trim(),
      v = $('#loreV').value.trim();
    if (!k || !v) return;
    app.state.lore[k.slice(0, 30)] = v.slice(0, 300);
    await persist();
    renderMemory();
  };
  box.querySelectorAll('[data-dsum]').forEach(
    b =>
      (b.onclick = async () => {
        app.state.summaries.splice(+b.dataset.dsum, 1);
        await persist();
        renderMemory();
      }),
  );
  box.querySelectorAll('[data-dcorr]').forEach(
    b =>
      (b.onclick = async () => {
        const live = app.state.corrections.filter(c => c.until >= app.state.next);
        live.splice(+b.dataset.dcorr, 1);
        app.state.corrections = live;
        await persist();
        renderMemory();
      }),
  );
  box.querySelectorAll('[data-cast]').forEach(
    el =>
      (el.onchange = async () => {
        app.state.cast[el.dataset.cast] = el.value;
        await persist();
        toast(T('Casting changed'));
      }),
  );
  box.querySelectorAll('[data-uncast]').forEach(
    b =>
      (b.onclick = async () => {
        delete app.state.cast[b.dataset.uncast];
        await persist();
        renderMemory();
      }),
  );
}
