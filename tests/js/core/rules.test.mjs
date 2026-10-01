import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleValue } from '../../../docs/js/core/rules.mjs';
import { golden, rulesFixture } from './_golden.mjs';

const FIX = golden('sizer.json').rules_fixture;

test('ruleValue returns known values from the golden rules fixture', () => {
  const rules = rulesFixture();
  assert.deepStrictEqual(ruleValue(rules, 'max_contracts'), { known: true, value: FIX.max_contracts.value });
  assert.deepStrictEqual(ruleValue(rules, 'flatten_time_ct'), { known: true, value: FIX.flatten_time_ct.value });
  assert.deepStrictEqual(ruleValue(rules, 'hold_margin_multipliers'),
    { known: true, value: FIX.hold_margin_multipliers.value });
});

test('ruleValue: null value, missing key, null rules, non-finite number are unknown', () => {
  const nullValue = rulesFixture({ max_contracts: { value: null, source: null } });
  assert.equal(ruleValue(nullValue, 'max_contracts').known, false);
  const missing = /** @type {any} */ ({ ...rulesFixture() });
  delete missing.daily_loss_cap_usd;
  assert.equal(ruleValue(missing, 'daily_loss_cap_usd').known, false);
  assert.equal(ruleValue(null, 'max_contracts').known, false);
  const nan = rulesFixture({ max_drawdown_usd: { value: Number.NaN, source: 'x' } });
  assert.equal(ruleValue(nan, 'max_drawdown_usd').known, false);
  const r = ruleValue(null, 'max_contracts');
  assert.ok(!r.known && r.reason.length > 0);
});

test('ruleValue: zero is a known value, not unknown', () => {
  const zero = rulesFixture({ max_contracts: { value: 0, source: 'x' } });
  assert.deepStrictEqual(ruleValue(zero, 'max_contracts'), { known: true, value: 0 });
});
