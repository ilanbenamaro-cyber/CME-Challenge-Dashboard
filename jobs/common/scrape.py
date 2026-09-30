"""Shared helpers for the CME page jobs: cell parsing (never 0 for missing) and fetch-to-text.

All CME page shapes are UNVERIFIED (Phase 0 recon could not reach www.cmegroup.com). Parsers are driven
by `hints` from jobs/config/sources.json so the shape can be corrected after a first live capture.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any, Callable, Iterable

from jobs.common.http import check_url

MISSING_TOKENS = frozenset({"", "-", "--", "—", "–", "n/a", "na", "none", "null"})


class ParseError(Exception):
    """The payload does not have the expected shape. The job fails closed (status:error, keep last data)."""


class FetchError(Exception):
    """Non-200 response or transport failure."""


def parse_number(cell: Any) -> float | None:
    """'$1,234.50' -> 1234.5, '(12.5)' -> -12.5, blank/'-'/garbage -> None. Never returns 0 for missing."""
    if isinstance(cell, bool) or cell is None:
        return None
    if isinstance(cell, (int, float)):
        v = float(cell)
        return v if math.isfinite(v) else None
    if not isinstance(cell, str):
        return None
    s = cell.strip().replace("−", "-")
    if s.lower() in MISSING_TOKENS:
        return None
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    s = s.replace("$", "").replace(",", "").replace(" ", "").replace("USD", "")
    if s.startswith("-$"):
        s = "-" + s[2:]
    if not re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)", s):
        return None
    v = float(s)
    if not math.isfinite(v):
        return None
    return -v if neg else v


def parse_int(cell: Any) -> int | None:
    v = parse_number(cell)
    if v is None or v != int(v):
        return None
    return int(v)


def parse_date(cell: Any, formats: Iterable[str]) -> date | None:
    """First matching strptime format, else None."""
    if not isinstance(cell, str):
        return None
    s = cell.strip()
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def is_blank(cell: Any) -> bool:
    return cell is None or (isinstance(cell, str) and cell.strip().lower() in MISSING_TOKENS)


def get_path(obj: Any, path: Iterable[str]) -> Any:
    """Follow dict keys; raise ParseError if any is absent."""
    cur = obj
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            raise ParseError(f"missing key {key!r}")
        cur = cur[key]
    return cur


def fetch_text(fetch: Callable[..., Any], url: str, accept: str) -> str:
    """Call the (allowlisted) fetch and return the body text for a 200, else raise FetchError."""
    resp = fetch(url, accept=accept)
    status = getattr(resp, "status_code", None)
    if status != 200:
        raise FetchError(f"HTTP {status} from {check_url(url)}")
    text = getattr(resp, "text", None)
    if not isinstance(text, str) or not text.strip():
        raise FetchError(f"empty body from {check_url(url)}")
    return text
