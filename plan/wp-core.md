# WP-CORE: pure logic

Branch `feat/core`.

## Owned paths
- `docs/js/core/*.mjs` **except** `types.mjs` (frozen, planner-owned)
- `tests/js/core/**`

## Forbidden
Everything else. In particular: `tests/golden/**` (read-only), `tests/boundary/**`, `docs/js/core/types.mjs`,
`docs/data/**`, `jobs/**`, `docs/js/io|ui/**`.

## Inputs
- Signatures and behaviour contracts: the JSDoc on each stub in `docs/js/core/`. Implement bodies **without
  changing exported names, parameter order, or return shapes**. You may add private helpers and extra
  exported helpers, and import between core modules.
- Types: `docs/js/core/types.mjs`.
- Expected values: `tests/golden/{pnl,sizer,compliance,freshness,expiry,flatten,book,atr,format,margin,contracts}.json`.
  Tests must load these JSON files and assert against them. Never compute expected values with the code under test.
- Contract specs for tests: `docs/data/contracts.json`.

## Constraints
- No DOM, no `fetch`, no `localStorage`, no `Date.now()` inside core (time is always a parameter).
- Integer cents and integer ticks (D11). `priceToTicks` tolerance 1e-6 ticks.
- Time zone via `Intl.DateTimeFormat('en-US', {timeZone: 'America/Chicago', ...})`. No hard-coded offsets.
  `ctWallToMs` must be DST-correct (try the two candidate offsets, -05:00 and -06:00, and pick the one whose
  CT wall clock round-trips).
- Unknown propagates: any null input or unknown rule makes the dependent output null/`unknown`, never 0.
- `tsc --checkJs --strict` clean.

## Tests to write (node:test, `tests/js/core/*.test.mjs`)
One test file per module. Every case in each golden file, plus the error cases (`assert.throws`). Also
property-style checks where cheap: short/long symmetry in P&L, `addDays`/`daysBetween` round-trip across DST
and month/year ends, and `tradeDate` for every hour of a DST-transition day (2026-11-01).

## Gate commands
```
npm run typecheck
node --test "tests/js/core/**/*.test.mjs"
```

## Acceptance items
A1, A2, A3, the core part of A4 (classifyFreshness), A5 (nextExpiration/expiryBanner), A6 (flattenBanner),
the core part of A8 (tradeDate/dailyNetByTradeDate/reconcile), and A12 (typecheck + tests).
