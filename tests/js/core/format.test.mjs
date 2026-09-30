import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtUsd, fmtPrice, fmtPct, UNKNOWN_TEXT } from '../../../docs/js/core/format.mjs';
import { golden } from './_golden.mjs';

const G = golden('format.json');

for (const [cents, expect] of G.fmtUsd) {
  test(`fmtUsd golden ${cents} -> ${expect}`, () => assert.equal(fmtUsd(cents), expect));
}
for (const [price, tick, expect] of G.fmtPrice) {
  test(`fmtPrice golden ${price} @ ${tick} -> ${expect}`, () => assert.equal(fmtPrice(price, tick), expect));
}
for (const [ratio, expect] of G.fmtPct) {
  test(`fmtPct golden ${ratio} -> ${expect}`, () => assert.equal(fmtPct(ratio), expect));
}

test('non-finite numbers render UNKNOWN, never a plausible number', () => {
  assert.equal(fmtUsd(Number.NaN), UNKNOWN_TEXT);
  assert.equal(fmtPrice(Infinity, 0.25), UNKNOWN_TEXT);
  assert.equal(fmtPct(Number.NaN), UNKNOWN_TEXT);
  assert.equal(fmtUsd(-0), '$0.00');
});
