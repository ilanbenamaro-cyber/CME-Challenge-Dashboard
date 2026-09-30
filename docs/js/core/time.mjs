/** IANA zone for all CME session logic. */
export const CT_ZONE = 'America/Chicago';

/**
 * Wall-clock parts in America/Chicago. weekday: 0=Sun..6=Sat.
 * @param {number} ms epoch milliseconds
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, weekday: number}}
 */
export function ctParts(ms) { throw new Error('not implemented'); }

/**
 * CT calendar date "YYYY-MM-DD".
 * @param {number} ms
 * @returns {string}
 */
export function ctDate(ms) { throw new Error('not implemented'); }

/**
 * Add n calendar days to "YYYY-MM-DD" (n may be negative).
 * @param {string} date
 * @param {number} n
 * @returns {string}
 */
export function addDays(date, n) { throw new Error('not implemented'); }

/**
 * Weekday (0=Sun..6=Sat) of "YYYY-MM-DD".
 * @param {string} date
 * @returns {number}
 */
export function weekdayOf(date) { throw new Error('not implemented'); }

/**
 * Previous Mon–Fri date strictly before `date` (no holiday calendar).
 * @param {string} date
 * @returns {string}
 */
export function prevWeekday(date) { throw new Error('not implemented'); }

/**
 * Whole calendar days from `from` to `to` (to - from), both "YYYY-MM-DD".
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function daysBetween(from, to) { throw new Error('not implemented'); }

/**
 * CME trade date of an instant: the CT date, rolled to the next weekday when CT hour >= 17.
 * A Saturday/Sunday CT date also rolls forward to Monday.
 * @param {number} ms
 * @returns {string}
 */
export function tradeDate(ms) { throw new Error('not implemented'); }

/**
 * Epoch ms of CT wall-clock time "HH:MM" on CT date "YYYY-MM-DD" (DST-correct).
 * Throws RangeError on malformed input.
 * @param {string} date
 * @param {string} hhmm
 * @returns {number}
 */
export function ctWallToMs(date, hhmm) { throw new Error('not implemented'); }
