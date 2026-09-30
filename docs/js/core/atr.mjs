/** @typedef {import('./types.mjs').Bar} Bar */

/**
 * Simple-average true range over the last `period` bars (bars sorted ascending by t).
 * TR_i = max(h_i - l_i, |h_i - c_{i-1}|, |l_i - c_{i-1}|); needs period + 1 bars; else null.
 * A period that is not a positive integer, or a non-finite price in the window, also yields null.
 * @param {Bar[]} bars
 * @param {number} period
 * @returns {number|null}
 */
export function atr(bars, period) {
  if (!Number.isInteger(period) || period < 1) return null;
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const span = bars.slice(bars.length - (period + 1));
  let sum = 0;
  for (let i = 1; i < span.length; i += 1) {
    const cur = span[i];
    const prev = span[i - 1];
    if (!cur || !prev) return null;
    const { h, l } = cur;
    const pc = prev.c;
    if (![h, l, pc].every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

/**
 * Last close, or null if no bars.
 * @param {Bar[]} bars
 * @returns {number|null}
 */
export function lastClose(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const last = bars[bars.length - 1];
  const c = last ? last.c : undefined;
  return typeof c === 'number' && Number.isFinite(c) ? c : null;
}
