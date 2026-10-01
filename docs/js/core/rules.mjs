/** @typedef {import('./types.mjs').RuleSet} RuleSet */

/**
 * Read a rule. Returns {known:true, value} or {known:false, reason, na}. A missing key, a null value,
 * or (for numbers) a non-finite value are all unknown (na false). A rule with `applies: false` is not a rule in
 * this challenge: known false, na true (ADR-008). Callers decide what "not applicable" means; it is never 0.
 * @template {keyof RuleSet} K
 * @param {RuleSet|null} rules
 * @param {K} key
 * @returns {{known: true, value: NonNullable<NonNullable<RuleSet[K]>['value']>} | {known: false, reason: string, na: boolean}}
 */
export function ruleValue(rules, key) {
  if (rules === null || rules === undefined || typeof rules !== 'object') {
    return { known: false, reason: 'rules not loaded', na: false };
  }
  if (!Object.prototype.hasOwnProperty.call(rules, key)) {
    return { known: false, reason: `rule ${String(key)} missing`, na: false };
  }
  /** @type {unknown} */
  const entry = rules[key];
  if (entry === null || entry === undefined || typeof entry !== 'object') {
    return { known: false, reason: `rule ${String(key)} missing`, na: false };
  }
  if (/** @type {{applies?: unknown}} */ (entry).applies === false) {
    return { known: false, reason: `${String(key)} is not a rule in this challenge`, na: true };
  }
  /** @type {unknown} */
  const value = /** @type {{value?: unknown}} */ (entry).value;
  if (value === null || value === undefined) {
    return { known: false, reason: `rule ${String(key)} unknown (value null)`, na: false };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { known: false, reason: `rule ${String(key)} is not a finite number`, na: false };
  }
  return { known: true, value: /** @type {NonNullable<NonNullable<RuleSet[K]>['value']>} */ (value) };
}
