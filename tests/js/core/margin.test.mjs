import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMargin } from '../../../docs/js/core/margin.mjs';
import { golden } from './_golden.mjs';

const G = golden('margin.json');

for (const c of G.cases) {
  test(`resolveMargin golden ${c.id}: ${c.root} ${c.basis} cmeFresh=${c.cmeFresh}`, () => {
    const cme = 'cme_override' in c ? c.cme_override : G.cme;
    const sheet = 'sheet_override' in c ? c.sheet_override : G.sheet;
    const got = resolveMargin(c.root, c.basis, cme, c.cmeFresh, sheet);
    assert.equal(got.value_usd, c.expect.value_usd);
    assert.equal(got.source, c.expect.source);
    assert.equal(typeof got.reason, 'string');
    assert.ok(got.reason.length > 0);
  });
}
