# G3 adversarial review (red-team + audit): all WPs

Branch `claude/pensive-pasteur-2mqzhm` @ 0f2c5a6. Report-only: no tracked file was changed apart from this one. Nothing was committed or pushed.
Throwaway probes live in `/tmp/g3/` (harness.mjs, vm_attacks.mjs, vm_invalid_open.mjs, time_attacks.mjs, money_attacks.mjs,
xss.mjs, http_probe.py, cost_probe.py).

## Gate results (actual lines)

- `npx tsc -p tsconfig.json`: no output, exit 0
- `npm run -s test:js`: `# tests 211` / `# pass 211` / `# fail 0`
- `python3 -m pytest -q tests/py tests/boundary`: `179 passed in 2.51s`
- `npm run -s test:e2e`: `ALL CHECKS PASSED. Screenshots: .../tests/e2e/out`

## Findings

### P0-1: An invalid open-trade row makes the dashboard say "flat" and "no open positions", even past flatten time
- Where: `docs/js/ui/viewmodel.mjs:553` (`open: trades ? trades.filter(...)`). Invalid Trades rows are dropped in `docs/js/io/sheet.mjs`,
  and only `realized` is invalidated (`computeMoney`, which checks `tradeRowErrors`). `open`, positions, margin in use and the flatten banner still use the filtered list.
- Input: Sheet Trades has one open row `{id:'O1', root:'ES', side:'Buy', qty:3, entry:5795, exit:'', ...}` (a typo: `Buy` instead of `long`).
  Time is 15:20 CDT, with fixture flatten at 15:10 (`/tmp/g3/vm_invalid_open.mjs`).
- Observed: `open P&L $0.00 flat | margin in use $0.00`, `positions ... Flat — no open positions in the Sheet | std 0 / 5 ok`,
  `banner ok flatten Flatten | Flatten by 15:10 CT (10 min past; no open positions)`. Two amber "Sheet invalid row" banners are shown,
  but the flatten banner is green and tells the user they are flat while 3 ES are open.
- Fix: when `tradeRowErrors.length > 0`, set `ctx.open = null`, or add an "open set incomplete" flag. Then open P&L, margin in use, positions,
  std-equivalent and flatten all render UNKNOWN, and the flatten banner is at least `unknown` (treating it as `hasOpen=true` is better). Add a VM test.

### P0-2: The drawdown peak silently ignores Daily rows that are rejected or have a blank balance, so the drawdown meter reads green
- Where: `docs/js/ui/viewmodel.mjs:709-711` (peak = max(start, valid numeric balances)). `docs/js/io/sheet.mjs:231` drops the whole Daily row
  on a bad value. A blank `reported_balance_usd` becomes null and is skipped without any row error.
- Input A: Daily `[{date:'2026-09-28', reported_balance_usd:'51,800.00 USD'}, {date:'2026-09-29', reported_balance_usd:50100}]`,
  starting balance 50,000, max DD 2,000. True peak 51,800 means DD 1,800 (90%, amber).
  Observed: `peak $50,100.00 ... meter drawdown ok 5% $100.00 / $2,000.00`. Only a generic "Sheet: 1 invalid row" banner is raised.
- Input B: the same row with a blank balance. Observed: `peak $50,000.00`, `meter drawdown ok 0%`, and no banner at all.
- Input C: Sheet not configured. The Peak KPI shows `$50,000.00` as a known value (no marker) while everything else is UNKNOWN.
- Fix: track peak completeness. Any rejected Daily row, or any Daily row with a pnl and no balance, makes peak (and the drawdown meter)
  UNKNOWN with the reason. When the Sheet is missing or errored, peak is UNKNOWN (or carries the Sheet badge), not the starting balance.

### P1-1: Meters, the sizer and positions show numbers from stale/errored Sheet data with no STALE marker (A4)
- Where: `meterVM` in `docs/js/ui/viewmodel.mjs:748` (MeterVM has no badge). Also `available` at :926, `sizer.contracts_text`, and positions/std_equiv.
- Input: Sheet refetch fails after a good load. main.mjs keeps the last good data and sets `error`. Last fetch was 90 min ago.
- Observed: the KPIs carry `STALE 1h 30m (job error)`, but `meter daily_loss ok 0%`, `meter drawdown ok 0%`, `meter margin ok 1%`,
  `sizer 12 ok | avail $49,343.14 null` (no badge). A new losing trade entered in the Sheet during the outage would not show up,
  and the green meter carries no warning.
- Fix: add a `badge` to MeterVM and SizerVM, derived from the Sheet (and bars) freshness, and render it. Consider forcing meters to
  `unknown` once Sheet age exceeds a hard limit.

### P1-2: The flatten banner is anchored to the CT calendar date, so it flips from red to green at midnight with the position still open
- Where: `docs/js/core/flatten.mjs:30` (`ctWallToMs(ctDate(nowMs), hhmm)`).
- Input: flatten 15:10, an open position held past it (`/tmp/g3/time_attacks.mjs`).
- Observed: `2026-10-01T04:59Z (23:59 CT) breach -529` then `2026-10-01T05:00Z (00:00 CT) ok 910 | Flatten by 15:10 CT — 910 min left`.
  A position held from Friday shows `ok 910` at Sat 00:00 CT. The reverse also happens: a position opened in the 17:00–24:00 CT evening
  session (new trade date) shows red "flatten time reached".
- Fix (after RULES.md confirms the rule's meaning): anchor the target to `tradeDate(now)`, and flag breach for any open trade whose
  entry_time is before the most recent flatten instant that has already passed. The golden vectors do not cover this.

### P1-3: A calendar override for a later contract hides the nearer computed expiry
- Where: `docs/js/core/expiry.mjs:51` (any calendar entry ≥ today wins over the computed third Friday, even when it is later).
- Input: calendar has only `{root:'ES', contract_code:'ESH27', date:'2027-03-18'}` (e.g. a holiday override), and today is 2026-12-14.
- Observed: `with cal: ESH27 2027-03-18 ok | without cal: ESZ26 2026-12-18 warn`. On 2026-12-18 it shows `ok` where it should show `breach`.
- Fix: take the earlier of (the earliest calendar entry ≥ today) and (the computed date), or let calendar entries override only the
  computed date for the same contract_code.

### P1-4: Bars used as marks are not checked for age per root
- Where: `docs/js/ui/viewmodel.mjs:569-580` (`markFor`: usability comes only from the envelope state). `jobs/fetch_bars.py` sets data_as_of to
  the latest bar across all roots.
- Input: the envelope is `ok` and fresh (data_as_of 30 min ago), but the ES series ends 30 h ago.
- Observed: `pos mark 5799.50 null last 1h close, bar 2026-09-29 11:00Z`, and open P&L `$43.76` with no badge.
  The producer drops failed roots instead of keeping old ones, so this needs Databento to return a lagging series for one root. Treat it as a latent risk.
- Fix: in `markFor`, treat a root as stale when its last bar `t` + 1h is older than the bars policy (with the same weekend window).
  Alternatively, make fetch_bars use the oldest per-root last bar for data_as_of.

### P1-5: The continuous `.c.0` mark can be the wrong contract month during the roll window (inferred)
- Where: `jobs/fetch_bars.py:41` (`<ROOT>.c.0`, calendar-ranked, which rolls at expiry). Trades carry no contract month.
- Risk: from roll week (about 8 days before a quarterly expiry) until expiry, a user holding the next contract (for example ESH27) is marked at the
  front month (ESZ26). Open P&L is then wrong by the calendar spread × $50 × qty. The mark cell does not name the contract.
- Fix: show the resolved contract in the mark note. Consider `.v.0` (volume-ranked), or a contract column in Trades plus per-contract marks.
  At minimum, show open P&L with a warning inside the expiry warn window.

### P1-6: Apps Script formats Daily.date in CT, not in the spreadsheet's time zone (inferred; Apps Script not runnable here)
- Where: `apps_script/Code.gs:80` (`Utilities.formatDate(value, 'America/Chicago', 'yyyy-MM-dd')` for date-only cells).
- Input: spreadsheet time zone America/New_York, with a date cell 2026-09-29, i.e. the instant 2026-09-29T04:00Z.
  The same formatting done with Node Intl gives `2026-09-28`.
- Effect: every Daily row lands one day early. Reconciliation then compares against the wrong trade date and reports missing or duplicate rows.
- Fix: for date-only cells use `ss.getSpreadsheetTimeZone()`, or read `getDisplayValues()` for the date column.

### P1-7: Daily loss = −(realized today + open P&L since entry) is wrong for positions held overnight (spec-level)
- Where: `docs/js/core/compliance.mjs:68`, fed by `openPnl` (marked from entry, not from the prior settlement).
- Example: long 1 ES entered yesterday, +$1,000 at yesterday's settle, down $1,200 today. Today's actual loss is $1,200, but the meter shows $200.
  The overnight and weekend hold multipliers in rules.json imply that overnight holds are expected.
- Fix: confirm the challenge definition in RULES.md. The usual one is prior EOD balance − current equity, which uses Daily
  `reported_balance_usd` or settlements. Until it is confirmed, label the meter "intraday positions only", or make it UNKNOWN when an open trade's entry is before the current trade date.

### P2 items (polish)
- P2-1 `docs/js/ui/viewmodel.mjs:1012`: the settlement sort comparator never returns 0. With two contracts on the same trade_date the output was
  `['ESH27','ESZ26']`, so the deferred month is shown as "Settle" (it is labelled by its contract_code). Fix: prefer the front contract explicitly.
- P2-2 `docs/js/io/sheet.mjs:88`: `coerceNumber('--5')` gives `5`, a sign flip on a double-minus typo. Reject more than one sign.
- P2-3 `docs/js/io/sheet.mjs:145`: qty has no upper bound. `qty:'100000000000000000000'` is accepted, and P&L becomes
  `-1000000000000000000` cents (not a safe integer). Cap qty (e.g. ≤ 1000) and assert `Number.isSafeInteger` in money.
- P2-4 `docs/js/io/sheet.mjs` `isIsoTime`: `2026-02-30T10:00:00-05:00` is accepted (V8 rolls it over). exit_time < entry_time is accepted,
  and an exit_time in the future is accepted, which drops that trade from today's realized without any warning.
- P2-5 `docs/js/io/data.mjs` `parseRulesFile`: values are not type-checked against `plan/schemas/rules.schema.json`
  (`max_contracts: "5"` is used as 5; `starting_balance_usd: "50,000"` throws and turns the Account panel into an error panel). Validate the types.
- P2-6 `docs/js/core/money.mjs:6`: a tolerance of 1e-6 ticks accepts `4500.2500001` as on-tick. This is harmless.
- P2-7 `.github/workflows/*.yml`: actions are pinned by tag, not SHA, and `pip install` has no hashes. The secret is scoped to the run step only.
- P2-8 `docs/js/io/sheet.mjs` URL_RE rejects Google Workspace web-app URLs (`/a/macros/<domain>/s/…/exec`). This is fine for a gmail.com owner.

## Verified directly (reproduced or run)
- All four gates (lines above).
- P0-1, P0-2 (A, B, C), P1-1, P1-2, P1-3, P1-4 (VM level), P2-1 to P2-4, P2-6: reproduced by running the scripts in /tmp/g3 against the real modules.
- Money: GC 0.1 grid scan 0..5000 and CL 0.01 grid scan 0..2000 give 0 mismatches. Off-tick prices are rejected. A short with a flat price gives +0, not -0.
  Short sign is correct. Fee rounding is half-up (`0.005→1`, `1.005→101`, `2.675→268`). The sizer with a micro ratio of 0.1 gives `max_contracts 0 → zero`.
  A held margin that rounds to 0 gives unknown.
- Time: tradeDate rolls at 17:00 CT on 2026-10-30, 2026-11-01 (CST) and 2027-03-14 (CDT). Weekends roll to Monday. The 01:30 fall-back
  maps to the earlier instant (CDT). Weekend freshness window: Sat with Fri 16:00 data is fresh. Sun 17:30 is stale. Fri 14:59 data on Sat is stale.
- XSS: a payload in trade id and notes, Daily date and pnl, settlement contract_code, envelope source and errors, calendar title/impact/source/
  time, loadErrors and sheet_url is rendered with 0 raw `<script>/<img>/<svg>` elements and 0 of 436 tags carrying an `on*=` attribute.
  Attribute values are quote-escaped.
- fetch/XHR/WebSocket/localStorage/innerHTML: network and storage calls appear only in docs/js/io. The only innerHTML sinks are in main.mjs and receive escaped renderer output.
  The CSP matches A11 (connect-src 'self' plus the two Apps Script hosts, `base-uri 'none'`, `form-action 'none'`, no unsafe-*).
- Sheet key: never rendered (the input is set via `.value`). Error texts (`HTTP n`, `network: <msg>`, `timed out`) do not include the URL.
  URL_RE is anchored, so `script.google.com.evil.io` and `@` tricks fail.
- jobs/common/http.py: `www.cmegroup.com.evil.io`, `@evil.io`, `evil.io\@cmegroup`, `#@`/`?@`, port 8443, trailing dot, http,
  tab injection and IPv6 are all blocked. A protocol-relative redirect resolves to evil.io and is re-checked and blocked. `:0443` is allowed (harmless).
- Databento cost cap (fake client): over the cap gives 0 `get_range` calls. `get_cost` throwing for every root gives 0 `get_range` calls with the key redacted (`key=***`).
  A NaN, negative or non-numeric cost skips that root. A total of exactly $2.00 proceeds (the rule is "over $2.00").
- Schemas: the bars, settlements, margins and challenge field names and types in plan/schemas match both the job writers and the VM readers.
  The committed envelopes are `status:error`, `data:null` seeds, which the site shows as ERROR.
- Code.gs: SHA-256 digest compare, no doPost, `spreadsheets.readonly` scope, `{error:'unauthorized'}` on a missing or wrong key.
- refresh.yml: `contents: write` only. The secret is used only in the run step's env. `github.ref_name` is passed via env, so there is no injection.
  The only triggers are schedule and workflow_dispatch. The commit step is limited to the four data files, on main only, using pull --rebase with retry.

## Inferred (not executed)
- P1-5 (continuous-symbol roll mismatch): from Databento `.c.0` semantics. No key was available here.
- P1-6 (Apps Script date zone): reasoned from Apps Script's Date semantics. Only the zone arithmetic was reproduced, in Node.
- P1-7 (daily-loss definition): read from the code and the formula. The correct definition depends on RULES.md.

## Verdict: FIX-THEN-SHIP
Before shipping, fix P0-1 and P0-2. Both show a confident "flat / OK / green" number where the truth is unknown, which is the failure mode this
dashboard exists to prevent. Each fix is small and local to viewmodel.mjs and needs a regression test. P1-1 and P1-3 should go in the same pass.
P1-2 and P1-7 depend on the real rule text (RULES.md). Resolve them when the rules are filled in, and until then keep the flatten and daily-loss
semantics labelled as assumptions in the UI.

## Closure (planner, 2026-10-01)
- P0-1, P0-2, P1-1, P1-4, P1-5 (label), P1-7 (label), P2-1..P2-5: fixed by the G3 fix pass (merge of worktree-agent-a0101da4),
  each with a regression test shown failing before the fix. /tmp/g3/vm_invalid_open.mjs re-run on the merged head:
  all open-position figures, meters and sizer read UNKNOWN; flatten banner level unknown.
- P1-2 (flatten trade-date anchor), P1-3 (expiry override), P1-6 (Apps Script date zone): fixed by planner, regression
  tests failing before / passing after.
- Open, need RULES.md: P1-7 definition of daily loss for overnight positions; P1-5 back-month marks during roll.
- Open, accepted: P2-6 (1e-6 tick tolerance), P2-7 (actions pinned by tag), P2-8 (Workspace web-app URLs).
Gates on merged head: tsc clean; js 238/238; py 180/180; e2e ALL CHECKS PASSED.
Verdict after fixes: SHIP (pending human: RULES.md, secret, Sheet deploy, Pages, iPhone visual gate).
