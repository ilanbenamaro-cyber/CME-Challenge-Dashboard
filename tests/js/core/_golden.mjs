// Shared loader for hand-computed golden vectors (tests/golden) and static contract specs.
import { readFileSync } from 'node:fs';

/**
 * @param {string} name file name inside tests/golden, e.g. "pnl.json"
 * @returns {any}
 */
export function golden(name) {
  return JSON.parse(readFileSync(new URL(`../../golden/${name}`, import.meta.url), 'utf8'));
}

/** @returns {import('../../../docs/js/core/types.mjs').ContractsFile} */
export function contractsFile() {
  return JSON.parse(readFileSync(new URL('../../../docs/data/contracts.json', import.meta.url), 'utf8'));
}

/**
 * @param {string} root
 * @returns {import('../../../docs/js/core/types.mjs').ContractSpec}
 */
export function specFor(root) {
  const spec = contractsFile().contracts.find((c) => c.root === root);
  if (!spec) throw new Error(`fixture: no spec for ${root}`);
  return spec;
}

/**
 * Rules fixture from sizer.json with optional whole-entry overrides.
 * @param {Record<string, unknown>} [overrides]
 * @returns {import('../../../docs/js/core/types.mjs').RuleSet}
 */
export function rulesFixture(overrides) {
  return { ...golden('sizer.json').rules_fixture, ...(overrides ?? {}) };
}
