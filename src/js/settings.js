/* ============ settings: this player's preferences ============ */
import { dset } from './db.js';
import { app } from './app.js';
import { uiLang } from './i18n.js';

// app.settings holds them (loaded at boot from the 'settings' document). setting(key) reads one with its default
// when it was never set, and saveSettings() writes them: one write at a time, in order, so an older copy never
// lands after a newer one.
export const SETTING_DEFAULTS = {
  tier: 'default', // the narrator's model tier
  len: 'normal', // reply length
  adminPersona: 'star',
  statusMode: 'auto', // when the status window shows numbers
  growth: 'auto', // how generous stat growth is
  questStyle: 'board',
  newsStyle: 'broadcast',
  boardStyle: 'auto',
  chatStyle: 'auto',
  gamblerP: 0.15, // the chance of a jackpot, and of a doom, each turn with the gambler's stone
};
// 'auto' looks like what players of the story's language know
const AUTO_STYLE = {
  boardStyle: { ko: 'dc', en: 'reddit', ja: '5ch' },
  chatStyle: { ko: 'kakao', en: 'whatsapp', ja: 'line' },
};

let writes = Promise.resolve();
let loaded = false; // set once boot has read the stored settings: before that a write would replace them with defaults

export function setting(key) {
  return app.settings[key] || SETTING_DEFAULTS[key];
}
// suggested choices after each turn, in every save and both game modes; on unless turned off
export const choicesOff = () => app.settings.choices === false;
// the narrator's language: the open save's own (kept from the day its first life began), else the one a new game gets
export function storyLang() {
  return (app.state && app.state.lang) || newStoryLang();
}
export const newStoryLang = () => app.settings.lang || uiLang();
export function widgetStyle(key) {
  const v = setting(key);
  return v !== 'auto' ? v : AUTO_STYLE[key][storyLang()] || AUTO_STYLE[key].en;
}
// a Japanese story reads the English prompt and is told to answer in Japanese (prompts.json "lang")
export function promptLang() {
  return storyLang() === 'ko' ? 'ko' : 'en';
}
export function settingsLoaded() {
  loaded = true;
}
export function saveSettings() {
  if (!loaded) return Promise.resolve(); // the start failed before the settings were read: keep the stored ones
  const write = writes.then(() => dset('settings', app.settings));
  writes = write.catch(() => {}); // the queue only orders the writes: whoever awaits `write` gets its error
  return write;
}
