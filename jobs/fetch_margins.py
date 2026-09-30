"""Exchange margin requirements from CME (UNVERIFIED source; see jobs/config/sources.json).

`parse_margins` is pure and works on the SYNTHETIC fixture shape. An unexpected shape raises ParseError
and the job fails closed. Missing or unparsable amounts become null (UNKNOWN), never 0.
The Sheet `Margins` tab is the manual fallback (ADR-004).
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable

from jobs.common import config, http
from jobs.common.envelope import failure_envelope, load_previous, make_envelope
from jobs.common.publish import publish, safe_error
from jobs.common.scrape import FetchError, ParseError, fetch_text, get_path, parse_date, parse_number

DATASET_NAME = "margins"
ACCEPT = "application/json"
SOURCE = "CME margins via www.cmegroup.com (UNVERIFIED source and parser)"
DRY_SOURCE = "SYNTHETIC dry-run fixture (jobs/fixtures; not CME data)"

DEFAULT_HINTS: dict[str, Any] = {
    "rows_path": ["rows"],
    "as_of_path": ["asOf"],
    "as_of_formats": ["%Y-%m-%d", "%m/%d/%Y"],
    "root_field": "root",
    "initial_field": "initial",
    "maintenance_field": "maintenance",
}


def parse_margins(payload: str | bytes | dict, hints: dict | None = None,
                  roots: Iterable[str] | None = None) -> list[dict]:
    """Pure parser -> [{root, initial_usd, maintenance_usd, as_of}]. First row per root wins (front period).

    `roots` (if given) keeps only those roots, e.g. the roots in contracts.json.
    """
    h = {**DEFAULT_HINTS, **(hints or {})}
    if isinstance(payload, dict):
        obj: Any = payload
    else:
        try:
            obj = json.loads(payload)
        except (TypeError, ValueError) as exc:
            raise ParseError("unexpected shape: body is not JSON") from exc
    rows_raw = get_path(obj, h["rows_path"])
    if not isinstance(rows_raw, list):
        raise ParseError("unexpected shape: margin rows are not a list")
    if not any(isinstance(r, dict) and h["root_field"] in r for r in rows_raw):
        raise ParseError(f"unexpected shape: no row has field {h['root_field']!r}")
    try:
        as_of_date = parse_date(get_path(obj, h["as_of_path"]), h["as_of_formats"])
    except ParseError:
        as_of_date = None
    as_of = as_of_date.isoformat() if as_of_date else None
    keep = set(roots) if roots is not None else None
    out: dict[str, dict] = {}
    for r in rows_raw:
        if not isinstance(r, dict):
            raise ParseError("unexpected shape: margin row is not an object")
        root = str(r.get(h["root_field"]) or "").strip().upper()
        if not root or (keep is not None and root not in keep) or root in out:
            continue
        out[root] = {
            "root": root,
            "initial_usd": parse_number(r.get(h["initial_field"])),
            "maintenance_usd": parse_number(r.get(h["maintenance_field"])),
            "as_of": as_of,
        }
    return list(out.values())


def run(
    now: datetime,
    out: Path,
    fetch: Callable[..., Any] = http.get,
    dry_run: bool = False,
    sources: dict | None = None,
    contracts: list[dict] | None = None,
) -> dict:
    """Fetch margins, write the envelope atomically to `out`, return it."""
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

    url = cfg.get("url")
    if not url:
        return fail(["source not configured (margins url is null in jobs/config/sources.json)"])
    roots = config.all_roots(contracts)
    try:
        rows = parse_margins(fetch_text(fetch, url, ACCEPT), cfg.get("hints"), roots)
    except (FetchError, ParseError, http.HostNotAllowed) as exc:
        return fail([safe_error(str(exc))])
    except Exception as exc:  # noqa: BLE001
        return fail([safe_error(exc)])
    if not rows:
        return fail(["unexpected shape: no margin rows for configured roots"])

    errors: list[str] = []
    found = {r["root"] for r in rows}
    missing = [r for r in roots if r not in found]
    if missing:
        errors.append(f"missing roots: {', '.join(missing)}")
    for r in rows:
        blanks = [k for k in ("initial_usd", "maintenance_usd") if r[k] is None]
        if blanks:
            errors.append(f"{r['root']}: {', '.join(blanks)} missing or unparsable")
    order = {root: i for i, root in enumerate(roots)}
    rows.sort(key=lambda r: order[r["root"]])
    status = "partial" if errors else "ok"
    # The payload is the requirement in force when fetched, so its as-of time is the fetch time.
    envelope = make_envelope(DATASET_NAME, source, status, errors, {"rows": rows}, now, now)
    return publish(DATASET_NAME, source, envelope, out, previous, now)
