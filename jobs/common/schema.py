"""Validate envelopes against the frozen schemas in plan/schemas/ (read-only for WP-JOBS)."""
from __future__ import annotations

import json
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = REPO_ROOT / "plan" / "schemas"

_RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def _is_datetime(value: object) -> bool:
    """Strict RFC 3339 date-time (offset required). Non-strings pass: `type` is checked separately."""
    if not isinstance(value, str):
        return True
    if not _RFC3339.match(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


_FORMATS = jsonschema.FormatChecker()
# jsonschema checks date-time only when the optional rfc3339-validator is installed; enforce it locally.
_FORMATS.checks("date-time")(_is_datetime)


@lru_cache(maxsize=None)
def _validator(dataset: str) -> jsonschema.protocols.Validator:
    if not dataset.replace("_", "").isalnum():
        raise ValueError(f"bad dataset name {dataset!r}")
    schema = json.loads((SCHEMA_DIR / f"{dataset}.schema.json").read_text(encoding="utf-8"))
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)
    return cls(schema, format_checker=_FORMATS)


def validate(dataset: str, obj: dict) -> None:
    """Raise jsonschema.ValidationError if `obj` does not match plan/schemas/<dataset>.schema.json."""
    _validator(dataset).validate(obj)
