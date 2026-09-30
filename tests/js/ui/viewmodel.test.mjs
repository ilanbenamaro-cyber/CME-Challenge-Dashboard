// WP-UI view-model and render tests. They compose real core, so they pass once WP-CORE is merged
// (against the G1 stubs they fail with "not implemented"). Expected values are hand-computed below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp, renderFatal, BUILD_ID } from '../../../docs/js/ui/render.mjs';
import { normalizeSheet } from '../../../docs/js/io/sheet.mjs';
import { defaultSettings } from '../../../docs/js/io/settings.mjs';
import { parseContractsFile, parseRulesFile } from '../../../docs/js/io/data.mjs';

const ROOT = new URL('../../../', import.meta.url);
/** @param {string} p */
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

const CONTRACTS = parseContractsFile(readJson('docs/data/contracts.json'));
const RULES_COMMITTED = parseRulesFile(readJson('docs/data/rules.json')); // every value null
const FIXTURE_RULES = parseRulesFile({
  schema_version: 1,
  updated_at: 'fixture',
  source_doc: 'tests/golden/sizer.json#rules_fixture',
  rules: readJson('tests/golden/sizer.json').rules_fixture,
});
const CALENDAR = readJson('docs/data/calendar.json');

// Wed 2026-09-30 14:45 CDT (19:45Z): 25 min before the fixture flatten time 15:10 CT.
const NOW = Date.parse('2026-09-30T19:45:00Z');
const MIN = 60000;
const SHEET_URL = 'https://script.google.com/macros/s/TESTID/exec';

/**
 * @param {string} dataset
 * @param {unknown} data
 * @param {number} asOfMs
 * @param {'ok'|'partial'|'error'} [status]
 */
function env(dataset, data, asOfMs, status = 'ok') {
  const iso = new Date(asOfMs).toISOString();
  return { schema_version: 1, dataset, generated_at: iso, data_as_of: iso, source: `test:${dataset}`, status, errors: status === 'ok' ? [] : ['fixture error'], data };
}

/** 20 hourly ES bars on the 0.25 grid, last close 5801.25. */
function esBars() {
  const bars = [];
  for (let i = 0; i < 20; i++) {
    const c = 5790 + i * 0.5 + (i === 19 ? 1.75 : 0);
    bars.push({ t: new Date(NOW - (20 - i) * 60 * MIN).toISOString(), o: c - 0.5, h: c + 1, l: c - 1.5, c, v: 100 });
  }
  return bars;
}

/** @param {number} asOfMs */
function barsEnv(asOfMs) {
  return env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: esBars() } }, aliases: { MES: 'ES' }, cost_usd: 0.01 }, asOfMs);
}

const CME_MARGINS = { rows: [
  { root: 'ES', initial_usd: 16500, maintenance_usd: 15000, as_of: '2026-09-29' },
  { root: 'MES', initial_usd: 1650, maintenance_usd: 1500, as_of: '2026-09-29' },
] };

/** Sheet rows: one closed MES short today (+$49.38 net) and one open MES long 2 @ 5795. */
function sheetRaw(extraTrades = /** @type {unknown[]} */ ([]), notes = 'ok') {
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
function sheetResult(raw) {
  const n = normalizeSheet(raw);
  return { ...n, fetchedAtMs: NOW - MIN };
}

/**
 * @param {Partial<import('../../../docs/js/ui/viewmodel.mjs').VMInputs>} over
 * @returns {import('../../../docs/js/ui/viewmodel.mjs').VMInputs}
 */
function inputs(over = {}) {
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
function noSectionErrors(vm) {
  assert.deepEqual(vm.sectionErrors, {}, 'a panel failed to build');
}

test('baseline: fresh data, known rules — P&L, meters and sizer are computed', () => {
  const vm = buildViewModel(inputs());
  noSectionErrors(vm);
  assert.ok(vm.account);
  // C1: short 5800 -> 5790 = 40 ticks * $1.25 = $50.00 - $0.62 fees = $49.38.
  assert.equal(vm.account.realized.text, '$49.38');
  // O1: long 2 @ 5795.00 marked at 5801.25 = 25 ticks * $1.25 * 2 = $62.50 - $1.24 fees = $61.26.
  assert.equal(vm.account.open.text, '$61.26');
  // Equity = 50,000 + 49.38 + 61.26 = 50,110.64. Peak = max(50,000, Daily EOD 50,100) = 50,100.
  assert.equal(vm.account.equity.text, '$50,110.64');
  assert.equal(vm.account.peak.text, '$50,100.00');
  // Margin in use: CME MES maintenance $1,500 * 0.25 (intraday) * 2 = $750.00.
  assert.equal(vm.account.margin_used.text, '$750.00');
  const [loss, dd, mm] = vm.account.meters;
  assert.equal(loss?.level, 'ok');
  assert.equal(loss?.used_text, '$0.00');
  assert.equal(dd?.level, 'ok');
  assert.match(dd?.note ?? '', /assumes EOD trailing/);
  assert.equal(mm?.level, 'ok');

  assert.ok(vm.positions);
  assert.equal(vm.positions.rows.length, 1);
  assert.equal(vm.positions.rows[0]?.mark.text, '5801.25');
  assert.equal(vm.positions.rows[0]?.mark.badge, null);
  assert.equal(vm.positions.std_equiv.text, '0.2 / 5'); // 2 MES / 10

  // Sizer: MES, $500 risk, 32 ticks -> $40/contract -> 12; margin: avail 50,110.64 - 750 = 49,360.64
  // / (1,500 * 0.25 = 375) = 131; max 5 * 10 = 50 -> 12 bound by risk. CME margin is fresh -> source CME.
  assert.ok(vm.sizer);
  assert.equal(vm.sizer.status, 'ok');
  assert.equal(vm.sizer.contracts_text, '12');
  assert.deepEqual(vm.sizer.limits.map((l) => [l.key, l.text, l.binding]), [['risk', '12', true], ['margin', '131', false], ['max_contracts', '50', false]]);
  assert.equal(vm.sizer.margin.text, '$1,500.00');
  assert.match(vm.sizer.margin.note, /^CME maintenance/);
  assert.equal(vm.sizer.per_contract_risk_text, '$40.00');
  assert.match(vm.sizer.atr.text, /ticks$/);

  // Flatten 15:10 CT with an open position, 25 min left -> warn, first banner.
  assert.equal(vm.banners[0]?.kind, 'flatten');
  assert.equal(vm.banners[0]?.level, 'warn');
  assert.ok(!vm.banners.some((b) => b.kind === 'rules'));
  assert.ok(vm.chips.every((c) => c.state === 'fresh'), JSON.stringify(vm.chips));

  // Reconciliation: 09-29 reported $100 vs computed 0 -> warn; 09-30 computed $49.38 with no report -> unknown.
  assert.ok(vm.recon && vm.recon.known);
  assert.deepEqual(vm.recon.rows.map((r) => [r.date, r.level]), [['2026-09-30', 'unknown'], ['2026-09-29', 'warn']]);
  assert.equal(vm.recon.challenge_shown, true);
  assert.equal(vm.recon.rows[1]?.challenge?.rank_text, '#12');

  // Calendar: next FOMC event and computed ES expiry.
  assert.ok(vm.calendar && vm.calendar.events);
  assert.equal(vm.calendar.events[0]?.date, '2026-10-28');
  assert.deepEqual(vm.calendar.expirations.find((x) => x.root === 'ES'), {
    root: 'ES', level: 'ok', contract_text: 'ESZ26', date_text: 'Fri 2026-12-18', days_text: '79d', source: 'computed: third Friday (holiday-unadjusted)',
  });
});

test('all rules UNKNOWN (committed rules.json): sizer and meters UNKNOWN with the rules banner', () => {
  const vm = buildViewModel(inputs({ rules: RULES_COMMITTED }));
  noSectionErrors(vm);
  assert.ok(vm.account && vm.sizer);
  for (const m of vm.account.meters) {
    assert.equal(m.level, 'unknown', m.key);
    assert.equal(m.pct_text, 'UNKNOWN', m.key);
    assert.equal(m.fill, null, m.key);
  }
  assert.equal(vm.account.equity.text, 'UNKNOWN');
  assert.equal(vm.sizer.status, 'unknown');
  assert.equal(vm.sizer.contracts_text, 'UNKNOWN');
  assert.ok(vm.sizer.reasons.length > 0);
  const rules = vm.banners.find((b) => b.kind === 'rules');
  assert.ok(rules, 'rules banner');
  assert.match(rules.message, /^11 rules UNKNOWN — fill plan\/RULES\.md → rules\.json/);
  assert.equal(vm.rulesInfo.unknown.length, 11);
  const flatten = vm.banners.find((b) => b.kind === 'flatten');
  assert.equal(flatten?.level, 'unknown');
  const html = renderApp(vm);
  assert.match(html, /data-contracts="UNKNOWN"/);
});

test('no Sheet configured: positions, P&L and reconciliation UNKNOWN, never $0.00', () => {
  const vm = buildViewModel(inputs({ sheet: null, settings: defaultSettings() }));
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions && vm.recon);
  assert.equal(vm.account.realized.text, 'UNKNOWN');
  assert.equal(vm.account.open.text, 'UNKNOWN');
  assert.equal(vm.account.margin_used.text, 'UNKNOWN');
  assert.equal(vm.positions.known, false);
  assert.equal(vm.recon.known, false);
  assert.equal(vm.chips.find((c) => c.name === 'sheet')?.state, 'missing');
  assert.ok(vm.banners.some((b) => b.kind === 'data' && b.title.startsWith('Sheet')));
  // Positions unknown: the flatten warning is shown as UNKNOWN, not as a false "flat".
  const f = vm.banners.find((b) => b.kind === 'flatten');
  assert.equal(f?.level, 'unknown');
  assert.match(f?.message ?? '', /open positions UNKNOWN/);
});

test('bars missing: open P&L UNKNOWN, mark UNKNOWN', () => {
  const i = inputs();
  const vm = buildViewModel({ ...i, envs: { ...i.envs, bars: null } });
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions);
  assert.equal(vm.account.open.text, 'UNKNOWN');
  assert.equal(vm.account.realized.text, '$49.38'); // realized does not need marks
  assert.equal(vm.account.meters[0]?.level, 'unknown');
  assert.equal(vm.positions.rows[0]?.mark.text, 'UNKNOWN');
  assert.equal(vm.positions.rows[0]?.pnl.text, 'UNKNOWN');
  assert.equal(vm.chips.find((c) => c.name === 'bars')?.state, 'missing');
  assert.ok(vm.banners.some((b) => b.kind === 'data' && b.title === 'bars MISSING' && b.level === 'unknown'));
});

test('bars stale: mark shown with a STALE flag, open P&L UNKNOWN', () => {
  const i = inputs();
  const vm = buildViewModel({ ...i, envs: { ...i.envs, bars: barsEnv(NOW - 245 * MIN) } });
  noSectionErrors(vm);
  assert.ok(vm.account && vm.positions && vm.markets);
  const mark = vm.positions.rows[0]?.mark;
  assert.equal(mark?.text, '5801.25');
  assert.equal(mark?.badge, 'STALE 4h 5m');
  assert.equal(vm.positions.rows[0]?.pnl.text, 'UNKNOWN');
  assert.equal(vm.account.open.text, 'UNKNOWN');
  const es = vm.markets.find((m) => m.root === 'ES');
  assert.equal(es?.last.text, '5801.25');
  assert.equal(es?.last.badge, 'STALE 4h 5m');
  const b = vm.banners.find((x) => x.kind === 'data' && x.title === 'bars STALE');
  assert.equal(b?.level, 'warn');
  assert.ok(renderApp(vm).includes('STALE 4h 5m'));
});

test('margins env error + Sheet Margins: sizer uses the Sheet with source "sheet"', () => {
  const i = inputs();
  const vm = buildViewModel({ ...i, envs: { ...i.envs, margins: env('margins', CME_MARGINS, NOW - 20 * 60 * MIN, 'error') } });
  noSectionErrors(vm);
  assert.ok(vm.sizer && vm.account);
  assert.equal(vm.chips.find((c) => c.name === 'margins')?.state, 'error');
  assert.equal(vm.sizer.margin.text, '$1,200.00'); // Sheet MES maintenance, not CME $1,500
  assert.equal(vm.sizer.margin.badge, 'SHEET');
  assert.match(vm.sizer.margin.note, /^Sheet maintenance · as of 2026-09-28/);
  // Margin in use: 1,200 * 0.25 * 2 = 600. Available 50,110.64 - 600 = 49,510.64 / 300 = 165.
  assert.equal(vm.account.margin_used.text, '$600.00');
  assert.equal(vm.sizer.limits[1]?.text, '165');
  assert.equal(vm.sizer.contracts_text, '12');
  // ES has no Sheet override -> UNKNOWN in markets.
  assert.equal(vm.markets?.find((m) => m.root === 'ES')?.margin.text, 'UNKNOWN');
});

test('invalid Trades row: today\'s P&L UNKNOWN plus the Sheet row banner', () => {
  const vm = buildViewModel(inputs({ sheet: sheetResult(sheetRaw([
    { id: 'BAD1', root: 'MES', side: 'long', qty: 'two', entry: 5800, exit: 5801, entry_time: '2026-09-30T09:00:00-05:00', exit_time: '2026-09-30T10:00:00-05:00', fees_usd: 0 },
  ])) }));
  noSectionErrors(vm);
  assert.ok(vm.account);
  assert.equal(vm.account.realized.text, 'UNKNOWN');
  assert.match(vm.account.realized.note, /invalid Trades row/);
  assert.equal(vm.account.meters[0]?.level, 'unknown');
  const b = vm.banners.find((x) => x.kind === 'sheet');
  assert.ok(b);
  assert.equal(b.level, 'warn');
  assert.match(b.message, /today's P&L is UNKNOWN/);
  assert.ok(b.details.some((d) => d.includes('BAD1')));
  assert.equal(vm.chips.find((c) => c.name === 'sheet')?.state, 'partial');
});

test('flatten breach with an open position is the first, red banner', () => {
  const vm = buildViewModel(inputs({ nowMs: Date.parse('2026-09-30T20:30:00Z') })); // 15:30 CDT
  noSectionErrors(vm);
  const b = vm.banners[0];
  assert.equal(b?.kind, 'flatten');
  assert.equal(b?.level, 'breach');
  assert.equal(b?.title, 'FLATTEN NOW');
  assert.ok(renderApp(vm).includes('banner-breach banner-flatten'));
});

test('flatten with no open positions stays ok', () => {
  const raw = sheetRaw();
  raw.tabs.Trades = raw.tabs.Trades.slice(0, 1);
  const vm = buildViewModel(inputs({ nowMs: Date.parse('2026-09-30T20:30:00Z'), sheet: sheetResult(raw) }));
  assert.equal(vm.banners.find((b) => b.kind === 'flatten')?.level, 'ok');
});

test('daily loss at 93% of the cap raises an amber limit banner', () => {
  const loser = { id: 'L1', root: 'ES', side: 'long', qty: 3, entry: 5800, exit: 5790, entry_time: '2026-09-30T09:00:00-05:00', exit_time: '2026-09-30T10:00:00-05:00', fees_usd: 0 };
  // 40 ticks * $12.50 * 3 = -$1,500.00; plus C1 +49.38 and O1 +61.26 -> loss $1,389.36 of $1,500 = 93% -> warn.
  const vm = buildViewModel(inputs({ sheet: sheetResult(sheetRaw([loser])) }));
  noSectionErrors(vm);
  const loss = vm.account?.meters[0];
  assert.equal(loss?.level, 'warn');
  assert.equal(loss?.used_text, '$1,389.36');
  assert.equal(loss?.pct_text, '93%');
  assert.ok(vm.banners.some((b) => b.kind === 'limit' && b.level === 'warn' && b.title === 'Daily loss vs cap'));
});

test('sizer form input problems give UNKNOWN with reasons, never a number', () => {
  const vm = buildViewModel(inputs({ sizerForm: { root: 'MES', risk_budget_usd: null, stop_ticks: 2.5, fee_per_contract_usd: null, hold: 'weekend' } }));
  noSectionErrors(vm);
  assert.ok(vm.sizer);
  assert.equal(vm.sizer.contracts_text, 'UNKNOWN');
  assert.equal(vm.sizer.reasons.length, 3);
});

test('renderApp escapes <script> and markup in Sheet notes and ids', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const vm = buildViewModel(inputs({ sheet: sheetResult(sheetRaw([], evil)) }));
  noSectionErrors(vm);
  const html = renderApp(vm);
  assert.ok(!html.includes('<script>alert(1)'), 'raw script tag rendered');
  assert.ok(!html.includes('<img src=x'), 'raw img tag rendered');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;'));
  assert.ok(html.includes(`data-build="${BUILD_ID}"`));
  assert.ok(!/\sstyle=/.test(html), 'inline style attribute (blocked by CSP)');
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/&lt;img src=x onerror=alert\(2\)&gt;/g, '')), 'inline handler');
});

test('renderFatal shows a visible error panel with escaped text', () => {
  const html = renderFatal(new Error('boom <b>x</b>'));
  assert.match(html, /Dashboard error/);
  assert.match(html, /boom &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /data-fatal="1"/);
});
