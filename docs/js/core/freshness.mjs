/** @typedef {import('./types.mjs').Freshness} Freshness */
/** @typedef {import('./types.mjs').FreshPolicy} FreshPolicy */

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
 * @param {import('./types.mjs').Envelope<unknown>|null|undefined} env
 * @param {number} nowMs
 * @param {FreshPolicy} policy
 * @returns {Freshness}
 */
export function classifyFreshness(env, nowMs, policy) { throw new Error('not implemented'); }
