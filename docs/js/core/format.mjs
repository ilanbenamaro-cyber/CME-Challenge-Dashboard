/** Text shown for any unknown value. Never "0", never "$0.00". */
export const UNKNOWN_TEXT = 'UNKNOWN';

/** @param {number|null|undefined} x @returns {x is number} */
function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * "$1,041.00", "-$73.50"; null -> UNKNOWN_TEXT. Non-finite numbers are also UNKNOWN_TEXT.
 * @param {number|null} cents
 * @returns {string}
 */
export function fmtUsd(cents) {
  if (!isNum(cents)) return UNKNOWN_TEXT;
  const c = Math.round(cents);
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${c < 0 ? '-' : ''}$${grouped}.${String(rem).padStart(2, '0')}`;
}

/**
 * Decimal places implied by a tick size (0.25 -> 2, 0.1 -> 1, 1 -> 0).
 * @param {number} tickSize
 * @returns {number}
 */
function tickDecimals(tickSize) {
  if (!isNum(tickSize) || tickSize <= 0) return 2;
  for (let d = 0; d <= 10; d += 1) {
    const scaled = tickSize * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
  }
  return 10;
}

/**
 * Fixed decimals matching tick size (0.25 -> 2, 0.1 -> 1, 0.01 -> 2, 1 -> 0); null -> UNKNOWN_TEXT.
 * @param {number|null} price
 * @param {number} tickSize
 * @returns {string}
 */
export function fmtPrice(price, tickSize) {
  if (!isNum(price)) return UNKNOWN_TEXT;
  return price.toFixed(tickDecimals(tickSize));
}

/**
 * Ratio as whole percent "80%"; null -> UNKNOWN_TEXT.
 * @param {number|null} ratio
 * @returns {string}
 */
export function fmtPct(ratio) {
  if (!isNum(ratio)) return UNKNOWN_TEXT;
  const pct = Math.round(ratio * 100) + 0;
  return `${pct}%`;
}
