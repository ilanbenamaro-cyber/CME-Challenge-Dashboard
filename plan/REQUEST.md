# CME Challenge Dashboard: Reconstructed Request

> **Status: RECONSTRUCTED.** The original `CME-REQUEST.md` was not available to the build session
> (2026-09-30). This file rebuilds it from what `plan/ORCHESTRATION.md` implies. Every item marked
> *(assumed)* is a default the planner chose. `plan/PLAN.md §6` lists those defaults ranked by blast
> radius. If the original request disagrees with this file, the original wins: file an ADR and patch.

## 1. Goal

This is a personal, mobile-first research and risk dashboard for a CME futures trading challenge, hosted on
GitHub Pages. It shows account P&L against the challenge limits, a position sizer, contract expiry
and flatten warnings, market context (bars, settlements, margins), a short event calendar, and a
reconciliation of the trade log against the challenge's reported daily results.

## 2. Boundary (non-negotiable)

- Research and risk tooling only. The system **never places, modifies, or cancels orders** and
  **never connects to CQG** or any broker or execution API.
- The site calls `fetch` only from `docs/js/io/**`. Jobs make network calls only through
  `jobs/common/http.py` (host allowlist) and the Databento client.
- Unknown or stale data renders as a visible warning, **never as zero or a plausible number**.
- Rule-dependent constants live in `docs/data/rules.json`, each with a `source`. Rules are never
  inferred: a rule with `value: null` is UNKNOWN and every dependent output shows UNKNOWN.

## 3. Decisions

| ID | Decision |
|---|---|
| D1 | Site is plain ES modules (`.mjs`) with JSDoc types, no bundler, no framework, no build step. |
| D2 | Type safety via `tsc --checkJs --strict --noEmit` over `docs/js/**` (overrides the global "TypeScript always" preference). |
| D3 | Hosting: GitHub Pages from `main:/docs`. |
| D4 | Data refresh: Python 3.11 jobs in `jobs/`, run by GitHub Actions cron (`refresh.yml`), committing `docs/data/*.json`. *(assumed schedule: hourly on weekdays, plus a 17:30 CT daily run for settlements and margins)* |
| D5 | Bars come from Databento `GLBX.MDP3`, schema `ohlcv-1h`, continuous symbology (`stype_in="continuous"`, `<ROOT>.c.0`). `metadata.get_cost` is called before every request, with a $2.00 cap per run. Micro roots are aliased to their parent's bars (MES→ES, MNQ→NQ, MCL→CL, MGC→GC). |
| D6 | The trade log lives in a Google Sheet, read via an Apps Script web-app JSON endpoint gated by a shared secret. The user enters the secret in the site settings (stored in `localStorage`); it is never committed. |
| D7 | Every bot-written data file uses one envelope: `{schema_version, dataset, generated_at, data_as_of, source, status, errors, data}`. On failure a job keeps the last good `data` and `data_as_of`, and sets `status:"error"`. |
| D8 | Only `docs/js/io/**` may call `fetch`/XHR/WebSocket/EventSource/`sendBeacon`. |
| D9 | Unknown ≠ 0. Stale values stay visible with a STALE marker; missing values show UNKNOWN. |
| D10 | `docs/data/rules.json` holds every challenge rule as `{value, source}`, populated only from `plan/RULES.md`. |
| D11 | Money math uses integer cents and integer ticks. Floating-point prices are converted to ticks with an on-tick check. |

## 4. Work packages and ownership

| WP | Owns | Must not touch |
|---|---|---|
| WP-CORE | `docs/js/core/**` (except `types.mjs`, which is frozen), `tests/js/core/**` | everything else |
| WP-JOBS | `jobs/**`, `tests/py/**`, `.github/workflows/refresh.yml`, `apps_script/**`, `requirements.txt` | `docs/js/**`, `plan/**`, `tests/golden/**` |
| WP-UI | `docs/index.html`, `docs/css/**`, `docs/js/io/**`, `docs/js/ui/**`, `docs/js/main.mjs`, `tests/js/ui/**`, `tests/e2e/**` | `docs/js/core/**`, `jobs/**` |
| Planner | `plan/**`, `tests/golden/**`, `tests/boundary/**`, `docs/js/core/types.mjs`, `docs/data/rules.json`, `docs/data/contracts.json`, `docs/data/calendar.json`, CI (`ci.yml`), `CLAUDE.md` | product logic |

## 5. Google Sheet tabs

| Tab | Columns | Notes |
|---|---|---|
| `Trades` | `id, root, side, qty, entry, exit, entry_time, exit_time, fees_usd, notes` | `exit`/`exit_time` blank means the position is open. `side` is `long`/`short`. Times are ISO-8601 with an offset. |
| `Daily` | `date, reported_pnl_usd, reported_balance_usd` | Copied from the challenge's daily results. Used for reconciliation. |
| `Margins` | `root, initial_usd, maintenance_usd, as_of` | Optional manual override, used when CME scraping fails. |

## 6. Data sources

| Dataset | Producer | Source | Cadence |
|---|---|---|---|
| `bars` | `jobs/fetch_bars.py` | Databento | hourly |
| `settlements` | `jobs/fetch_settlements.py` | CME settlements page/API | daily |
| `margins` | `jobs/fetch_margins.py` | CME margins page/API | daily |
| `challenge` | `jobs/fetch_challenge.py` | CME challenge daily results page | daily |
| `calendar` | human (validated by job) | curated | as needed |
| `rules`, `contracts` | human | `plan/RULES.md`, CME contract specs | as needed |

## 7. Acceptance items

- **A1** P&L for every golden vector in `tests/golden/pnl.json` matches to the cent. Off-tick prices are rejected.
- **A2** The sizer matches `tests/golden/sizer.json`, including the hold selector (intraday/overnight/weekend multipliers), the binding constraint, and null output when any input rule or margin is unknown.
- **A3** The daily loss cap and margin usage meters go red on breach, amber at ≥80%, and show UNKNOWN when the rule or an input is unknown (`tests/golden/compliance.json`).
- **A4** Each dataset shows a freshness chip. A stale, error, missing or invalid dataset raises a visible banner, and dependent numbers carry a STALE marker or UNKNOWN (`tests/golden/freshness.json`).
- **A5** Expiry banner: warns within N calendar days (setting, default 5) for open or watched roots. For roots with manual expiry rules and no calendar entry, the expiry shows UNKNOWN (`tests/golden/expiry.json`).
- **A6** Flatten banner: countdown to `flatten_time_ct`, red once it has passed with open positions, UNKNOWN when the rule is null (`tests/golden/flatten.json`).
- **A7** Calendar: the next 3 events and the next expiration per watched root.
- **A8** Book reconciliation: per trade date, computed net P&L from `Trades` vs `Daily.reported_pnl_usd` with the diff. The CME trade date rolls at 17:00 CT (`tests/golden/book.json`).
- **A9** Jobs write schema-valid envelopes atomically. On failure they keep the last good data and set `status:"error"`.
- **A10** Databento: `get_cost` precedes every `get_range`, and a run aborts before spending when the projected total is over $2.00.
- **A11** Boundary tests pass (`tests/boundary/`). The CSP `connect-src` is limited to `'self'` and the Apps Script hosts.
- **A12** `tsc` strict check, node tests, pytest and boundary tests are green in CI.
- **A13** The layout works at 390px width with no horizontal scroll.
- **A14** Secrets: `DATABENTO_API_KEY` lives only in the Actions secret, the Sheet key never enters the repo, and workflow permissions are minimal.

## 8. Deadline

Ship by **2026-10-03**.
