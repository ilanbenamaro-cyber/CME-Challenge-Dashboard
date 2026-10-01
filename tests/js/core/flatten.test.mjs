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

// G3 P1-2 regressions (planner): flatten is anchored to the CME trade date, not the CT calendar date.
test('flatten banner does not flip at CT midnight with a position open (G3 P1-2)', () => {
  const rules = /** @type {any} */ ({ flatten_time_ct: { value: '15:10', source: 'TEST FIXTURE' } });
  // Tue 2026-09-29 23:59 CDT (trade date Wed) and Wed 00:00 CDT: both target Wed 15:10 CDT (20:10Z).
  const before = flattenBanner(Date.parse('2026-09-30T04:59:00Z'), rules, true);
  const after = flattenBanner(Date.parse('2026-09-30T05:00:00Z'), rules, true);
  assert.deepEqual([before.level, before.value], ['ok', 911]);
  assert.deepEqual([after.level, after.value], ['ok', 910]);
});

test('evening-session position is not a false breach; 15:10–17:00 window still breaches (G3 P1-2)', () => {
  const rules = /** @type {any} */ ({ flatten_time_ct: { value: '15:10', source: 'TEST FIXTURE' } });
  // Tue 18:00 CDT -> trade date Wed -> Wed 15:10 is 21h10m away.
  assert.deepEqual(pick(flattenBanner(Date.parse('2026-09-29T23:00:00Z'), rules, true)), ['ok', 1270]);
  // Tue 16:30 CDT -> still trade date Tue -> 80 min past.
  assert.deepEqual(pick(flattenBanner(Date.parse('2026-09-29T21:30:00Z'), rules, true)), ['breach', -80]);
  // Sat 2026-09-26 12:00 CDT -> trade date Mon 09-28 -> Mon 15:10 CDT (20:10Z).
  assert.deepEqual(pick(flattenBanner(Date.parse('2026-09-26T17:00:00Z'), rules, true)), ['ok', 3070]);
});

/** @param {{level: string, value: number|null}} b */
function pick(b) { return [b.level, b.value]; }
