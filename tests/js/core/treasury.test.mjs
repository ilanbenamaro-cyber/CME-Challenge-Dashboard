// ADR-009: sub-cent tick values (Treasuries) stay exact. Expected values from tests/golden/treasury.json only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradePnlCents, tickValueMicros, microsToCents } from '../../../docs/js/core/money.mjs';
import { sizePosition } from '../../../docs/js/core/sizer.mjs';
import { golden, specFor } from './_golden.mjs';

const G = golden('treasury.json');

test('treasury / energy P&L golden (exact sub-cent ticks, one rounding per trade)', () => {
  for (const c of G.pnl) assert.deepEqual(tradePnlCents(c.trade, specFor(c.trade.root)), c.expect, c.id);
});

test('off-grid treasury price is rejected', () => {
  for (const c of G.errors) assert.throws(() => tradePnlCents(c.trade, specFor(c.trade.root)), RangeError, c.id);
});

test('ZT sizer uses a conservative (ceil) stop risk', () => {
  const rules = golden('utc2026.json').rules_fixture;
  for (const c of G.sizer) {
    const out = sizePosition({ spec: specFor(c.root), risk_budget_usd: c.risk_budget_usd, stop_ticks: c.stop_ticks,
      fee_per_contract_usd: c.fee_per_contract_usd, available_margin_usd: c.available_margin_usd,
      margin_per_contract_usd: c.margin_per_contract_usd, hold: c.hold, rules });
    assert.deepEqual({ status: out.status, contracts: out.contracts, binding: out.binding,
      per_contract_risk_cents: out.per_contract_risk_cents, limits: out.limits }, c.expect, c.id);
  }
});

test('tick values: micros exact, unrepresentable rejected; microsToCents rounds half away from zero', () => {
  assert.equal(tickValueMicros(specFor('ZT')), 78125);
  assert.equal(tickValueMicros(specFor('ZN')), 156250);
  assert.throws(() => tickValueMicros(/** @type {any} */ ({ root: 'X', tick_value_usd: 0.123456 })), RangeError);
  assert.deepEqual([156250, -156250, 78125, -78125, 49, -49, 50, -50].map(microsToCents), [1563, -1563, 781, -781, 0, 0, 1, -1]);
});
