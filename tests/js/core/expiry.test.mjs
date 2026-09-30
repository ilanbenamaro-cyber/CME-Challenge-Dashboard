import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thirdFriday, nextExpiration, expiryBanner } from '../../../docs/js/core/expiry.mjs';
import { golden, contractsFile } from './_golden.mjs';

const G = golden('expiry.json');
const FILE = contractsFile();

for (const c of G.thirdFriday) {
  test(`thirdFriday golden ${c.year}-${c.month} -> ${c.expect}`, () => {
    assert.equal(thirdFriday(c.year, c.month), c.expect);
  });
}

for (const c of G.nextExpiration) {
  test(`nextExpiration golden ${c.id}: ${c.root} on ${c.today}${c.calc ? ` (${c.calc})` : ''}`, () => {
    assert.deepStrictEqual(nextExpiration(c.root, c.today, FILE, c.calendar), c.expect);
  });
}

for (const c of G.expiryBanner) {
  test(`expiryBanner golden ${c.id}: ${c.root} on ${c.today}`, () => {
    const got = expiryBanner(c.root, c.exp, c.today, c.warnDays);
    assert.equal(got.level, c.expect.level);
    assert.equal(got.value, c.expect.value);
    assert.ok(got.message.length > 0);
  });
}

test('expiryBanner unknown message tells the user where to fix it', () => {
  const got = expiryBanner('CL', null, '2026-09-30', 5);
  assert.equal(got.message, 'CL expiry UNKNOWN — add it to calendar.json');
});

test('nextExpiration with no contracts file is unknown', () => {
  assert.equal(nextExpiration('ES', '2026-09-30', null, []), null);
});

test('thirdFriday rejects bad months', () => {
  assert.throws(() => thirdFriday(2026, 13), RangeError);
  assert.throws(() => thirdFriday(2026, 0), RangeError);
});

// G3 P1-3 regressions (planner): a calendar entry for a later contract must not hide the nearer computed one.
test('calendar entry for a later contract does not hide the nearer computed expiry (G3 P1-3)', () => {
  const next = nextExpiration;
  const contracts = contractsFile();
  const cal = [{ root: 'ES', contract_code: 'ESH27', date: '2027-03-18', source: 'fixture' }];
  assert.deepEqual(next('ES', '2026-12-18', contracts, cal), {
    root: 'ES', contract_code: 'ESZ26', date: '2026-12-18', source: 'computed: third Friday (holiday-unadjusted)',
  });
  assert.equal(next('ES', '2026-12-19', contracts, cal)?.contract_code, 'ESH27');
  assert.equal(next('ES', '2026-12-19', contracts, cal)?.source, 'fixture');
});

test('an override moved into the past suppresses the computed date for that contract (G3 P1-3)', () => {
  const next = nextExpiration;
  const contracts = contractsFile();
  const cal = [{ root: 'ES', contract_code: 'ESZ26', date: '2026-12-17', source: 'override' }];
  assert.equal(next('ES', '2026-12-18', contracts, cal)?.contract_code, 'ESH27');
});
