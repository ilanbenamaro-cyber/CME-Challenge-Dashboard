/** @typedef {import('./types.mjs').Meter} Meter */
/** @typedef {import('./types.mjs').RuleSet} RuleSet */

/** Ratio at which a meter turns amber. Dashboard threshold, not a challenge rule. */
export const WARN_RATIO = 0.8;

/**
 * Daily loss meter. loss = max(0, -(realized + open)). breach if loss >= cap; warn if
 * loss >= WARN_RATIO * cap; else ok. unknown if the cap rule is unknown or openCents is null.
 * @param {number} realizedCents
 * @param {number|null} openCents  0 when flat; null when open P&L cannot be marked
 * @param {RuleSet|null} rules
 * @returns {Meter}
 */
export function dailyLossMeter(realizedCents, openCents, rules) { throw new Error('not implemented'); }

/**
 * Drawdown meter. drawdown = max(0, peak - balance). Same thresholds against max_drawdown_usd.
 * unknown if balance or peak is null or the rule is unknown.
 * @param {number|null} balanceCents
 * @param {number|null} peakCents
 * @param {RuleSet|null} rules
 * @returns {Meter}
 */
export function drawdownMeter(balanceCents, peakCents, rules) { throw new Error('not implemented'); }

/**
 * Margin usage meter. breach if used > available; warn if used >= WARN_RATIO * available.
 * unknown if either is null or available <= 0.
 * @param {number|null} usedCents
 * @param {number|null} availableCents
 * @returns {Meter}
 */
export function marginMeter(usedCents, availableCents) { throw new Error('not implemented'); }
