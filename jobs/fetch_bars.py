"""Hourly OHLCV bars from Databento (D5), cost-checked before any spend (A10).

For each parent root, metadata.get_cost is called with exactly the same parameters that will later be
passed to timeseries.get_range. All costs are projected first; if the run total is over COST_CAP_USD the
job aborts with zero range requests. Micro roots are aliased to their parent's bars.

Symbology note (databento 0.87.0, checked by introspection of DBNStore.to_df / InstrumentMap): with
stype_in="continuous" and the default stype_out="instrument_id", to_df(map_symbols=True) fills the
`symbol` column with the *requested* continuous symbol (e.g. "ES.c.0"), resolved per instrument_id and
date from the response metadata. The index is ts_event (bar open) because ohlcv has no ts_recv.
"""
from __future__ import annotations

import math
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from jobs.common import config
from jobs.common.envelope import failure_envelope, load_previous, make_envelope
from jobs.common.publish import publish, safe_error

DATASET_NAME = "bars"
DB_DATASET = "GLBX.MDP3"
DB_SCHEMA = "ohlcv-1h"
STYPE_IN = "continuous"
LOOKBACK = timedelta(hours=72)
KEEP_BARS = 72
COST_CAP_USD = 2.00
SOURCE = f"Databento {DB_DATASET} {DB_SCHEMA} (stype_in={STYPE_IN}, <ROOT>.c.0)"
DRY_SOURCE = "SYNTHETIC dry-run fixture (fake Databento client; not market data)"


def default_client_factory(key: str) -> Any:
    import databento  # imported lazily so tests and dry runs never need network or a key

    return databento.Historical(key=key)


def symbol_for(root: str) -> str:
    return f"{root}.c.0"


def window(now: datetime) -> tuple[datetime, datetime]:
    """[now - 72h, now) with both ends floored to the hour, in UTC."""
    end = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return end - LOOKBACK, end


_LICENSE_END_RE = re.compile(r"dataset_unavailable_range.*?end time before (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", re.S)


def licensed_end(exc: BaseException) -> datetime | None:
    """If Databento refused the range because the account's license only covers data up to some time
    (422 dataset_unavailable_range, e.g. no live CME license -> data delayed), return that time floored
    to the hour (UTC). Otherwise None."""
    m = _LICENSE_END_RE.search(str(exc))
    if not m:
        return None
    t = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    return t.replace(minute=0, second=0, microsecond=0)


def request_params(root: str, start: datetime, end: datetime) -> dict:
    """The one parameter set used for BOTH get_cost and get_range for a root."""
    return {
        "dataset": DB_DATASET,
        "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "symbols": [symbol_for(root)],
        "schema": DB_SCHEMA,
        "stype_in": STYPE_IN,
    }


def _num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def frame_to_bars(df: Any, symbol: str) -> tuple[list[dict], int]:
    """Convert a Databento ohlcv DataFrame to schema bars. Returns (bars sorted by t, rows dropped).

    Rows whose `symbol` column is present and differs from the requested symbol are dropped, as are rows
    with a non-finite price or volume (never replaced by 0).
    """
    bars: dict[str, dict] = {}
    dropped = 0
    has_symbol = "symbol" in getattr(df, "columns", [])
    for ts, row in df.iterrows():
        if has_symbol and row["symbol"] != symbol:
            dropped += 1
            continue
        o, h, l, c, v = (_num(row.get(k)) for k in ("open", "high", "low", "close", "volume"))
        if None in (o, h, l, c, v) or v < 0:  # type: ignore[operator]
            dropped += 1
            continue
        t = _ts_utc(ts)
        if t is None:
            dropped += 1
            continue
        key = t.strftime("%Y-%m-%dT%H:%M:%SZ")
        bars[key] = {"t": key, "o": o, "h": h, "l": l, "c": c, "v": v}
    ordered = [bars[k] for k in sorted(bars)]
    return ordered[-KEEP_BARS:], dropped


def _ts_utc(ts: Any) -> datetime | None:
    if hasattr(ts, "to_pydatetime"):
        ts = ts.to_pydatetime()
    if not isinstance(ts, datetime) or ts.tzinfo is None:
        return None
    return ts.astimezone(timezone.utc)


def run(
    now: datetime,
    out: Path,
    client_factory: Callable[[str], Any] = default_client_factory,
    dry_run: bool = False,
    env: Mapping[str, str] | None = None,
    contracts: list[dict] | None = None,
) -> dict:
    """Fetch bars, write the envelope atomically to `out`, return it."""
    env = os.environ if env is None else env
    contracts = config.load_contracts() if contracts is None else contracts
    previous = load_previous(out)
    source = DRY_SOURCE if dry_run else SOURCE

    def fail(errors: list[str]) -> dict:
        return publish(DATASET_NAME, source, failure_envelope(DATASET_NAME, source, previous, errors, now),
                       out, previous, now)

    if dry_run:
        from jobs.common.fakes import FakeDatabentoClient

        key = "dry-run"
        client = FakeDatabentoClient()
    else:
        key = env.get("DATABENTO_API_KEY", "").strip()
        if not key:
            return fail(["DATABENTO_API_KEY not set"])
        try:
            client = client_factory(key)
        except Exception as exc:  # noqa: BLE001
            return fail([safe_error(exc, [key])])

    roots = config.parent_roots(contracts)
    start, end = window(now)
    errors: list[str] = []

    # 1) Project the cost of every request before spending anything.
    planned: list[tuple[str, dict]] = []
    total = 0.0
    for root in roots:
        params = request_params(root, start, end)
        try:
            cost = _num(client.metadata.get_cost(**params))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{root}: cost check failed: {safe_error(exc, [key])}")
            continue
        if cost is None or cost < 0:
            errors.append(f"{root}: cost check returned an invalid value")
            continue
        total += cost
        planned.append((root, params))
    if total > COST_CAP_USD:
        return fail(errors + [f"cost cap: projected ${total:.4f} > ${COST_CAP_USD:.2f}; nothing requested"])
    if not planned:
        return fail(errors or ["no roots to request"])

    # 2) Spend: identical params to the cost check.
    result_roots: dict[str, dict] = {}
    latest: datetime | None = None
    delayed_to: datetime | None = None

    def delayed_params(root: str) -> dict:
        """Params for the licensed (delayed) window, cost-checked against the cap before any spend (A10)."""
        nonlocal total
        assert delayed_to is not None
        p = request_params(root, delayed_to - LOOKBACK, delayed_to)
        cost = _num(client.metadata.get_cost(**p))
        if cost is None or cost < 0 or total + cost > COST_CAP_USD:
            raise RuntimeError("cost check for the licensed window failed or exceeds the cost cap")
        total += cost
        return p

    for root, params in planned:
        symbol = symbol_for(root)
        try:
            if delayed_to is not None:
                params = delayed_params(root)
            try:
                store = client.timeseries.get_range(**params)
            except Exception as exc:  # noqa: BLE001
                lic_end = licensed_end(exc)
                if lic_end is None or delayed_to is not None or lic_end >= end:
                    raise
                # License only covers data up to lic_end (no live CME license): re-check the cost of that window,
                # keep the cap, retry once. The bars are then delayed and the site marks them STALE by their age.
                delayed_to = lic_end
                params = delayed_params(root)
                store = client.timeseries.get_range(**params)
            df = store.to_df()
            bars, dropped = frame_to_bars(df, symbol)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{root}: range request failed: {safe_error(exc, [key])}")
            continue
        if dropped:
            errors.append(f"{root}: dropped {dropped} unusable bar rows")
        if not bars:
            errors.append(f"{root}: no bars returned")
            continue
        result_roots[root] = {"symbol": symbol, "bars": bars}
        last_open = datetime.fromisoformat(bars[-1]["t"].replace("Z", "+00:00"))
        latest = last_open if latest is None else max(latest, last_open)

    if not result_roots or latest is None:
        return fail(errors or ["no bars returned for any root"])

    missing = [r for r in roots if r not in result_roots]
    status = "partial" if missing else "ok"
    if missing:
        errors.append(f"missing roots: {', '.join(missing)}")
    data = {
        "roots": result_roots,
        "aliases": config.aliases(contracts),
        "cost_usd": round(total, 6),
    }
    data_as_of = min(latest + timedelta(hours=1), now)
    if delayed_to is not None:
        source = f"{source}; delayed: Databento license covers data up to {delayed_to:%Y-%m-%dT%H:%MZ} (no live CME license)"
    envelope = make_envelope(DATASET_NAME, source, status, errors, data, data_as_of, now)
    return publish(DATASET_NAME, source, envelope, out, previous, now)
