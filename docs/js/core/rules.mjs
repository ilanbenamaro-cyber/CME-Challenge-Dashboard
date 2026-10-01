/** @typedef {import('./types.mjs').RuleSet} RuleSet */

/**
 * Read a rule. Returns {known:true, value} or {known:false, reason}. A missing key, a null value,
 * or (for numbers) a non-finite value are all unknown.
 * @template {keyof RuleSet} K
 * @param {RuleSet|null} rules
 * @param {K} key
 * @returns {{known: true, value: NonNullable<RuleSet[K]['value']>} | {known: false, reason: string}}
 */
export function ruleValue(rules, key) {
  if (rules === null || rules === undefined || typeof rules !== 'object') {
    return { known: false, reason: 'rules not loaded' };
  }
  if (!Object.prototype.hasOwnProperty.call(rules, key)) {
    return { known: false, reason: `rule ${String(key)} missing` };
  }
  /** @type {unknown} */
  const entry = rules[key];
  if (entry === null || entry === undefined || typeof entry !== 'object') {
    return { known: false, reason: `rule ${String(key)} missing` };
  }
  /** @type {unknown} */
  const value = /** @type {{value?: unknown}} */ (entry).value;
  if (value === null || value === undefined) {
    return { known: false, reason: `rule ${String(key)} unknown (value null)` };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { known: false, reason: `rule ${String(key)} is not a finite number` };
  }
  return { known: true, value: /** @type {NonNullable<RuleSet[K]['value']>} */ (value) };
}
