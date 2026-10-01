"""Daily settlement prices from CME (UNVERIFIED source; see jobs/config/sources.json).

`parse_settlements` is pure and works on the SYNTHETIC fixture shape. Any unexpected shape raises
ParseError, and the job then fails closed. A missing settle is dropped, never written as 0.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from jobs.common import config, http
from jobs.common.envelope import failure_envelope, load_previous, make_envelope
from jobs.common.publish import publish, safe_error
from jobs.common.scrape import FetchError, ParseError, fetch_text, get_path, parse_date, parse_number

DATASET_NAME = "settlements"
ACCEPT = "application/json"
SOURCE = "CME settlements via www.cmegroup.com (UNVERIFIED source and parser)"
DRY_SOURCE = "SYNTHETIC dry-run fixture (jobs/fixtures; not CME data)"

DEFAULT_HINTS: dict[str, Any] = {
    "rows_path": ["settlements"],
    "trade_date_path": ["tradeDate"],
    "trade_date_formats": ["%m/%d/%Y", "%Y-%m-%d"],
    "month_field": "month",
    "settle_field": "settle",
    "max_contracts": 4,
}

_MONTH_RE = re.compile(r"^([A-Z]{3})\s*'?(\d{2})$")
_ROOT_RE = re.compile(r"^[A-Z0-9]{1,4}$")


def contract_code(root: str, month_label: Any) -> str | None:
    """('ES', 'DEC 26') -> 'ESZ26'. Non-contract labels (e.g. 'Total') -> None."""
    if not isinstance(month_label, str):
        return None
    m = _MONTH_RE.match(month_label.strip().upper())
    if not m or m.group(1) not in config.MONTH_CODES:
        return None
    return f"{root}{config.MONTH_CODES[m.group(1)]}{m.group(2)}"


def _load_json(payload: str | bytes | dict) -> Any:
    if isinstance(payload, dict):
        return payload
    try:
        return json.loads(payload)
    except (TypeError, ValueError) as exc:
        raise ParseError("unexpected shape: body is not JSON") from exc


def parse_settlements(payload: str | bytes | dict, root: str, hints: dict | None = None) -> list[dict]:
    """Pure parser: payload for one root -> [{root, contract_code, settle, trade_date}], front months first."""
    h = {**DEFAULT_HINTS, **(hints or {})}
    if not _ROOT_RE.match(root or ""):
        raise ParseError(f"bad root {root!r}")
    obj = _load_json(payload)
    rows_raw = get_path(obj, h["rows_path"])
    if not isinstance(rows_raw, list):
        raise ParseError("unexpected shape: settlement rows are not a list")
    trade_date = parse_date(get_path(obj, h["trade_date_path"]), h["trade_date_formats"])
    if trade_date is None:
        raise ParseError("unexpected shape: trade date missing or unparsable")
    if rows_raw and not any(isinstance(r, dict) and h["month_field"] in r for r in rows_raw):
        raise ParseError(f"unexpected shape: no row has field {h['month_field']!r}")
    out: list[dict] = []
    for r in rows_raw:
        if not isinstance(r, dict):
            raise ParseError("unexpected shape: settlement row is not an object")
        code = contract_code(root, r.get(h["month_field"]))
        if code is None:
            continue
        settle = parse_number(r.get(h["settle_field"]))
        if settle is None:
            continue  # missing settle: drop, never 0
        out.append({"root": root, "contract_code": code, "settle": settle, "trade_date": trade_date.isoformat()})
        if len(out) >= int(h["max_contracts"]):
            break
    return out


def run(
    now: datetime,
    out: Path,
    fetch: Callable[..., Any] = http.get,
    dry_run: bool = False,
    sources: dict | None = None,
    contracts: list[dict] | None = None,
) -> dict:
    """Fetch every configured root, write the envelope atomically to `out`, return it."""
    if dry_run:
        from jobs.common.fakes import SOURCES_FIXTURE, fixture_fetch

        fetch = fixture_fetch
        sources = config.load_sources(SOURCES_FIXTURE) if sources is None else sources
    sources = config.load_sources() if sources is None else sources
    contracts = config.load_contracts() if contracts is None else contracts
    source = DRY_SOURCE if dry_run else SOURCE
    previous = load_previous(out)
    cfg = sources.get(DATASET_NAME) or {}

    def fail(errors: list[str]) -> dict:
        return publish(DATASET_NAME, source, failure_envelope(DATASET_NAME, source, previous, errors, now),
                       out, previous, now)

    template = cfg.get("url_template")
    known = set(config.all_roots(contracts))
    products = {r: p for r, p in (cfg.get("products") or {}).items() if r in known}
    if not template or not products:
        return fail(["source not configured (settlements url_template/products in jobs/config/sources.json)"])

    rows: list[dict] = []
    errors: list[str] = []
    for root, product in products.items():
        try:
            url = template.format(product_id=product["product_id"])
            got = parse_settlements(fetch_text(fetch, url, ACCEPT), root, cfg.get("hints"))
        except (FetchError, ParseError, http.HostNotAllowed) as exc:
            errors.append(f"{root}: {safe_error(str(exc))}")
            continue
        except Exception as exc:  # noqa: BLE001 - one root never blocks the others
            errors.append(f"{root}: {safe_error(exc)}")
            continue
        if not got:
            errors.append(f"{root}: no settlement rows parsed")
            continue
        rows.extend(got)

    if not rows:
        return fail(errors or ["no settlement rows parsed"])
    oldest = min(date.fromisoformat(r["trade_date"]) for r in rows)
    data_as_of = min(config.ct_close_utc(oldest), now)
    status = "partial" if errors else "ok"
    envelope = make_envelope(DATASET_NAME, source, status, errors, {"rows": rows}, data_as_of, now)
    return publish(DATASET_NAME, source, envelope, out, previous, now)
