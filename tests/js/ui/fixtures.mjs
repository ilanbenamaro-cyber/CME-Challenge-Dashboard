// Shared fixtures for the WP-UI view-model tests (not a test file itself).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSheet } from '../../../docs/js/io/sheet.mjs';
import { defaultSettings } from '../../../docs/js/io/settings.mjs';
import { parseContractsFile, parseRulesFile } from '../../../docs/js/io/data.mjs';

export const ROOT = new URL('../../../', import.meta.url);
/** @param {string} p */
export const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

export const CONTRACTS = parseContractsFile(readJson('docs/data/contracts.json'));
/**
 * The pre-ADR-008 placeholder rules file: the 11 original keys, every value null (built here, not read from
 * docs/data/rules.json, which now holds the real challenge rules).
 */
export function allNullRulesJson() {
  /** @type {Record<string, {value: null, source: null}>} */
  const rules = {};
  for (const k of Object.keys(readJson('tests/golden/sizer.json').rules_fixture)) rules[k] = { value: null, source: null };
  return { schema_version: 1, updated_at: 'fixture', source_doc: 'plan/RULES.md', rules };
}
export const RULES_ALL_NULL = parseRulesFile(allNullRulesJson());
export const FIXTURE_RULES = parseRulesFile({
  schema_version: 1,
  updated_at: 'fixture',
  source_doc: 'tests/golden/sizer.json#rules_fixture',
  rules: readJson('tests/golden/sizer.json').rules_fixture,
});
export const CALENDAR = readJson('docs/data/calendar.json');

// Wed 2026-09-30 14:45 CDT (19:45Z): 25 min before the fixture flatten time 15:10 CT.
export const NOW = Date.parse('2026-09-30T19:45:00Z');
export const MIN = 60000;
export const SHEET_URL = 'https://script.google.com/macros/s/TESTID/exec';

/**
 * @param {string} dataset
 * @param {unknown} data
 * @param {number} asOfMs
 * @param {'ok'|'partial'|'error'} [status]
 */
export function env(dataset, data, asOfMs, status = 'ok') {
  const iso = new Date(asOfMs).toISOString();
  return { schema_version: 1, dataset, generated_at: iso, data_as_of: iso, source: `test:${dataset}`, status, errors: status === 'ok' ? [] : ['fixture error'], data };
}

/** 20 hourly ES bars on the 0.25 grid, last close 5801.25. */
export function esBars() {
  const bars = [];
  for (let i = 0; i < 20; i++) {
    const c = 5790 + i * 0.5 + (i === 19 ? 1.75 : 0);
    bars.push({ t: new Date(NOW - (20 - i) * 60 * MIN).toISOString(), o: c - 0.5, h: c + 1, l: c - 1.5, c, v: 100 });
  }
  return bars;
}

/** @param {number} asOfMs */
export function barsEnv(asOfMs) {
  return env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: esBars() } }, aliases: { MES: 'ES' }, cost_usd: 0.01 }, asOfMs);
}

export const CME_MARGINS = { rows: [
  { root: 'ES', initial_usd: 16500, maintenance_usd: 15000, as_of: '2026-09-29' },
  { root: 'MES', initial_usd: 1650, maintenance_usd: 1500, as_of: '2026-09-29' },
] };

/** Sheet rows: one closed MES short today (+$49.38 net) and one open MES long 2 @ 5795. */
export function sheetRaw(extraTrades = /** @type {unknown[]} */ ([]), notes = 'ok') {
  return {
    schema_version: 1,
    generated_at: new Date(NOW).toISOString(),
    tabs: {
      Trades: [
        { id: 'C1', root: 'MES', side: 'short', qty: 1, entry: 5800, exit: 5790, entry_time: '2026-09-30T09:00:00-05:00', exit_time: '2026-09-30T14:00:00-05:00', fees_usd: 0.62, notes: '' },
        { id: 'O1', root: 'MES', side: 'long', qty: '2', entry: '5795.00', exit: '', entry_time: '2026-09-30T13:00:00-05:00', exit_time: '', fees_usd: '1.24', notes },
        ...extraTrades,
      ],
      Daily: [{ date: '2026-09-29', reported_pnl_usd: 100, reported_balance_usd: 50100 }],
      Margins: [{ root: 'MES', initial_usd: 1320, maintenance_usd: 1200, as_of: '2026-09-28' }],
    },
  };
}

/** @param {unknown} raw */
export function sheetResult(raw) {
  const n = normalizeSheet(raw);
  return { ...n, fetchedAtMs: NOW - MIN };
}

/**
 * @param {Partial<import('../../../docs/js/ui/viewmodel.mjs').VMInputs>} over
 * @returns {import('../../../docs/js/ui/viewmodel.mjs').VMInputs}
 */
export function inputs(over = {}) {
  return {
    nowMs: NOW,
    rules: FIXTURE_RULES,
    contracts: CONTRACTS,
    envs: {
      bars: barsEnv(NOW - 30 * MIN),
      settlements: env('settlements', { rows: [{ root: 'ES', contract_code: 'ESZ26', settle: 5799.5, trade_date: '2026-09-29' }] }, NOW - 20 * 60 * MIN),
      margins: env('margins', CME_MARGINS, NOW - 20 * 60 * MIN),
      challenge: env('challenge', { rows: [{ date: '2026-09-29', account: 'x', pnl_usd: 100, balance_usd: 50100, rank: 12 }] }, NOW - 20 * 60 * MIN),
      calendar: /** @type {any} */ (CALENDAR),
    },
    sheet: sheetResult(sheetRaw()),
    settings: { ...defaultSettings(), sheet_url: SHEET_URL, sheet_key: 'k' },
    sizerForm: { root: 'MES', risk_budget_usd: 500, stop_ticks: 32, fee_per_contract_usd: 0, hold: 'intraday' },
    loadedAtMs: NOW,
    ...over,
  };
}

/** @param {import('../../../docs/js/ui/viewmodel.mjs').ViewModel} vm */
export function noSectionErrors(vm) {
  assert.deepEqual(vm.sectionErrors, {}, 'a panel failed to build');
}
