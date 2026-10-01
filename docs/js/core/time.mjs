/** IANA zone for all CME session logic. */
export const CT_ZONE = 'America/Chicago';

const DAY_MS = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** @type {Intl.DateTimeFormat|null} */
let ctFormatter = null;

/** @returns {Intl.DateTimeFormat} */
function formatter() {
  if (ctFormatter === null) {
    ctFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: CT_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
  }
  return ctFormatter;
}

/** @param {number} n @returns {string} */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a strict "YYYY-MM-DD" calendar date. Throws RangeError if malformed or not a real date.
 * @param {string} date
 * @returns {{year: number, month: number, day: number}}
 */
export function parseDate(date) {
  const m = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) throw new RangeError(`malformed date: ${String(date)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`not a calendar date: ${date}`);
  }
  return { year, month, day };
}

/**
 * Format year/month/day as "YYYY-MM-DD".
 * @param {number} year
 * @param {number} month 1..12
 * @param {number} day
 * @returns {string}
 */
export function fmtDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** @param {string} date @returns {number} UTC midnight ms of the calendar date */
function dateToUtcMs(date) {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

/** @param {number} ms @returns {string} */
function utcMsToDate(ms) {
  const d = new Date(ms);
  return fmtDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Parse an ISO-8601 instant that carries an explicit offset ("Z" or "+HH:MM"). Strings without an
 * offset are rejected because their meaning would depend on the viewer's local zone.
 * @param {unknown} iso
 * @returns {number|null} epoch ms, or null if unparsable
 */
export function parseInstant(iso) {
  if (typeof iso !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Wall-clock parts in America/Chicago. weekday: 0=Sun..6=Sat.
 * @param {number} ms epoch milliseconds
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, weekday: number}}
 */
export function ctParts(ms) {
  if (!Number.isFinite(ms)) throw new RangeError(`invalid instant: ${ms}`);
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of formatter().formatToParts(new Date(ms))) p[part.type] = part.value;
  const weekday = WEEKDAYS.indexOf(p.weekday ?? '');
  if (weekday < 0) throw new RangeError(`unexpected weekday from Intl: ${p.weekday}`);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday,
  };
}

/**
 * CT calendar date "YYYY-MM-DD".
 * @param {number} ms
 * @returns {string}
 */
export function ctDate(ms) {
  const p = ctParts(ms);
  return fmtDate(p.year, p.month, p.day);
}

/**
 * Add n calendar days to "YYYY-MM-DD" (n may be negative).
 * @param {string} date
 * @param {number} n
 * @returns {string}
 */
export function addDays(date, n) {
  if (!Number.isInteger(n)) throw new RangeError(`day count must be an integer: ${n}`);
  return utcMsToDate(dateToUtcMs(date) + n * DAY_MS);
}

/**
 * Weekday (0=Sun..6=Sat) of "YYYY-MM-DD".
 * @param {string} date
 * @returns {number}
 */
export function weekdayOf(date) {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

/** @param {string} date @returns {boolean} */
function isWeekend(date) {
  const w = weekdayOf(date);
  return w === 0 || w === 6;
}

/**
 * Previous Mon–Fri date strictly before `date` (no holiday calendar).
 * @param {string} date
 * @returns {string}
 */
export function prevWeekday(date) {
  let d = addDays(date, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

/**
 * Whole calendar days from `from` to `to` (to - from), both "YYYY-MM-DD".
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);
}

/**
 * CME trade date of an instant: the CT date, rolled to the next weekday when CT hour >= 17.
 * A Saturday/Sunday CT date also rolls forward to Monday.
 * @param {number} ms
 * @returns {string}
 */
export function tradeDate(ms) {
  const p = ctParts(ms);
  let d = fmtDate(p.year, p.month, p.day);
  if (p.hour >= 17) d = addDays(d, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/**
 * Epoch ms of CT wall-clock time "HH:MM" on CT date "YYYY-MM-DD" (DST-correct).
 * Throws RangeError on malformed input.
 * Ambiguous wall times (fall-back hour) resolve to the earlier instant (CDT). Wall times inside the
 * spring-forward gap do not exist; they resolve with the standard-time offset (-06:00), which lands
 * one hour later on the wall clock (the same choice as Temporal's 'compatible' disambiguation).
 * @param {string} date
 * @param {string} hhmm
 * @returns {number}
 */
export function ctWallToMs(date, hhmm) {
  const { year, month, day } = parseDate(date);
  const m = typeof hhmm === 'string' ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null;
  if (!m) throw new RangeError(`malformed time: ${String(hhmm)}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`time out of range: ${hhmm}`);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  for (const offsetH of [5, 6]) {
    const candidate = naiveUtc + offsetH * 3600000;
    const p = ctParts(candidate);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      return candidate;
    }
  }
  return naiveUtc + 6 * 3600000;
}
