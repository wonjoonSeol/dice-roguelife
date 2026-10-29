/* ============ calendar: in-game dates and clock times ============ */
// The weekday is computed, never written by the narrator: only for plain calendar dates, never for a world's own
// calendar ("제국력 1203년"). Each language's date and time patterns are in reply/<lang>.js.
import { locale, tIn } from './i18n.js';
import { normName } from './util.js';
import { any, profiles } from './reply-words.js';

// the first date in s by profile p (at its start when anchored): { y, m, d, text }, or null
function dateBy(p, s, anchored) {
  for (const { re, months } of p.date) {
    const m = re.exec(s);
    if (!m || (anchored && m.index !== 0)) continue;
    const g = m.groups;
    const mo = g.mon ? months.indexOf(g.mon.slice(0, 3).toLowerCase()) + 1 : +g.m;
    return { y: +g.y, m: mo, d: +g.d, text: m[0] };
  }
  return null;
}
const utcDate = (y, mo, d) => {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
};
const isoOf = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const FMT = {}; // Intl formatters by kind and language: building one costs more than formatting many dates
const formatter = (kind, lang) =>
  (FMT[kind + lang] ||= new Intl.DateTimeFormat(
    locale(lang),
    kind === 'wd'
      ? { weekday: 'short', timeZone: 'UTC' }
      : { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' },
  ));
const weekday = (dt, lang) => formatter('wd', lang).format(dt);

// a world's own calendar date without the days-since count the screen adds to it ("정월 열사흘 (+2일)"), in half or
// full width
const SINCE = /\s*[(（][+＋][0-9０-９]+[^)）]*[)）]\s*$/;
export const ownDateText = s =>
  String(s || '')
    .replace(SINCE, '')
    .trim();
// the same own-calendar date written a little differently ("정월열사흘", "Day 3. of Frost")
const bareDate = s => normName(s).replace(/[.,、。]/g, '');
export const sameOwnDate = (a, b) => bareDate(a) === bareDate(b);
// the date to show for a clock (a turn's copy or the save's): a real date with its weekday; a world's own calendar with
// the days since the narrator last named it, until it names the next
export function clockDate(ck, lang) {
  if (!ck || !ck.date) return '';
  const n = !ck.anchor && ck.dateDay != null ? ck.day - ck.dateDay : 0;
  return n > 0 ? tIn(lang, '{date} (+{n} {n|day|days})', { date: ck.date, n }) : withWeekday(ck.date);
}
// a clock's shown parts after D+: date, time, weather, place
export const clockParts = (ck, lang) => [clockDate(ck, lang), ck.time, ck.weather, ck.place].filter(Boolean);
export function parseKDate(x) {
  const s = String(x || '');
  for (const p of profiles()) {
    const f = dateBy(p, s.trim(), true); // at the start: "제국력 1203년 3월 5일" is a world's own calendar
    if (f) return utcDate(f.y, f.m, f.d) ? isoOf(f.y, f.m, f.d) : null;
  }
  return null;
}
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
// "2035년 4월 5일 (목)", "April 5, 2035 (Thu)", "2035年4月5日 (木)"
export function fmtKDate(iso, lang = 'ko') {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${formatter('date', lang).format(dt)} (${weekday(dt, lang)})`;
}
// minutes after midnight, or null when the hour is ambiguous
export function clockMin(t) {
  t = String(t || '');
  for (const p of profiles())
    for (const c of p.clock) {
      const m = c.re.exec(t);
      if (!m) continue;
      const g = m.groups,
        h0 = +g.h,
        per = g.period || '';
      if (h0 < 1 || h0 > 12) continue;
      let h = h0 % 12;
      if (c.pm && c.pm.test(per)) h += 12;
      else if (c.day && c.day.test(per) && h0 < 6) h += 12;
      else if (c.night && c.night.test(per) && h0 >= 6 && h0 < 12) h += 12;
      return h * 60 + (g.m != null ? +g.m : g.half ? 30 : 0);
    }
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  if (m) return (+m[1] % 24) * 60 + +m[2];
  if (any('midnight')(t)) return 0;
  if (any('noon')(t)) return 720;
  return null;
}
// the log calls this for every turn on every redraw, with the same few dates: remember the answers
const WD_SEEN = new Map();
export function withWeekday(date) {
  const s = String(date || '');
  if (WD_SEEN.has(s)) return WD_SEEN.get(s);
  const out = addWeekday(s, date);
  if (WD_SEEN.size > 200) WD_SEEN.clear();
  WD_SEEN.set(s, out);
  return out;
}
function addWeekday(s, date) {
  for (const p of profiles()) {
    const bare = s.replace(p.weekday, '').trim();
    const f = dateBy(p, bare, true);
    if (!f) continue;
    const dt = utcDate(f.y, f.m, f.d);
    return dt ? bare.replace(f.text, `${f.text} (${weekday(dt, p.lang)})`) : date || '';
  }
  return date || '';
}
