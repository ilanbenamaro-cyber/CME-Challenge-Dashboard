/** @typedef {import('./types.mjs').SizerInput} SizerInput */
/** @typedef {import('./types.mjs').SizerResult} SizerResult */

import { tickValueCents, usdToCents } from './money.mjs';
import { ruleValue } from './rules.mjs';

/** @param {unknown} x @returns {x is number} */
function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Contracts that fit all of:
 *  - risk:   floor(risk_budget_cents / per_contract_risk_cents)
 *  - margin: floor(available_margin_cents / (margin_per_contract_cents * hold multiplier)), computed in cents
 *  - max_contracts: rules.max_contracts, converted for micros: floor(max_contracts * micro_to_standard_ratio)
 * status 'unknown' (contracts null) if any needed input or rule is null/unknown;
 * 'zero' if all known and the minimum is 0; else 'ok'.
 * Throws RangeError for stop_ticks not a positive integer, negative risk budget or fee.
 *
 * Implementation notes: the held margin per contract (margin cents * multiplier) is rounded to whole
 * cents; a held margin <= 0 is treated as unknown (it would make the margin limit unbounded).
 * A negative available margin gives a margin limit of 0.
 * @param {SizerInput} input
 * @returns {SizerResult}
 */
export function sizePosition(input) {
  const { spec, hold, rules } = input;
  if (!Number.isInteger(input.stop_ticks) || input.stop_ticks <= 0) {
    throw new RangeError(`stop_ticks must be a positive integer: ${String(input.stop_ticks)}`);
  }
  if (!isNum(input.risk_budget_usd) || input.risk_budget_usd < 0) {
    throw new RangeError(`risk budget must be a finite number >= 0: ${String(input.risk_budget_usd)}`);
  }
  if (!isNum(input.fee_per_contract_usd) || input.fee_per_contract_usd < 0) {
    throw new RangeError(`fee per contract must be a finite number >= 0: ${String(input.fee_per_contract_usd)}`);
  }

  /** @type {string[]} */
  const reasons = [];

  // Risk limit: always computable once inputs validate.
  const perContractRisk = input.stop_ticks * tickValueCents(spec) + usdToCents(input.fee_per_contract_usd);
  const riskLimit = Math.floor(usdToCents(input.risk_budget_usd) / perContractRisk);

  // Margin limit.
  /** @type {number|null} */
  let marginLimit = null;
  const mult = ruleValue(rules, 'hold_margin_multipliers');
  /** @type {number|null} */
  let holdMult = null;
  if (!mult.known) {
    reasons.push(`hold margin multipliers: ${mult.reason}`);
  } else {
    const v = /** @type {Record<string, unknown>} */ (mult.value)[hold];
    if (isNum(v)) holdMult = v;
    else reasons.push(`${hold} hold margin multiplier unknown`);
  }
  if (!isNum(input.available_margin_usd)) reasons.push('available margin unknown');
  if (!isNum(input.margin_per_contract_usd)) reasons.push('margin per contract unknown');
  if (holdMult !== null && isNum(input.available_margin_usd) && isNum(input.margin_per_contract_usd)) {
    const held = Math.round(usdToCents(input.margin_per_contract_usd) * holdMult);
    if (held <= 0) {
      reasons.push(`held margin per contract is not positive (${held} cents)`);
    } else {
      marginLimit = Math.max(0, Math.floor(usdToCents(input.available_margin_usd) / held));
    }
  }

  // Max-contracts limit (converted for micros).
  /** @type {number|null} */
  let maxLimit = null;
  const max = ruleValue(rules, 'max_contracts');
  if (!max.known) {
    reasons.push(`max contracts: ${max.reason}`);
  } else if (spec.parent === null) {
    maxLimit = Math.floor(max.value);
  } else {
    const ratio = ruleValue(rules, 'micro_to_standard_ratio');
    if (!ratio.known) reasons.push(`micro to standard ratio: ${ratio.reason}`);
    else maxLimit = Math.floor(max.value * ratio.value);
  }

  const limits = { risk: riskLimit, margin: marginLimit, max_contracts: maxLimit };

  if (marginLimit === null || maxLimit === null) {
    return { status: 'unknown', contracts: null, binding: null, per_contract_risk_cents: perContractRisk, limits, reasons };
  }

  // Ties resolve risk > margin > max_contracts.
  /** @type {['risk'|'margin'|'max_contracts', number][]} */
  const ordered = [['risk', riskLimit], ['margin', marginLimit], ['max_contracts', maxLimit]];
  let [binding, contracts] = ordered[0] ?? ['risk', riskLimit];
  for (const [name, value] of ordered) {
    if (value < contracts) {
      binding = name;
      contracts = value;
    }
  }
  if (contracts <= 0) {
    return {
      status: 'zero',
      contracts: 0,
      binding,
      per_contract_risk_cents: perContractRisk,
      limits,
      reasons: [`no contract fits: ${binding} limit is 0`],
    };
  }
  return { status: 'ok', contracts, binding, per_contract_risk_cents: perContractRisk, limits, reasons: [] };
}
