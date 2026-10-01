// WP-UI io tests: Sheet normalisation, settings sanitising, static-file parsing. Pure functions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSheet, coerceNumber, isValidSheetUrl, TRADES_ROW_PREFIX } from '../../../docs/js/io/sheet.mjs';
import { sanitizeSettings, defaultSettings, parseRoots, sanitizeSizerForm, loadSettings, saveSettings } from '../../../docs/js/io/settings.mjs';
import { asEnvelope, parseRulesFile, parseContractsFile } from '../../../docs/js/io/data.mjs';

const ROOT = new URL('../../../', import.meta.url);
const readJson = (/** @type {string} */ p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

/** @param {Record<string, unknown>} over */
function tradeRow(over = {}) {
  return {
    id: 'T1', root: 'MES', side: 'long', qty: 2, entry: 5800, exit: 5801.25,
    entry_time: '2026-09-30T09:00:00-05:00', exit_time: '2026-09-30T09:30:00-05:00', fees_usd: 2.48, notes: '',
    ...over,
  };
}

/** @param {unknown[]} trades @param {unknown[]} [daily] @param {unknown[]} [margins] */
function raw(trades, daily = [], margins) {
  /** @type {Record<string, unknown>} */
  const tabs = { Trades: trades, Daily: daily };
  if (margins) tabs.Margins = margins;
  return { schema_version: 1, generated_at: '2026-09-30T15:00:00Z', tabs };
}

test('coerceNumber: blanks to null, numeric strings coerced, junk is NaN (never 0)', () => {
  assert.equal(coerceNumber(''), null);
  assert.equal(coerceNumber('   '), null);
  assert.equal(coerceNumber(null), null);
  assert.equal(coerceNumber(undefined), null);
  assert.equal(coerceNumber('5800.25'), 5800.25);
  assert.equal(coerceNumber(' 12 '), 12);
  assert.equal(coerceNumber('-1,234.50'), -1234.5);
  assert.equal(coerceNumber('$4.80'), 4.8);
  assert.equal(coerceNumber(7), 7);
  assert.ok(Number.isNaN(coerceNumber('abc')));
  assert.ok(Number.isNaN(coerceNumber('12abc')));
  assert.ok(Number.isNaN(coerceNumber('1.2.3')));
  assert.ok(Number.isNaN(coerceNumber(true)));
  assert.ok(Number.isNaN(coerceNumber(Infinity)));
});

test('normalizeSheet: coerces numeric strings and blank exit to an open trade', () => {
  const r = normalizeSheet(raw([
    tradeRow({ id: 7, qty: '3', entry: '5800.50', exit: '', exit_time: '', fees_usd: '1.24', notes: 'scalp' }),
  ]));
  assert.equal(r.error, null);
  assert.deepEqual(r.rowErrors, []);
  assert.ok(r.data);
  assert.deepEqual(r.data.trades, [{
    id: '7', root: 'MES', side: 'long', qty: 3, entry: 5800.5, exit: null,
    entry_time: '2026-09-30T09:00:00-05:00', exit_time: null, fees_usd: 1.24, notes: 'scalp',
  }]);
});

test('normalizeSheet: non-coercible values make the row invalid with its id; row excluded, never 0', () => {
  const r = normalizeSheet(raw([
    tradeRow({ id: 'GOOD' }),
    tradeRow({ id: 'BADQTY', qty: 'two' }),
    tradeRow({ id: 'BADENTRY', entry: 'n/a' }),
    tradeRow({ id: 'BLANKFEE', fees_usd: '' }),
    tradeRow({ id: 'BADSIDE', side: 'buy' }),
    tradeRow({ id: 'HALFOPEN', exit: '', exit_time: '2026-09-30T10:00:00-05:00' }),
    tradeRow({ id: 'NOOFFSET', entry_time: '2026-09-30T09:00:00' }),
    tradeRow({ id: 'FRACQTY', qty: 1.5 }),
  ]));
  assert.equal(r.error, null);
  assert.ok(r.data);
  assert.deepEqual(r.data.trades.map((t) => t.id), ['GOOD']);
  const ids = ['BADQTY', 'BADENTRY', 'BLANKFEE', 'BADSIDE', 'HALFOPEN', 'NOOFFSET', 'FRACQTY'];
  assert.equal(r.rowErrors.length, ids.length);
  ids.forEach((id, i) => {
    assert.ok(r.rowErrors[i]?.startsWith(`${TRADES_ROW_PREFIX}${id}:`), r.rowErrors[i]);
  });
});

test('normalizeSheet: blank rows skipped, missing and duplicate ids are row errors', () => {
  const blank = { id: '', root: '', side: '', qty: '', entry: '', exit: '', entry_time: '', exit_time: '', fees_usd: '', notes: '' };
  const r = normalizeSheet(raw([tradeRow({ id: 'A' }), blank, tradeRow({ id: '' }), tradeRow({ id: 'A' })]));
  assert.ok(r.data);
  assert.equal(r.data.trades.length, 1);
  assert.equal(r.rowErrors.length, 2);
  assert.match(r.rowErrors[0] ?? '', /^Trades row #4: id is blank/);
  assert.match(r.rowErrors[1] ?? '', /^Trades row A: duplicate id/);
});

test('normalizeSheet: Daily and Margins rows normalised; bad rows reported, not coerced', () => {
  const r = normalizeSheet(raw(
    [],
    [
      { date: '2026-09-29', reported_pnl_usd: '-9.31', reported_balance_usd: '49,902.48' },
      { date: '2026-09-28', reported_pnl_usd: '', reported_balance_usd: '' },
      { date: '09/27/2026', reported_pnl_usd: 1, reported_balance_usd: 1 },
      { date: '2026-09-26', reported_pnl_usd: 'oops', reported_balance_usd: 1 },
    ],
    [
      { root: 'mes', initial_usd: '1,320', maintenance_usd: 1200, as_of: '2026-09-28' },
      { root: 'ES', initial_usd: '', maintenance_usd: '', as_of: '' },
      { root: 'NQ', initial_usd: 'x', maintenance_usd: 1, as_of: '' },
    ],
  ));
  assert.ok(r.data);
  assert.deepEqual(r.data.daily, [
    { date: '2026-09-29', reported_pnl_usd: -9.31, reported_balance_usd: 49902.48 },
    { date: '2026-09-28', reported_pnl_usd: null, reported_balance_usd: null },
  ]);
  assert.deepEqual(r.data.margins, [
    { root: 'MES', initial_usd: 1320, maintenance_usd: 1200, as_of: '2026-09-28' },
    { root: 'ES', initial_usd: null, maintenance_usd: null, as_of: null },
  ]);
  assert.equal(r.rowErrors.length, 3);
  assert.ok(r.rowErrors.every((e) => !e.startsWith(TRADES_ROW_PREFIX)));
});

test('normalizeSheet: {error} responses and bad shapes give error, no data', () => {
  assert.deepEqual(normalizeSheet({ error: 'bad key' }), { data: null, rowErrors: [], error: 'Sheet: bad key' });
  assert.equal(normalizeSheet(null).data, null);
  assert.notEqual(normalizeSheet('x').error, null);
  assert.notEqual(normalizeSheet({ schema_version: 2, tabs: { Trades: [], Daily: [] } }).error, null);
  assert.notEqual(normalizeSheet({ schema_version: 1, tabs: { Trades: [] } }).error, null);
  const ok = normalizeSheet(raw([]));
  assert.deepEqual(ok, { data: { trades: [], daily: [], margins: [] }, rowErrors: [], error: null });
});

test('isValidSheetUrl accepts only Apps Script /macros/s/<id>/exec', () => {
  assert.ok(isValidSheetUrl('https://script.google.com/macros/s/AbC_123-x/exec'));
  assert.ok(!isValidSheetUrl('http://script.google.com/macros/s/AbC/exec'));
  assert.ok(!isValidSheetUrl('https://script.google.com.evil.io/macros/s/AbC/exec'));
  assert.ok(!isValidSheetUrl('https://example.com/macros/s/AbC/exec'));
  assert.ok(!isValidSheetUrl('https://script.google.com/macros/s/AbC/dev'));
  assert.ok(!isValidSheetUrl(''));
});

test('settings: defaults and field-by-field sanitising', () => {
  assert.deepEqual(defaultSettings(), { sheet_url: '', sheet_key: '', watched_roots: ['ES', 'MES', 'NQ', 'MNQ'], expiry_warn_days: 5 });
  assert.deepEqual(sanitizeSettings(null), defaultSettings());
  assert.deepEqual(sanitizeSettings({ sheet_url: ' u ', sheet_key: 'k', watched_roots: 'cl, mcl gc,CL,<b>', expiry_warn_days: '7' }),
    { sheet_url: 'u', sheet_key: 'k', watched_roots: ['CL', 'MCL', 'GC'], expiry_warn_days: 7 });
  assert.equal(sanitizeSettings({ expiry_warn_days: -1 }).expiry_warn_days, 5);
  assert.equal(sanitizeSettings({ expiry_warn_days: 2.5 }).expiry_warn_days, 5);
  assert.equal(parseRoots(''), null);
  assert.deepEqual(sanitizeSizerForm({ root: 'es', risk_budget_usd: '250', stop_ticks: '', fee_per_contract_usd: 'x', hold: 'weekend' }),
    { root: 'ES', risk_budget_usd: 250, stop_ticks: null, fee_per_contract_usd: null, hold: 'weekend' });
});

test('settings: storage unavailable (node) falls back to defaults without throwing', () => {
  assert.deepEqual(loadSettings(), defaultSettings());
  assert.doesNotThrow(() => saveSettings(defaultSettings()));
});

test('static files: committed rules/contracts/calendar parse', () => {
  const rules = parseRulesFile(readJson('docs/data/rules.json'));
  assert.ok(rules);
  assert.equal(rules.rules.daily_loss_cap_usd.value, null);
  const contracts = parseContractsFile(readJson('docs/data/contracts.json'));
  assert.ok(contracts);
  assert.equal(contracts.contracts.length, 8);
  assert.ok(asEnvelope(readJson('docs/data/calendar.json')));
  assert.equal(parseRulesFile({ schema_version: 1 }), null);
  assert.equal(parseContractsFile([]), null);
  assert.equal(asEnvelope({ hello: 1 }), null);
  const odd = parseRulesFile({ schema_version: 1, rules: { max_contracts: 5 } });
  assert.deepEqual(odd?.rules.max_contracts, { value: null, source: null });
});
