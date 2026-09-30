"""Challenge daily results from CME (UNVERIFIED source; see jobs/config/sources.json).

`parse_challenge` is pure and works on the SYNTHETIC HTML fixture shape. An unexpected shape raises
ParseError and the job fails closed. Blank or unparsable amounts become null (UNKNOWN), never 0.
"""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from bs4 import BeautifulSoup

from jobs.common import config, http
from jobs.common.envelope import failure_envelope, load_previous, make_envelope
from jobs.common.publish import publish, safe_error
from jobs.common.scrape import FetchError, ParseError, fetch_text, is_blank, parse_date, parse_int, parse_number

DATASET_NAME = "challenge"
ACCEPT = "text/html"
SOURCE = "CME challenge results via www.cmegroup.com (UNVERIFIED source and parser)"
DRY_SOURCE = "SYNTHETIC dry-run fixture (jobs/fixtures; not CME data)"

DEFAULT_HINTS: dict[str, Any] = {
    "table_selector": "table",
    "columns": {"date": "Date", "account": "Account", "pnl_usd": "P&L", "balance_usd": "Balance", "rank": "Rank"},
    "date_formats": ["%m/%d/%Y", "%Y-%m-%d"],
}


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def parse_challenge(payload: str | bytes, account: str | None = None, hints: dict | None = None) -> list[dict]:
    """Pure parser -> [{date, account, pnl_usd, balance_usd, rank}], filtered to `account` when given."""
    h = {**DEFAULT_HINTS, **(hints or {})}
    if not isinstance(payload, (str, bytes)) or not payload:
        raise ParseError("unexpected shape: empty payload")
    soup = BeautifulSoup(payload, "html.parser")
    wanted = {k: _norm(v) for k, v in h["columns"].items()}
    table_rows: list[Any] = []
    index: dict[str, int] = {}
    for table in soup.select(h["table_selector"]):
        trs = table.find_all("tr")
        if not trs:
            continue
        header = [_norm(c.get_text()) for c in trs[0].find_all(["th", "td"])]
        if all(label in header for label in wanted.values()):
            index = {k: header.index(label) for k, label in wanted.items()}
            table_rows = trs[1:]
            break
    if not index:
        raise ParseError(f"unexpected shape: no table with columns {sorted(h['columns'].values())}")

    want_acct = account.strip().lower() if account else None
    need = max(index.values())
    by_date: dict[str, dict] = {}
    for tr in table_rows:
        cells = [" ".join(c.get_text().split()) for c in tr.find_all(["td", "th"])]
        if len(cells) <= need:
            continue  # footer / "no results" rows with colspan
        raw_date = cells[index["date"]]
        if is_blank(raw_date):
            continue
        d = parse_date(raw_date, h["date_formats"])
        if d is None:
            raise ParseError(f"unexpected shape: unparsable date {raw_date[:40]!r}")
        acct = cells[index["account"]].strip()
        if want_acct is not None and acct.lower() != want_acct:
            continue
        key = f"{d.isoformat()}|{acct}"
        by_date[key] = {
            "date": d.isoformat(),
            "account": acct,
            "pnl_usd": parse_number(cells[index["pnl_usd"]]),
            "balance_usd": parse_number(cells[index["balance_usd"]]),
            "rank": parse_int(cells[index["rank"]]),
        }
    return [by_date[k] for k in sorted(by_date)]


def run(
    now: datetime,
    out: Path,
    fetch: Callable[..., Any] = http.get,
    dry_run: bool = False,
    sources: dict | None = None,
) -> dict:
    """Fetch challenge results for the configured account, write the envelope atomically to `out`, return it."""
    if dry_run:
        from jobs.common.fakes import SOURCES_FIXTURE, fixture_fetch

        fetch = fixture_fetch
        sources = config.load_sources(SOURCES_FIXTURE) if sources is None else sources
    sources = config.load_sources() if sources is None else sources
    source = DRY_SOURCE if dry_run else SOURCE
    previous = load_previous(out)
    cfg = sources.get(DATASET_NAME) or {}

    def fail(errors: list[str]) -> dict:
        return publish(DATASET_NAME, source, failure_envelope(DATASET_NAME, source, previous, errors, now),
                       out, previous, now)

    url, account = cfg.get("url"), cfg.get("account")
    if not url or not account:
        return fail(["source not configured (challenge url/account is null in jobs/config/sources.json)"])
    try:
        rows = parse_challenge(fetch_text(fetch, url, ACCEPT), str(account), cfg.get("hints"))
    except (FetchError, ParseError, http.HostNotAllowed) as exc:
        return fail([safe_error(str(exc))])
    except Exception as exc:  # noqa: BLE001
        return fail([safe_error(exc)])
    if not rows:
        return fail(["configured account not found in results"])

    errors = [f"{r['date']}: {k} missing or unparsable" for r in rows
              for k in ("pnl_usd", "balance_usd") if r[k] is None]
    latest = max(date.fromisoformat(r["date"]) for r in rows)
    data_as_of = min(config.ct_close_utc(latest), now)
    status = "partial" if errors else "ok"
    envelope = make_envelope(DATASET_NAME, source, status, errors, {"rows": rows}, data_as_of, now)
    return publish(DATASET_NAME, source, envelope, out, previous, now)
