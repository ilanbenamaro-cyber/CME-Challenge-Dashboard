// Gate-3 regression tests (.workflows/_shared/advice/G3-all.md). Each test reproduces one finding and pins
// the fixed behaviour. Inputs follow the probe scripts in /tmp/g3/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { NOW, MIN, sheetRaw, sheetResult, inputs, noSectionErrors } from './fixtures.mjs';

// P0-1 (/tmp/g3/vm_invalid_open.mjs): an open ES row with side "Buy" is rejected by normalizeSheet.
const BAD_OPEN = { id: 'O9', root: 'ES', side: 'Buy', qty: 3, entry: 5795, exit: '', entry_time: '2026-09-30T13:00:00-05:00', exit_time: '', fees_usd: 0, notes: '' };

test('P0-1: an invalid Trades row makes open positions UNKNOWN (never flat / $0.00), even past flatten', () => {
  const raw = sheetRaw([BAD_OPEN]);
  raw.tabs.Trades = raw.tabs.Trades.filter((t) => /** @type {{id: string}} */ (t).id !== 'O1'); // no valid open rows
  const vm = buildViewModel(inputs({ nowMs: Date.parse('2026-09-30T20:20:00Z'), sheet: sheetResult(raw) })); // 15:20 CDT
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions && vm.sizer);
  assert.equal(vm.account.open.text, 'UNKNOWN');
  assert.match(vm.account.open.note, /open positions UNKNOWN \(1 invalid Sheet row\)/);
  assert.equal(vm.account.margin_used.text, 'UNKNOWN');
  assert.equal(vm.account.equity.text, 'UNKNOWN');
  assert.equal(vm.positions.known, false);
  assert.match(vm.positions.reason, /open positions UNKNOWN \(1 invalid Sheet row\)/);
  assert.equal(vm.positions.std_equiv.text, 'UNKNOWN');
  assert.equal(vm.sizer.available.text, 'UNKNOWN');
  for (const m of vm.account.meters) assert.equal(m.level, 'unknown', m.key);
  const f = vm.banners.find((b) => b.kind === 'flatten');
  assert.equal(f?.level, 'unknown');
  assert.match(f?.message ?? '', /open positions UNKNOWN \(1 invalid Sheet row\)/);
  assert.doesNotMatch(f?.message ?? '', /no open positions/);
  const html = renderApp(vm);
  assert.ok(!html.includes('no open positions'), 'flatten banner claims flat');
  assert.ok(!html.includes('Flat — no open positions'), 'positions panel claims flat');
});

test('P0-1: flatten banner is UNKNOWN (not ok) before flatten time too when rows are invalid', () => {
  const vm = buildViewModel(inputs({ nowMs: Date.parse('2026-09-30T15:00:00Z'), sheet: sheetResult(sheetRaw([BAD_OPEN])) })); // 10:00 CDT
  const f = vm.banners.find((b) => b.kind === 'flatten');
  assert.equal(f?.level, 'unknown');
  assert.match(f?.message ?? '', /open positions UNKNOWN/);
});

test('P0-1: Sheet not loaded keeps open positions UNKNOWN', () => {
  const vm = buildViewModel(inputs({ sheet: null }));
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions);
  assert.equal(vm.account.open.text, 'UNKNOWN');
  assert.equal(vm.account.margin_used.text, 'UNKNOWN');
  assert.equal(vm.positions.known, false);
  assert.equal(vm.banners.find((b) => b.kind === 'flatten')?.level, 'unknown');
});

/**
 * Sheet whose Daily tab is replaced.
 * @param {unknown[]} daily
 */
function sheetWithDaily(daily) {
  const raw = sheetRaw();
  raw.tabs.Daily = /** @type {any} */ (daily);
  return sheetResult(raw);
}

test('P0-2: a rejected Daily row makes peak and the drawdown meter UNKNOWN', () => {
  // Input A: true peak 51,800 (row rejected), so DD would be 1,800 of 2,000; it must not read "ok 5%".
  const vm = buildViewModel(inputs({ sheet: sheetWithDaily([
    { date: '2026-09-28', reported_pnl_usd: 1800, reported_balance_usd: '51,800.00 USD' },
    { date: '2026-09-29', reported_pnl_usd: -1700, reported_balance_usd: 50100 },
  ]) }));
  noSectionErrors(vm);
  assert.ok(vm.account);
  assert.equal(vm.account.peak.known, false);
  assert.equal(vm.account.peak.text, 'UNKNOWN');
  assert.match(vm.account.peak.note, /1 invalid Daily row/);
  const dd = vm.account.meters.find((m) => m.key === 'drawdown');
  assert.equal(dd?.level, 'unknown');
  assert.equal(dd?.pct_text, 'UNKNOWN');
  assert.match(dd?.note ?? '', /peak UNKNOWN/);
});

test('P0-2: a Daily row with a blank balance makes peak UNKNOWN', () => {
  // Input B: balance not filled in yet.
  const vm = buildViewModel(inputs({ sheet: sheetWithDaily([{ date: '2026-09-28', reported_pnl_usd: 1800, reported_balance_usd: '' }]) }));
  noSectionErrors(vm);
  assert.ok(vm.account);
  assert.equal(vm.account.peak.text, 'UNKNOWN');
  assert.match(vm.account.peak.note, /2026-09-28 has no reported balance/);
  assert.equal(vm.account.meters.find((m) => m.key === 'drawdown')?.level, 'unknown');
});

test('P0-2: Sheet not loaded makes peak UNKNOWN, not the starting balance', () => {
  // Input C.
  const vm = buildViewModel(inputs({ sheet: null }));
  noSectionErrors(vm);
  assert.ok(vm.account);
  assert.equal(vm.account.peak.known, false);
  assert.equal(vm.account.peak.text, 'UNKNOWN');
  assert.ok(!renderApp(vm).includes('$50,000.00'), 'starting balance shown as a known peak');
});

/**
 * Extract one data-live region / meter from rendered HTML.
 * @param {string} html
 * @param {string} marker attribute text that starts the region, e.g. 'data-meter="drawdown"'
 */
function region(html, marker) {
  const i = html.indexOf(marker);
  assert.ok(i >= 0, `missing ${marker}`);
  return html.slice(i, i + 1500);
}

test('P1-1: stale Sheet (refetch failed, last good kept) puts a STALE badge on meters, sizer and positions', () => {
  // /tmp/g3/vm_attacks.mjs #1: main.mjs keeps the last good data and sets `error`; last fetch 90 min ago.
  const base = inputs();
  const sheet = { ...sheetResult(sheetRaw()), error: 'network: Failed to fetch', fetchedAtMs: NOW - 90 * MIN };
  const vm = buildViewModel({ ...base, sheet });
  noSectionErrors(vm);
  assert.ok(vm.account && vm.sizer && vm.positions);
  for (const m of vm.account.meters) assert.match(m.badge ?? '', /STALE 1h 30m/, m.key);
  assert.match(vm.sizer.badge ?? '', /STALE 1h 30m/);
  assert.match(vm.sizer.available.badge ?? '', /STALE 1h 30m/);
  assert.match(vm.positions.badge ?? '', /STALE 1h 30m/);
  assert.match(vm.positions.std_equiv.badge ?? '', /STALE 1h 30m/);
  assert.match(vm.account.peak.badge ?? '', /STALE 1h 30m/);
  assert.match(vm.account.margin_used.badge ?? '', /STALE 1h 30m/);
  const html = renderApp(vm);
  for (const key of ['daily_loss', 'drawdown', 'margin']) assert.match(region(html, `data-meter="${key}"`), /STALE 1h 30m/, key);
  assert.match(region(html, 'data-live="sizer"'), /STALE 1h 30m/);
  assert.match(region(html, 'data-live="positions"'), /STALE 1h 30m/);
});

test('P1-1: stale-ish bars (partial) mark the meters and sizer when positions are open', () => {
  const base = inputs();
  const bars = { ...base.envs.bars, status: /** @type {const} */ ('partial'), errors: ['NQ failed'] };
  const vm = buildViewModel({ ...base, envs: { ...base.envs, bars: /** @type {any} */ (bars) } });
  noSectionErrors(vm);
  assert.ok(vm.account && vm.sizer);
  assert.match(vm.account.meters[0]?.badge ?? '', /bars.*PARTIAL/);
  assert.match(vm.sizer.badge ?? '', /bars.*PARTIAL/);
});

test('P1-1: all inputs fresh gives no badges on meters, sizer or positions', () => {
  const vm = buildViewModel(inputs());
  assert.ok(vm.account && vm.sizer && vm.positions);
  for (const m of vm.account.meters) assert.equal(m.badge, null, m.key);
  assert.equal(vm.sizer.badge, null);
  assert.equal(vm.positions.badge, null);
});

test('P0-2: complete Daily data still gives a known peak', () => {
  const vm = buildViewModel(inputs());
  assert.equal(vm.account?.peak.text, '$50,100.00');
  assert.equal(vm.account?.peak.known, true);
});
