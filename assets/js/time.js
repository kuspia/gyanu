export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const IST_LABEL = '+05:30';

const pad = (n, w = 2) => String(n).padStart(w, '0');

// India has never observed DST, so a fixed offset is exact rather than an approximation.
export function istParts(when = new Date()) {
  const shifted = new Date(when.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay()
  };
}

export function istDateKey(when = new Date()) {
  const { year, month, day } = istParts(when);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function istClock(when = new Date()) {
  const { hours, minutes, seconds } = istParts(when);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function istTimestamp(when = new Date()) {
  const { year, month, day, hours, minutes, seconds } = istParts(when);
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}${IST_LABEL}`;
}

export function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return utc;
}

export function isValidDateKey(key) {
  return parseDateKey(key) !== null;
}

export function shiftDateKey(key, days) {
  const utc = parseDateKey(key);
  if (!utc) return null;
  utc.setUTCDate(utc.getUTCDate() + days);
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function daysBetween(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// The only date the tracker ever accepts a write for.
export function submittableDateKey(when = new Date()) {
  return shiftDateKey(istDateKey(when), -1);
}

// The newest date the calendar is allowed to reveal. Today is deliberately hidden:
// today's log does not exist yet and will not exist until tomorrow.
export function latestViewableDateKey(when = new Date()) {
  return shiftDateKey(istDateKey(when), -1);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const MONTH_NAMES = MONTHS;
export const WEEKDAY_SHORT = WEEKDAYS.map((d) => d.slice(0, 3));

export function formatDateKey(key, { withWeekday = true } = {}) {
  const utc = parseDateKey(key);
  if (!utc) return key ?? '';
  const day = utc.getUTCDate();
  const month = MONTHS[utc.getUTCMonth()];
  const year = utc.getUTCFullYear();
  const weekday = WEEKDAYS[utc.getUTCDay()];
  return withWeekday ? `${weekday}, ${day} ${month} ${year}` : `${day} ${month} ${year}`;
}

export function formatWakeTime(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!match) return hhmm ?? '';
  let hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours < 12 ? 'AM' : 'PM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function minutesFromMidnight(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToClock(total) {
  if (total === null || !Number.isFinite(total)) return '--:--';
  const rounded = Math.round(total);
  return `${pad(Math.floor(rounded / 60) % 24)}:${pad(rounded % 60)}`;
}
