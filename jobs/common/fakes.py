"""Offline stand-ins for --dry-run: a fake Databento client and a fixture-backed fetch.

Everything produced here is SYNTHETIC (deterministic made-up numbers) and is labelled as such in the
envelope `source`. It exercises the code paths without network access; it says nothing about real markets.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from jobs.common import http
from jobs.common.config import FIXTURES_DIR

BARS_FIXTURE = FIXTURES_DIR / "bars.SYNTHETIC.json"
ROUTES_FIXTURE = FIXTURES_DIR / "routes.SYNTHETIC.json"
SOURCES_FIXTURE = FIXTURES_DIR / "sources.SYNTHETIC.json"


def _parse_ts(value: Any) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def synthetic_frame(symbol: str, start: datetime, end: datetime, base: float, tick: float) -> Any:
    """Deterministic hourly OHLCV DataFrame shaped like DBNStore.to_df() for ohlcv-1h."""
    import pandas as pd

    rows, index = [], []
    t = start
    i = 0
    while t < end:
        if not (t.weekday() == 5 or (t.weekday() == 6 and t.hour < 22)):  # rough weekend gap
            mid = base + tick * round(40 * math.sin(i / 7.0))
            o = mid
            c = mid + tick * round(6 * math.sin(i / 3.0))
            h = max(o, c) + tick * 4
            lo = min(o, c) - tick * 4
            rows.append({"rtype": 34, "publisher_id": 1, "instrument_id": 1000 + len(symbol),
                         "open": o, "high": h, "low": lo, "close": c, "volume": 1000 + 17 * (i % 13),
                         "symbol": symbol})
            index.append(t)
        t += timedelta(hours=1)
        i += 1
    df = pd.DataFrame(rows, index=pd.DatetimeIndex(index, name="ts_event"))
    return df


class _Store:
    def __init__(self, df: Any) -> None:
        self._df = df

    def to_df(self, **_kw: Any) -> Any:
        return self._df


class _Metadata:
    def get_cost(self, **params: Any) -> float:
        return 0.0001 * len(params.get("symbols") or [])


class _Timeseries:
    def __init__(self, fixture: dict) -> None:
        self._fixture = fixture

    def get_range(self, **params: Any) -> _Store:
        import pandas as pd

        (symbol,) = params["symbols"]
        root = symbol.split(".")[0]
        spec = self._fixture["roots"].get(root)
        if spec is None:
            if root in self._fixture.get("empty_roots", []):
                return _Store(pd.DataFrame(columns=["open", "high", "low", "close", "volume", "symbol"]))
            # Roots added to contracts.json after the fixture was written (e.g. ZT/ZN/HO) get generic
            # SYNTHETIC bars so a dry run stays complete; prices are placeholders, never published.
            spec = {"base": 100.0, "tick": 0.01}
        start, end = _parse_ts(params["start"]), _parse_ts(params["end"])
        return _Store(synthetic_frame(symbol, start, end, float(spec["base"]), float(spec["tick"])))


class FakeDatabentoClient:
    """Mimics the parts of databento.Historical used by fetch_bars (metadata.get_cost, timeseries.get_range)."""

    def __init__(self, fixture_path: Path = BARS_FIXTURE) -> None:
        fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
        self.metadata = _Metadata()
        self.timeseries = _Timeseries(fixture)


class FakeResponse:
    def __init__(self, status_code: int, text: str, content_type: str) -> None:
        self.status_code = status_code
        self.text = text
        self.content = text.encode("utf-8")
        self.headers = {"Content-Type": content_type}

    def json(self) -> Any:
        return json.loads(self.text)


def fixture_fetch(url: str, *, timeout: float = 20, accept: str = http.DEFAULT_ACCEPT) -> FakeResponse:
    """Drop-in for http.get that serves SYNTHETIC fixtures. Enforces the same allowlist, never does I/O."""
    http.check_url(url)
    routes = json.loads(ROUTES_FIXTURE.read_text(encoding="utf-8"))["routes"]
    name = routes.get(url)
    if name is None:
        return FakeResponse(404, "not found", "text/plain")
    path = FIXTURES_DIR / name
    ctype = "application/json" if name.endswith(".json") else "text/html; charset=utf-8"
    return FakeResponse(200, path.read_text(encoding="utf-8"), ctype)
