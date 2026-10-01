import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyNetByTradeDate, reconcile } from '../../../docs/js/core/book.mjs';
import { golden, contractsFile } from './_golden.mjs';

const G = golden('book.json');
const FILE = contractsFile();

test('dailyNetByTradeDate golden: dates and net per CME trade date', () => {
  const got = dailyNetByTradeDate(G.trades, FILE);
  assert.deepStrictEqual([...got.keys()].sort(), Object.keys(G.expect_computed).sort());
  for (const [date, exp] of Object.entries(G.expect_computed)) {
    const row = got.get(date);
    assert.ok(row, date);
    assert.equal(row.net_cents, /** @type {any} */ (exp).net_cents, date);
    assert.equal(row.errors.length, /** @type {any} */ (exp).error_count, date);
  }
});

test('reconcile golden: rows, order, diffs and levels', () => {
  const got = reconcile(dailyNetByTradeDate(G.trades, FILE), G.reported, G.reconcile_limit);
  assert.equal(got.length, G.expect_recon.length);
  got.forEach((row, i) => {
    const exp = G.expect_recon[i];
    const { errors, ...rest } = row;
    assert.deepStrictEqual(rest, exp, exp.date);
    assert.ok(Array.isArray(errors));
    if (exp.level === 'unknown') assert.ok(errors.length > 0, `${exp.date}: unknown must explain why`);
    if (exp.level === 'ok') assert.deepStrictEqual(errors, [], exp.date);
  });
});

test('reconcile respects the limit and keeps the newest dates', () => {
  const got = reconcile(dailyNetByTradeDate(G.trades, FILE), G.reported, 2);
  assert.deepStrictEqual(got.map((r) => r.date), G.expect_recon.slice(0, 2).map((/** @type {any} */ r) => r.date));
  assert.deepStrictEqual(reconcile(new Map(), G.reported, 0), []);
});

test('closed trade with a bad exit time or off-tick price is an error, never 0', () => {
  const base = G.trades[0];
  const badTime = { ...base, id: 'BT', exit_time: 'yesterday' };
  const offTick = { ...base, id: 'OT', exit: 4502.1 };
  const got = dailyNetByTradeDate([badTime, offTick], FILE);
  for (const row of got.values()) {
    assert.equal(row.net_cents, null);
    assert.ok(row.errors.length > 0);
  }
  assert.ok(got.size > 0);
});

test('no contracts file makes every closed-trade date unknown', () => {
  const got = dailyNetByTradeDate(G.trades, null);
  for (const row of got.values()) assert.equal(row.net_cents, null);
});
