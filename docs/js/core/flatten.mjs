/** @typedef {import('./types.mjs').Banner} Banner */
/** @typedef {import('./types.mjs').RuleSet} RuleSet */

import { ruleValue } from './rules.mjs';
import { ctWallToMs, tradeDate } from './time.mjs';

/** Minutes before flatten time at which the banner turns amber. Dashboard threshold. */
export const FLATTEN_WARN_MIN = 30;

/**
 * Flatten banner. minutes_left = floor((ctWallToMs(tradeDate(now), flatten) - now) / 60000).
 * Anchored to the CME trade date (rolls at 17:00 CT, weekend -> Monday), not the calendar date, so the
 * banner does not flip at midnight and an evening-session position counts toward the next day's flatten (G3 P1-2).
 * unknown if flatten_time_ct is unknown (value null).
 * With open positions: minutes_left <= 0 -> breach; <= FLATTEN_WARN_MIN -> warn; else ok.
 * Without open positions: ok (message still states the flatten time).
 * A malformed flatten_time_ct (not "HH:MM") is also reported as unknown rather than thrown.
 * @param {number} nowMs
 * @param {RuleSet|null} rules
 * @param {boolean} hasOpenPositions
 * @returns {Banner}
 */
export function flattenBanner(nowMs, rules, hasOpenPositions) {
  const r = ruleValue(rules, 'flatten_time_ct');
  if (!r.known) {
    return { level: 'unknown', message: `Flatten time UNKNOWN (${r.reason})`, value: null };
  }
  const hhmm = r.value;
  /** @type {number} */
  let target;
  try {
    target = ctWallToMs(tradeDate(nowMs), hhmm);
  } catch {
    return { level: 'unknown', message: `Flatten time UNKNOWN (malformed rule value "${String(hhmm)}")`, value: null };
  }
  const minutesLeft = Math.floor((target - nowMs) / 60000) + 0;
  const at = `Flatten by ${hhmm} CT`;
  const rel = minutesLeft > 0 ? `${minutesLeft} min left` : minutesLeft === 0 ? 'now' : `${-minutesLeft} min past`;
  if (!hasOpenPositions) {
    return { level: 'ok', message: `${at} (${rel}; no open positions)`, value: minutesLeft };
  }
  if (minutesLeft <= 0) {
    return { level: 'breach', message: `${at} — flatten time reached with open positions (${rel})`, value: minutesLeft };
  }
  if (minutesLeft <= FLATTEN_WARN_MIN) {
    return { level: 'warn', message: `${at} — ${rel} with open positions`, value: minutesLeft };
  }
  return { level: 'ok', message: `${at} — ${rel}`, value: minutesLeft };
}
