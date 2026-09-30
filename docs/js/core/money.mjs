// WP-CORE. Signatures frozen at G1; bodies are stubs until WP-CORE lands.
/** @typedef {import('./types.mjs').ContractSpec} ContractSpec */
/** @typedef {import('./types.mjs').Trade} Trade */
/** @typedef {import('./types.mjs').PnlCents} PnlCents */

/**
 * Convert a price to an integer tick count. Throws RangeError if the price is not a finite
 * number or is not on the tick grid (tolerance 1e-6 ticks).
 * @param {number} price
 * @param {number} tickSize
 * @returns {number}
 */
export function priceToTicks(price, tickSize) { throw new Error('not implemented'); }

/**
 * USD per tick as integer cents (Math.round(tick_value_usd * 100)).
 * @param {ContractSpec} spec
 * @returns {number}
 */
export function tickValueCents(spec) { throw new Error('not implemented'); }

/**
 * USD amount to integer cents. Throws RangeError for non-finite input.
 * @param {number} usd
 * @returns {number}
 */
export function usdToCents(usd) { throw new Error('not implemented'); }

/**
 * P&L of a closed trade (or of an open trade marked at `markPrice`).
 * gross = (exitTicks - entryTicks) * tickValueCents * qty, negated for short.
 * Throws RangeError on off-tick prices, qty not a positive integer, negative fees, or
 * spec.root !== trade.root. If trade.exit is null, `markPrice` is required (throws otherwise).
 * @param {Trade} trade
 * @param {ContractSpec} spec
 * @param {number} [markPrice]
 * @returns {PnlCents}
 */
export function tradePnlCents(trade, spec, markPrice) { throw new Error('not implemented'); }
