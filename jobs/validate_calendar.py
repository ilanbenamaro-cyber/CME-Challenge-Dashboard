"""Validate the human-maintained docs/data/calendar.json (ADR-003). Read-only: never writes."""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import jsonschema

from jobs.common import config
from jobs.common.schema import validate

DATASET_NAME = "calendar"
CALENDAR_PATH = config.DEFAULT_DATA_DIR / "calendar.json"


def check(obj: dict, known_roots: set[str]) -> list[str]:
    """Schema errors plus checks the schema cannot express (real calendar dates, known roots)."""
    try:
        validate(DATASET_NAME, obj)
    except jsonschema.ValidationError as exc:
        return [f"schema: {exc.message}"]
    errors: list[str] = []
    data = obj.get("data") or {}
    for i, ev in enumerate(data.get("events", [])):
        try:
            date.fromisoformat(ev["date"])
        except ValueError:
            errors.append(f"events[{i}]: invalid date {ev['date']}")
    for i, ex in enumerate(data.get("expirations", [])):
        try:
            date.fromisoformat(ex["date"])
        except ValueError:
            errors.append(f"expirations[{i}]: invalid date {ex['date']}")
        if ex["root"] not in known_roots:
            errors.append(f"expirations[{i}]: unknown root {ex['root']}")
        if not ex["contract_code"].startswith(ex["root"]):
            errors.append(f"expirations[{i}]: contract_code {ex['contract_code']} does not match root {ex['root']}")
    return errors


def run(now: datetime, path: Path = CALENDAR_PATH, contracts: list[dict] | None = None) -> dict:
    """Return a summary {dataset, status: 'ok'|'error', errors, data_as_of}. Does not write anything."""
    contracts = config.load_contracts() if contracts is None else contracts
    try:
        obj = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {"dataset": DATASET_NAME, "status": "error", "errors": [f"unreadable: {exc}"], "data_as_of": None}
    if not isinstance(obj, dict):
        return {"dataset": DATASET_NAME, "status": "error", "errors": ["not a JSON object"], "data_as_of": None}
    errors = check(obj, set(config.all_roots(contracts)))
    return {
        "dataset": DATASET_NAME,
        "status": "error" if errors else "ok",
        "errors": errors,
        "data_as_of": obj.get("data_as_of"),
    }
