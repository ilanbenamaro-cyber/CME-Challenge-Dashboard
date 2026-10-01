/** @typedef {import('./types.mjs').Freshness} Freshness */
/** @typedef {import('./types.mjs').FreshPolicy} FreshPolicy */

import { addDays, ctDate, ctParts, ctWallToMs, parseInstant, prevWeekday } from './time.mjs';

/** Future data_as_of beyond this skew is 'invalid'. */
export const MAX_CLOCK_SKEW_MIN = 5;

/**
 * Default policy per dataset.
 * @type {Record<import('./types.mjs').DatasetName, FreshPolicy>}
 */
export const POLICIES = {
  bars: { kind: 'intraday', max_age_min: 180 },
  settlements: { kind: 'daily' },
  margins: { kind: 'daily' },
  challenge: { kind: 'daily' },
  calendar: { kind: 'intraday', max_age_min: 20160 }, // human-curated; flag after 14 days untouched
};

/**
 * If `nowMs` is inside the CME weekend close (Fri 16:00 CT .. Sun 17:00 CT), the epoch ms of
 * Fri 15:00 CT of that weekend; otherwise null.
 * @param {number} nowMs
 * @returns {number|null}
 */
function weekendCloseCutoff(nowMs) {
  const p = ctParts(nowMs);
  const today = ctDate(nowMs);
  /** @type {number|null} */
  let back = null;
  if (p.weekday === 5 && p.hour >= 16) back = 0;
  else if (p.weekday === 6) back = 1;
  else if (p.weekday === 0 && p.hour < 17) back = 2;
  if (back === null) return null;
  return ctWallToMs(addDays(today, -back), '15:00');
}

/**
 * Classify an envelope. Evaluation order:
 *  1. env null/undefined                                  -> missing
 *  2. schema_version !== 1, data_as_of unparsable, or data_as_of > now + MAX_CLOCK_SKEW_MIN -> invalid
 *     (data_as_of === null with status 'error'            -> error, age_min null)
 *  3. status 'error'                                       -> error  (age_min still reported)
 *  4. age check per policy fails                           -> stale
 *  5. status 'partial'                                     -> partial
 *  6. otherwise                                            -> fresh
 * daily policy: fresh iff ctDate(data_as_of) >= prevWeekday(ctDate(now)).
 * intraday policy: fresh iff age_min <= max_age_min, OR now is inside the weekend close
 *   (Fri 16:00 CT .. Sun 17:00 CT) and data_as_of >= Fri 15:00 CT of that weekend.
 * age_min = floor((now - data_as_of) / 60000).
 * data_as_of must carry an explicit offset (see time.parseInstant); an unknown status value is invalid.
 * @param {import('./types.mjs').Envelope<unknown>|null|undefined} env
 * @param {number} nowMs
 * @param {FreshPolicy} policy
 * @returns {Freshness}
 */
export function classifyFreshness(env, nowMs, policy) {
  if (env === null || env === undefined) {
    return { state: 'missing', age_min: null, reason: 'data file missing' };
  }
  if (env.schema_version !== 1) {
    return { state: 'invalid', age_min: null, reason: `unsupported schema_version ${String(env.schema_version)}` };
  }
  const status = env.status;
  if (status !== 'ok' && status !== 'partial' && status !== 'error') {
    return { state: 'invalid', age_min: null, reason: `unknown status ${String(status)}` };
  }
  const errText = Array.isArray(env.errors) && env.errors.length > 0 ? `: ${env.errors.join('; ')}` : '';
  if (env.data_as_of === null && status === 'error') {
    return { state: 'error', age_min: null, reason: `job has never succeeded${errText}` };
  }
  const asOf = parseInstant(env.data_as_of);
  if (asOf === null) {
    return { state: 'invalid', age_min: null, reason: `data_as_of unparsable: ${String(env.data_as_of)}` };
  }
  if (asOf > nowMs + MAX_CLOCK_SKEW_MIN * 60000) {
    return { state: 'invalid', age_min: null, reason: 'data_as_of is in the future' };
  }
  const age = Math.floor((nowMs - asOf) / 60000) + 0;
  if (status === 'error') {
    return { state: 'error', age_min: age, reason: `last run failed${errText}` };
  }
  /** @type {boolean} */
  let fresh;
  if (policy.kind === 'daily') {
    const need = prevWeekday(ctDate(nowMs));
    fresh = ctDate(asOf) >= need;
    if (!fresh) return { state: 'stale', age_min: age, reason: `data is older than ${need} (CT)` };
  } else {
    fresh = age <= policy.max_age_min;
    if (!fresh) {
      const cutoff = weekendCloseCutoff(nowMs);
      fresh = cutoff !== null && asOf >= cutoff;
    }
    if (!fresh) return { state: 'stale', age_min: age, reason: `data is ${age} min old (max ${policy.max_age_min})` };
  }
  if (status === 'partial') {
    return { state: 'partial', age_min: age, reason: `partial data${errText}` };
  }
  return { state: 'fresh', age_min: age, reason: 'fresh' };
}
