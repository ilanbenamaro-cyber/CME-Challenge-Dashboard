// Gate-3 regression tests for the io layer (.workflows/_shared/advice/G3-all.md P2-2..P2-5).
// Inputs follow /tmp/g3/money_attacks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceNumber, normalizeSheet } from '../../../docs/js/io/sheet.mjs';

/** @param {Record<string, unknown>} over */
function tradeRow(over = {}) {
  return {
    id: 'T1', root: 'ES', side: 'long', qty: 1, entry: 5000, exit: 5001,
    entry_time: '2026-09-30T10:00:00-05:00', exit_time: '2026-09-30T11:00:00-05:00', fees_usd: 0, notes: '',
    ...over,
  };
}

/** @param {unknown[]} trades */
function raw(trades) {
  return { schema_version: 1, generated_at: '2026-09-30T17:00:00Z', tabs: { Trades: trades, Daily: [] } };
}

// Load time used for the future-exit check: Wed 2026-09-30 12:00 CDT.
const LOAD_MS = Date.parse('2026-09-30T17:00:00Z');

test('P2-2: coerceNumber rejects more than one sign', () => {
  for (const s of ['--5', '+-5', '-+5', '++5', '-$-5', '+$+5', '-$+5']) {
    assert.ok(Number.isNaN(coerceNumber(s)), `${s} -> ${coerceNumber(s)}`);
  }
  assert.equal(coerceNumber('-5'), -5);
  assert.equal(coerceNumber('+5'), 5);
  assert.equal(coerceNumber('-$5'), -5);
  assert.equal(coerceNumber('$-5'), -5);
  assert.equal(coerceNumber('-1,234.50'), -1234.5);
  assert.equal(coerceNumber('1e3'), 1000);
});

test('P2-3: qty must be a positive safe integer no larger than 10000', () => {
  const r = normalizeSheet(raw([
    tradeRow({ id: 'A', qty: '100000000000000000000' }),
    tradeRow({ id: 'B', qty: 10001 }),
    tradeRow({ id: 'C', qty: 2 ** 53 }),
    tradeRow({ id: 'D', qty: 0 }),
    tradeRow({ id: 'E', qty: 10000 }),
    tradeRow({ id: 'F', qty: '3' }),
  ]), LOAD_MS);
  assert.deepEqual(r.data?.trades.map((t) => [t.id, t.qty]), [['E', 10000], ['F', 3]]);
  for (const id of ['A', 'B', 'C', 'D']) {
    assert.ok(r.rowErrors.some((e) => e.startsWith(`Trades row ${id}: qty`)), `${id}: ${r.rowErrors.join(' | ')}`);
  }
});

test('P2-4: impossible calendar dates and times are row errors', () => {
  const r = normalizeSheet(raw([
    tradeRow({ id: 'C', entry_time: '2026-02-30T10:00:00-05:00', exit: '', exit_time: '' }),
    tradeRow({ id: 'D', entry_time: '2026-09-30T25:00:00-05:00' }),
    tradeRow({ id: 'E', exit_time: '2026-09-31T11:00:00-05:00' }),
    tradeRow({ id: 'F', entry_time: '2026-09-30T10:60:00-05:00' }),
    tradeRow({ id: 'G', entry_time: '2026-09-30T10:00:00+24:00' }),
    tradeRow({ id: 'OK', entry_time: '2028-02-29T10:00:00-06:00', exit: '', exit_time: '' }),
  ]), LOAD_MS);
  assert.deepEqual(r.data?.trades.map((t) => t.id), ['OK']);
  for (const id of ['C', 'D', 'E', 'F', 'G']) {
    assert.ok(r.rowErrors.some((e) => e.startsWith(`Trades row ${id}:`) && /not a valid ISO-8601/.test(e)), `${id}: ${r.rowErrors.join(' | ')}`);
  }
});

test('P2-4: exit_time before entry_time is a row error', () => {
  const r = normalizeSheet(raw([tradeRow({ id: 'B', exit_time: '2026-09-29T11:00:00-05:00' })]), LOAD_MS);
  assert.equal(r.data?.trades.length, 0);
  assert.match(r.rowErrors[0] ?? '', /^Trades row B: exit_time is before entry_time/);
});

test('P2-4: exit_time more than 5 minutes after the load time is a row error', () => {
  const r = normalizeSheet(raw([
    tradeRow({ id: 'FUT', exit_time: '2026-09-30T12:06:00-05:00' }), // 6 min after load
    tradeRow({ id: 'NEAR', exit_time: '2026-09-30T12:05:00-05:00' }), // exactly 5 min: allowed (clock skew)
  ]), LOAD_MS);
  assert.deepEqual(r.data?.trades.map((t) => t.id), ['NEAR']);
  assert.match(r.rowErrors[0] ?? '', /^Trades row FUT: exit_time is in the future/);
});
