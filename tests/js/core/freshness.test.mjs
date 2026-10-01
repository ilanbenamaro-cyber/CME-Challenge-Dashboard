import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, POLICIES } from '../../../docs/js/core/freshness.mjs';
import { golden } from './_golden.mjs';

const G = golden('freshness.json');

/**
 * Golden note: env fields not listed default to {schema_version:1, dataset:'x',
 * generated_at: data_as_of or now, source:'test', status:'ok', errors:[], data:{}}.
 * @param {any} partial
 * @param {string} now
 */
function envOf(partial, now) {
  if (partial === null) return null;
  return {
    schema_version: 1,
    dataset: 'x',
    generated_at: partial.data_as_of ?? now,
    source: 'test',
    status: 'ok',
    errors: [],
    data: {},
    ...partial,
  };
}

for (const c of G.cases) {
  test(`classifyFreshness golden ${c.id}${c.calc ? `: ${c.calc}` : ''}`, () => {
    const got = classifyFreshness(envOf(c.env, c.now), Date.parse(c.now), c.policy);
    assert.equal(got.state, c.expect.state);
    assert.equal(got.age_min, c.expect.age_min);
    assert.equal(typeof got.reason, 'string');
  });
}

test('undefined env is missing; unknown status is invalid', () => {
  const now = Date.parse('2026-09-30T15:00:00Z');
  assert.equal(classifyFreshness(undefined, now, POLICIES.bars).state, 'missing');
  const bad = /** @type {any} */ (envOf({ data_as_of: '2026-09-30T14:00:00Z', status: 'weird' }, ''));
  assert.equal(classifyFreshness(bad, now, POLICIES.bars).state, 'invalid');
  const noAsOf = /** @type {any} */ (envOf({ data_as_of: null }, '2026-09-30T15:00:00Z'));
  assert.equal(classifyFreshness(noAsOf, now, POLICIES.bars).state, 'invalid');
});
