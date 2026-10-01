"""D7 envelope helpers: build, fail closed (keeping last good data), load and write atomically."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

SCHEMA_VERSION = 1

Status = Literal["ok", "partial", "error"]


def utc_now() -> datetime:
    """Current time as a tz-aware UTC datetime (seconds precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso_utc(dt: datetime) -> str:
    """ISO-8601 UTC with a trailing Z, e.g. 2026-09-30T15:00:00Z. Naive datetimes are rejected."""
    if dt.tzinfo is None:
        raise ValueError("naive datetime; pass a tz-aware value")
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_envelope(
    dataset: str,
    source: str,
    status: Status,
    errors: list[str],
    data: dict | None,
    data_as_of: datetime | None,
    generated_at: datetime,
) -> dict:
    """Build a D7 envelope. `status='error'` never carries fresh data from this call path's caller."""
    if status not in ("ok", "partial", "error"):
        raise ValueError(f"bad status {status!r}")
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset": dataset,
        "generated_at": iso_utc(generated_at),
        "data_as_of": iso_utc(data_as_of) if data_as_of is not None else None,
        "source": source,
        "status": status,
        "errors": [str(e) for e in errors],
        "data": data,
    }


def failure_envelope(
    dataset: str,
    source: str,
    previous: dict | None,
    errors: list[str],
    generated_at: datetime,
) -> dict:
    """status='error' envelope that keeps the last good `data` and `data_as_of` (D7).

    `previous` is only trusted when it is a dict for the same dataset; anything else is treated as absent.
    """
    keep_data = None
    keep_as_of = None
    if isinstance(previous, dict) and previous.get("dataset") == dataset:
        keep_data = previous.get("data")
        as_of = previous.get("data_as_of")
        keep_as_of = as_of if isinstance(as_of, str) else None
        if keep_data is None:
            keep_as_of = None
    return {
        "schema_version": SCHEMA_VERSION,
        "dataset": dataset,
        "generated_at": iso_utc(generated_at),
        "data_as_of": keep_as_of,
        "source": source,
        "status": "error",
        "errors": [str(e) for e in errors] or ["unknown error"],
        "data": keep_data,
    }


def load_previous(path: Path) -> dict | None:
    """Last written envelope, or None when the file is missing, unreadable or not a JSON object. Never raises."""
    try:
        obj: Any = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - by contract this never raises
        return None
    return obj if isinstance(obj, dict) else None


def dumps(obj: dict) -> str:
    """Canonical file text: 2-space indent, UTF-8, trailing newline."""
    return json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def write_atomic(path: Path, obj: dict) -> None:
    """Write JSON via a temp file in the same directory + os.replace. No partial file is ever left behind."""
    path = Path(path)
    text = dumps(obj)  # serialise first: a bad object raises before any file is touched
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
