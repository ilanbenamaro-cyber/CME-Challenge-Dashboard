# WP-UI: site shell, io, rendering

Branch `feat/ui`.

## Owned paths
`docs/index.html`, `docs/css/**`, `docs/js/io/**`, `docs/js/ui/**`, `docs/js/main.mjs`, `tests/js/ui/**`, `tests/e2e/**`,
plus `docs/.nojekyll` and `docs/404.html` if wanted.

## Forbidden
`docs/js/core/**` (consume only; stubs are replaced by WP-CORE), `jobs/**`, `docs/data/**`, `plan/**`, `tests/golden/**`,
`tests/boundary/**`, `.github/**`.

## Frozen inputs
- Core API: JSDoc signatures in `docs/js/core/*.mjs`, types in `docs/js/core/types.mjs`. Stubs throw until WP-CORE merges.
  UI unit tests that exercise core must be written now and will pass after merge. To develop visually before
  that, you may temporarily point at a local shim, but **commit nothing that shadows core**.
- Data shapes: `plan/schemas/*.json`. Static files: `docs/data/{rules,contracts,calendar}.json`.
- Boundary tests: `tests/boundary/boundary.test.mjs` (CSP, network confinement, no remote scripts). Read it first.

## io layer (the only fetch/localStorage users)
- `docs/js/io/data.mjs`
  - `loadEnvelope(name: DatasetName): Promise<{env: Envelope<unknown>|null, error: string|null}>` fetches
    `data/<name>.json?t=<ms>` with `cache:'no-store'`. Network, HTTP or JSON errors give `env:null` plus the error text
  - `loadStatic(name: 'rules'|'contracts'): Promise<{json: unknown|null, error: string|null}>`
- `docs/js/io/sheet.mjs`
  - `loadSheet(url: string, key: string): Promise<SheetResult>`, where
    `SheetResult = {data: SheetData|null, rowErrors: string[], error: string|null, fetchedAtMs: number|null}`
  - Accept only `https://script.google.com/macros/s/.../exec` URLs. Simple GET, no custom headers, key as a query param
  - `normalizeSheet(raw: unknown): {data: SheetData|null, rowErrors: string[], error: string|null}`: pure and exported
    for tests. `''` → null. Numeric strings are coerced; a non-coercible value makes that row invalid (added to
    `rowErrors` with the row id, excluded from `trades`). It never becomes 0. `{error}` responses → `error`
- `docs/js/io/settings.mjs`: `loadSettings(): Settings`, `saveSettings(s: Settings): void`, try/catch around storage
  - `Settings = {sheet_url: string, sheet_key: string, watched_roots: string[], expiry_warn_days: number}`
  - defaults: `''`, `''`, `['ES','MES','NQ','MNQ']`, `5`

## View model (pure, node-testable)
`docs/js/ui/viewmodel.mjs`: `buildViewModel(inputs: VMInputs): ViewModel`, where
`VMInputs = {nowMs, rules: RulesFile|null, contracts: ContractsFile|null, envs: Record<DatasetName, Envelope|null>,
sheet: SheetResult|null, settings: Settings, sizerForm: {root, risk_budget_usd, stop_ticks, fee_per_contract_usd, hold}}`.
It composes core only. No DOM, no fetch, no `Date.now()`.
- **Freshness chips**: `classifyFreshness(env, now, POLICIES[name])` per dataset, plus the Sheet (fresh if fetched in the last 15 min).
- **Banners**, ordered by severity: flatten (`flattenBanner`, open positions from Sheet trades with exit null),
  expiry per root in (open-position roots ∪ watched roots), a data banner per non-fresh dataset, a "N rules
  UNKNOWN — fill plan/RULES.md → rules.json" banner, and a Sheet row-error banner.
- **Account**: today's realized net P&L (trade date = `tradeDate(now)`), open P&L (mark = `lastClose` of
  `barsRootFor(root)` from bars **only if bars are fresh or partial**, else open P&L null → UNKNOWN), `dailyLossMeter`,
  `drawdownMeter` (PLAN §6 #3, labelled "assumes EOD trailing"), and `marginMeter` (PLAN §6 #4). Any invalid Trades row
  makes today's realized P&L null.
- **Positions**: open trades with mark, open P&L, standard-equivalent count vs `max_contracts`.
- **Sizer**: `sizePosition` using `resolveMargin` (CME rows if the margins env is fresh, else Sheet Margins) on
  `rules.margin_basis`. The hold selector is intraday/overnight/weekend. Show contracts, the binding constraint, each limit and
  the reasons. Unknown shows "UNKNOWN" plus the reasons, never a number. It also shows ATR(14) in ticks for the root as a stop hint.
- **Markets**: per watched root: last close (with STALE marker if the bars env is stale), ATR(14), latest settle and margin
  on the basis, each with source and as-of.
- **Calendar**: the next 3 events on or after today, and the next expiration per watched root (`nextExpiration`).
- **Reconciliation**: `reconcile(dailyNetByTradeDate(trades), sheet.daily, 10)`. If the challenge env is fresh, show its
  rows in a second column group.

Every value carries its level/state so the renderer can style it. Unknown renders `UNKNOWN_TEXT`; stale renders the
value plus a `STALE` badge with the age.

## Rendering
- `docs/js/ui/render.mjs`: `renderApp(vm: ViewModel): string` plus per-panel functions. They return HTML strings. **All
  dynamic text goes through `escapeHtml`**, because Sheet notes and ids are untrusted.
- `docs/js/main.mjs`: loads settings, static files, envelopes and the Sheet via io, builds the VM, sets
  `#app.innerHTML`, and wires the settings form and the sizer form (re-render on input). It re-renders every 30 s for clocks
  and re-fetches every 5 min and on the Refresh button. No inline scripts or handlers (CSP).
- `docs/index.html`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';
  style-src 'self'; img-src 'self' data:; connect-src 'self' https://script.google.com https://script.googleusercontent.com;
  base-uri 'none'; form-action 'none'">` (the boundary test pins the default/script/connect-src
  lists). Viewport meta, `theme-color`, `<script type="module" src="js/main.mjs">`.
- `docs/css/app.css`: mobile-first (390px). Clear red/amber/green/grey (unknown) levels that don't rely on colour alone
  (icon + text). Dark mode via `prefers-color-scheme`. No horizontal scroll: wrap tables in overflow containers.

## Tests
- `tests/js/ui/*.test.mjs` (node:test): `normalizeSheet` coercion and row errors, and `buildViewModel` scenarios:
  all rules unknown → sizer and meters UNKNOWN with the rules banner; bars missing → open P&L UNKNOWN; bars stale → mark
  shown with a STALE flag; margins env error + Sheet Margins → sizer uses the sheet with source "sheet"; invalid trade row
  → today's P&L UNKNOWN plus the banner; flatten breach with an open position. `renderApp` escapes `<script>` in notes.
  Fixture rules may reuse `tests/golden/sizer.json#rules_fixture`.
- `tests/e2e/smoke.mjs`: a node static server over `docs/` on an OS-assigned port (`listen(0)`), Playwright Chromium
  (`executablePath` from the `PLAYWRIGHT_BROWSERS_PATH` install, no download), iPhone viewport 390×844. It asserts
  `#app` renders the expected panels (checking for a marker proving the current code is served), that there are no page errors,
  that `document.documentElement.scrollWidth <= innerWidth`, and saves screenshots to `tests/e2e/out/`. It exits
  non-zero on failure. Playwright is not a project dependency: resolve it from the global install
  (`createRequire(join(execSync("npm root -g").toString().trim(), "/"))("playwright")`, currently 1.56.1).
  If it is unavailable, print SKIP and exit 0.

## Gate commands
```
npm run typecheck
node --test "tests/js/ui/**/*.test.mjs" "tests/boundary/**/*.test.mjs"
npm run test:e2e
```

## Acceptance items
A4 (UI), A5–A8 presentation, A11 (CSP + io confinement), A13, and the UI part of A12.
