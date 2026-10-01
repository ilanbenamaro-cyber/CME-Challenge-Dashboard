// ADR-008 view-model tests: the 2026 CME Group University Trading Challenge rules
// (tests/golden/utc2026.json#rules_fixture). Expected values come from that golden file or are hand-computed
// in the comments; never from the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { validateRulesFile } from '../../../docs/js/io/data.mjs';
import { inputs, noSectionErrors, readJson, sheetResult, NOW, MIN } from './fixtures.mjs';

const GOLDEN = readJson('tests/golden/utc2026.json');
const UTC_JSON = { schema_version: 1, updated_at: 'fixture', source_doc: 'tests/golden/utc2026.json#rules_fixture', rules: GOLDEN.rules_fixture };
const UTC = validateRulesFile(UTC_JSON).rules;

/** Sizer form with a blank fee (the untouched default). */
const FORM_BLANK_FEE = { root: 'MES', risk_budget_usd: 500, stop_ticks: 32, fee_per_contract_usd: null, hold: /** @type {const} */ ('intraday') };

/**
 * Sheet result with the given rows, fetched one minute before `nowMs` (fresh).
 * @param {number} nowMs
 * @param {unknown[]} trades
 * @param {unknown[]} daily
 */
function sheetAt(nowMs, trades, daily) {
  const r = sheetResult({ schema_version: 1, generated_at: new Date(nowMs).toISOString(), tabs: { Trades: trades, Daily: daily, Margins: [] } });
  return { ...r, fetchedAtMs: nowMs - MIN };
}

/**
 * @param {number} nowMs
 * @param {unknown[]} trades
 * @param {unknown[]} daily
 * @param {Partial<import('../../../docs/js/ui/viewmodel.mjs').VMInputs>} [over]
 */
function utcAt(nowMs, trades, daily, over = {}) {
  return buildViewModel(inputs({ nowMs, rules: UTC, sheet: sheetAt(nowMs, trades, daily), sizerForm: FORM_BLANK_FEE, ...over }));
}

/** @param {import('../../../docs/js/ui/viewmodel.mjs').ViewModel} vm @param {string} key */
function meter(vm, key) {
  const m = vm.account?.meters.find((x) => x.key === key);
  assert.ok(m, `meter ${key} missing: ${JSON.stringify(vm.account?.meters.map((x) => x.key))}`);
  return m;
}

// A closed ES loser on Wed 2026-10-07: long 1 @ 5800 -> 5790 = 40 ticks * $12.50 = $500 + $5 fees = -$505.00.
const ES_LOSER_1007 = { id: 'L1', root: 'ES', side: 'long', qty: 1, entry: 5800, exit: 5790, entry_time: '2026-10-07T09:00:00-05:00', exit_time: '2026-10-07T09:30:00-05:00', fees_usd: 5, notes: '' };
// Wed 2026-10-07 10:00 CDT: trade date 2026-10-07, previous weekday 2026-10-06.
const WED_1007 = Date.parse('2026-10-07T15:00:00Z');

test('UTC: committed rules.json and the golden fixture validate without errors and keep applies', () => {
  const committed = validateRulesFile(readJson('docs/data/rules.json'));
  assert.deepEqual(committed.errors, []);
  assert.equal(committed.rules?.rules.max_drawdown_usd.applies, false);
  assert.equal(committed.rules?.rules.min_contracts_per_day?.value, 10);
  assert.deepEqual(validateRulesFile(UTC_JSON).errors, []);
  assert.deepEqual(UTC?.rules.flatten_dates?.value, ['2026-10-30']);
  assert.equal(UTC?.rules.allowed_roots.applies, false);
});

test('UTC: wrongly typed new keys and applies become null / dropped and are listed', () => {
  const { rules: rf, errors } = validateRulesFile({
    ...UTC_JSON,
    rules: {
      ...GOLDEN.rules_fixture,
      daily_loss_cap_pct: { value: 20, source: 'r' }, // > 1
      flatten_dates: { value: ['10/30/2026'], source: 'r' },
      min_contracts_per_day: { value: 9.5, source: 'r' },
      commission_per_side_usd: { value: '2.50', source: 'r' },
      max_drawdown_usd: { value: null, source: null, applies: 'no' },
    },
  });
  assert.ok(rf);
  for (const k of ['daily_loss_cap_pct', 'flatten_dates', 'min_contracts_per_day', 'commission_per_side_usd']) {
    assert.equal(/** @type {any} */ (rf.rules)[k].value, null, k);
    assert.ok(errors.some((e) => e.startsWith(`${k}:`)), `${k} not listed: ${errors.join(' | ')}`);
  }
  // A non-boolean applies is dropped, so the null drawdown rule is UNKNOWN (not silently "not a rule").
  assert.equal('applies' in rf.rules.max_drawdown_usd, false);
  assert.ok(errors.some((e) => e.startsWith('max_drawdown_usd.applies:')));
  const vm = buildViewModel(inputs({ rules: rf, ruleErrors: errors }));
  assert.ok(vm.rulesInfo.unknown.includes('max_drawdown_usd'));
  assert.ok(vm.rulesInfo.unknown.includes('min_contracts_per_day'));
});

test('UTC: not-applicable rules are never UNKNOWN (banner, drawdown, positions, sizer, allowed_roots)', () => {
  // Default fixture: Wed 2026-09-30 14:45 CDT, open MES long 2, Daily 2026-09-29 balance $50,100.
  const vm = buildViewModel(inputs({ rules: UTC, sizerForm: FORM_BLANK_FEE }));
  noSectionErrors(vm);
  assert.ok(!vm.banners.some((b) => b.kind === 'rules'), JSON.stringify(vm.banners.map((b) => b.title)));
  assert.deepEqual(vm.rulesInfo.unknown, []);
  // The five applies:false keys of the golden fixture.
  assert.deepEqual([...vm.rulesInfo.na].sort(), ['allowed_roots', 'daily_loss_cap_usd', 'max_contracts', 'max_drawdown_usd', 'micro_to_standard_ratio']);

  const dd = meter(vm, 'drawdown');
  assert.equal(dd.level, 'na');
  assert.equal(dd.note, 'No drawdown rule in this challenge');
  assert.equal(dd.fill, null);

  assert.ok(vm.positions);
  assert.equal(vm.positions.std_label, 'Contracts open');
  assert.equal(vm.positions.std_equiv.text, '2 contracts'); // O1: MES long 2
  assert.equal(vm.positions.std_equiv.level, null);
  assert.equal(vm.positions.std_equiv.note, 'no contract cap (margin-limited)');
  assert.ok(!vm.banners.some((b) => b.title === 'Contracts open'));

  assert.ok(vm.sizer);
  const max = vm.sizer.limits.find((l) => l.key === 'max_contracts');
  assert.deepEqual(max, { key: 'max_contracts', label: 'Max contracts', text: 'n/a (margin-limited)', binding: false });

  // allowed_roots does not apply: no root is flagged, whatever it is.
  assert.deepEqual(vm.positions.rows.map((r) => r.flags), [[]]);
  const cl = buildViewModel(inputs({ rules: UTC, sizerForm: { ...FORM_BLANK_FEE, root: 'CL' } }));
  assert.ok(!cl.sizer?.warnings.some((w) => /allowed_roots/.test(w)), JSON.stringify(cl.sizer?.warnings));

  const html = renderApp(vm);
  assert.match(html, /No drawdown rule in this challenge/);
  assert.match(html, /no contract cap \(margin-limited\)/);
  assert.match(html, /n\/a \(margin-limited\)/);
  assert.match(html, /data-meter="drawdown"[^>]*>[\s\S]*?lvl-na/);
  assert.doesNotMatch(html, /rules UNKNOWN/);

  // Sheet not loaded: max is still n/a, never UNKNOWN.
  const noSheet = buildViewModel(inputs({ rules: UTC, sheet: null, sizerForm: FORM_BLANK_FEE }));
  assert.equal(noSheet.positions?.std_label, 'Contracts open');
  assert.equal(noSheet.sizer?.limits.find((l) => l.key === 'max_contracts')?.text, 'n/a (margin-limited)');
  assert.equal(meter(noSheet, 'drawdown').level, 'na');
});

test('UTC: the daily loss cap is 20% of the prior Daily close', () => {
  // Daily 10-06 balance $998,765.43 = 99,876,543 cents -> golden pctCapCents: 19,975,308 cents = $199,753.08.
  const vm = utcAt(WED_1007, [ES_LOSER_1007], [
    { date: '2026-10-05', reported_pnl_usd: 500, reported_balance_usd: 1000500 },
    { date: '2026-10-06', reported_pnl_usd: -1734.57, reported_balance_usd: 998765.43 },
  ]);
  noSectionErrors(vm);
  const m = meter(vm, 'daily_loss');
  assert.equal(m.label, 'Daily loss vs 20% lock');
  assert.equal(m.level, 'ok');
  assert.equal(m.limit_text, '$199,753.08');
  assert.equal(m.used_text, '$505.00'); // realized -$505.00, flat
  assert.equal(m.remaining_text, '$199,248.08'); // 199,753.08 - 505.00
  assert.match(m.note, /^20% of prior close \$998,765\.43 = cap \$199,753\.08/);
  assert.match(m.note, /loss = −\(realized today \+ open P&L/);
});

test('UTC: no Daily rows yet -> cap on the starting balance, labelled', () => {
  // Mon 2026-10-05 10:00 CDT, first trade date. Golden: $1,000,000 x 0.2 = $200,000.00.
  const vm = utcAt(Date.parse('2026-10-05T15:00:00Z'), [], []);
  noSectionErrors(vm);
  const m = meter(vm, 'daily_loss');
  assert.equal(m.level, 'ok');
  assert.equal(m.limit_text, '$200,000.00');
  assert.equal(m.used_text, '$0.00');
  assert.match(m.note, /^20% of \$1,000,000\.00 \(starting balance; no Daily close yet\) = cap \$200,000\.00/);
});

test('UTC: practice-period Daily rows before the first trade date are ignored (balances reset)', () => {
  // RULES p6: "All account balances will reset before the live competition begins." A practice close of
  // $1,050,000 on Fri 2026-10-02 must not become the base on Mon 2026-10-05: base = $1,000,000, cap = $200,000.00.
  const practice = [{ date: '2026-10-02', reported_pnl_usd: 50000, reported_balance_usd: 1050000 }];
  const m = meter(utcAt(Date.parse('2026-10-05T15:00:00Z'), [], practice), 'daily_loss');
  assert.equal(m.limit_text, '$200,000.00');
  assert.match(m.note, /starting balance/);
  // From Tue 2026-10-06 the Mon 10-05 close ($990,000) is the base: 0.2 x 990,000 = $198,000.00.
  const live = [...practice, { date: '2026-10-05', reported_pnl_usd: -10000, reported_balance_usd: 990000 }];
  assert.equal(meter(utcAt(Date.parse('2026-10-06T15:00:00Z'), [], live), 'daily_loss').limit_text, '$198,000.00');
});

test('UTC: a missing prior close, a rejected Daily row or no Sheet make the cap UNKNOWN', () => {
  // Wed 10-07 with only a 10-05 close: the 10-06 close (previous weekday) is missing.
  const missing = utcAt(WED_1007, [ES_LOSER_1007], [{ date: '2026-10-05', reported_pnl_usd: 500, reported_balance_usd: 1000500 }]);
  noSectionErrors(missing);
  const m = meter(missing, 'daily_loss');
  assert.equal(m.level, 'unknown');
  assert.equal(m.limit_text, 'UNKNOWN');
  assert.equal(m.pct_text, 'UNKNOWN');
  assert.match(m.note, /Daily close for 2026-10-06 missing/);

  const bad = utcAt(WED_1007, [ES_LOSER_1007], [
    { date: '2026-10-06', reported_pnl_usd: 1, reported_balance_usd: 998765.43 },
    { date: '2026-10-05', reported_pnl_usd: 'abc', reported_balance_usd: 1000500 },
  ]);
  assert.equal(meter(bad, 'daily_loss').level, 'unknown');
  assert.match(meter(bad, 'daily_loss').note, /invalid Daily row/);

  const none = buildViewModel(inputs({ nowMs: WED_1007, rules: UTC, sheet: null }));
  assert.equal(meter(none, 'daily_loss').level, 'unknown');
  assert.equal(meter(none, 'daily_loss').limit_text, 'UNKNOWN');
  assert.ok(!renderApp(none).includes('$200,000.00'), 'no plausible cap without the Sheet');
});

test('UTC: contracts traded today — warn below 10, ok at 10, UNKNOWN on invalid rows or no Sheet', () => {
  const g = GOLDEN.contractsTradedOn;
  // Mon 2026-10-05 13:30 CDT: golden count for 2026-10-05 is 9 -> 1 more needed. Before 14:00 CT: no banner.
  const early = utcAt(Date.parse('2026-10-05T18:30:00Z'), g.trades, []);
  noSectionErrors(early);
  const m = meter(early, 'min_contracts');
  assert.equal(m.label, 'Contracts traded today');
  assert.equal(m.level, 'warn');
  assert.equal(m.pct_text, '9 / 10');
  assert.equal(m.remaining_text, '1');
  assert.match(m.note, /^1 more needed — \$1,000 penalty if under 10 by the close/);
  assert.ok(!early.banners.some((b) => b.title === 'Contracts traded today'));

  // 14:30 CDT the same day, inside the challenge window (10-05..10-30): amber banner.
  const late = utcAt(Date.parse('2026-10-05T19:30:00Z'), g.trades, []);
  const b = late.banners.find((x) => x.title === 'Contracts traded today');
  assert.ok(b, JSON.stringify(late.banners.map((x) => x.title)));
  assert.equal(b.level, 'warn');
  assert.match(b.message, /9 \/ 10 traded — 1 more needed/);

  // Default fixture: Wed 2026-09-30 14:45 CDT, before the challenge. C1 entry+exit 1+1, O1 entry 2 = 4 -> warn, no banner.
  const pre = buildViewModel(inputs({ rules: UTC }));
  assert.equal(meter(pre, 'min_contracts').pct_text, '4 / 10');
  assert.ok(!pre.banners.some((x) => x.title === 'Contracts traded today'));

  // One more contract on 10-05 (entry 10:30 CDT) -> 10 -> ok.
  const extra = { id: 'E', root: 'ES', side: 'long', qty: 1, entry: 5800, exit: null, entry_time: '2026-10-05T10:30:00-05:00', exit_time: null, fees_usd: 2.5 };
  const ok = utcAt(Date.parse('2026-10-05T19:30:00Z'), [...g.trades, extra], []);
  assert.equal(meter(ok, 'min_contracts').level, 'ok');
  assert.equal(meter(ok, 'min_contracts').pct_text, '10 / 10');
  assert.ok(!ok.banners.some((x) => x.title === 'Contracts traded today'));

  // An invalid Trades row could be a trade today: UNKNOWN, never a count.
  const badRow = { id: 'BAD', root: 'ES', side: 'long', qty: 'two', entry: 5800, exit: null, entry_time: '2026-10-05T10:30:00-05:00', exit_time: null, fees_usd: 0 };
  const invalid = utcAt(Date.parse('2026-10-05T19:30:00Z'), [...g.trades, badRow], []);
  const u = meter(invalid, 'min_contracts');
  assert.equal(u.level, 'unknown');
  assert.equal(u.pct_text, 'UNKNOWN');
  assert.equal(u.used_text, 'UNKNOWN');
  assert.match(u.note, /1 invalid Trades row/);
  assert.ok(!invalid.banners.some((x) => x.title === 'Contracts traded today'));

  const noSheet = buildViewModel(inputs({ rules: UTC, sheet: null }));
  assert.equal(meter(noSheet, 'min_contracts').level, 'unknown');
  assert.match(renderApp(noSheet), /data-meter="min_contracts"/);
});

test('UTC: a blank sizer fee defaults to 2 x the $2.50/side commission', () => {
  // MES: 32 ticks * $1.25 = $40 + $5.00 fee = $45.00/contract -> floor($500 / $45) = 11 (golden Z3: 4500 cents, 11).
  // Margin: equity 1,000,000 + 49.38 + 61.26 = 1,000,110.64; in use: CME MES initial 1,650 * 1 * 2 = 3,300;
  // available 996,810.64 / 1,650 = 604.1 -> 604.
  const vm = buildViewModel(inputs({ rules: UTC, sizerForm: FORM_BLANK_FEE }));
  noSectionErrors(vm);
  assert.ok(vm.sizer);
  assert.equal(vm.sizer.fee_note, 'fee defaulted from $2.50/side commission ($5.00 round trip)');
  assert.equal(vm.sizer.per_contract_risk_text, '$45.00');
  assert.equal(vm.sizer.contracts_text, '11');
  assert.deepEqual(vm.sizer.limits.map((l) => [l.key, l.text, l.binding]), [['risk', '11', true], ['margin', '604', false], ['max_contracts', 'n/a (margin-limited)', false]]);
  assert.match(renderApp(vm), /fee defaulted from \$2\.50\/side commission/);
  // A typed fee (even 0) wins and there is no note: $40.00/contract -> 12.
  const typed = buildViewModel(inputs({ rules: UTC, sizerForm: { ...FORM_BLANK_FEE, fee_per_contract_usd: 0 } }));
  assert.equal(typed.sizer?.fee_note, '');
  assert.equal(typed.sizer?.per_contract_risk_text, '$40.00');
  assert.equal(typed.sizer?.contracts_text, '12');
});

test('UTC: flatten is a calm info line except on 2026-10-30, where it counts down', () => {
  const vm = buildViewModel(inputs({ rules: UTC }));
  const f = vm.banners.find((b) => b.kind === 'flatten');
  assert.equal(f?.level, 'ok');
  assert.equal(f?.message, 'No flatten required today (final-day flatten by 15:45 CT on 2026-10-30)');
  const html = renderApp(vm);
  assert.match(html, /class="infoline"[\s\S]*No flatten required today/);
  assert.doesNotMatch(html, /banner-flatten/);
  // Positions UNKNOWN (no Sheet) does not turn the non-flatten day into an UNKNOWN banner.
  const noSheet = buildViewModel(inputs({ rules: UTC, sheet: null }));
  assert.equal(noSheet.banners.find((b) => b.kind === 'flatten')?.level, 'ok');

  // Fri 2026-10-30 with the open MES position: golden 20:00Z = 15:00 CDT -> 45 min, ok; 20:15Z -> 30 min, warn.
  const at1500 = buildViewModel(inputs({ rules: UTC, nowMs: Date.parse('2026-10-30T20:00:00Z') }));
  const f1 = at1500.banners.find((b) => b.kind === 'flatten');
  assert.equal(f1?.level, 'ok');
  assert.match(f1?.message ?? '', /Flatten by 15:45 CT — 45 min left/);
  const at1515 = buildViewModel(inputs({ rules: UTC, nowMs: Date.parse('2026-10-30T20:15:00Z') }));
  const f2 = at1515.banners.find((b) => b.kind === 'flatten');
  assert.equal(f2?.level, 'warn');
  assert.match(f2?.message ?? '', /30 min left with open positions/);
  assert.equal(at1515.banners[0]?.kind, 'flatten');
  assert.ok(NOW < Date.parse('2026-10-30T00:00:00Z'));
});
