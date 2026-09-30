"""Read-only access to docs/data/contracts.json (planner-owned) and jobs/config/sources.json."""
from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS_PATH = REPO_ROOT / "docs" / "data" / "contracts.json"
SOURCES_PATH = REPO_ROOT / "jobs" / "config" / "sources.json"
FIXTURES_DIR = REPO_ROOT / "jobs" / "fixtures"
DEFAULT_DATA_DIR = REPO_ROOT / "docs" / "data"

CT = ZoneInfo("America/Chicago")

MONTH_CODES = {"JAN": "F", "FEB": "G", "MAR": "H", "APR": "J", "MAY": "K", "JUN": "M",
               "JUL": "N", "AUG": "Q", "SEP": "U", "OCT": "V", "NOV": "X", "DEC": "Z"}


def load_contracts(path: Path = CONTRACTS_PATH) -> list[dict]:
    return list(json.loads(Path(path).read_text(encoding="utf-8"))["contracts"])


def all_roots(contracts: list[dict]) -> list[str]:
    return [c["root"] for c in contracts]


def parent_roots(contracts: list[dict]) -> list[str]:
    """Roots with parent == null: these are the bar roots."""
    return [c["root"] for c in contracts if c.get("parent") is None]


def aliases(contracts: list[dict]) -> dict[str, str]:
    """Micro root -> parent root (MES -> ES, ...)."""
    return {c["root"]: c["parent"] for c in contracts if c.get("parent")}


def load_sources(path: Path = SOURCES_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def ct_close_utc(d: date, hhmm: str = "16:00") -> datetime:
    """`d` at hh:mm America/Chicago, as a UTC datetime (DST-aware via zoneinfo, never a fixed offset)."""
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.combine(d, time(h, m), tzinfo=CT).astimezone(timezone.utc)
