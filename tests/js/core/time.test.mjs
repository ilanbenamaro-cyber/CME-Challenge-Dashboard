import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ctParts, ctDate, addDays, weekdayOf, prevWeekday, daysBetween, tradeDate, ctWallToMs, parseInstant,
} from '../../../docs/js/core/time.mjs';
import { golden } from './_golden.mjs';

const BOOK = golden('book.json');

for (const c of BOOK.tradeDate) {
  test(`tradeDate golden ${c.t}: ${c.calc}`, () => {
    assert.equal(tradeDate(Date.parse(c.t)), c.expect);
  });
}

test('tradeDate for every hour of the DST-transition Sunday 2026-11-01 rolls to Monday', () => {
  // 2026-11-01 00:00 CDT = 05:00Z; this CT day lasts 25 hours (01:00 repeats). All of Sunday -> Monday.
  const start = Date.parse('2026-11-01T05:00:00Z');
  for (let h = 0; h < 25; h += 1) {
    const ms = start + h * 3600000;
    assert.equal(ctDate(ms), '2026-11-01', `hour ${h} still CT Sunday`);
    assert.equal(tradeDate(ms), '2026-11-02', `hour ${h}`);
  }
  assert.equal(ctDate(start + 25 * 3600000), '2026-11-02');
});

test('tradeDate on Monday 2026-11-02 (CST) rolls at 17:00 CT = 23:00Z', () => {
  const start = Date.parse('2026-11-02T06:00:00Z'); // 00:00 CST
  for (let h = 0; h < 24; h += 1) {
    const ms = start + h * 3600000;
    assert.equal(tradeDate(ms), h < 17 ? '2026-11-02' : '2026-11-03', `hour ${h}`);
  }
});

test('ctParts reports CT wall clock across DST', () => {
  assert.deepStrictEqual(ctParts(Date.parse('2026-09-30T19:00:00Z')),
    { year: 2026, month: 9, day: 30, hour: 14, minute: 0, weekday: 3 });
  assert.deepStrictEqual(ctParts(Date.parse('2026-12-01T20:00:00Z')),
    { year: 2026, month: 12, day: 1, hour: 14, minute: 0, weekday: 2 });
  assert.equal(ctParts(Date.parse('2026-09-30T05:00:00Z')).hour, 0); // midnight is 0, not 24
});

test('ctWallToMs is DST-correct (flatten golden semantics: 15:10 CDT = 20:10Z, CST = 21:10Z)', () => {
  assert.equal(ctWallToMs('2026-09-30', '15:10'), Date.parse('2026-09-30T20:10:00Z'));
  assert.equal(ctWallToMs('2026-12-01', '15:10'), Date.parse('2026-12-01T21:10:00Z'));
  assert.equal(ctWallToMs('2026-09-25', '15:00'), Date.parse('2026-09-25T20:00:00Z'));
  assert.equal(ctWallToMs('2026-12-04', '15:00'), Date.parse('2026-12-04T21:00:00Z'));
  // fall-back day: 00:30 is CDT, 03:00 is CST; ambiguous 01:30 resolves to the earlier (CDT) instant
  assert.equal(ctWallToMs('2026-11-01', '00:30'), Date.parse('2026-11-01T05:30:00Z'));
  assert.equal(ctWallToMs('2026-11-01', '03:00'), Date.parse('2026-11-01T09:00:00Z'));
  assert.equal(ctWallToMs('2026-11-01', '01:30'), Date.parse('2026-11-01T06:30:00Z'));
  // spring-forward day 2027-03-14: 01:59 CST, 03:00 CDT; 02:30 does not exist -> -06:00 (= 03:30 CDT)
  assert.equal(ctWallToMs('2027-03-14', '01:59'), Date.parse('2027-03-14T07:59:00Z'));
  assert.equal(ctWallToMs('2027-03-14', '03:00'), Date.parse('2027-03-14T08:00:00Z'));
  assert.equal(ctWallToMs('2027-03-14', '02:30'), Date.parse('2027-03-14T08:30:00Z'));
});

test('ctWallToMs rejects malformed input', () => {
  const bad = [['2026-09-30', '3:10'], ['2026-09-30', '24:00'], ['2026-09-30', '15:60'],
    ['2026-9-30', '15:10'], ['2026-02-30', '15:10'], ['', '15:10'], ['2026-09-30', '']];
  for (const [d, t] of bad) {
    assert.throws(() => ctWallToMs(d, t), RangeError, `${d} ${t}`);
  }
});

test('addDays / daysBetween round-trip across DST, month and year ends (property)', () => {
  const anchors = ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01', '2026-12-31', '2027-02-28', '2028-02-28'];
  for (const a of anchors) {
    for (let n = -400; n <= 400; n += 7) {
      const b = addDays(a, n);
      assert.equal(daysBetween(a, b), n, `${a} + ${n}`);
      assert.equal(addDays(b, -n), a, `${b} - ${n}`);
    }
  }
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(daysBetween('2026-09-30', '2026-12-18'), 79);
});

test('weekdayOf / prevWeekday', () => {
  assert.equal(weekdayOf('2026-09-30'), 3);
  assert.equal(weekdayOf('2026-11-01'), 0);
  assert.equal(prevWeekday('2026-09-30'), '2026-09-29');
  assert.equal(prevWeekday('2026-09-28'), '2026-09-25');
  assert.equal(prevWeekday('2026-09-27'), '2026-09-25');
  assert.equal(prevWeekday('2026-09-26'), '2026-09-25');
  assert.throws(() => weekdayOf('nope'), RangeError);
});

test('parseInstant requires an explicit offset', () => {
  assert.equal(parseInstant('2026-09-30T15:00:00Z'), Date.parse('2026-09-30T15:00:00Z'));
  assert.equal(parseInstant('2026-09-29T15:00:00-05:00'), Date.parse('2026-09-29T20:00:00Z'));
  assert.equal(parseInstant('2026-09-29T15:00:00'), null);
  assert.equal(parseInstant('not-a-date'), null);
  assert.equal(parseInstant(null), null);
});
