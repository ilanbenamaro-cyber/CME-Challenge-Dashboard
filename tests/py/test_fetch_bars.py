import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from jobs import fetch_bars
from jobs.common.config import load_contracts
from jobs.common.envelope import make_envelope, write_atomic
from jobs.common.fakes import synthetic_frame
from jobs.common.schema import validate

ENV = {"DATABENTO_API_KEY": "db-testkeytestkeytestkey"}


class Recorder:
    """Mock databento.Historical: records the order of calls and their params."""

    def __init__(self, costs=None, frames=None, cost_exc=None, range_exc=None):
        self.calls = []
        self.costs = costs or {}
        self.frames = frames or {}
        self.cost_exc = cost_exc or {}
        self.range_exc = range_exc or {}
        rec = self

        class M:
            def get_cost(self, **p):
                rec.calls.append(("get_cost", p))
                root = p["symbols"][0].split(".")[0]
                if root in rec.cost_exc:
                    raise rec.cost_exc[root]
                return rec.costs.get(root, 0.001)

        class T:
            def get_range(self, **p):
                rec.calls.append(("get_range", p))
                root = p["symbols"][0].split(".")[0]
                if root in rec.range_exc:
                    raise rec.range_exc[root]
                df = rec.frames.get(root)
                if df is None:
                    start = datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
                    end = datetime.fromisoformat(p["end"].replace("Z", "+00:00"))
                    df = synthetic_frame(p["symbols"][0], start, end, 100.0, 0.25)

                class S:
                    def to_df(self_inner):
                        return df
                return S()

        self.metadata = M()
        self.timeseries = T()


def _run(now, tmp_path, client, env=ENV):
    return fetch_bars.run(now, tmp_path / "bars.json", client_factory=lambda key: client, env=env)


def test_window_floors_to_hour(now):
    start, end = fetch_bars.window(now)
    assert end == datetime(2026, 9, 30, 15, 0, tzinfo=timezone.utc)
    assert start == end - timedelta(hours=72)


def test_get_cost_precedes_get_range_with_identical_params(now, tmp_path):
    c = Recorder()
    e = _run(now, tmp_path, c)
    assert e["status"] == "ok"
    names = [n for n, _ in c.calls]
    first_range = names.index("get_range")
    assert all(n == "get_cost" for n in names[:first_range])
    costs = [p for n, p in c.calls if n == "get_cost"]
    ranges = [p for n, p in c.calls if n == "get_range"]
    assert costs == ranges  # identical params, same order
    assert len(ranges) == 4
    for p in ranges:
        assert p["dataset"] == "GLBX.MDP3"
        assert p["schema"] == "ohlcv-1h"
        assert p["stype_in"] == "continuous"
        assert p["start"] == "2026-09-27T15:00:00Z" and p["end"] == "2026-09-30T15:00:00Z"
    assert sorted(p["symbols"][0] for p in ranges) == ["CL.c.0", "ES.c.0", "GC.c.0", "NQ.c.0"]


def test_output_shape_aliases_and_as_of(now, tmp_path):
    e = _run(now, tmp_path, Recorder())
    validate("bars", e)
    assert json.loads((tmp_path / "bars.json").read_text()) == e
    d = e["data"]
    assert set(d["roots"]) == {"ES", "NQ", "CL", "GC"}
    assert d["aliases"] == {"MES": "ES", "MNQ": "NQ", "MCL": "CL", "MGC": "GC"}
    assert d["roots"]["ES"]["symbol"] == "ES.c.0"
    bars = d["roots"]["ES"]["bars"]
    assert 0 < len(bars) <= 72
    assert bars == sorted(bars, key=lambda b: b["t"])
    assert all(isinstance(b[k], float) for b in bars for k in "ohlc")
    assert bars[-1]["t"] == "2026-09-30T14:00:00Z"
    assert e["data_as_of"] == "2026-09-30T15:00:00Z"  # last bar open + 1h (<= run time)
    assert d["cost_usd"] == pytest.approx(0.004)


def test_keeps_last_72_bars(now, tmp_path):
    idx = pd.date_range("2026-09-20T00:00:00Z", periods=200, freq="h", name="ts_event")
    df = pd.DataFrame({"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 3, "symbol": "ES.c.0"},
                      index=idx)
    e = _run(now, tmp_path, Recorder(frames={"ES": df}))
    bars = e["data"]["roots"]["ES"]["bars"]
    assert len(bars) == 72
    assert bars[-1]["t"] == idx[-1].strftime("%Y-%m-%dT%H:%M:%SZ")


def test_cost_cap_aborts_with_zero_range_calls(now, tmp_path):
    prev = make_envelope("bars", "s", "ok", [], {"roots": {}, "aliases": {}, "cost_usd": 0.1},
                         datetime(2026, 9, 29, 20, tzinfo=timezone.utc), now - timedelta(days=1))
    write_atomic(tmp_path / "bars.json", prev)
    c = Recorder(costs={"ES": 0.5, "NQ": 0.5, "CL": 0.5, "GC": 0.51})
    e = _run(now, tmp_path, c)
    assert [n for n, _ in c.calls].count("get_range") == 0
    assert e["status"] == "error"
    assert any("cost cap" in x for x in e["errors"])
    assert e["data"] == prev["data"] and e["data_as_of"] == prev["data_as_of"]
    validate("bars", e)


def test_cost_exactly_at_cap_is_allowed(now, tmp_path):
    c = Recorder(costs={"ES": 0.5, "NQ": 0.5, "CL": 0.5, "GC": 0.5})
    e = _run(now, tmp_path, c)
    assert e["status"] == "ok" and e["data"]["cost_usd"] == 2.0


@pytest.mark.parametrize("bad", [float("nan"), -1.0, "abc", None])
def test_invalid_cost_skips_root_without_spend(now, tmp_path, bad):
    c = Recorder(costs={"GC": bad})
    e = _run(now, tmp_path, c)
    assert e["status"] == "partial"
    assert not any(p["symbols"] == ["GC.c.0"] for n, p in c.calls if n == "get_range")
    assert "GC" not in e["data"]["roots"]


def test_missing_key_writes_failure(now, tmp_path):
    called = []
    e = fetch_bars.run(now, tmp_path / "bars.json", client_factory=lambda k: called.append(k), env={})
    assert called == []
    assert e["status"] == "error" and e["errors"] == ["DATABENTO_API_KEY not set"]
    assert e["data"] is None
    validate("bars", e)


def test_partial_when_a_root_returns_no_bars(now, tmp_path):
    empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume", "symbol"])
    e = _run(now, tmp_path, Recorder(frames={"NQ": empty}))
    assert e["status"] == "partial"
    assert "NQ" not in e["data"]["roots"]
    assert any("NQ" in x for x in e["errors"])
    validate("bars", e)


def test_range_exception_is_partial_and_key_redacted(now, tmp_path):
    exc = RuntimeError(f"auth failed for {ENV['DATABENTO_API_KEY']}")
    e = _run(now, tmp_path, Recorder(range_exc={"CL": exc}))
    assert e["status"] == "partial"
    text = json.dumps(e)
    assert ENV["DATABENTO_API_KEY"] not in text
    assert "***" in text


def test_all_roots_fail_keeps_previous(now, tmp_path):
    exc = RuntimeError("503")
    e = _run(now, tmp_path, Recorder(range_exc={r: exc for r in ("ES", "NQ", "CL", "GC")}))
    assert e["status"] == "error" and e["data"] is None
    validate("bars", e)


def test_client_factory_exception(now, tmp_path):
    def boom(key):
        raise ValueError(f"bad key {key}")
    e = fetch_bars.run(now, tmp_path / "bars.json", client_factory=boom, env=ENV)
    assert e["status"] == "error" and ENV["DATABENTO_API_KEY"] not in json.dumps(e)


def test_rows_for_other_symbols_and_nan_are_dropped_not_zeroed(now, tmp_path):
    idx = pd.DatetimeIndex(["2026-09-30T12:00:00Z", "2026-09-30T13:00:00Z", "2026-09-30T14:00:00Z"],
                           name="ts_event")
    df = pd.DataFrame({"open": [1.0, float("nan"), 3.0], "high": [2.0, 2.0, 4.0], "low": [0.5, 0.5, 2.5],
                       "close": [1.5, 1.5, 3.5], "volume": [1, 1, 1],
                       "symbol": ["ES.c.0", "ES.c.0", "ES.c.1"]}, index=idx)
    e = _run(now, tmp_path, Recorder(frames={"ES": df}))
    bars = e["data"]["roots"]["ES"]["bars"]
    assert [b["t"] for b in bars] == ["2026-09-30T12:00:00Z"]
    assert any("ES: dropped 2" in x for x in e["errors"])


def test_dry_run_uses_fake_client_and_no_key(now, tmp_path):
    def forbidden(key):
        raise AssertionError("real client must not be built in dry run")
    e = fetch_bars.run(now, tmp_path / "bars.json", client_factory=forbidden, dry_run=True, env={})
    assert e["status"] == "ok"
    assert "SYNTHETIC" in e["source"]
    validate("bars", e)


def test_contract_list_drives_roots():
    contracts = load_contracts()
    parents = [c["root"] for c in contracts if c["parent"] is None]
    assert parents == ["ES", "NQ", "CL", "GC"]
