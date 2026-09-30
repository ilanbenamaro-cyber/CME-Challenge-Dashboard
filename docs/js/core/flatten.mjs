/** @typedef {import('./types.mjs').Banner} Banner */
/** @typedef {import('./types.mjs').RuleSet} RuleSet */

/** Minutes before flatten time at which the banner turns amber. Dashboard threshold. */
export const FLATTEN_WARN_MIN = 30;

/**
 * Flatten banner. minutes_left = floor((ctWallToMs(ctDate(now), flatten) - now) / 60000).
 * unknown if flatten_time_ct is unknown (value null).
 * With open positions: minutes_left <= 0 -> breach; <= FLATTEN_WARN_MIN -> warn; else ok.
 * Without open positions: ok (message still states the flatten time).
 * @param {number} nowMs
 * @param {RuleSet|null} rules
 * @param {boolean} hasOpenPositions
 * @returns {Banner}
 */
export function flattenBanner(nowMs, rules, hasOpenPositions) { throw new Error('not implemented'); }
