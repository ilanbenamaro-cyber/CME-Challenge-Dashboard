// Gate-3 regression tests for the io layer (.workflows/_shared/advice/G3-all.md P2-2..P2-5).
// Inputs follow /tmp/g3/money_attacks.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceNumber, normalizeSheet } from '../../../docs/js/io/sheet.mjs';
import { parseRulesFile, validateRulesFile } from '../../../docs/js/io/data.mjs';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { inputs, readJson } from './fixtures.mjs';

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

test('P2-5: wrongly typed rules.json values become UNKNOWN (null) and are listed as load errors', () => {
  const golden = readJson('tests/golden/sizer.json').rules_fixture;
  const json = {
    schema_version: 1, updated_at: 'x', source_doc: 'x',
    rules: {
      ...golden,
      max_contracts: { value: '5', source: 'r' },
      starting_balance_usd: { value: '50,000', source: 'r' },
      daily_loss_cap_usd: { value: -1, source: 'r' },
      micro_to_standard_ratio: { value: 10, source: 7 },
      flatten_time_ct: { value: '3:10pm', source: 'r' },
      margin_basis: { value: 'Initial', source: 'r' },
      allowed_roots: { value: 'ES,MES', source: 'r' },
      hold_margin_multipliers: { value: { intraday: '0.25', overnight: 1, weekend: 1 }, source: 'r' },
      challenge_end_date: { value: 20261231, source: 'r' },
    },
  };
  const { rules: rf, errors } = validateRulesFile(json);
  assert.ok(rf);
  for (const k of ['max_contracts', 'starting_balance_usd', 'daily_loss_cap_usd', 'flatten_time_ct', 'margin_basis', 'allowed_roots', 'challenge_end_date']) {
    assert.equal(/** @type {any} */ (rf.rules)[k].value, null, k);
    assert.ok(errors.some((e) => e.startsWith(`${k}:`)), `${k} not listed: ${errors.join(' | ')}`);
  }
  assert.deepEqual(rf.rules.hold_margin_multipliers.value, { intraday: null, overnight: 1, weekend: 1 });
  assert.ok(errors.some((e) => e.startsWith('hold_margin_multipliers.intraday:')));
  assert.equal(rf.rules.micro_to_standard_ratio.value, 10);
  assert.equal(rf.rules.micro_to_standard_ratio.source, null);
  assert.ok(errors.some((e) => e.startsWith('micro_to_standard_ratio.source:')));
  // Well-typed values pass through unchanged.
  assert.equal(rf.rules.max_drawdown_usd.value, golden.max_drawdown_usd.value);
  assert.deepEqual(parseRulesFile(json), rf);
  // The committed file (all null) has no load errors.
  assert.deepEqual(validateRulesFile(readJson('docs/data/rules.json')).errors, []);
});

test('P2-5: the view model shows rule type errors as a banner and keeps the Account panel', () => {
  const golden = readJson('tests/golden/sizer.json').rules_fixture;
  const { rules: rf, errors } = validateRulesFile({
    schema_version: 1, updated_at: 'x', source_doc: 'x',
    rules: { ...golden, starting_balance_usd: { value: '50,000', source: 'r' } },
  });
  const vm = buildViewModel(inputs({ rules: rf, ruleErrors: errors }));
  assert.deepEqual(vm.sectionErrors, {});
  assert.equal(vm.account?.equity.text, 'UNKNOWN');
  const b = vm.banners.find((x) => x.kind === 'rules' && /invalid value/.test(x.title));
  assert.ok(b, JSON.stringify(vm.banners.map((x) => x.title)));
  assert.equal(b.level, 'warn');
  assert.ok(b.details.some((d) => d.startsWith('starting_balance_usd:')));
  assert.ok(vm.rulesInfo.unknown.includes('starting_balance_usd'));
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
