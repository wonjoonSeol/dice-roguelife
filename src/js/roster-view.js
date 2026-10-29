/* ============ the character list editor: the fate screen and the memory tab ============ */
import { esc } from './util.js';
import { N_, T } from './i18n.js';
import { LIMITS } from './limits.js';
import { namesOf, parseRoster } from './roster.js';
import { charSets } from './images.js';
import { cardIndex, namedSetOf } from './casting.js';

// a paste box, a file to read in, and what the list holds
const ROSTER_HELP = N_(
  'Every detail is key: value. Name: starts a person, and the lines under it are theirs until a blank line; or put a person on one line split by /. A # heading is the affiliation of the people under it. Keys: Name, Aliases, Affiliation, Gender, Position, Power, Looks, Personality, Speech, Signature, Ties, Secret. Any other key is kept too.',
);
export const ROSTER_EXAMPLE = N_(
  "# Mount Hua Sect\nName: Baek Ri-un\nAliases: Ri-un, Plum Sword\nPosition: first disciple\nPower: first-rate\nPersonality: quiet, stubborn\nSpeech: curt\nSecret: the sect leader's hidden son\n\nName: Seol-hwa / Position: third disciple / Speech: 'Hmph.'",
);
const ROSTER_NOTE = {
  unlabeled: N_('Line {line} skipped, a part has no key (key: value): {text}'),
  noName: N_('Line {line} skipped, no person above it (a person starts with Name:): {text}'),
  twoNames: N_('Line {line} skipped, two names on one line: {text}'),
  longName: N_('Line {line} skipped, a name is at most {n} characters: {text}'),
  me: N_('Line {line} skipped, {name} is your character'),
  again: N_('Line {line}: {name} was listed before, this one is kept'),
  other: N_('Line {line}: {label} is not a known key, kept as a detail of {name}'),
  over: N_('Only the first {n} people are kept'),
  cut: N_('Some details of {name} were cut to fit'),
  aliasMe: N_('Line {line}: {alias} is your character, so it is not another name of {name}'),
  nameCut: N_('Line {line}: {text} has no key and is not part of the name, so it is skipped'),
  aliasTaken: N_('Line {line}: {alias} already names someone else in the list, so it is not another name of {name}'),
};
export function rosterEditorHtml(text) {
  return `<p class="muted field-note">${T(ROSTER_HELP)}</p>
   <textarea data-roster rows="7" maxlength="${LIMITS.roster.text}" aria-label="${T('Character list')}" placeholder="${esc(T(ROSTER_EXAMPLE))}" class="roster-text">${esc(text)}</textarea>
   <div class="row roster-row"><label class="btn ghost file-btn">${T('Open a file')}<input type="file" data-roster-file accept=".md,.txt,text/markdown,text/plain" hidden></label><span class="muted count-note" data-roster-count></span></div>
   <div class="roster-preview" data-roster-preview></div>`;
}
// me: the player's name, which the list never holds; onInput gets the text after every change. The preview waits for
// a pause in typing; the count does not
export function bindRosterEditor(root, worldId, me, onInput) {
  const ta = root.querySelector('[data-roster]');
  let wait = 0;
  const preview = () => {
    clearTimeout(wait);
    root.querySelector('[data-roster-preview]').innerHTML = rosterPreviewHtml(ta.value, worldId, me);
  };
  const show = now => {
    root.querySelector('[data-roster-count]').textContent = `${ta.value.length}/${LIMITS.roster.text}`;
    if (onInput) onInput(ta.value);
    if (now) preview();
    else {
      clearTimeout(wait);
      wait = setTimeout(preview, 150);
    }
  };
  ta.oninput = () => show(false);
  root.querySelector('[data-roster-file]').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    ta.value = (await f.text()).slice(0, LIMITS.roster.text);
    e.target.value = ''; // the same file can be read again
    show(true);
  };
  show(true);
}
function rosterPreviewHtml(text, worldId, me) {
  if (!text.trim()) return '';
  const { people, notes } = parseRoster(text, me);
  const ix = cardIndex(charSets(), worldId); // the cards of the world this list is for
  const faces = people.map(e => !!namedSetOf(namesOf(e), { ix, exact: true }));
  const chips = people
    .map(
      (e, i) =>
        `<span class="roster-chip${faces[i] ? ' has-face' : ''}">${faces[i] ? '🖼 ' : ''}${esc(e.name)}${e.faction ? ` <span class="muted">${esc(e.faction)}</span>` : ''}</span>`,
    )
    .join('');
  return `<p class="roster-sum">${T('{n} {n|person|people} read, {m} with a face', { n: people.length, m: faces.filter(Boolean).length })}</p>${chips ? `<div class="roster-people">${chips}</div>` : ''}${notes.length ? `<ul class="roster-notes">${notes.map(x => `<li>${esc(T(ROSTER_NOTE[x.why], x))}</li>`).join('')}</ul>` : ''}`;
}
