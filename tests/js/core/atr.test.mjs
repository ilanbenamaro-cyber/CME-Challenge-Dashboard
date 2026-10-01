import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atr, lastClose } from '../../../docs/js/core/atr.mjs';
import { golden } from './_golden.mjs';

const G = golden('atr.json');

for (const c of G.cases) {
  test(`atr golden period ${c.period} -> ${c.expect}`, () => {
    const got = atr(G.bars, c.period);
    if (c.expect === null) assert.equal(got, null);
    else {
      assert.equal(typeof got, 'number');
      assert.ok(Math.abs(/** @type {number} */ (got) - c.expect) < 1e-9, `${got} vs ${c.expect}`);
    }
  });
}

test('lastClose golden', () => {
  assert.equal(lastClose(G.bars), G.lastClose);
  assert.equal(lastClose([]), null);
});

test('atr with invalid period is null', () => {
  assert.equal(atr(G.bars, 0), null);
  assert.equal(atr(G.bars, 2.5), null);
  assert.equal(atr([], 1), null);
});
