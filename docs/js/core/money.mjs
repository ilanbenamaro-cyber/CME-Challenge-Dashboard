// WP-CORE. Signatures frozen at G1.
/** @typedef {import('./types.mjs').ContractSpec} ContractSpec */
/** @typedef {import('./types.mjs').Trade} Trade */
/** @typedef {import('./types.mjs').PnlCents} PnlCents */

/** Allowed distance from the tick grid, in ticks. */
const TICK_TOLERANCE = 1e-6;

/**
 * Convert a price to an integer tick count. Throws RangeError if the price is not a finite
 * number or is not on the tick grid (tolerance 1e-6 ticks).
 * @param {number} price
 * @param {number} tickSize
 * @returns {number}
 */
export function priceToTicks(price, tickSize) {
  if (typeof tickSize !== 'number' || !Number.isFinite(tickSize) || tickSize <= 0) {
    throw new RangeError(`invalid tick size: ${String(tickSize)}`);
  }
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new RangeError(`price is not a finite number: ${String(price)}`);
  }
  const raw = price / tickSize;
  const ticks = Math.round(raw);
  if (Math.abs(raw - ticks) > TICK_TOLERANCE) {
    throw new RangeError(`price ${price} is not on the ${tickSize} tick grid`);
  }
  return ticks + 0; // normalise -0
}

/**
 * USD per tick as integer cents (Math.round(tick_value_usd * 100)).
 * @param {ContractSpec} spec
 * @returns {number}
 */
export function tickValueCents(spec) {
  const v = spec.tick_value_usd;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new RangeError(`invalid tick value for ${spec.root}: ${String(v)}`);
  }
  return Math.round(v * 100);
}

/**
 * USD amount to integer cents. Throws RangeError for non-finite input.
 * Rounds half away from zero after removing binary noise (1.005 -> 101, -9.31 -> -931).
 * @param {number} usd
 * @returns {number}
 */
export function usdToCents(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) {
    throw new RangeError(`USD amount is not a finite number: ${String(usd)}`);
  }
  const scaled = Number((Math.abs(usd) * 100).toFixed(6));
  const cents = Math.round(scaled) * Math.sign(usd);
  return cents + 0; // normalise -0
}

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
export function tradePnlCents(trade, spec, markPrice) {
  if (spec.root !== trade.root) {
    throw new RangeError(`spec root ${spec.root} does not match trade root ${trade.root}`);
  }
  if (!Number.isInteger(trade.qty) || trade.qty <= 0) {
    throw new RangeError(`qty must be a positive integer: ${String(trade.qty)}`);
  }
  if (typeof trade.fees_usd !== 'number' || !Number.isFinite(trade.fees_usd) || trade.fees_usd < 0) {
    throw new RangeError(`fees must be a finite number >= 0: ${String(trade.fees_usd)}`);
  }
  if (trade.side !== 'long' && trade.side !== 'short') {
    throw new RangeError(`side must be long or short: ${String(trade.side)}`);
  }
  /** @type {number} */
  let exitPrice;
  if (trade.exit === null || trade.exit === undefined) {
    if (markPrice === undefined || markPrice === null) {
      throw new RangeError(`trade ${trade.id} is open and no mark price was given`);
    }
    exitPrice = markPrice;
  } else {
    exitPrice = trade.exit;
  }
  const entryTicks = priceToTicks(trade.entry, spec.tick_size);
  const exitTicks = priceToTicks(exitPrice, spec.tick_size);
  const raw = (exitTicks - entryTicks) * tickValueCents(spec) * trade.qty;
  const gross = (trade.side === 'short' ? -raw : raw) + 0;
  const fees = usdToCents(trade.fees_usd);
  return { gross_cents: gross, fees_cents: fees, net_cents: gross - fees };
}
