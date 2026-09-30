/** @typedef {import('./types.mjs').Bar} Bar */

/**
 * Simple-average true range over the last `period` bars (bars sorted ascending by t).
 * TR_i = max(h_i - l_i, |h_i - c_{i-1}|, |l_i - c_{i-1}|); needs period + 1 bars; else null.
 * @param {Bar[]} bars
 * @param {number} period
 * @returns {number|null}
 */
export function atr(bars, period) { throw new Error('not implemented'); }

/**
 * Last close, or null if no bars.
 * @param {Bar[]} bars
 * @returns {number|null}
 */
export function lastClose(bars) { throw new Error('not implemented'); }
