# PLAN: CME Challenge Dashboard (G0)

Inputs: `plan/REQUEST.md` (reconstructed; see ADR-000), `plan/ORCHESTRATION.md`, `.workflows/_shared/outbox.md`
(Phase 0 recon). Planner: Opus (ORCHESTRATION §1 fallback, ADR-001).

## 1. Work-package DAG

```
            ┌────────────── G1 interface freeze (types.mjs, schemas, golden vectors, boundary tests) ──────────────┐
            │                                   │                                          │
        WP-CORE                             WP-JOBS                                     WP-UI
  docs/js/core/* bodies            jobs/*, refresh.yml, apps_script/           io/, ui/, main.mjs, index.html, css
  tests/js/core/*                  tests/py/*, seed docs/data envelopes        tests/js/ui/*, tests/e2e/*
            │                                   │                                          │
            │                                   │                (builds against core stubs + golden semantics;
            │                                   │                 real integration after WP-CORE merges)
            └──────────── G2 per-WP advisory ───┴──────────────────────────────────────────┘
                                              merge --no-ff (CORE → JOBS → UI)
                                                         │
                                          G3 pre-ship: redteam + audit + e2e smoke
                                                         │
                                  Human: fill RULES.md → rules.json, deploy Apps Script,
                                  add DATABENTO_API_KEY, enable Pages, iPhone visual gate
```

All three WPs run in parallel once G1 is frozen. WP-UI unit tests that need real core behaviour are written
against the golden semantics and go green after the WP-CORE merge (UI merges last).

**Critical path:** G1 → WP-CORE (money/sizer/freshness are what every UI panel depends on) → WP-UI integration
→ G3 → human pre-flight items (rules, Sheet, secret, Pages) → Oct 3 ship. Jobs are off the critical path
for a usable site: the site degrades to explicit UNKNOWN/ERROR states without them.

## 2. Frozen interfaces (G1)

| Artifact | Path |
|---|---|
| Core types | `docs/js/core/types.mjs` |
| Core signatures (JSDoc on stubs) | `docs/js/core/*.mjs` |
| Data file schemas (D7 envelope) | `plan/schemas/{bars,settlements,margins,challenge,calendar}.schema.json` |
| Static files | `plan/schemas/{rules,contracts}.schema.json` |
| Sheet endpoint response | `plan/schemas/sheet.schema.json` |
| Golden vectors | `tests/golden/*.json` |
| Boundary tests | `tests/boundary/*` |

Producers (`jobs/`) and consumers (`docs/js/`) meet only through the schemas. Any change is an ADR.

## 3. Cut-line order (drop first → last)

1. Calendar polish (keep next 3 events + next expirations).
2. Sizer hold-selector extras beyond intraday/overnight/weekend multipliers (e.g. ATR-based stop helper).
3. Book reconciliation table (keep P&L and compliance).
4. Challenge-results scraper (reconciliation can use the Sheet `Daily` tab alone).
5. **Never cut:** golden-vector tests, boundary tests, expiry and flatten banners, stale-data warnings,
   daily-cap and margin reds.

## 4. Risk register

| ID | Risk | Early observable symptom | Mitigation |
|---|---|---|---|
| R1 | CME pages block Actions IPs / need JS rendering | First Actions run writes `status:"error"` with HTTP 403/empty table for margins/settlements/challenge | Fail closed; Sheet `Margins` tab fallback; `Daily` tab for reconciliation; site shows ERROR chips, never stale numbers as fresh |
| R2 | CME page structure differs from parser assumptions (unverified: recon blocked) | `partial`/`error` status with "unexpected shape" errors | Parsers isolated as pure `parse_*` functions with synthetic fixtures; swap after first live capture |
| R3 | Databento cost overrun | `get_cost` > $2 logged; job aborts with status error | Cost check before every request; cap in code and schema (`cost_usd ≤ 2`) |
| R4 | Continuous symbol roll produces a price gap in bars | ATR spike around roll date | ATR shown as context only; not used in any compliance number |
| R5 | Rules never pasted | Every meter/sizer shows UNKNOWN; banner "N rules unknown" | Intended fail-safe; RULES.md checklist |
| R6 | Holiday-shifted expirations | Calendar vs computed date mismatch | Calendar override; gotcha logged |
| R7 | Sheet row typos (text in number column) | "Sheet rows invalid" banner; today's P&L UNKNOWN | Row-level validation in io; never coerce to 0 |
| R8 | Apps Script CORS/redirect breaks fetch | Sheet chip ERROR "network" on first real deploy | Simple GET, no headers; CSP allows both Google hosts |
| R9 | Cron skipped / delayed | bars chip goes STALE (>180 min) | Visible STALE; manual `workflow_dispatch` |
| R10 | Bot data commits conflict with feature merges | refresh.yml push rejected (non-fast-forward) | Job does `git pull --rebase` on data-only commit before push; data paths owned only by bot |
| R11 | DST edge (Nov 1 2026) breaks flatten countdown | Flatten minutes off by 60 on Nov 2 | Intl-based `ctWallToMs`; golden L6 covers CST |

## 5. Gates

Gate commands (all WPs): `npm run typecheck`, `npm run test:js`, `npm run test:py`. WP-UI additionally:
`npm run test:e2e`. Advisory output goes to `.workflows/_shared/advice/<gate>-<scope>.md`.

## 6. Ambiguities (ranked by blast radius) and defaults taken

| # | Ambiguity | Default taken |
|---|---|---|
| 1 | The original request is missing, so D1–D11, the paths and the acceptance items are reconstructed | `plan/REQUEST.md`. Diff it against the original and file ADRs |
| 2 | Challenge rule values (cap, drawdown, max contracts, flatten time, hold multipliers, margin basis) | All `null` → UNKNOWN until RULES.md is filled |
| 3 | Drawdown definition (EOD trailing vs intraday trailing vs static) | Peak = max(starting balance, reported EOD balances from `Daily`). The UI labels it "assumes EOD trailing" |
| 4 | Equity / available margin for the sizer | equity = starting balance + Σ closed net (Trades) + open P&L; available = equity − margin in use by open positions (same hold multiplier as selected). UNKNOWN if any part is unknown |
| 5 | Whether open positions reduce the sizer's `max_contracts` headroom | No. The sizer sizes a fresh position and the positions panel shows current standard-equivalent count against the limit |
| 6 | Bot commits to `main` vs CLAUDE.md "never commit directly to main" | The refresh bot commits only `docs/data/{bars,settlements,margins,challenge}.json` to main. Agents never commit to main |
| 7 | CME source URLs and page shapes | Configurable in `jobs/config/sources.json` with `verified:false` |
| 8 | Refresh cadence | One cron, hourly Sun–Fri at :07 UTC. Daily datasets are re-fetched each run (idempotent) |
| 9 | Contract universe | ES, MES, NQ, MNQ, CL, MCL, GC, MGC |
| 10 | Invalid Sheet `Trades` rows | Today's realized P&L becomes UNKNOWN and a banner lists the row ids |
| 11 | Expiry warn window | 5 calendar days (user setting) |
| 12 | Event calendar content | Human-curated. Seeded with two FOMC dates marked UNVERIFIED |
