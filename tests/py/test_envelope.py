import json
import os
from datetime import datetime, timezone, timedelta

import jsonschema
import pytest

from jobs.common import envelope as env
from jobs.common.schema import validate


def test_make_envelope_shape(now):
    e = env.make_envelope("margins", "src", "ok", [], {"rows": []}, now - timedelta(hours=1), now)
    assert e == {
        "schema_version": 1,
        "dataset": "margins",
        "generated_at": "2026-09-30T15:23:45Z",
        "data_as_of": "2026-09-30T14:23:45Z",
        "source": "src",
        "status": "ok",
        "errors": [],
        "data": {"rows": []},
    }
    validate("margins", e)


def test_make_envelope_rejects_bad_status_and_naive_time(now):
    with pytest.raises(ValueError):
        env.make_envelope("margins", "s", "fine", [], None, None, now)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        env.make_envelope("margins", "s", "ok", [], None, None, datetime(2026, 1, 1))


def test_iso_utc_converts_offsets():
    ct = timezone(timedelta(hours=-5))
    assert env.iso_utc(datetime(2026, 9, 30, 10, 0, 0, 123, tzinfo=ct)) == "2026-09-30T15:00:00Z"


def test_failure_keeps_previous_data_and_as_of(now):
    prev = env.make_envelope("margins", "s", "ok", [], {"rows": [{"root": "ES", "initial_usd": 1.5,
                             "maintenance_usd": None, "as_of": None}]},
                             datetime(2026, 9, 29, 21, 0, tzinfo=timezone.utc), now - timedelta(days=1))
    f = env.failure_envelope("margins", "s", prev, ["HTTP 403"], now)
    assert f["status"] == "error"
    assert f["errors"] == ["HTTP 403"]
    assert f["data"] == prev["data"]
    assert f["data_as_of"] == "2026-09-29T21:00:00Z"
    assert f["generated_at"] == "2026-09-30T15:23:45Z"
    validate("margins", f)


def test_failure_without_previous_or_wrong_dataset(now):
    for prev in (None, {"dataset": "bars", "data": {"x": 1}, "data_as_of": "2026-01-01T00:00:00Z"}, {"junk": 1}):
        f = env.failure_envelope("margins", "s", prev, ["boom"], now)
        assert f["data"] is None and f["data_as_of"] is None and f["status"] == "error"
        validate("margins", f)


def test_failure_never_has_empty_errors(now):
    assert env.failure_envelope("margins", "s", None, [], now)["errors"]


def test_load_previous_never_raises(tmp_path):
    assert env.load_previous(tmp_path / "missing.json") is None
    (tmp_path / "corrupt.json").write_text("{not json")
    assert env.load_previous(tmp_path / "corrupt.json") is None
    (tmp_path / "list.json").write_text("[1, 2]")
    assert env.load_previous(tmp_path / "list.json") is None
    (tmp_path / "bin.json").write_bytes(b"\xff\xfe\x00")
    assert env.load_previous(tmp_path / "bin.json") is None
    (tmp_path / "dir.json").mkdir()
    assert env.load_previous(tmp_path / "dir.json") is None
    (tmp_path / "ok.json").write_text('{"a": 1}')
    assert env.load_previous(tmp_path / "ok.json") == {"a": 1}


def test_write_atomic_format(tmp_path):
    p = tmp_path / "sub" / "x.json"
    env.write_atomic(p, {"a": 1, "b": [1, 2]})
    text = p.read_text()
    assert text == '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n'
    assert os.listdir(p.parent) == ["x.json"]


def test_write_atomic_unserialisable_leaves_old_file_untouched(tmp_path):
    p = tmp_path / "x.json"
    env.write_atomic(p, {"old": True})
    with pytest.raises((TypeError, ValueError)):
        env.write_atomic(p, {"bad": object()})
    with pytest.raises(ValueError):
        env.write_atomic(p, {"nan": float("nan")})
    assert json.loads(p.read_text()) == {"old": True}
    assert os.listdir(tmp_path) == ["x.json"]


def test_write_atomic_failure_during_replace_cleans_temp(tmp_path, monkeypatch):
    p = tmp_path / "x.json"
    env.write_atomic(p, {"old": True})

    def boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr(env.os, "replace", boom)
    with pytest.raises(OSError):
        env.write_atomic(p, {"new": True})
    assert json.loads(p.read_text()) == {"old": True}
    assert os.listdir(tmp_path) == ["x.json"]


def test_schema_rejects_bad_envelopes(now):
    good = env.make_envelope("settlements", "s", "ok", [], {"rows": []}, now, now)
    validate("settlements", good)
    for mutate in (
        lambda e: e.update(schema_version=2),
        lambda e: e.update(dataset="bars"),
        lambda e: e.update(status="fine"),
        lambda e: e.update(extra=1),
        lambda e: e["data"].update(rows=[{"root": "ES", "contract_code": "ESZ26", "settle": None,
                                          "trade_date": "2026-09-29"}]),
        lambda e: e.update(generated_at="yesterday"),
    ):
        bad = json.loads(json.dumps(good))
        mutate(bad)
        with pytest.raises(jsonschema.ValidationError):
            validate("settlements", bad)


@pytest.mark.parametrize("value,ok", [
    ("2026-09-30T15:00:00Z", True),
    ("2026-09-30T10:00:00-05:00", True),
    ("2026-09-30T15:00:00.5Z", True),
    ("2026-09-30T15:00:00", False),
    ("2026-09-30", False),
    ("2026-13-30T15:00:00Z", False),
])
def test_date_time_format_is_enforced(now, value, ok):
    e = env.make_envelope("challenge", "s", "ok", [], {"rows": []}, now, now)
    e["data_as_of"] = value
    if ok:
        validate("challenge", e)
    else:
        with pytest.raises(jsonschema.ValidationError):
            validate("challenge", e)
