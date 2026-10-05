import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from jobs import fetch_bars
from jobs.common import config
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
    assert not any(p["symbols"][0] == "GC.c.0" for n, p in c.calls if n == "get_range")
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
                       "symbol": ["ES.c.0", "ES.c.0", "ES.c.9"]}, index=idx)  # ES.c.9 is never requested
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


def test_real_dbnstore_to_df_maps_continuous_symbol():
    """Offline round trip through databento's real DBNStore.to_df(): with stype_in=continuous and
    stype_out=instrument_id, the symbol column carries the requested 'ES.c.0' and the index is ts_event."""
    import io
    from datetime import date
    from types import SimpleNamespace

    import databento as db
    import databento_dbn as dbn

    hour = 3600 * 10**9
    t0 = int(datetime(2026, 9, 29, 13, tzinfo=timezone.utc).timestamp()) * 10**9
    meta = dbn.Metadata(
        dataset="GLBX.MDP3", schema=dbn.Schema.OHLCV_1H, start=t0, end=t0 + 3 * hour,
        stype_in=dbn.SType.CONTINUOUS, stype_out=dbn.SType.INSTRUMENT_ID, symbols=["ES.c.0"],
        partial=[], not_found=[],
        mappings=[SimpleNamespace(raw_symbol="ES.c.0", intervals=[SimpleNamespace(
            start_date=date(2026, 9, 1), end_date=date(2026, 12, 31), symbol="4242")])],
    )
    buf = io.BytesIO()
    buf.write(meta.encode())
    for i in range(3):
        px = (5000 + i) * 10**9
        buf.write(bytes(dbn.OHLCVMsg(0x22, 1, 4242, t0 + i * hour, px, px + 10**9, px - 10**9, px, 10 + i)))
    df = db.DBNStore.from_bytes(buf.getvalue()).to_df()
    assert df.index.name == "ts_event"
    assert set(df["symbol"]) == {"ES.c.0"}
    bars, dropped = fetch_bars.frame_to_bars(df, "ES.c.0")
    assert dropped == 0
    assert bars[0] == {"t": "2026-09-29T13:00:00Z", "o": 5000.0, "h": 5001.0, "l": 4999.0, "c": 5000.0, "v": 10.0}
    assert [b["t"] for b in bars] == ["2026-09-29T13:00:00Z", "2026-09-29T14:00:00Z", "2026-09-29T15:00:00Z"]


def test_contract_list_drives_roots():
    contracts = config.load_contracts()
    parents = [c["root"] for c in contracts if c["parent"] is None]
    assert parents == ["ES", "NQ", "CL", "GC"]


class LicensedRecorder(Recorder):
    """Databento account without a live CME license: any range ending after `limit` is refused with the real 422 text."""

    def __init__(self, limit):
        super().__init__()
        rec = self
        inner = self.timeseries

        class T:
            def get_range(self, **p):
                end = datetime.fromisoformat(p["end"].replace("Z", "+00:00"))
                if end > limit:
                    rec.calls.append(("get_range", p))
                    raise RuntimeError(
                        "BentoClientError: 422 dataset_unavailable_range Part or all of your request for dataset "
                        "'GLBX.MDP3' requires a subscription and/or license to access. Try again with an end time "
                        f"before {limit:%Y-%m-%dT%H:%M:%S}.238315000Z. documentation: https://databento.com/pricing#cme")
                return inner.get_range(**p)

        self.timeseries = T()


def test_unlicensed_live_range_falls_back_to_delayed_window(tmp_path):
    # Real 2026-10-01 run: now 02:07Z, license end 2026-09-30T18:07:10Z -> floored 18:00Z (8h delayed).
    now = datetime(2026, 10, 1, 2, 7, tzinfo=timezone.utc)
    limit = datetime(2026, 9, 30, 18, 7, 10, tzinfo=timezone.utc)
    rec = LicensedRecorder(limit)
    env = _run(now, tmp_path, rec)
    validate("bars", env)
    assert env["status"] == "ok", env["errors"]
    assert "delayed" in env["source"] and "2026-09-30T18:00Z" in env["source"]
    # data_as_of is the last bar close of the delayed window, never later than the licensed end.
    assert env["data_as_of"] <= "2026-09-30T18:00:00Z"
    # A10 still holds: every get_range is preceded by a get_cost with identical params.
    for i, (name, p) in enumerate(rec.calls):
        if name == "get_range" and p["end"] == "2026-09-30T18:00:00Z":
            assert ("get_cost", p) in rec.calls[:i]
    # cost_usd reports only billed requests: 4 licensed-window quotes at the Recorder's $0.001 each, not the
    # refused live-window quotes (Databento does not bill a refused request).
    assert env["data"]["cost_usd"] == pytest.approx(0.004)
    # Only the first root hits the 422; the rest go straight to the delayed window.
    refused = [p for n, p in rec.calls if n == "get_range" and p["end"] == "2026-10-01T02:00:00Z"]
    assert len(refused) == 1


def test_unlicensed_fallback_respects_cost_cap(tmp_path):
    now = datetime(2026, 10, 1, 2, 7, tzinfo=timezone.utc)
    rec = LicensedRecorder(datetime(2026, 9, 30, 18, 7, 10, tzinfo=timezone.utc))
    rec.costs = {"ES": 1.99}  # planned total ~2.0; the re-check for the delayed window would exceed $2.00
    env = _run(now, tmp_path, rec)
    assert all(not (n == "get_range" and p["symbols"][0] == "ES.c.0" and p["end"] == "2026-09-30T18:00:00Z") for n, p in rec.calls)
    assert any("ES: range request failed" in e and "cap" in e for e in env["errors"])


def test_other_422_errors_are_not_retried(tmp_path):
    now = datetime(2026, 10, 1, 2, 7, tzinfo=timezone.utc)
    rec = Recorder(range_exc={r: RuntimeError("422 symbology_invalid_request") for r in ["ES", "NQ", "CL", "GC"]})
    env = _run(now, tmp_path, rec)
    assert env["status"] == "error"
    assert sum(1 for n, _ in rec.calls if n == "get_range") == 4


def _seed_previous(tmp_path, now, rec):
    """First run publishes the full 72h window; returns the published envelope."""
    return _run(now, tmp_path, rec)


def test_incremental_second_run_fetches_only_new_bars(tmp_path):
    t0 = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    first = _seed_previous(tmp_path, t0, Recorder())
    last_t = first["data"]["roots"]["ES"]["bars"][-1]["t"]           # 2026-10-06T14:00:00Z
    rec = Recorder()
    second = _run(t0 + timedelta(hours=1), tmp_path, rec)
    ranges = [p for n, p in rec.calls if n == "get_range"]
    assert ranges and all(p["start"] == last_t and p["end"] == "2026-10-06T16:00:00Z" for p in ranges)
    for i, (n, p) in enumerate(rec.calls):  # A10 still holds on the incremental params
        if n == "get_range":
            assert ("get_cost", p) in rec.calls[:i]
    es = second["data"]["roots"]["ES"]["bars"]
    n_first = len(first["data"]["roots"]["ES"]["bars"])                # weekend hours have no bars
    assert es[-1]["t"] == "2026-10-06T15:00:00Z" and len(es) == min(n_first + 1, fetch_bars.KEEP_BARS)
    assert [b["t"] for b in es] == sorted({b["t"] for b in es})       # merged, de-duplicated, ordered


def test_incremental_same_hour_makes_no_request(tmp_path):
    t0 = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    first = _seed_previous(tmp_path, t0, Recorder())
    rec = Recorder()
    # Same hour: window end 15:00Z, last bar opened 14:00Z -> still one possible bar; a run at 15:59 re-asks.
    _run(t0 + timedelta(minutes=50), tmp_path, rec)
    assert all(p["start"] == first["data"]["roots"]["ES"]["bars"][-1]["t"] for n, p in rec.calls)


def test_no_new_bars_keeps_published_bars_without_error(tmp_path):
    t0 = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    first = _seed_previous(tmp_path, t0, Recorder())
    empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume", "symbol"])
    rec = Recorder(frames={r: empty for r in ["ES", "NQ", "CL", "GC"]})
    second = _run(t0 + timedelta(hours=1), tmp_path, rec)
    assert second["status"] == "ok", second["errors"]
    assert second["data"]["roots"]["ES"]["bars"] == first["data"]["roots"]["ES"]["bars"]


class AvailRecorder(Recorder):
    """Dataset published only up to `avail`: quotes or ranges ending later fail with the real 422 text
    (data_end_after_available_end), as seen on Actions on 2026-10-01. Optionally exposes get_dataset_range."""

    def __init__(self, avail, expose_range=False):
        super().__init__()
        rec, m_inner, t_inner = self, self.metadata, self.timeseries
        msg = ("BentoClientError: 422 data_end_after_available_end The dataset GLBX.MDP3 has data available up to "
               f"'{avail:%Y-%m-%d %H:%M:%S}+00:00'. The `end` in the query is after the available range.")

        def late(p):
            return datetime.fromisoformat(p["end"].replace("Z", "+00:00")) > avail

        class M:
            def get_cost(self, **p):
                if late(p):
                    rec.calls.append(("get_cost", p))
                    raise RuntimeError(msg)
                return m_inner.get_cost(**p)

            if expose_range:
                def get_dataset_range(self, dataset):
                    rec.calls.append(("get_dataset_range", {"dataset": dataset}))
                    return {"start": "2010-06-06T00:00:00.000000000Z", "end": f"{avail:%Y-%m-%dT%H:%M:%S}.000000000Z"}

        class T:
            def get_range(self, **p):
                if late(p):
                    rec.calls.append(("get_range", p))
                    raise RuntimeError(msg)
                return t_inner.get_range(**p)

        self.metadata, self.timeseries = M(), T()


def _assert_cost_before_every_range(calls):
    for i, (n, p) in enumerate(calls):
        if n == "get_range":
            assert ("get_cost", p) in calls[:i], p


def test_dataset_range_clamps_window_before_any_quote(tmp_path):
    now = datetime(2026, 10, 1, 13, 7, tzinfo=timezone.utc)
    avail = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    rec = AvailRecorder(avail, expose_range=True)
    env = _run(now, tmp_path, rec)
    assert env["status"] == "ok", env["errors"]
    ends = {p["end"] for n, p in rec.calls if n in ("get_cost", "get_range")}
    assert ends == {"2026-10-01T12:00:00Z"}          # nothing ever asked past the entitled end
    assert "delayed" in env["source"] and "2026-10-01T12:00Z" in env["source"]
    _assert_cost_before_every_range(rec.calls)


def test_cost_check_422_available_end_clamps_and_requotes(tmp_path):
    # No get_dataset_range (older client / call failed): the quote itself is refused, as in the user's report.
    now = datetime(2026, 10, 1, 13, 7, tzinfo=timezone.utc)
    rec = AvailRecorder(datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc))
    env = _run(now, tmp_path, rec)
    assert env["status"] == "ok", env["errors"]
    assert set(env["data"]["roots"]) == {"ES", "NQ", "CL", "GC"}
    assert all(p["end"] == "2026-10-01T12:00:00Z" for n, p in rec.calls if n == "get_range")
    _assert_cost_before_every_range(rec.calls)


def test_available_end_parser_handles_both_422_texts():
    a = RuntimeError("422 data_end_after_available_end The dataset GLBX.MDP3 has data available up to '2026-10-01 12:00:00+00:00'.")
    b = RuntimeError("422 dataset_unavailable_range ... Try again with an end time before 2026-09-30T18:07:10.238315000Z.")
    assert fetch_bars.licensed_end(a) == datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    assert fetch_bars.licensed_end(b) == datetime(2026, 9, 30, 18, 0, tzinfo=timezone.utc)
    assert fetch_bars.licensed_end(RuntimeError("422 symbology_invalid_request")) is None


def test_server_error_on_range_is_retried_once(tmp_path):
    """Seen on Actions 2026-10-01: NQ get_range -> 'BentoServerError: 504 The remote gateway timed out.'"""
    now = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    rec = Recorder()
    inner = rec.timeseries
    state = {"failed": False}

    class T:
        def get_range(self, **p):
            if p["symbols"][0] == "NQ.c.0" and not state["failed"]:
                state["failed"] = True
                rec.calls.append(("get_range", p))
                raise RuntimeError("BentoServerError: 504 The remote gateway timed out.")
            return inner.get_range(**p)

    rec.timeseries = T()
    slept = []
    env = fetch_bars.run(now, tmp_path / "bars.json", client_factory=lambda key: rec, env=ENV, sleep=slept.append)
    assert env["status"] == "ok", env["errors"]
    assert slept == [fetch_bars.RETRY_SLEEP_S]
    nq = [p for n, p in rec.calls if n == "get_range" and p["symbols"][0] == "NQ.c.0"]
    assert len(nq) == 2 and nq[0] == nq[1]                       # same, already cost-checked params


def test_server_error_twice_is_reported_not_looped(tmp_path):
    now = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    rec = Recorder(range_exc={"NQ": RuntimeError("BentoServerError: 504 The remote gateway timed out.")})
    env = fetch_bars.run(now, tmp_path / "bars.json", client_factory=lambda key: rec, env=ENV, sleep=lambda s: None)
    assert env["status"] == "partial"
    assert sum(1 for n, p in rec.calls if n == "get_range" and p["symbols"][0] == "NQ.c.0") == 2


# --- ADR-010: exact-contract series -------------------------------------------------------------------------------

def test_contract_code_from_raw_symbol():
    assert fetch_bars.contract_code("HO", "HOZ6", 2026) == "HOZ26"
    assert fetch_bars.contract_code("ZN", "ZNH7", 2026) == "ZNH27"
    assert fetch_bars.contract_code("GC", "GCZ26", 2026) == "GCZ26"
    assert fetch_bars.contract_code("ES", "ESH0", 2029) == "ESH30"   # next decade, not 2020
    assert fetch_bars.contract_code("CL", "HOZ6", 2026) is None      # wrong root
    assert fetch_bars.contract_code("CL", "CLZ6-CLF7", 2026) is None  # spreads are not outright contracts


class SymRecorder(Recorder):
    """Recorder whose ranges return c.0/c.1 rows for distinct instruments and that resolves ids like Databento."""

    def __init__(self, raw_by_id, fail_resolve=False):
        super().__init__()
        rec = self

        class T:
            def get_range(self, **p):
                rec.calls.append(("get_range", p))
                start = datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(p["end"].replace("Z", "+00:00"))
                root = p["symbols"][0].split(".")[0]
                frames = [synthetic_frame(f"{root}.c.{n}", start, end, 100.0 + n, 0.25, instrument_id=hash((root, n)) % 10**6)
                          for n in (0, 1)]
                df = pd.concat(frames).sort_index(kind="stable")

                class S:
                    def to_df(self_inner):
                        return df
                return S()

        class Y:
            def resolve(self, **p):
                rec.calls.append(("resolve", p))
                if fail_resolve:
                    raise RuntimeError("BentoClientError: 400 bad symbology request")
                return {"result": {s: [{"d0": p["start_date"], "d1": p["end_date"], "s": raw_by_id(int(s))}] for s in p["symbols"]}}

        self.timeseries, self.symbology = T(), Y()


def _raw(iid):
    for root in ["ES", "NQ", "CL", "GC"]:
        for n, m in ((0, "X"), (1, "Z")):
            if hash((root, n)) % 10**6 == iid:
                return f"{root}{m}6"
    return "??"


def test_contract_series_published_per_exact_contract(tmp_path):
    now = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    rec = SymRecorder(_raw)
    env = _run(now, tmp_path, rec)
    validate("bars", env)
    assert env["status"] == "ok", env["errors"]
    c = env["data"]["contracts"]
    assert set(c) == {f"{r}{m}26" for r in ["ES", "NQ", "CL", "GC"] for m in "XZ"}
    assert c["CLZ26"]["raw_symbol"] == "CLZ6" and c["CLZ26"]["symbol"] == "CL.c.1" and c["CLZ26"]["root"] == "CL"
    # c.1 rows never leak into the front-month series, and each contract carries its own prices.
    assert env["data"]["roots"]["CL"]["bars"][-1]["c"] == c["CLX26"]["bars"][-1]["c"]
    assert c["CLZ26"]["bars"][-1]["c"] != c["CLX26"]["bars"][-1]["c"]
    assert sum(1 for n, _ in rec.calls if n == "resolve") == 1     # one free metadata call for all ids


def test_symbology_failure_keeps_roots_and_reports(tmp_path):
    now = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    env = _run(now, tmp_path, SymRecorder(_raw, fail_resolve=True))
    assert set(env["data"]["roots"]) == {"ES", "NQ", "CL", "GC"}
    assert "contracts" not in env["data"]
    assert any(e.startswith("contract symbology failed") for e in env["errors"])


def test_expired_contract_series_are_pruned(tmp_path):
    t0 = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    _run(t0, tmp_path, SymRecorder(_raw))
    # Four days later the previously published CLX26 series has no bar inside the 72h window -> dropped,
    # unless refreshed; here the fake keeps resolving the same months, so all still present; inject an old one.
    path = tmp_path / "bars.json"
    env = json.loads(path.read_text())
    env["data"]["contracts"]["CLV26"] = {"root": "CL", "symbol": "CL.c.0", "raw_symbol": "CLV6",
                                         "bars": [{"t": "2026-09-01T00:00:00Z", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}
    path.write_text(json.dumps(env))
    env2 = _run(t0 + timedelta(hours=1), tmp_path, SymRecorder(_raw))
    assert "CLV26" not in env2["data"]["contracts"] and "CLZ26" in env2["data"]["contracts"]


def test_symbology_end_date_is_last_data_day_and_retries_on_available_end_date(tmp_path):
    """Actions 2026-10-05: resolve refused end_date 2026-10-06 ('data up to, but not including 2026-10-05')."""
    now = datetime(2026, 10, 5, 0, 26, tzinfo=timezone.utc)
    rec = SymRecorder(_raw)
    inner = rec.symbology

    class Y:
        def resolve(self, **p):
            if p["end_date"] > "2026-10-05":
                rec.calls.append(("resolve-refused", p))
                raise RuntimeError("BentoClientError: 422 data_end_date_after_available_end_date The dataset GLBX.MDP3 has "
                                   "data available has data up to, but not including '2026-10-05'. The `end_date` in the "
                                   "query ('2026-10-06') is after the available range.")
            return inner.resolve(**p)

    rec.symbology = Y()
    env = _run(now, tmp_path, rec)
    assert "contracts" in env["data"], env["errors"]
    ends = [p["end_date"] for n, p in rec.calls if n == "resolve"]
    assert ends and all(e <= "2026-10-05" for e in ends)


def test_server_error_on_cost_check_is_retried_once(tmp_path):
    """Actions 2026-10-05: 'NG: cost check failed: BentoServerError: 504 The remote gateway timed out.'"""
    now = datetime(2026, 10, 6, 15, 7, tzinfo=timezone.utc)
    rec = Recorder()
    inner = rec.metadata
    state = {"failed": False}

    class M:
        def get_cost(self, **p):
            if p["symbols"][0] == "CL.c.0" and not state["failed"]:
                state["failed"] = True
                rec.calls.append(("get_cost", p))
                raise RuntimeError("BentoServerError: 504 The remote gateway timed out.")
            return inner.get_cost(**p)

    rec.metadata = M()
    slept = []
    env = fetch_bars.run(now, tmp_path / "bars.json", client_factory=lambda key: rec, env=ENV, sleep=slept.append)
    assert env["status"] == "ok", env["errors"]
    assert slept == [fetch_bars.RETRY_SLEEP_S]


def test_symbology_respects_license_cutoff_inside_the_day(tmp_path):
    """Actions 2026-10-05: resolve with end_date 2026-10-05 refused, license ends 2026-10-04T16:38Z."""
    now = datetime(2026, 10, 5, 0, 36, tzinfo=timezone.utc)
    rec = SymRecorder(_raw)
    inner = rec.symbology

    class Y:
        def resolve(self, **p):
            if p["end_date"] > "2026-10-04":
                rec.calls.append(("resolve-refused", p))
                raise RuntimeError("BentoClientError: 422 dataset_unavailable_range Part or all of your request for "
                                   "dataset 'GLBX.MDP3' requires a subscription and/or license to access. Try again "
                                   "with an end time before 2026-10-04T16:38:01.164533000Z.")
            return inner.resolve(**p)

    rec.symbology = Y()
    env = _run(now, tmp_path, rec)
    assert "contracts" in env["data"], env["errors"]
    ok = [p for n, p in rec.calls if n == "resolve"]
    assert ok and all(p["start_date"] < p["end_date"] <= "2026-10-04" for p in ok)
