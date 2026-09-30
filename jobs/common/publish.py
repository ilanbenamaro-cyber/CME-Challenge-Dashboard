"""Validate-then-write: every envelope is schema-checked before the atomic write; invalid output fails closed."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

import jsonschema

from jobs.common.envelope import failure_envelope, load_previous, write_atomic
from jobs.common.schema import validate

MAX_ERROR_LEN = 300


def safe_error(exc: BaseException | str, secrets: Iterable[str | None] = ()) -> str:
    """One-line error text, truncated, with any secret values redacted."""
    text = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
    for s in secrets:
        if s and len(s) >= 4:
            text = text.replace(s, "***")
    text = " ".join(text.split())
    return text if len(text) <= MAX_ERROR_LEN else text[: MAX_ERROR_LEN - 1] + "…"


def checked(dataset: str, source: str, envelope: dict, previous: dict | None, now: datetime) -> dict:
    """Return `envelope` if schema-valid; otherwise a failure envelope (keeping previous data if that is valid)."""
    try:
        validate(dataset, envelope)
        return envelope
    except jsonschema.ValidationError as exc:
        errors = [e for e in envelope.get("errors", []) if isinstance(e, str)]
        errors.append(safe_error(f"output failed schema validation: {exc.message}"))
    fallback = failure_envelope(dataset, source, previous, errors, now)
    try:
        validate(dataset, fallback)
        return fallback
    except jsonschema.ValidationError:
        errors.append("previous data also invalid; dropped")
        fallback = failure_envelope(dataset, source, None, errors, now)
        validate(dataset, fallback)
        return fallback


def same_ignoring_generated_at(a: dict | None, b: dict | None) -> bool:
    """True when both envelopes are equal apart from `generated_at` (ADR-005)."""
    if not isinstance(a, dict) or not isinstance(b, dict):
        return False
    return {k: v for k, v in a.items() if k != "generated_at"} == {k: v for k, v in b.items() if k != "generated_at"}


def publish(dataset: str, source: str, envelope: dict, out: Path, previous: dict | None, now: datetime) -> dict:
    """Schema-check `envelope` (fail closed), then write it atomically to `out`. Write errors propagate.

    ADR-005: if the file on disk already equals the result apart from `generated_at`, it is not rewritten
    (no hourly commit churn; the site's freshness uses data_as_of).
    """
    final = checked(dataset, source, envelope, previous, now)
    if not same_ignoring_generated_at(final, load_previous(out)):
        write_atomic(out, final)
    return final
