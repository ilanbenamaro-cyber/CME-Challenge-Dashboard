/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */
/** @typedef {import('./types.mjs').ExpirationEntry} ExpirationEntry */
/** @typedef {import('./types.mjs').Banner} Banner */

/** CME month codes, index 0 = January. */
export const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * Third Friday of a month, "YYYY-MM-DD". month is 1..12.
 * @param {number} year
 * @param {number} month
 * @returns {string}
 */
export function thirdFriday(year, month) { throw new Error('not implemented'); }

/**
 * Next expiration on or after `today` for `root`.
 * Calendar entries for the root take precedence (earliest entry with date >= today).
 * Otherwise, for expiry_rule 'quarterly_third_friday', compute the third Friday of the next listed
 * month (spec.months) with date >= today; source "computed: third Friday (holiday-unadjusted)".
 * contract_code = root + month code + 2-digit year, e.g. "ESZ26".
 * Returns null if the root is unknown or the rule is 'manual' with no calendar entry.
 * @param {string} root
 * @param {string} today "YYYY-MM-DD" (CT)
 * @param {ContractsFile|null} contracts
 * @param {ExpirationEntry[]} calendarExpirations
 * @returns {ExpirationEntry|null}
 */
export function nextExpiration(root, today, contracts, calendarExpirations) { throw new Error('not implemented'); }

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
export function expiryBanner(root, exp, today, warnDays) { throw new Error('not implemented'); }
