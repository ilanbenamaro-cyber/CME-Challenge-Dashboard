/** @typedef {import('./types.mjs').Trade} Trade */
/** @typedef {import('./types.mjs').DailyRow} DailyRow */
/** @typedef {import('./types.mjs').ReconRow} ReconRow */
/** @typedef {import('./types.mjs').ContractsFile} ContractsFile */

/**
 * Net P&L per CME trade date (tradeDate(exit_time)) for closed trades.
 * A trade that cannot be priced (unknown root, off-tick, bad time) contributes an error string to
 * its date and makes that date's total null.
 * @param {Trade[]} trades
 * @param {ContractsFile|null} contracts
 * @returns {Map<string, {net_cents: number|null, errors: string[]}>}
 */
export function dailyNetByTradeDate(trades, contracts) { throw new Error('not implemented'); }

/**
 * Reconciliation rows for the union of dates, sorted descending, at most `limit` rows.
 * @param {Map<string, {net_cents: number|null, errors: string[]}>} computed
 * @param {DailyRow[]} reported
 * @param {number} limit
 * @returns {ReconRow[]}
 */
export function reconcile(computed, reported, limit) { throw new Error('not implemented'); }
