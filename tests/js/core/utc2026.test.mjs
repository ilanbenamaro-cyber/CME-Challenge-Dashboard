// ADR-008: 2026 University Trading Challenge rule shapes. Expected values from tests/golden/utc2026.json only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLossMeter, minContractsMeter, pctCapCents } from '../../../docs/js/core/compliance.mjs';
import { contractsTradedOn } from '../../../docs/js/core/book.mjs';
import { flattenBanner } from '../../../docs/js/core/flatten.mjs';
import { sizePosition } from '../../../docs/js/core/sizer.mjs';
import { ruleValue } from '../../../docs/js/core/rules.mjs';
import { golden, specFor } from './_golden.mjs';

const G = golden('utc2026.json');
/** @param {Record<string, unknown>} [o] @returns {any} */
const rules = (o) => ({ ...G.rules_fixture, ...(o ?? {}) });

test('applies:false is not applicable, never known and never a value', () => {
  const r = ruleValue(rules(), 'max_drawdown_usd');
  assert.equal(r.known, false);
  assert.equal(!r.known && r.na, true);
  const u = ruleValue(rules({ max_drawdown_usd: { value: null, source: null } }), 'max_drawdown_usd');
  assert.equal(!u.known && u.na, false);
});

test('pctCapCents golden', () => {
  for (const c of G.pctCapCents) {
    const rs = c.pct_override === undefined ? rules() : rules({ daily_loss_cap_pct: { value: c.pct_override, source: 'x' } });
    assert.equal(pctCapCents(rs, c.base), c.expect, JSON.stringify(c));
  }
});

test('dailyLossMeter with percentage cap override golden', () => {
  for (const c of G.dailyLossWithPctCap) {
    const m = dailyLossMeter(c.realized, c.open, rules(), c.cap);
    for (const k of ['level', 'used_cents', 'limit_cents', 'remaining_cents']) assert.equal(/** @type {any} */ (m)[k], c.expect[k], `${c.id} ${k}`);
    if (c.expect.used_ratio === null) assert.equal(m.used_ratio, null);
    else assert.ok(Math.abs(/** @type {number} */ (m.used_ratio) - c.expect.used_ratio) < 1e-9, c.id);
  }
});

test('minContractsMeter golden', () => {
  for (const c of G.minContracts) {
    const m = minContractsMeter(c.traded, rules(c.rule_override));
    assert.deepEqual([m.level, m.required, m.remaining], [c.expect.level, c.expect.required, c.expect.remaining], JSON.stringify(c));
  }
});

test('contractsTradedOn golden (entries and exits by CME trade date)', () => {
  const { trades, expect, bad_time_trade } = G.contractsTradedOn;
  for (const [date, n] of Object.entries(expect)) assert.equal(contractsTradedOn(trades, date), n, date);
  assert.equal(contractsTradedOn([...trades, bad_time_trade], '2026-10-05'), null);
});

test('flattenBanner honours flatten_dates golden', () => {
  for (const c of G.flattenWithDates) {
    const b = flattenBanner(Date.parse(c.now), rules(), c.open);
    assert.deepEqual([b.level, b.value], [c.expect.level, c.expect.value], c.now);
    if (c.message_includes) assert.ok(b.message.includes(c.message_includes), b.message);
  }
});

test('sizer: max_contracts not applicable is not blocking golden', () => {
  for (const c of G.sizer) {
    const out = sizePosition({
      spec: specFor(c.root), risk_budget_usd: c.risk_budget_usd, stop_ticks: c.stop_ticks,
      fee_per_contract_usd: c.fee_per_contract_usd, available_margin_usd: c.available_margin_usd,
      margin_per_contract_usd: c.margin_per_contract_usd, hold: c.hold, rules: rules(),
    });
    assert.deepEqual(
      { status: out.status, contracts: out.contracts, binding: out.binding, per_contract_risk_cents: out.per_contract_risk_cents, limits: out.limits },
      c.expect, c.id,
    );
  }
});
