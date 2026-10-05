// ADR-010: open positions are marked only with their own contract's bars (bars.data.contracts), never the
// front-month continuous series. Expected values are hand-computed in the comments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildViewModel } from '../../../docs/js/ui/viewmodel.mjs';
import { renderApp } from '../../../docs/js/ui/render.mjs';
import { normalizeSheet } from '../../../docs/js/io/sheet.mjs';
import { NOW, MIN, env, esBars, esz26, sheetRaw, sheetResult, inputs, noSectionErrors } from './fixtures.mjs';

/**
 * 20 hourly HO bars on the 0.0001 grid, the last closing 30 min ago at `last`.
 * @param {number} last
 * @param {number} [shiftMs] move every bar this far into the past
 */
function hoBars(last, shiftMs = 0) {
  const bars = [];
  for (let i = 0; i < 20; i++) {
    const c = Math.round((last - (19 - i) * 0.0005) * 10000) / 10000;
    bars.push({ t: new Date(NOW - (20 - i) * 60 * MIN - shiftMs).toISOString(), o: c, h: c + 0.001, l: c - 0.001, c, v: 10 });
  }
  return bars;
}

/**
 * Bars envelope: the front-month HO series (HOX26) at 4.5624 plus the given exact-contract series.
 * @param {Record<string, unknown>} contracts
 */
function barsWith(contracts) {
  return env('bars', {
    roots: { ES: { symbol: 'ES.c.0', bars: esBars() }, HO: { symbol: 'HO.c.0', bars: hoBars(4.5624) } },
    aliases: { MES: 'ES' },
    cost_usd: 0.01,
    contracts,
  }, NOW - 30 * MIN);
}

const HOZ26 = { HOZ26: { root: 'HO', symbol: 'HO.c.1', raw_symbol: 'HOZ6', bars: hoBars(4.4) } };

/**
 * Sheet with one open HO long 2 @ 4.3875 (Ilan's real position) and nothing else.
 * @param {Record<string, unknown>} over  cell overrides for the HO row
 */
function hoSheet(over = {}) {
  const raw = sheetRaw();
  raw.tabs.Trades = [{
    id: 'H1', root: 'HO', side: 'long', qty: 2, entry: 4.3875, exit: '', entry_time: '2026-09-30T08:00:00-05:00',
    exit_time: '', fees_usd: 0, notes: '', contract: 'HOZ26', ...over,
  }];
  return sheetResult(raw);
}

/** @param {Partial<import('../../../docs/js/ui/viewmodel.mjs').VMInputs>} over */
function hoInputs(over = {}) {
  const base = inputs();
  return inputs({ envs: { ...base.envs, bars: barsWith(HOZ26) }, sheet: hoSheet(), ...over });
}

test('(a) a HOZ26 long is marked with the HOZ26 series (4.4000), not the HO front month (4.5624)', () => {
  // (4.4000 - 4.3875) / 0.0001 = 125 ticks; 125 x $4.20 x 2 = $1,050.00 (fees 0).
  // The front month would give (4.5624 - 4.3875) / 0.0001 = 1749 ticks x 4.20 x 2 = $14,691.60 (the phantom).
  const vm = buildViewModel(hoInputs());
  noSectionErrors(vm);
  const row = vm.positions?.rows[0];
  assert.equal(row?.contract_text, 'HOZ26');
  assert.equal(row?.mark.text, '4.4000');
  assert.equal(row?.mark.badge, null);
  assert.match(row?.mark.note ?? '', /^HOZ26 \(HOZ6\) bar close/);
  assert.equal(row?.pnl.text, '$1,050.00');
  assert.equal(vm.account?.open.text, '$1,050.00');
  // Markets still shows the front month for HO, labelled as such.
  const base = inputs();
  const withHo = buildViewModel(hoInputs({ settings: { ...base.settings, watched_roots: ['HO'] } }));
  assert.equal(withHo.markets?.[0]?.last.text, '4.5624');
  assert.match(withHo.markets?.[0]?.last.note ?? '', /HO\.c\.0 front-month continuous/);
});

test('(a) open P&L is net of the row fees, as the existing open/closed P&L is (tradePnlCents net_cents)', () => {
  // $1,050.00 gross - $5.00 fees = $1,045.00.
  const vm = buildViewModel(hoInputs({ sheet: hoSheet({ fees_usd: 5 }) }));
  assert.equal(vm.positions?.rows[0]?.pnl.text, '$1,045.00');
  assert.equal(vm.account?.open.text, '$1,045.00');
});

test('(b) no contract on the row: mark UNKNOWN with "add the contract", never the front month', () => {
  for (const contract of ['', '   ', undefined]) {
    const sheet = hoSheet({ contract });
    assert.deepEqual(sheet.rowErrors, [], 'a blank contract is not a row error');
    const vm = buildViewModel(hoInputs({ sheet }));
    noSectionErrors(vm);
    const row = vm.positions?.rows[0];
    assert.equal(row?.contract_text, 'HO ?');
    assert.equal(row?.mark.text, 'UNKNOWN');
    assert.match(row?.mark.note ?? '', /add the contract \(e\.g\. HOZ26\) to this Trades row/);
    assert.equal(row?.pnl.text, 'UNKNOWN');
    assert.equal(vm.account?.open.text, 'UNKNOWN');
    assert.match(vm.account?.open.note ?? '', /H1 \(HO\): .*add the contract/);
    assert.equal(vm.account?.equity.text, 'UNKNOWN');
    assert.equal(vm.sizer?.available.text, 'UNKNOWN');
    assert.equal(vm.account?.meters.find((m) => m.key === 'daily_loss')?.level, 'unknown');
    assert.ok(!renderApp(vm).includes('4.5624'), 'front-month price leaked into the page');
  }
});

test('(c) contract set but no series in bars.data.contracts: UNKNOWN with the coverage note', () => {
  const vm = buildViewModel(hoInputs({ sheet: hoSheet({ contract: 'HOF27' }) }));
  noSectionErrors(vm);
  const row = vm.positions?.rows[0];
  assert.equal(row?.mark.text, 'UNKNOWN');
  assert.match(row?.mark.note ?? '', /no bars for HOF27 \(bars cover the first 3 listed months\)/);
  assert.equal(vm.account?.open.text, 'UNKNOWN');
  assert.equal(vm.account?.equity.text, 'UNKNOWN');
  assert.equal(vm.account?.meters.find((m) => m.key === 'daily_loss')?.level, 'unknown');
  // An older envelope without `contracts` at all behaves the same.
  const base = inputs();
  const old = env('bars', { roots: { HO: { symbol: 'HO.c.0', bars: hoBars(4.5624) } }, aliases: {}, cost_usd: 0 }, NOW - 30 * MIN);
  const vm2 = buildViewModel(hoInputs({ envs: { ...base.envs, bars: old } }));
  assert.match(vm2.positions?.rows[0]?.mark.note ?? '', /no bars for HOZ26/);
  assert.equal(vm2.account?.open.text, 'UNKNOWN');
});

test('(d) contract/root mismatch is a row error and makes the open set UNKNOWN (G3 P0-1)', () => {
  const sheet = hoSheet({ root: 'CL' });
  assert.deepEqual(sheet.rowErrors, ['Trades row H1: contract HOZ26 does not match root CL']);
  const vm = buildViewModel(hoInputs({ sheet }));
  noSectionErrors(vm);
  assert.equal(vm.positions?.known, false);
  assert.match(vm.positions?.reason ?? '', /open positions UNKNOWN \(1 invalid Sheet row\)/);
  assert.equal(vm.account?.open.text, 'UNKNOWN');
  assert.equal(vm.account?.equity.text, 'UNKNOWN');
});

test('(e) a micro (MESZ26) is marked with the parent ESZ26 series', () => {
  // ESZ26 series = fixture ES bars shifted down 1.25 -> last close 5800.00; the front month stays at 5801.25.
  // O1 long 2 MES @ 5795: (5800.00 - 5795) / 0.25 = 20 ticks x $1.25 x 2 = $50.00 - $1.24 fees = $48.76.
  const base = inputs();
  const esz = esBars().map((b) => ({ ...b, o: b.o - 1.25, h: b.h - 1.25, l: b.l - 1.25, c: b.c - 1.25 }));
  const bars = env('bars', { roots: { ES: { symbol: 'ES.c.0', bars: esBars() } }, aliases: { MES: 'ES' }, cost_usd: 0.01, contracts: esz26(esz) }, NOW - 30 * MIN);
  const vm = buildViewModel({ ...base, envs: { ...base.envs, bars } });
  noSectionErrors(vm);
  const row = vm.positions?.rows[0];
  assert.equal(row?.contract_text, 'MESZ26');
  assert.equal(row?.mark.text, '5800.00');
  assert.match(row?.mark.note ?? '', /^MESZ26 via ESZ26 \(ESZ6\) bar close/);
  assert.equal(row?.pnl.text, '$48.76');
  assert.equal(vm.markets?.find((m) => m.root === 'ES')?.last.text, '5801.25');
});

test('(f) a stale contract series shows a STALE badge and leaves open P&L UNKNOWN', () => {
  // HOZ26 last bar opened 31h ago, closed 30h ago -> STALE 1d 6h; the envelope and HO front month are fresh.
  const base = inputs();
  const bars = barsWith({ HOZ26: { ...HOZ26.HOZ26, bars: hoBars(4.4, 30 * 60 * MIN) } });
  const vm = buildViewModel(hoInputs({ envs: { ...base.envs, bars } }));
  noSectionErrors(vm);
  assert.equal(vm.chips.find((c) => c.name === 'bars')?.state, 'fresh');
  const row = vm.positions?.rows[0];
  assert.equal(row?.mark.text, '4.4000');
  assert.equal(row?.mark.badge, 'STALE 1d 6h');
  assert.equal(row?.pnl.text, 'UNKNOWN');
  assert.match(row?.pnl.note ?? '', /HOZ26 bars STALE/);
  assert.equal(vm.account?.open.text, 'UNKNOWN');
  assert.match(renderApp(vm), /STALE 1d 6h/);
});

test('(g) normalizeSheet: contract is trimmed + uppercased, blank/absent is null, malformed is a row error', () => {
  const row = { root: 'HO', side: 'long', qty: 1, entry: 4.3875, exit: '', entry_time: '2026-09-30T08:00:00-05:00', exit_time: '', fees_usd: 0 };
  const r = normalizeSheet({
    schema_version: 1,
    tabs: {
      Trades: [
        { ...row, id: 'A', contract: ' hoz26 ' },
        { ...row, id: 'B', contract: '' },
        { ...row, id: 'C' },
        { ...row, id: 'D', contract: '  ' },
        { ...row, id: 'E', root: 'MES', entry: 5795, contract: 'mesz26' },
        { ...row, id: 'F', contract: 'HOZ6' },
        { ...row, id: 'G', root: 'MES', entry: 5795, contract: 'ESZ26' },
        { ...row, id: 'H', contract: 'HOA26' },
      ],
      Daily: [],
    },
  });
  assert.equal(r.error, null);
  assert.deepEqual(r.data?.trades.map((t) => [t.id, t.contract]), [['A', 'HOZ26'], ['B', null], ['C', null], ['D', null], ['E', 'MESZ26']]);
  assert.equal(r.rowErrors.length, 3);
  assert.match(r.rowErrors[0] ?? '', /^Trades row F: contract HOZ6 is not a contract code/);
  assert.equal(r.rowErrors[1], 'Trades row G: contract ESZ26 does not match root MES');
  assert.match(r.rowErrors[2] ?? '', /^Trades row H: contract HOA26 is not a contract code/);
});
