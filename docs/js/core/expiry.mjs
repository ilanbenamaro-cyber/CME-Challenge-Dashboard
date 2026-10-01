/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */
/** @typedef {import('./types.mjs').ExpirationEntry} ExpirationEntry */
/** @typedef {import('./types.mjs').Banner} Banner */

import { resolveSpec } from './contracts.mjs';
import { daysBetween, fmtDate, parseDate, weekdayOf } from './time.mjs';

/** CME month codes, index 0 = January. */
export const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * Third Friday of a month, "YYYY-MM-DD". month is 1..12.
 * @param {number} year
 * @param {number} month
 * @returns {string}
 */
export function thirdFriday(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`invalid year/month: ${year}-${month}`);
  }
  const firstWeekday = weekdayOf(fmtDate(year, month, 1));
  const firstFriday = 1 + ((5 - firstWeekday + 7) % 7);
  return fmtDate(year, month, firstFriday + 14);
}

/**
 * Next expiration on or after `today` for `root`: the earliest of
 *  - calendar entries for the root with date >= today, and
 *  - for expiry_rule 'quarterly_third_friday', the computed third Friday of the next listed month
 *    (spec.months) with date >= today; source "computed: third Friday (holiday-unadjusted)".
 * A calendar entry overrides the computed date for the same contract_code (whatever its date), but never
 * hides a nearer computed contract (G3 P1-3).
 * contract_code = root + month code + 2-digit year, e.g. "ESZ26".
 * Returns null if the root is unknown or the rule is 'manual' with no calendar entry.
 * @param {string} root
 * @param {string} today "YYYY-MM-DD" (CT)
 * @param {ContractsFile|null} contracts
 * @param {ExpirationEntry[]} calendarExpirations
 * @returns {ExpirationEntry|null}
 */
export function nextExpiration(root, today, contracts, calendarExpirations) {
  const spec = resolveSpec(root, contracts);
  if (!spec) return null;
  const { year } = parseDate(today);

  /** @type {ExpirationEntry|null} */
  let best = null;
  for (const e of Array.isArray(calendarExpirations) ? calendarExpirations : []) {
    if (!e || e.root !== root || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    if (e.date < today) continue;
    if (best === null || e.date < best.date) best = e;
  }
  const overridden = new Set(
    (Array.isArray(calendarExpirations) ? calendarExpirations : [])
      .filter((e) => e && e.root === root)
      .map((e) => e.contract_code),
  );
  const computed = spec.expiry_rule === 'quarterly_third_friday' ? nextComputed(root, spec.months, today, year, overridden) : null;
  if (computed !== null && (best === null || computed.date < best.date)) return computed;
  return best === null ? null : { ...best };
}

/**
 * @param {string} root
 * @param {string} monthCodes
 * @param {string} today
 * @param {number} year
 * @param {Set<string>} overridden
 * @returns {ExpirationEntry|null}
 */
function nextComputed(root, monthCodes, today, year, overridden) {
  const months = [...new Set([...monthCodes].map((ch) => MONTH_CODES.indexOf(ch)).filter((i) => i >= 0))]
    .sort((a, b) => a - b);
  if (months.length === 0) return null;
  for (const y of [year, year + 1]) {
    for (const idx of months) {
      const date = thirdFriday(y, idx + 1);
      const code = `${root}${MONTH_CODES[idx]}${String(y % 100).padStart(2, '0')}`;
      if (date >= today && !overridden.has(code)) {
        return {
          root,
          contract_code: code,
          date,
          source: 'computed: third Friday (holiday-unadjusted)',
        };
      }
    }
  }
  return null;
}

/**
 * Expiry banner for one root. days = daysBetween(today, exp.date).
 * null expiration -> unknown ("<ROOT> expiry UNKNOWN — add it to calendar.json").
 * days <= 0 -> breach; days <= warnDays -> warn; else ok.
 * @param {string} root
 * @param {ExpirationEntry|null} exp
 * @param {string} today
 * @param {number} warnDays
 * @returns {Banner}
 */
export function expiryBanner(root, exp, today, warnDays) {
  if (exp === null || exp === undefined) {
    return { level: 'unknown', message: `${root} expiry UNKNOWN — add it to calendar.json`, value: null };
  }
  const days = daysBetween(today, exp.date);
  const what = `${exp.contract_code} expires ${exp.date}`;
  if (days <= 0) {
    const when = days === 0 ? 'today' : `${-days} day${days === -1 ? '' : 's'} ago`;
    return { level: 'breach', message: `${what} (${when}) — roll or flatten ${root}`, value: days };
  }
  const plural = days === 1 ? '' : 's';
  if (days <= warnDays) {
    return { level: 'warn', message: `${what} — ${days} day${plural} left`, value: days };
  }
  return { level: 'ok', message: `${what} — ${days} day${plural} left`, value: days };
}
