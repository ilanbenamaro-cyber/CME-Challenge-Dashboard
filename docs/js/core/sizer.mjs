/** @typedef {import('./types.mjs').SizerInput} SizerInput */
/** @typedef {import('./types.mjs').SizerResult} SizerResult */

/**
 * Contracts that fit all of:
 *  - risk:   floor(risk_budget_cents / per_contract_risk_cents)
 *  - margin: floor(available_margin_cents / (margin_per_contract_cents * hold multiplier)), computed in cents
 *  - max_contracts: rules.max_contracts, converted for micros: floor(max_contracts * micro_to_standard_ratio)
 * status 'unknown' (contracts null) if any needed input or rule is null/unknown;
 * 'zero' if all known and the minimum is 0; else 'ok'.
 * Throws RangeError for stop_ticks not a positive integer, negative risk budget or fee.
 * @param {SizerInput} input
 * @returns {SizerResult}
 */
export function sizePosition(input) { throw new Error('not implemented'); }
