# Outbox

## Phase 0 recon — 2026-09-30 (build session, sandboxed)

### Facts
- `www.cmegroup.com:443` → CONNECT refused by the build sandbox egress proxy (403, org policy). No HTTP status,
  content-type, rendering mode, robots.txt or terms stance could be observed for the margins, settlements or
  challenge pages.
- Databento Python client 0.87.0 (PyPI) signatures, checked by introspection:
  - `Historical(key=None, gateway=...)`
  - `metadata.get_cost(dataset, start, end=None, mode=..., symbols=None, schema='trades', stype_in='raw_symbol', limit=None) -> float`
  - `timeseries.get_range(dataset, start, end=None, symbols=None, schema='trades', stype_in='raw_symbol', stype_out='instrument_id', limit=None, path=None) -> DBNStore`
- PyPI, npm reachable.

### Unknowns (need a run from an unrestricted network or GitHub Actions)
- All three CME pages: server-rendered vs JS, login wall, robots/terms, table structure.
- Projected Databento cost: `get_cost` requires `DATABENTO_API_KEY`, which is not available in the build session.
  Planned request per hourly run: 4 parent roots × ohlcv-1h × 3 days lookback → expected well under $0.01, UNVERIFIED.
- GitHub Actions cron limits: minimum 5-minute interval, best-effort timing (known; not re-verified via docs here).

### Plan consequence
CME scrapers are written against configurable URLs with defensive parsers and must fail closed (status:error,
last good data kept). The Sheet `Margins` tab is the manual fallback for margins. See PLAN.md risk R1.

## WP-UI task report — 2026-09-30
Branch / commits: `feat/ui` (not pushed, not merged). bcd8587 index.html+CSP+.nojekyll · 0d0d953 io layer · c91cc6e view model +
renderer · aa9e396 main.mjs + CSS · 00aa066 mobile layout fixes · 6102590 e2e smoke · (this report).
Gate commands run + actual result lines:
- `npx tsc -p tsconfig.json` → clean (exit 0).
- On feat/ui as committed (core = G1 stubs): `node --test "tests/js/ui/**/*.test.mjs" "tests/boundary/**/*.test.mjs"` → `# pass 15 / # fail 14`.
  12 ui failures are only `error: 'not implemented'` from core stubs. Boundary #4 (CSP) fails only because of the planner regex
  bug fixed in ff743fb, which is not merged here (see below). Boundary #6 (refresh.yml) is WP-JOBS's.
- The same tree in a scratch copy with the REAL core from bb2aae1 plus the fixed boundary test from ff743fb:
  ui tests `# pass 23 / # fail 0`. Boundary `# pass 5 / # fail 1` (only #6 refresh.yml). `node tests/e2e/smoke.mjs` → `ALL CHECKS PASSED`
  (5 scenarios: iPhone committed-data, iPhone live fixtures light+dark, desktop 1280, injected core failure → error panel).
  The ui tests were also green against an independent temporary core shim (scratch only, 159/159 golden checks, never committed).
- e2e on feat/ui with stubs: the page shows the "Dashboard error" panel (robustness path works). Panel checks fail until core merges.
Acceptance items covered (A#): A4 (six freshness chips, per-dataset data banners, STALE badges / UNKNOWN), A5 (expiry banners for
open ∪ watched roots, UNKNOWN for manual roots, warn-days setting), A6 (flatten countdown banner, red with open positions,
UNKNOWN when the rule is null or positions are unknown), A7 (next 3 events + next expiration per watched root), A8 (reconciliation
table + challenge column group when fresh), A11 (CSP as specified, fetch/localStorage only in docs/js/io, no inline script/style/
handlers, all dynamic text escaped, XSS e2e), A13 (390px, scrollWidth <= innerWidth asserted), UI part of A12 (tsc strict clean).
Deviations from plan / ADR requests:
- ADR request (CSP): `frame-ancestors` is ignored inside a `<meta>` CSP (Chromium logs a console error saying so). The CSP is kept exactly
  as specified. The smoke test allow-lists that single message. GitHub Pages cannot set headers, so there is no clickjacking protection.
  Suggest dropping `frame-ancestors` from the pinned meta, or accepting the risk explicitly.
- Could not `git merge --no-ff claude/pensive-pasteur-2mqzhm` (the boundary fix and the core): the merge was denied by the session
  permission policy. The coordinator or a human must merge it into feat/ui (or merge feat/ui after it). No conflicts expected: feat/ui does
  not touch core/tests/boundary. It adds docs/index.html and docs/.nojekyll, which the integration branch does not have.
- Additive, not in the spec: VMInputs gained optional `loadErrors` and `loadedAtMs`. The view model also raises red/amber "limit" banners
  for meters at warn/breach, positions above max_contracts, and roots outside allowed_roots. The sizer form is persisted in
  localStorage (io/settings.mjs). A Sheet row with blank fees_usd is invalid (never 0). Trades times must carry Z or an offset (matches core).
- Margin meter = margin in use vs equity (PLAN §6 #4). Sizer available margin = equity − margin in use, clamped at 0 before sizePosition.
- With the Sheet unavailable, the flatten banner shows level `unknown` ("open positions UNKNOWN"), neither a false "flat ok" nor a red alarm.
Known gaps / risks:
- Apps Script fetch was verified only against a Playwright-intercepted fixture, never against a real deployment (R8).
- The iPhone visual gate belongs to Ilan. Screenshots come from the e2e run (tests/e2e/out/, gitignored).
- `reconcile` 'unknown' date rows render as "UNKNOWN DATE" at warn level. io rejects unparsable times, so they should not occur.
