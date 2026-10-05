"""Hourly OHLCV bars from Databento (D5), cost-checked before any spend (A10).

For each parent root, metadata.get_cost is called with exactly the same parameters that will later be
passed to timeseries.get_range. Fetches are incremental: each root starts at its last published bar (merged,
last 72 kept), so an hourly run costs ~1-2 bars per root. All costs are projected first; if the run total is over COST_CAP_USD the
job aborts with zero range requests. Micro roots are aliased to their parent's bars.

Symbology note (databento 0.87.0, checked by introspection of DBNStore.to_df / InstrumentMap): with
stype_in="continuous" and the default stype_out="instrument_id", to_df(map_symbols=True) fills the
`symbol` column with the *requested* continuous symbol (e.g. "ES.c.0"), resolved per instrument_id and
date from the response metadata. The index is ts_event (bar open) because ohlcv has no ts_recv.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
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
DEPTH = 3  # continuous months per root (<ROOT>.c.0 .. c.2) so back-month positions get their own marks (ADR-010)
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
_AVAILABLE_END_RE = re.compile(r"data_end_after_available_end.*?available up to '(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})", re.S)


def _floor_hour(t: datetime) -> datetime:
    return t.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def licensed_end(exc: BaseException) -> datetime | None:
    """If Databento refused a request because data is only available up to some time, return that time floored
    to the hour (UTC); otherwise None. Two 422s carry it:
      - dataset_unavailable_range: the account's license ends earlier (no live CME license -> ~8h delay);
      - data_end_after_available_end: the dataset itself is only published up to that time."""
    text = str(exc)
    m = _LICENSE_END_RE.search(text) or _AVAILABLE_END_RE.search(text)
    if not m:
        return None
    t = datetime.strptime(m.group(1).replace(" ", "T"), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    return _floor_hour(t)


_SERVER_ERROR_RE = re.compile(r"BentoServerError|\b5\d\d\b.*(gateway|timed out|unavailable|internal)", re.I)
RETRY_SLEEP_S = 5.0


def get_range_with_retry(client: Any, params: dict, sleep: Callable[[float], None] = time.sleep) -> Any:
    """timeseries.get_range, retried once after a short pause on a Databento server-side error (5xx, e.g.
    '504 The remote gateway timed out', seen on Actions 2026-10-01). Same params, already cost-checked (A10);
    a failed request is not billed. Client errors (4xx) are never retried here."""
    try:
        return client.timeseries.get_range(**params)
    except Exception as exc:  # noqa: BLE001
        if not _SERVER_ERROR_RE.search(str(exc)) and type(exc).__name__ != "BentoServerError":
            raise
        sleep(RETRY_SLEEP_S)
        return client.timeseries.get_range(**params)


def entitled_end(client: Any) -> datetime | None:
    """Latest time the account may request for the bars schema (metadata.get_dataset_range is documented as
    'the available range for the dataset given the user's entitlements'; metadata calls are free). Floored to
    the hour. None if the call fails or the shape is unexpected: the 422 fallbacks still apply."""
    try:
        r = client.metadata.get_dataset_range(dataset=DB_DATASET)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(r, dict):
        return None
    sch = r.get("schema")
    raw = sch.get(DB_SCHEMA, {}).get("end") if isinstance(sch, dict) and isinstance(sch.get(DB_SCHEMA), dict) else None
    raw = raw or r.get("end")
    t = _parse_t(raw) if isinstance(raw, str) else None
    if t is None:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return _floor_hour(t)


def _parse_t(t: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except ValueError:
        return None


def previous_bars(previous: dict | None, root: str) -> list[dict]:
    """Bars already published for `root` (last good data), or [] if none/unusable."""
    try:
        bars = previous["data"]["roots"][root]["bars"]  # type: ignore[index]
    except (TypeError, KeyError):
        return []
    return [b for b in bars if isinstance(b, dict) and _parse_t(b.get("t")) is not None] if isinstance(bars, list) else []


def incremental_start(prev: list[dict], window_start: datetime) -> datetime:
    """Incremental fetch: start at the last published bar (refetched once, cheap and safe) when it lies inside the
    window; otherwise the full window. Keeps each hourly run to ~1-2 bars per root instead of 72."""
    if not prev:
        return window_start
    last = _parse_t(prev[-1]["t"])
    return last if last is not None and last >= window_start else window_start


def merge_bars(prev: list[dict], new: list[dict], keep: int) -> list[dict]:
    """Union by bar open time (new wins), sorted, last `keep` bars."""
    by_t = {b["t"]: b for b in prev}
    by_t.update({b["t"]: b for b in new})
    return [by_t[t] for t in sorted(by_t)][-keep:]


def log_cost(kind: str, params: dict, cost: float | None) -> None:
    """One stderr line per quote, visible in the Actions log; stdout stays one summary line per dataset (no
    secrets: params never contain the key)."""
    shown = "invalid" if cost is None else f"${cost:.6f}"
    print(f"bars {kind}: {params['symbols'][0]} {params['start']} -> {params['end']} quoted {shown}", file=sys.stderr, flush=True)


def request_params(root: str, start: datetime, end: datetime) -> dict:
    """The one parameter set used for BOTH get_cost and get_range for a root."""
    return {
        "dataset": DB_DATASET,
        "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "symbols": [f"{root}.c.{n}" for n in range(DEPTH)],
        "schema": DB_SCHEMA,
        "stype_in": STYPE_IN,
    }


def _num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _row_bar(ts: Any, row: Any) -> dict | None:
    o, h, l, c, v = (_num(row.get(k)) for k in ("open", "high", "low", "close", "volume"))
    if None in (o, h, l, c, v) or v < 0:  # type: ignore[operator]
        return None
    t = _ts_utc(ts)
    if t is None:
        return None
    key = t.strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"t": key, "o": o, "h": h, "l": l, "c": c, "v": v}


def frame_by_instrument(df: Any, expected: set[str]) -> dict[int, dict]:
    """Group an ohlcv DataFrame by instrument_id -> {"symbol": continuous symbol of its latest row, "bars": [...]}.
    Only rows whose `symbol` is one of the requested continuous symbols; unusable rows are skipped (never 0)."""
    cols = getattr(df, "columns", [])
    if "instrument_id" not in cols:
        return {}
    out: dict[int, dict] = {}
    for ts, row in df.iterrows():
        sym = row["symbol"] if "symbol" in cols else None
        if sym is not None and sym not in expected:
            continue
        try:
            iid = int(row["instrument_id"])
        except (TypeError, ValueError):
            continue
        bar = _row_bar(ts, row)
        if bar is None:
            continue
        slot = out.setdefault(iid, {"symbol": sym, "bars": {}})
        slot["bars"][bar["t"]] = bar
        if sym is not None and bar["t"] >= max(slot["bars"]):
            slot["symbol"] = sym
    return {i: {"symbol": v["symbol"], "bars": [v["bars"][k] for k in sorted(v["bars"])]} for i, v in out.items()}


def frame_to_bars(df: Any, symbol: str, also: set[str] | None = None) -> tuple[list[dict], int]:
    """Convert a Databento ohlcv DataFrame to schema bars for `symbol`. Returns (bars sorted by t, rows dropped).

    Rows of the other requested continuous symbols (`also`, e.g. ES.c.1/ES.c.2) are skipped silently; rows of any
    other symbol are dropped and counted, as are rows with a non-finite price or volume (never replaced by 0).
    """
    bars: dict[str, dict] = {}
    dropped = 0
    has_symbol = "symbol" in getattr(df, "columns", [])
    also = also or set()
    for ts, row in df.iterrows():
        if has_symbol and row["symbol"] != symbol:
            if row["symbol"] not in also:
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


_RAW_RE = re.compile(r"^([FGHJKMNQUVXZ])(\d{1,2})$")


def contract_code(root: str, raw: str, ref_year: int) -> str | None:
    """Exchange raw symbol -> contract code: "HOZ6" -> "HOZ26" (1-digit year resolved to the decade nearest
    `ref_year`, never more than a year in the past). None if `raw` is not root + month + year."""
    if not isinstance(raw, str) or not raw.startswith(root):
        return None
    m = _RAW_RE.match(raw[len(root):])
    if not m:
        return None
    month, yy = m.group(1), m.group(2)
    if len(yy) == 2:
        year = 2000 + int(yy)
    else:
        year = (ref_year // 10) * 10 + int(yy)
        if year < ref_year - 1:
            year += 10
    return f"{root}{month}{year % 100:02d}"


def resolve_raw_symbols(client: Any, ids: list[int], start: datetime, end: datetime) -> dict[int, str]:
    """instrument_id -> exchange raw symbol via symbology.resolve (a free metadata call). Takes the latest mapping
    per id. Unexpected shapes are skipped (those instruments simply get no contract series)."""
    res = client.symbology.resolve(
        dataset=DB_DATASET, symbols=[str(i) for i in ids], stype_in="instrument_id", stype_out="raw_symbol",
        start_date=start.date().isoformat(), end_date=(end + timedelta(days=1)).date().isoformat(),
    )
    print(f"bars symbology: {json.dumps(res)[:600]}", file=sys.stderr, flush=True)
    out: dict[int, str] = {}
    result = res.get("result", {}) if isinstance(res, dict) else {}
    for k, v in result.items() if isinstance(result, dict) else []:
        try:
            iid = int(k)
        except (TypeError, ValueError):
            continue
        entries = v if isinstance(v, list) else [v]
        syms = [e.get("s") for e in entries if isinstance(e, dict) and isinstance(e.get("s"), str)]
        syms += [e for e in entries if isinstance(e, str)]
        if syms:
            out[iid] = syms[-1]
    return out


def build_contract_series(client: Any, by_instrument: dict[str, dict[int, dict]], previous: dict | None,
                          window_start: datetime, now: datetime, key: str) -> tuple[dict, list[str]]:
    """data.contracts (ADR-010): each fetched instrument's bars under its contract code, merged with the previously
    published series; series whose last bar is older than the window are dropped (expired/rolled off)."""
    errors: list[str] = []
    prev_series = {}
    try:
        prev_series = dict(previous["data"].get("contracts") or {})  # type: ignore[index]
    except (TypeError, KeyError, AttributeError):
        prev_series = {}
    ids = sorted({i for per_root in by_instrument.values() for i in per_root})
    raw: dict[int, str] = {}
    if ids:
        try:
            raw = resolve_raw_symbols(client, ids, window_start, now)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"contract symbology failed: {safe_error(exc, [key])}")
    series: dict[str, dict] = {}
    for code, s in prev_series.items():
        if isinstance(s, dict) and isinstance(s.get("bars"), list) and s["bars"]:
            series[code] = s
    for root, per_root in by_instrument.items():
        for iid, got in per_root.items():
            r = raw.get(iid)
            if r is None or not got["bars"]:
                continue
            ref_year = int(got["bars"][-1]["t"][:4])
            code = contract_code(root, r, ref_year)
            if code is None:
                errors.append(f"{root}: unrecognised raw symbol {r!r}")
                continue
            old = series.get(code, {}).get("bars", [])
            series[code] = {"root": root, "symbol": got["symbol"] or f"{root}.c.?", "raw_symbol": r,
                            "bars": merge_bars(old, got["bars"], KEEP_BARS)}
    cutoff = window_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    return {c: s for c, s in sorted(series.items()) if s["bars"][-1]["t"] >= cutoff}, errors


def run(
    now: datetime,
    out: Path,
    client_factory: Callable[[str], Any] = default_client_factory,
    dry_run: bool = False,
    env: Mapping[str, str] | None = None,
    contracts: list[dict] | None = None,
    sleep: Callable[[float], None] = time.sleep,
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
    window_end = end
    # Never ask past what the account may receive: clamp to the entitled end before any quote (fixes both
    # 422 dataset_unavailable_range and 422 data_end_after_available_end on the cost check).
    avail = entitled_end(client)
    if avail is not None and avail < end:
        end = avail

    # 1) Project the cost of every request before spending anything.
    planned: list[tuple[str, dict, float]] = []
    total = 0.0  # projected (cap check): includes quotes for requests Databento may refuse and never bill
    billed = 0.0  # quotes of the requests that actually returned data (reported as cost_usd)
    unchanged: list[str] = []
    for root in roots:
        root_start = incremental_start(previous_bars(previous, root), start)
        if root_start >= end:
            unchanged.append(root)  # nothing new can exist yet: no request, no cost
            continue
        params = request_params(root, root_start, end)
        try:
            try:
                cost = _num(client.metadata.get_cost(**params))
            except Exception as exc:  # noqa: BLE001
                lic = licensed_end(exc)
                if lic is None or lic >= end:
                    raise
                end = lic  # applies to this and every later root
                if root_start >= end:
                    unchanged.append(root)
                    continue
                params = request_params(root, root_start, end)
                cost = _num(client.metadata.get_cost(**params))
            log_cost("quote", params, cost)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{root}: cost check failed: {safe_error(exc, [key])}")
            continue
        if cost is None or cost < 0:
            errors.append(f"{root}: cost check returned an invalid value")
            continue
        total += cost
        planned.append((root, params, cost))
    if total > COST_CAP_USD:
        return fail(errors + [f"cost cap: projected ${total:.4f} > ${COST_CAP_USD:.2f}; nothing requested"])
    if not planned and not unchanged:
        return fail(errors or ["no roots to request"])

    # 2) Spend: identical params to the cost check.
    result_roots: dict[str, dict] = {}
    latest: datetime | None = None
    delayed_to: datetime | None = None

    class _NothingNew(Exception):
        """The licensed window holds no bar newer than what is already published."""

    def keep_previous(root: str) -> None:
        nonlocal latest
        prev = previous_bars(previous, root)
        if prev:
            result_roots[root] = {"symbol": symbol_for(root), "bars": prev[-KEEP_BARS:]}
            last_open = _parse_t(prev[-1]["t"])
            if last_open is not None:
                latest = last_open if latest is None else max(latest, last_open)

    by_instrument: dict[str, dict[int, dict]] = {}

    for root in unchanged:
        keep_previous(root)

    def delayed_params(root: str) -> tuple[dict, float]:
        """Params for the licensed (delayed) window, cost-checked against the cap before any spend (A10)."""
        nonlocal total
        assert delayed_to is not None
        p_start = incremental_start(previous_bars(previous, root), delayed_to - LOOKBACK)
        if p_start >= delayed_to:
            raise _NothingNew()
        p = request_params(root, p_start, delayed_to)
        cost = _num(client.metadata.get_cost(**p))
        log_cost("quote (licensed window)", p, cost)
        if cost is None or cost < 0 or total + cost > COST_CAP_USD:
            raise RuntimeError("cost check for the licensed window failed or exceeds the cost cap")
        total += cost
        return p, cost

    def requote(root: str, w_end: datetime) -> tuple[dict, float]:
        """Re-quote a root planned before the window end was clamped (A10: cost before every range)."""
        nonlocal total
        p_start = incremental_start(previous_bars(previous, root), start)
        if p_start >= w_end:
            raise _NothingNew()
        p = request_params(root, p_start, w_end)
        cost = _num(client.metadata.get_cost(**p))
        log_cost("quote (clamped window)", p, cost)
        if cost is None or cost < 0 or total + cost > COST_CAP_USD:
            raise RuntimeError("cost check for the clamped window failed or exceeds the cost cap")
        total += cost
        return p, cost

    end_str = request_params("X", start, end)["end"]
    for root, params, quote in planned:
        symbol = symbol_for(root)
        try:
            if delayed_to is not None:
                params, quote = delayed_params(root)
            elif params["end"] != end_str:
                params, quote = requote(root, end)
            try:
                store = get_range_with_retry(client, params, sleep)
            except Exception as exc:  # noqa: BLE001
                lic_end = licensed_end(exc)
                req_end = _parse_t(params["end"])
                if lic_end is None or delayed_to is not None or req_end is None or lic_end >= req_end:
                    raise
                # License only covers data up to lic_end (no live CME license): re-check the cost of that window,
                # keep the cap, retry once. The bars are then delayed and the site marks them STALE by their age.
                delayed_to = lic_end
                params, quote = delayed_params(root)
                store = get_range_with_retry(client, params, sleep)
            billed += quote
            df = store.to_df()
            requested = set(params["symbols"])
            bars, dropped = frame_to_bars(df, symbol, requested - {symbol})
            by_instrument[root] = frame_by_instrument(df, requested)
        except _NothingNew:
            keep_previous(root)
            continue
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{root}: range request failed: {safe_error(exc, [key])}")
            continue
        if dropped:
            errors.append(f"{root}: dropped {dropped} unusable bar rows")
        prev = previous_bars(previous, root)
        if not bars and not prev:
            errors.append(f"{root}: no bars returned")
            continue
        merged = merge_bars(prev, bars, KEEP_BARS)  # no new bars (e.g. market closed) keeps the published ones
        result_roots[root] = {"symbol": symbol, "bars": merged}
        last_open = _parse_t(merged[-1]["t"])
        if last_open is not None:
            latest = last_open if latest is None else max(latest, last_open)

    if not result_roots or latest is None:
        return fail(errors or ["no bars returned for any root"])

    missing = [r for r in roots if r not in result_roots]
    status = "partial" if missing else "ok"
    if missing:
        errors.append(f"missing roots: {', '.join(missing)}")
    series, c_errors = build_contract_series(client, by_instrument, previous, start, now, key)
    errors.extend(c_errors)
    data = {
        "roots": result_roots,
        "aliases": config.aliases(contracts),
        "cost_usd": round(billed, 6),
    }
    if series:
        data["contracts"] = series
    data_as_of = min(latest + timedelta(hours=1), now)
    data_end = delayed_to if delayed_to is not None else end
    if data_end < window_end:
        source = f"{source}; delayed: Databento data available to this account up to {data_end:%Y-%m-%dT%H:%MZ}"
    envelope = make_envelope(DATASET_NAME, source, status, errors, data, data_as_of, now)
    return publish(DATASET_NAME, source, envelope, out, previous, now)
