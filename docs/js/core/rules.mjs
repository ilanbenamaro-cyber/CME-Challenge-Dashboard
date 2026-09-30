/** @typedef {import('./types.mjs').RuleSet} RuleSet */

/**
 * Read a rule. Returns {known:true, value} or {known:false, reason}. A missing key, a null value,
 * or (for numbers) a non-finite value are all unknown.
 * @template {keyof RuleSet} K
 * @param {RuleSet|null} rules
 * @param {K} key
 * @returns {{known: true, value: NonNullable<RuleSet[K]['value']>} | {known: false, reason: string}}
 */
export function ruleValue(rules, key) { throw new Error('not implemented'); }
