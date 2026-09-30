# WP-JOBS: producers, workflow, Apps Script

Branch `feat/jobs`.

## Owned paths
- `jobs/**` (package: `jobs/__init__.py`, `jobs/common/`, `jobs/config/`, `jobs/fixtures/`)
- `tests/py/**`
- `.github/workflows/refresh.yml`
- `apps_script/**` (`Code.gs`, `appsscript.json`, `README.md`)
- `requirements.txt`
- Seed files `docs/data/{bars,settlements,margins,challenge}.json` (initial envelope only; the bot owns them afterwards)

## Forbidden
`docs/js/**`, `docs/index.html`, `docs/css/**`, `plan/**`, `tests/golden/**`, `tests/boundary/**`,
`docs/data/{rules,contracts,calendar}.json`, `.github/workflows/ci.yml`.

## Frozen inputs
- Output shapes: `plan/schemas/{bars,settlements,margins,challenge,calendar}.schema.json` (D7 envelope).
- Apps Script response: `plan/schemas/sheet.schema.json`.
- Contract list: `docs/data/contracts.json` (read-only). Parents (`parent == null`) are the bar roots;
  `aliases` maps each micro to its parent.
- Boundary tests: `tests/boundary/test_boundary_jobs.py`. It must pass. Read it first.

## Modules and signatures (Python 3.11, type-hinted)
- `jobs/common/envelope.py`
  - `utc_now() -> datetime`
  - `make_envelope(dataset: str, source: str, status: Literal['ok','partial','error'], errors: list[str], data: dict | None, data_as_of: datetime | None, generated_at: datetime) -> dict`
  - `failure_envelope(dataset: str, source: str, previous: dict | None, errors: list[str], generated_at: datetime) -> dict`
    keeps `previous.data` and `previous.data_as_of` (D7), with `status="error"`
  - `load_previous(path: Path) -> dict | None`: returns None on missing or corrupt files, never raises
  - `write_atomic(path: Path, obj: dict) -> None`: temp file in the same dir, then `os.replace`, 2-space indent, trailing newline
- `jobs/common/schema.py`: `validate(dataset: str, obj: dict) -> None` against `plan/schemas/<dataset>.schema.json` (raises)
- `jobs/common/http.py`: `ALLOWED_HOSTS = frozenset({...})`, which must be a literal of `*.cmegroup.com` hosts only
  (the boundary test parses it). `get(url: str, *, timeout: float = 20, accept: str = ...) -> requests.Response`
  raises `HostNotAllowed` before any I/O for a non-allowlisted or non-https URL. Honest User-Agent, 2 retries
  with backoff on 5xx/connection errors, no retry on 4xx.
- `jobs/fetch_bars.py`: `run(now: datetime, out: Path, client_factory=..., dry_run=False) -> dict`
  - dataset `GLBX.MDP3`, schema `ohlcv-1h`, `stype_in="continuous"`, symbols `<ROOT>.c.0` for parent roots
  - lookback 72h (`[now-72h floored to hour, now floored to hour)`); keep the last 72 bars per root
  - **call `client.metadata.get_cost(...)` with the exact same params before `client.timeseries.get_range(...)`**,
    accumulate the run's cost, and abort (failure envelope, error "cost cap") if the projected total is > $2.00. No spend happens on abort
  - `DATABENTO_API_KEY` from env. If it is missing, write a failure envelope ("DATABENTO_API_KEY not set")
  - output `data = {roots: {ES: {symbol: "ES.c.0", bars: [...]}}, aliases: {MES: "ES", ...}, cost_usd}`
    with prices as floats, `t` ISO UTC of bar open, `data_as_of` = the latest bar open + 1h (bar close) or run time, whichever is earlier
  - `status="partial"` if some roots returned no bars
- `jobs/fetch_margins.py`, `jobs/fetch_settlements.py`, `jobs/fetch_challenge.py`:
  `run(now, out, fetch=http.get, dry_run=False) -> dict` + a pure `parse_*(payload) -> rows`.
  - URLs, account id and parse hints come from `jobs/config/sources.json`, each marked `"verified": false`
    (recon could not reach CME, see outbox). Parsers work against **synthetic fixtures** in `jobs/fixtures/`,
    each labelled SYNTHETIC in its filename. On an unexpected shape, raise `ParseError` → failure envelope. Never emit
    zeros for missing cells: use null, or drop the row and add an error (`partial`).
  - margins rows: `{root, initial_usd, maintenance_usd, as_of}`, only for roots in contracts.json
  - settlements rows: `{root, contract_code, settle, trade_date}`
  - challenge rows: `{date, account, pnl_usd, balance_usd, rank}`, filtered to the configured account
- `jobs/validate_calendar.py`: validates human-maintained `docs/data/calendar.json` against its schema. It does not write.
- `jobs/refresh.py`: `python -m jobs.refresh [--only a,b] [--dry-run] [--data-dir DIR]` runs each job in isolation
  (one failing job never blocks others). Every output is schema-validated **before** the atomic write, and an invalid
  output becomes a failure envelope. Exit code 0 unless a write itself fails. Prints a one-line summary per dataset.
  `--dry-run` uses the fixtures and a fake Databento client, with no network.

## refresh.yml
- Triggers: `schedule: - cron: '7 * * * 0-5'` and `workflow_dispatch`.
- `permissions:` must be exactly `contents: write` (the boundary test checks this). `concurrency: refresh` with no cancel.
- Steps: checkout, setup-python 3.11 (pip cache), `pip install -r requirements.txt`, then
  `python -m jobs.refresh` with `env: DATABENTO_API_KEY: ${{ secrets.DATABENTO_API_KEY }}` on that step only.
  Commit only `docs/data/{bars,settlements,margins,challenge}.json` if changed, as
  `github-actions[bot]`, message `data: refresh <UTC timestamp>`, `git pull --rebase` then push (retry once).
- Never echo secrets. No `pull_request_target`.

## Apps Script (D6)
`apps_script/Code.gs` `doGet(e)`: constant-time compare of `e.parameter.key` against Script Property `SHEET_KEY`.
On mismatch or absence return `{error: "unauthorized"}`. Otherwise read tabs `Trades`, `Daily` and the optional `Margins`
(header row → keys, blank → `""`, Date cells → ISO-8601 with offset via `Utilities.formatDate(d, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX")`,
Daily.date → `yyyy-MM-dd`) and return `{schema_version: 1, generated_at, tabs: {...}}` as JSON via ContentService.
Read-only: no writes to the sheet. `apps_script/README.md` has the deploy steps (Execute as: me; Access: anyone;
set `SHEET_KEY` as a Script Property; paste the /exec URL and key into the dashboard settings, never into the repo).

## Seed data
Commit `docs/data/{bars,settlements,margins,challenge}.json` as failure envelopes
(`status:"error"`, `errors:["not yet fetched"]`, `data:null`, `data_as_of:null`) that validate against the schemas.

## Tests (`tests/py/`)
Cover the envelope helpers, atomic write (no partial file on exception), failure keeping previous data, the http allowlist
(rejects `http://`, other hosts, and lookalikes like `cmegroup.com.evil.io`), bars with a fake client (asserts get_cost is
called before get_range with identical params, cap abort does zero get_range calls, micro aliases, partial on
missing root), each parser on its SYNTHETIC fixture plus malformed input → ParseError, refresh isolation (one job
raising still writes the others), and schema validation of every produced envelope.

## Gate commands
```
python3 -m pytest -q tests/py tests/boundary/test_boundary_jobs.py
python3 -m jobs.refresh --dry-run --data-dir "$(mktemp -d)"
```

## Acceptance items
A9, A10, the jobs part of A11, A14 (workflow + secret handling), the jobs part of A12.
