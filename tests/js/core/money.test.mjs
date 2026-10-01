import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceToTicks, tickValueCents, usdToCents, tradePnlCents } from '../../../docs/js/core/money.mjs';
import { golden, specFor } from './_golden.mjs';

const G = golden('pnl.json');

for (const c of G.cases) {
  test(`tradePnlCents golden ${c.id}: ${c.calc}`, () => {
    const got = tradePnlCents(c.trade, specFor(c.trade.root), c.mark);
    assert.deepStrictEqual(got, c.expect);
  });
}

for (const e of G.errors) {
  test(`tradePnlCents error ${e.id}: ${e.why}`, () => {
    const spec = specFor(e.spec_root ?? e.trade.root);
    assert.throws(() => tradePnlCents(e.trade, spec), RangeError);
  });
}

test('P&L gross is antisymmetric between long and short (property)', () => {
  for (const c of G.cases) {
    const flipped = { ...c.trade, side: c.trade.side === 'long' ? 'short' : 'long' };
    const a = tradePnlCents(c.trade, specFor(c.trade.root), c.mark);
    const b = tradePnlCents(flipped, specFor(c.trade.root), c.mark);
    assert.equal(a.gross_cents + b.gross_cents, 0, c.id);
    assert.ok(!Object.is(a.gross_cents, -0) && !Object.is(b.gross_cents, -0), `${c.id}: no -0`);
    assert.equal(a.fees_cents, b.fees_cents, c.id);
  }
});

test('priceToTicks rounds float noise onto the grid (gotcha: 78.43/0.01)', () => {
  assert.equal(priceToTicks(78.43, 0.01), 7843);
  assert.equal(priceToTicks(70.05, 0.01), 7005);
  assert.equal(priceToTicks(1950.3, 0.1), 19503);
});

test('priceToTicks rejects off-grid and non-finite prices', () => {
  assert.throws(() => priceToTicks(4500.1, 0.25), RangeError);
  assert.throws(() => priceToTicks(Number.NaN, 0.25), RangeError);
  assert.throws(() => priceToTicks(Infinity, 0.25), RangeError);
  assert.throws(() => priceToTicks(4500, 0), RangeError);
});

test('tickValueCents and usdToCents', () => {
  assert.equal(tickValueCents(specFor('ES')), 1250);
  assert.equal(tickValueCents(specFor('MNQ')), 50);
  assert.equal(usdToCents(-9.31), -931);
  assert.equal(usdToCents(97.52), 9752);
  assert.equal(usdToCents(2.22), 222);
  assert.ok(Object.is(usdToCents(-0), 0));
  assert.throws(() => usdToCents(Number.NaN), RangeError);
  assert.throws(() => usdToCents(Infinity), RangeError);
});
