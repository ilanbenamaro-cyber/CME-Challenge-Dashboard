import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenBanner } from '../../../docs/js/core/flatten.mjs';
import { golden, rulesFixture } from './_golden.mjs';

const G = golden('flatten.json');

for (const c of G.cases) {
  test(`flattenBanner golden ${c.id}${c.calc ? `: ${c.calc}` : ''}`, () => {
    const rules = rulesFixture({ ...G.rule, ...(c.rule_override ?? {}) });
    const got = flattenBanner(Date.parse(c.now), rules, c.open);
    assert.equal(got.level, c.expect.level);
    assert.equal(got.value, c.expect.value);
    assert.ok(got.message.length > 0);
  });
}

test('flatten banner states the flatten time even when flat', () => {
  const rules = rulesFixture(G.rule);
  const got = flattenBanner(Date.parse('2026-09-30T20:30:00Z'), rules, false);
  assert.match(got.message, new RegExp(G.rule.flatten_time_ct.value));
});

test('flatten banner with no rules or a malformed time is unknown', () => {
  assert.equal(flattenBanner(Date.parse('2026-09-30T19:00:00Z'), null, true).level, 'unknown');
  const bad = rulesFixture({ flatten_time_ct: { value: '3pm', source: 'x' } });
  const got = flattenBanner(Date.parse('2026-09-30T19:00:00Z'), bad, true);
  assert.equal(got.level, 'unknown');
  assert.equal(got.value, null);
});
