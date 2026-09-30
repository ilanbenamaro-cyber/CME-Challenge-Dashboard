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
## WP-JOBS task report — 2026-09-30
Branch / commits: `feat/jobs` (worktree branch renamed to match plan/wp-jobs.md), based on 98843f8. Not pushed or merged.
7d3be09 envelope + atomic write + schema; 3097cc1 allowlisted http; 2debbb7 Databento bars; e872b88 refresh.yml + seed
envelopes; 497f240 CME settlements/margins/challenge; 31f0653 refresh orchestrator + calendar validation;
9075bac Apps Script; 73ccd3c real-DBNStore test + checkout@v5/setup-python@v6; this report is the last commit.

Gate commands run + actual result lines:
- `python3 -m pytest -q tests/py tests/boundary/test_boundary_jobs.py` → `177 passed`
- `python3 -m pytest -q tests/py tests/boundary` → `177 passed`
- `python3 -m jobs.refresh --dry-run --data-dir "$(mktemp -d)"` → exit 0; bars/settlements/margins/challenge/calendar all `ok`
  (SYNTHETIC)
- `node --test tests/boundary/boundary.test.mjs` → `# tests 6 / # pass 5 / # fail 1`. The one failure is the CSP test
  (`docs/index.html` missing; owned by WP-UI). The workflow-permission, no-order-words and no-secrets tests pass.

Acceptance items covered (A#):
- A9: every envelope goes through `jobs/common/publish.py` (schema-validate, then atomic temp + `os.replace`). Invalid
  output becomes a failure envelope, and invalid previous data is dropped rather than re-published. Failures keep the
  last good `data`/`data_as_of`.
- A10: `get_cost` is projected for every root with the exact `get_range` params before any spend. A run total over
  $2.00 aborts with zero `get_range` calls. A non-finite or negative cost skips that root.
- A11 (jobs part): network only via `jobs/common/http.py` (`ALLOWED_HOSTS = frozenset({"www.cmegroup.com"})`,
  https only, no userinfo or odd ports, and each redirect hop re-checked) plus Databento in `fetch_bars.py`.
- A12 (jobs part): pytest is green. A14: `refresh.yml` has `permissions: contents: write` only and uses only
  `secrets.DATABENTO_API_KEY` on the run step, with no echo and no `pull_request_target`. Error text redacts the key.

Facts established here:
- databento 0.87.0: with `stype_in="continuous"` and the default `stype_out="instrument_id"`, `DBNStore.to_df()` fills
  `symbol` with the requested continuous symbol (`ES.c.0`), and the index is `ts_event` (bar open). This was checked
  by introspecting `InstrumentMap._resolve_mapping_tuple` and by a real offline DBN round trip
  (`tests/py/test_fetch_bars.py::test_real_dbnstore_to_df_maps_continuous_symbol`).

Deviations from plan / ADR requests:
- Minor signature widening: `parse_settlements(payload, root, hints=None)`, `parse_margins(payload, hints=None,
  roots=None)`, `parse_challenge(payload, account=None, hints=None)`. They are still pure and payload-first. Parse
  hints come from `jobs/config/sources.json`.
- `--dry-run` without `--data-dir` writes to a fresh temp dir. It refuses `--data-dir docs/data` so SYNTHETIC numbers
  can never be committed as real data.
- The refresh.yml commit step runs only on `refs/heads/main`. A dispatch on another branch is a no-commit smoke test.
- `data_as_of` choices: settlements = oldest trade_date at 16:00 America/Chicago (capped at run time); challenge =
  latest row date at 16:00 CT (capped); margins = fetch time (the requirement in force when fetched); bars = latest
  bar open + 1h (capped).
- `jsonschema` checks `format: date-time` only when the optional `rfc3339-validator` is installed (it is not).
  `jobs/common/schema.py` registers a strict local RFC 3339 checker instead of adding a dependency.
- ADR request (low): `generated_at` changes every run, so the bot commits data hourly (~144 commits/week) even when
  nothing else changes. If that is unwanted, the options are to skip commits when only `generated_at` changed (the
  site would then need to use `data_as_of` for freshness, which it already does), or to accept it.

Known gaps / risks:
- ALL CME sources are UNVERIFIED (`verified:false`). The settlements URL template and product ids (ES 133, NQ 146,
  CL 425, GC 437) were recalled from memory and are unchecked. The margins URL and the challenge URL and account are
  null, so those jobs report "source not configured" (status:error) until a human fills them after a live capture.
  Fixture shapes are invented (SYNTHETIC).
- Databento: the request `end` = the current hour. If GLBX.MDP3 availability lags, Databento may reject the end
  bound. That shows as per-root errors / status error, not bad data. Unverified without a key.
- robots.txt and the terms stance of cmegroup.com were never observed (recon blocked). Check them before relying on
  the scrapers.
- `pandas` is used directly (fake client, tests) but comes in only transitively via `databento`.
- Apps Script: tested under Node with stubbed services only. The `spreadsheets.readonly` manifest scope is untested on
  a real deploy; the README gives the fallback.
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
