import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpec, barsRootFor, standardEquivalent } from '../../../docs/js/core/contracts.mjs';
import { golden, contractsFile } from './_golden.mjs';

const G = golden('contracts.json');
const FILE = contractsFile();

for (const [root, expect] of G.barsRootFor) {
  test(`barsRootFor golden ${root} -> ${expect}`, () => {
    assert.equal(barsRootFor(root, FILE), expect);
  });
}

G.standardEquivalent.forEach((c, i) => {
  test(`standardEquivalent golden #${i + 1} (ratio ${c.ratio}) -> ${c.expect}`, () => {
    assert.equal(standardEquivalent(c.positions, FILE, c.ratio), c.expect);
  });
});

test('resolveSpec / barsRootFor with no contracts file are unknown', () => {
  assert.equal(resolveSpec('ES', null), null);
  assert.equal(barsRootFor('ES', null), null);
  assert.equal(standardEquivalent([{ root: 'ES', qty: 1 }], null, 10), null);
  assert.equal(resolveSpec('ES', FILE)?.tick_size, 0.25);
});
