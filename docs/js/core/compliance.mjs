/** @typedef {import('./types.mjs').Meter} Meter */
/** @typedef {import('./types.mjs').RuleSet} RuleSet */

import { usdToCents } from './money.mjs';
import { ruleValue } from './rules.mjs';

/** Ratio at which a meter turns amber. Dashboard threshold, not a challenge rule. */
export const WARN_RATIO = 0.8;

/** @param {unknown} x @returns {x is number} */
function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Limit in cents from a USD rule; null (with reason) if unknown or not positive.
 * @param {RuleSet|null} rules
 * @param {'daily_loss_cap_usd'|'max_drawdown_usd'} key
 * @returns {{cents: number|null, reason: string}}
 */
function limitFromRule(rules, key) {
  const r = ruleValue(rules, key);
  if (!r.known) return { cents: null, reason: r.reason };
  const cents = usdToCents(r.value);
  if (cents <= 0) return { cents: null, reason: `rule ${key} must be positive` };
  return { cents, reason: '' };
}

/**
 * Loss-style meter: breach if used >= limit; warn if used >= WARN_RATIO * limit.
 * @param {number|null} used
 * @param {number|null} limit
 * @param {string} unknownReason
 * @param {string} label
 * @returns {Meter}
 */
function lossMeter(used, limit, unknownReason, label) {
  if (used === null || limit === null) {
    return { level: 'unknown', used_ratio: null, used_cents: used, limit_cents: limit, remaining_cents: null, reason: unknownReason };
  }
  const ratio = used / limit;
  const remaining = Math.max(0, limit - used);
  if (used >= limit) {
    return { level: 'breach', used_ratio: ratio, used_cents: used, limit_cents: limit, remaining_cents: remaining, reason: `${label} limit reached` };
  }
  if (used >= WARN_RATIO * limit) {
    return { level: 'warn', used_ratio: ratio, used_cents: used, limit_cents: limit, remaining_cents: remaining, reason: `${label} at or above ${Math.round(WARN_RATIO * 100)}% of limit` };
  }
  return { level: 'ok', used_ratio: ratio, used_cents: used, limit_cents: limit, remaining_cents: remaining, reason: `${label} within limit` };
}

/**
 * Daily loss meter. loss = max(0, -(realized + open)). breach if loss >= cap; warn if
 * loss >= WARN_RATIO * cap; else ok. unknown if the cap rule is unknown or openCents is null.
 * @param {number} realizedCents
 * @param {number|null} openCents  0 when flat; null when open P&L cannot be marked
 * @param {RuleSet|null} rules
 * @returns {Meter}
 */
export function dailyLossMeter(realizedCents, openCents, rules) {
  const cap = limitFromRule(rules, 'daily_loss_cap_usd');
  /** @type {string[]} */
  const why = [];
  /** @type {number|null} */
  let loss = null;
  if (!isNum(realizedCents)) why.push('realized P&L unknown');
  if (!isNum(openCents)) why.push('open P&L cannot be marked');
  if (isNum(realizedCents) && isNum(openCents)) loss = Math.max(0, -(realizedCents + openCents)) + 0;
  if (cap.cents === null) why.push(`daily loss cap unknown: ${cap.reason}`);
  return lossMeter(loss, cap.cents, why.join('; '), 'daily loss');
}

/**
 * Drawdown meter. drawdown = max(0, peak - balance). Same thresholds against max_drawdown_usd.
 * unknown if balance or peak is null or the rule is unknown.
 * @param {number|null} balanceCents
 * @param {number|null} peakCents
 * @param {RuleSet|null} rules
 * @returns {Meter}
 */
export function drawdownMeter(balanceCents, peakCents, rules) {
  const lim = limitFromRule(rules, 'max_drawdown_usd');
  /** @type {string[]} */
  const why = [];
  /** @type {number|null} */
  let dd = null;
  if (!isNum(balanceCents)) why.push('balance unknown');
  if (!isNum(peakCents)) why.push('peak balance unknown');
  if (isNum(balanceCents) && isNum(peakCents)) dd = Math.max(0, peakCents - balanceCents) + 0;
  if (lim.cents === null) why.push(`max drawdown unknown: ${lim.reason}`);
  return lossMeter(dd, lim.cents, why.join('; '), 'drawdown');
}

/**
 * Margin usage meter. breach if used > available; warn if used >= WARN_RATIO * available.
 * unknown if either is null or available <= 0.
 * @param {number|null} usedCents
 * @param {number|null} availableCents
 * @returns {Meter}
 */
export function marginMeter(usedCents, availableCents) {
  const used = isNum(usedCents) ? usedCents : null;
  const avail = isNum(availableCents) ? availableCents : null;
  if (used === null || avail === null || avail <= 0) {
    /** @type {string[]} */
    const why = [];
    if (used === null) why.push('margin in use unknown');
    if (avail === null) why.push('available margin unknown');
    else if (avail <= 0) why.push('available margin is not positive');
    return { level: 'unknown', used_ratio: null, used_cents: used, limit_cents: avail, remaining_cents: null, reason: why.join('; ') };
  }
  const ratio = used / avail;
  const remaining = Math.max(0, avail - used);
  /** @type {Meter['level']} */
  let level = 'ok';
  let reason = 'margin within available';
  if (used > avail) {
    level = 'breach';
    reason = 'margin in use exceeds available';
  } else if (used >= WARN_RATIO * avail) {
    level = 'warn';
    reason = `margin at or above ${Math.round(WARN_RATIO * 100)}% of available`;
  }
  return { level, used_ratio: ratio, used_cents: used, limit_cents: avail, remaining_cents: remaining, reason };
}
