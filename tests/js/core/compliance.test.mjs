import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLossMeter, drawdownMeter, marginMeter } from '../../../docs/js/core/compliance.mjs';
import { golden, rulesFixture } from './_golden.mjs';

const G = golden('compliance.json');

/**
 * Golden tolerance: used_ratio |a-b| < 1e-9; all *_cents exact.
 * @param {import('../../../docs/js/core/types.mjs').Meter} got
 * @param {any} expect
 */
function assertMeter(got, expect) {
  assert.equal(got.level, expect.level);
  assert.equal(got.used_cents, expect.used_cents);
  assert.equal(got.limit_cents, expect.limit_cents);
  assert.equal(got.remaining_cents, expect.remaining_cents);
  if (expect.used_ratio === null) assert.equal(got.used_ratio, null);
  else assert.ok(got.used_ratio !== null && Math.abs(got.used_ratio - expect.used_ratio) < 1e-9,
    `ratio ${got.used_ratio} vs ${expect.used_ratio}`);
  assert.equal(typeof got.reason, 'string');
  if (expect.level === 'unknown') assert.ok(got.reason.length > 0, 'unknown must explain why');
}

for (const c of G.daily_loss) {
  test(`dailyLossMeter golden ${c.id}: ${c.calc}`, () => {
    assertMeter(dailyLossMeter(c.realized_cents, c.open_cents, rulesFixture(c.rule_overrides)), c.expect);
  });
}

for (const c of G.drawdown) {
  test(`drawdownMeter golden ${c.id}${c.calc ? `: ${c.calc}` : ''}`, () => {
    assertMeter(drawdownMeter(c.balance_cents, c.peak_cents, rulesFixture(c.rule_overrides)), c.expect);
  });
}

for (const c of G.margin) {
  test(`marginMeter golden ${c.id}${c.calc ? `: ${c.calc}` : ''}`, () => {
    assertMeter(marginMeter(c.used_cents, c.available_cents), c.expect);
  });
}

test('meters with no rules loaded are unknown, never ok', () => {
  assert.equal(dailyLossMeter(-100, 0, null).level, 'unknown');
  assert.equal(drawdownMeter(4900000, 5050000, null).level, 'unknown');
  const dd = drawdownMeter(4900000, 5050000, rulesFixture({ max_drawdown_usd: { value: null, source: null } }));
  assert.equal(dd.level, 'unknown');
  assert.equal(dd.limit_cents, null);
});
