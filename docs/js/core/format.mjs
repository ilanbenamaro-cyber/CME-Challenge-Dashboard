/** Text shown for any unknown value. Never "0", never "$0.00". */
export const UNKNOWN_TEXT = 'UNKNOWN';

/**
 * "$1,041.00", "-$73.50"; null -> UNKNOWN_TEXT.
 * @param {number|null} cents
 * @returns {string}
 */
export function fmtUsd(cents) { throw new Error('not implemented'); }

/**
 * Fixed decimals matching tick size (0.25 -> 2, 0.1 -> 1, 0.01 -> 2, 1 -> 0); null -> UNKNOWN_TEXT.
 * @param {number|null} price
 * @param {number} tickSize
 * @returns {string}
 */
export function fmtPrice(price, tickSize) { throw new Error('not implemented'); }

/**
 * Ratio as whole percent "80%"; null -> UNKNOWN_TEXT.
 * @param {number|null} ratio
 * @returns {string}
 */
export function fmtPct(ratio) { throw new Error('not implemented'); }
