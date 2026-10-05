// Gate-3 regression tests (.workflows/_shared/advice/G3-all.md). Each test reproduces one finding and pins
// the fixed behaviour. Inputs follow the probe scripts in /tmp/g3/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel, compareSettleRows } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { NOW, MIN, env, esBars, esz26, sheetRaw, sheetResult, inputs, noSectionErrors } from './fixtures.mjs';

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

/**
 * ES bars shifted into the past.
 * @param {number} shiftMs
 */
function esBarsShifted(shiftMs) {
  return esBars().map((b) => ({ ...b, t: new Date(Date.parse(b.t) - shiftMs).toISOString() }));
}

test('P1-4: fresh bars envelope but an ES series that ended 30h ago: mark STALE, open P&L UNKNOWN', () => {
  // /tmp/g3/vm_attacks.mjs #6.
  const base = inputs();
  const shifted = esBarsShifted(30 * 60 * MIN);
  const bars = env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: shifted } }, contracts: esz26(shifted) }, NOW - 30 * MIN);
  const vm = buildViewModel({ ...base, envs: { ...base.envs, bars } });
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions && vm.markets);
  assert.equal(vm.chips.find((c) => c.name === 'bars')?.state, 'fresh');
  const mark = vm.positions.rows[0]?.mark;
  assert.equal(mark?.text, '5801.25');
  assert.equal(mark?.badge, 'STALE 1d 6h'); // last bar closed 30h ago
  assert.equal(vm.positions.rows[0]?.pnl.text, 'UNKNOWN');
  assert.equal(vm.account.open.text, 'UNKNOWN');
  const es = vm.markets.find((m) => m.root === 'ES');
  assert.equal(es?.last.text, '5801.25');
  assert.equal(es?.last.badge, 'STALE 1d 6h');
  assert.match(es?.atr.badge ?? '', /^STALE/);
});

test('P1-4: per-root check passes for a series whose last bar closed within the bars policy', () => {
  const base = inputs();
  const shifted = esBarsShifted(60 * MIN);
  const bars = env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: shifted } }, contracts: esz26(shifted) }, NOW - 30 * MIN);
  const vm = buildViewModel({ ...base, envs: { ...base.envs, bars } });
  assert.equal(vm.positions?.rows[0]?.mark.badge, null);
  assert.notEqual(vm.account?.open.text, 'UNKNOWN');
});

test('P1-4: a root with no bars is UNKNOWN', () => {
  const base = inputs();
  const bars = env('bars', { roots: { NQ: { symbol: 'NQ.c.0', bars: esBars() } } }, NOW - 30 * MIN);
  const vm = buildViewModel({ ...base, envs: { ...base.envs, bars } });
  assert.equal(vm.positions?.rows[0]?.mark.text, 'UNKNOWN');
  assert.equal(vm.account?.open.text, 'UNKNOWN');
});

test('P1-5 / ADR-010: Markets last is labelled front-month continuous; position marks name their own contract', () => {
  const vm = buildViewModel(inputs());
  noSectionErrors(vm);
  const front = /front-month continuous \(\.c\.0\)/;
  const es = vm.markets?.find((m) => m.root === 'ES');
  assert.match(es?.last.note ?? '', front);
  const mark = vm.positions?.rows[0]?.mark.note ?? '';
  assert.match(mark, /^MESZ26 via ESZ26 \(ESZ6\) bar close/);
  assert.doesNotMatch(mark, front);
  assert.doesNotMatch(vm.account?.open.note ?? '', front);
  assert.equal(vm.positions?.rows[0]?.contract_text, 'MESZ26');
  const html = renderApp(vm);
  assert.match(region(html, 'data-live="positions"'), /ESZ26 \(ESZ6\) bar close/);
  assert.doesNotMatch(region(html, 'data-live="positions"'), front);
  assert.match(region(html, 'data-live="markets"'), front);
});

test('P1-7: the daily-loss meter states its assumed definition', () => {
  const vm = buildViewModel(inputs());
  const loss = vm.account?.meters.find((m) => m.key === 'daily_loss');
  const text = 'assumes loss = −(realized today + open P&L since entry); confirm against RULES.md';
  assert.ok(loss?.note.includes(text), loss?.note);
  assert.ok(renderApp(vm).includes('assumes loss = −(realized today + open P&amp;L since entry); confirm against RULES.md'));
});

test('P2-1: settlement comparator is a total order (root, trade_date desc, front contract first)', () => {
  const rows = [
    { root: 'ES', contract_code: 'ESH27', settle: 5850, trade_date: '2026-09-29' },
    { root: 'ES', contract_code: 'ESZ26', settle: 5799.5, trade_date: '2026-09-29' },
    { root: 'ES', contract_code: 'ESZ26', settle: 5790, trade_date: '2026-09-28' },
    { root: 'NQ', contract_code: 'NQZ26', settle: 20000, trade_date: '2026-09-29' },
    { root: 'ES', contract_code: 'ESZ27', settle: 5900, trade_date: '2026-09-29' },
  ];
  for (const a of rows) {
    assert.equal(compareSettleRows(a, a), 0);
    assert.equal(compareSettleRows(a, { ...a }), 0);
    for (const b of rows) assert.equal(Math.sign(compareSettleRows(a, b)), 0 - Math.sign(compareSettleRows(b, a)));
  }
  const sorted = [...rows].sort(compareSettleRows).map((r) => `${r.contract_code}@${r.trade_date}`);
  assert.deepEqual(sorted, ['ESZ26@2026-09-29', 'ESH27@2026-09-29', 'ESZ27@2026-09-29', 'ESZ26@2026-09-28', 'NQZ26@2026-09-29']);
  // The Markets "Settle" cell shows the front contract whatever the input order.
  for (const order of [rows.slice(0, 2), rows.slice(0, 2).reverse()]) {
    const base = inputs();
    const vm = buildViewModel({ ...base, envs: { ...base.envs, settlements: env('settlements', { rows: order }, NOW - 20 * 60 * MIN) } });
    const es = vm.markets?.find((m) => m.root === 'ES');
    assert.equal(es?.settle.text, '5799.50');
    assert.match(es?.settle.note ?? '', /^ESZ26/);
  }
});

test('P0-2: complete Daily data still gives a known peak', () => {
  const vm = buildViewModel(inputs());
  assert.equal(vm.account?.peak.text, '$50,100.00');
  assert.equal(vm.account?.peak.known, true);
});
