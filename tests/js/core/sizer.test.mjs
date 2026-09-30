import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizePosition } from '../../../docs/js/core/sizer.mjs';
import { golden, specFor, rulesFixture } from './_golden.mjs';

const G = golden('sizer.json');

/**
 * @param {any} c golden case
 * @returns {import('../../../docs/js/core/types.mjs').SizerInput}
 */
function inputOf(c) {
  return {
    spec: specFor(c.root),
    risk_budget_usd: c.risk_budget_usd,
    stop_ticks: c.stop_ticks,
    fee_per_contract_usd: c.fee_per_contract_usd,
    available_margin_usd: c.available_margin_usd,
    margin_per_contract_usd: c.margin_per_contract_usd,
    hold: c.hold,
    rules: rulesFixture(c.rule_overrides),
  };
}

for (const c of G.cases) {
  test(`sizePosition golden ${c.id}: ${c.calc}`, () => {
    const got = sizePosition(inputOf(c));
    const { reasons, ...rest } = got;
    assert.deepStrictEqual(rest, c.expect);
    if (c.expect.status === 'ok') assert.deepStrictEqual(reasons, []);
    else assert.ok(reasons.length > 0, 'unknown/zero must explain why');
    if (c.expect.status === 'unknown') assert.equal(got.contracts, null);
  });
}

for (const e of G.errors) {
  test(`sizePosition error ${e.id}: ${e.why}`, () => {
    assert.throws(() => sizePosition(inputOf(e)), RangeError);
  });
}

test('sizePosition rejects a negative fee', () => {
  const base = G.cases[0];
  assert.throws(() => sizePosition(inputOf({ ...base, fee_per_contract_usd: -0.01 })), RangeError);
});

test('sizePosition with null rules is unknown, never zero', () => {
  const input = { ...inputOf(G.cases[1]), rules: /** @type {any} */ (null) };
  const got = sizePosition(input);
  assert.equal(got.status, 'unknown');
  assert.equal(got.contracts, null);
});
