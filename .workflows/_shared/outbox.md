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

## WP-CORE task report — 2026-09-30
Branch / commits: `worktree-agent-a59fe4fa5ce6d4912` (plan names `feat/core`; the worktree branch was kept, not renamed).
d6e0f3c money + time; 5fa3c45 rules, contracts, format, margin, atr; 1afc550 sizer + compliance;
e72c3e2 freshness, expiry, flatten, book; plus this report commit. Not pushed, not merged.
Gate commands run + actual result lines:
- `npx tsc -p tsconfig.json` → no output, exit 0
- `node --test "tests/js/core/**/*.test.mjs"` → `# tests 182` / `# pass 182` / `# fail 0`
- (info) `node --test tests/boundary/boundary.test.mjs` → pass 4, fail 2. The two failures are the CSP test
  (docs/index.html does not exist yet, WP-UI) and the workflow-permissions test (WP-JOBS). Neither concerns core.
Acceptance items covered (A#): A1, A2, A3 (money/sizer/compliance), core part of A4 (classifyFreshness),
A5 (nextExpiration/expiryBanner), A6 (flattenBanner), core part of A8 (tradeDate/dailyNetByTradeDate/reconcile),
A12 (typecheck + tests). Every case in all 11 golden files is asserted, including the pnl E1–E6 and sizer SE1–SE3 error
cases. Property checks: long/short P&L antisymmetry with no -0, a 1-year round trip for addDays/daysBetween across DST and
month/year ends, tradeDate for all 25 hours of 2026-11-01 plus the following CST Monday, and ctWallToMs fall-back and
spring-forward cases.
Deviations from plan / ADR requests: no golden-vs-JSDoc conflicts found, so no ADR requests. Where the contract is silent,
these interpretations were taken (each is documented in JSDoc):
- time.ctWallToMs: an ambiguous fall-back wall time resolves to the earlier instant (CDT). A nonexistent spring-forward
  wall time resolves with -06:00 (Temporal 'compatible') instead of throwing.
- Added exported helpers time.parseInstant, which requires an explicit Z/±HH:MM offset because offset-less ISO strings are
  local-zone dependent, plus time.parseDate/fmtDate and book.UNKNOWN_DATE_KEY. freshness and book use parseInstant, so an
  offset-less data_as_of is 'invalid'.
- money.usdToCents rounds half away from zero after removing binary noise (toFixed(6)).
- sizer: held margin per contract = round(margin_cents * multiplier). A held margin <= 0 → unknown. A negative available
  margin → margin limit 0.
- compliance: a non-positive cap or drawdown rule → unknown (it would otherwise divide by zero).
- freshness: data_as_of null with status ok/partial → invalid. An unknown status value → invalid.
- flatten: a malformed flatten_time_ct → unknown banner (not thrown).
- book: a closed trade with a bad or missing exit_time is attributed to tradeDate(entry_time), else to key 'unknown', and
  that date's total becomes null with an error. reconcile gives reported null + an error for a missing or duplicated Daily
  row. Every unknown row carries at least one error string.
Known gaps / risks:
- A reconcile row can have date 'unknown' when both trade times are unparsable. The UI should render it as a warning row.
- The spring-forward gap behaviour is untested against any golden (no vector exists). Flatten times near 02:00 CT are
  not realistic.
