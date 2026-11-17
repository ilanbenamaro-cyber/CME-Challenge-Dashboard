# HANDOFF: CME Challenge Dashboard

_Last updated 2026-10-06 by Claude (build session). Read this first, then `CLAUDE.md`._

## What this is
A phone-first, **read-only** risk dashboard for Ilan's team in the **2026 CME Group University Trading Challenge**.
- Live: Sun Oct 4, 17:00 CT → Fri Oct 30, 16:00 CT.
- It never places orders and never connects to CQG.

| Thing | Where |
|---|---|
| Live site | https://ilanbenamaro-cyber.github.io/CME-Challenge-Dashboard/ (GitHub Pages, `main:/docs`) |
| Repo | `ilanbenamaro-cyber/CME-Challenge-Dashboard` (public). Default branch `main`. Work branch `claude/pensive-pasteur-2mqzhm` |
| Trade log | Google Sheet ["CME Challenge Trade Log"](https://docs.google.com/spreadsheets/d/1GNrAjHScij2rwwa7R7Un6i-L1-Wjg4FZ1xoc8iOr9iY/edit) (ilanben@umich.edu). Tabs `Trades`, `Daily`, `Margins`. Chicago time zone |
| Sheet → site | Apps Script web app (deployed by Ilan). The URL and key live **only** in Ilan's browser Settings, never in the repo |
| Price data | Databento `GLBX.MDP3` `ohlcv-1h`, hourly GitHub Actions `refresh.yml`. Secret `DATABENTO_API_KEY` is set |
| Rules | `plan/RULES.md` (verbatim excerpts) → `docs/data/rules.json` (page-cited) |

## Workflow conventions (from CLAUDE.md, keep following them)
- **Branches:** work on the `claude/…` branch, open a PR to `main`, merge only after CI is green (merge commit). Never commit to `main` directly; only the refresh bot does.
- **Gates:**
  - `npx tsc -p tsconfig.json`
  - `npm run -s test:js` (269)
  - `python3 -m pytest -q tests/py tests/boundary` (198)
  - `npm run -s test:e2e`
- **Expected values:** test values come from `tests/golden/*.json`, hand-computed. Never generate them from the code under test.
- **Unknown data:** unknown is never 0. Stale values show a `STALE <age>` badge. Rules are never inferred.
- **Planning record:** decisions are in `.workflows/_knowledge/decisions.md` (ADR-000…011), gotchas in `.workflows/_knowledge/gotchas.md`.
- **Visual gate:** Ilan closes it on his iPhone. Don't self-approve.

## Architecture (one line each)
- `docs/js/core/`: pure logic (money in 1/10,000 USD, sizer, meters, freshness, expiry, flatten, book). Interface in `types.mjs`.
- `docs/js/io/`: the only place that fetches or touches storage. `sheet.mjs` normalises Sheet rows, including `contract`.
- `docs/js/ui/viewmodel.mjs`: composes everything. `render.mjs` produces escaped HTML.
- `jobs/`: Python producers → `docs/data/*.json` (D7 envelope). `fetch_bars.py` is the only live one.

## Current state (2026-10-06)
- **bars:** `ok`, data about 8h delayed (no live CME license; $199/mo Standard plan declined). 12 roots plus 31 exact-contract series. Costs about $0.00003 per run.
- **settlements, margins, challenge:** intentionally **OFF**. CME blocks automated access and its terms forbid it (ADR-007). They show as grey OFF chips.
- **Ilan's open positions** (Sheet rows 3–7): ZTZ26 L3, ZNZ26 S2, HOZ26 L2, CLZ26 S2, GCZ26 L1. Rows 1–2 are closed (ZN +$21.25, CL −$50 net).

## Key decisions you must not undo
| ADR | Decision |
|---|---|
| 007 | No CME website scraping. Margins and daily results come from the Sheet tabs |
| 008 | UTC rules:<br>- 20% daily lock on the prior trade date's Daily close ($1M before the first close; practice rows ignored)<br>- 10 contracts/day minimum<br>- final-day flatten only, 15:45 CT on Oct 30<br>- `applies:false` means "not a rule"<br>- initial margin |
| 009 | Sub-cent tick values (ZT $7.8125, ZN $15.625): exact math, one rounding per trade |
| 010 | A position is marked only with its **own contract's** bars (Sheet `contract` column, e.g. `HOZ26`). Never the front month |
| 011 | **Option B (Ilan):** stale marks still price positions; every derived figure shows `bars STALE <age>` |

## Databento quirks (all handled in `jobs/fetch_bars.py`; see gotchas)
- **Delayed data:** without a license, ranges past about now−8h → 422. The job clamps to `metadata.get_dataset_range` first.
- **Availability errors:** `data_end_after_available_end` and `data_end_date_after_available_end_date` are handled by clamping and retrying once.
- **Symbology:** `symbology.resolve` is license-limited and day-granular, so `end_date` = the day of the last data.
- **Server errors:** 504 gateway timeouts get one retry (cost check and range).
- **Raw symbols:** both `HOZ6` and `NGZ26` forms appear.
- **Billing:** cost quotes are logged to stderr; `cost_usd` counts billed requests only.

## Open items for Ilan
1. **Margins tab:** enter **initial** margins for ZT, ZN, HO, CL and GC (`root | initial | maintenance | as_of`). Until then margin-in-use and the sizer show UNKNOWN.
2. **Daily tab:** add a row after each settlement (`date | reported P&L | reported balance`). The first is 2026-10-05. The balance sets the next day's 20% lock.
3. **New trades:** always fill `contract` (e.g. `ZNZ26`), with Treasury prices as decimals and times as ISO with an offset.
4. **iPhone visual check** of the Positions table (Contract column, mark labels).
5. **Leftover branch:** `recon/cme-phase0` can be deleted on GitHub (the proxy blocked deletion).

## Calendar notes
- CLX26 expires **Oct 20** and HOX26 **Oct 30**, both inside the challenge. Ilan holds Dec contracts.
- The Dec-26 dates use first notice day (Nov 30) for ZT, ZN and GC. CLZ26 is Nov 20 and HOZ26 Nov 30.

## Optional next work (offered, not requested yet)
- CQG fill CSV import tab (needs one sample export from Ilan).
- Manual "mark" column, unnecessary now that option B is in.
- Settlements via a licensed feed (Databento `statistics` schema).
- Add more products to `docs/data/contracts.json`, with exact specs and golden vectors, whenever Ilan trades something new. An unknown root makes the row invalid on purpose.
