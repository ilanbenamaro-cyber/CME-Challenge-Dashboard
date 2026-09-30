// Gate-3 regression tests (.workflows/_shared/advice/G3-all.md). Each test reproduces one finding and pins
// the fixed behaviour. Inputs follow the probe scripts in /tmp/g3/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { sheetRaw, sheetResult, inputs, noSectionErrors } from './fixtures.mjs';

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
