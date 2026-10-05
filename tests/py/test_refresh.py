import json
import subprocess
import sys
from pathlib import Path

import pytest

from jobs import refresh, validate_calendar
from jobs.common import config
from jobs.common.envelope import write_atomic
from jobs.common.schema import validate

REPO = Path(__file__).resolve().parents[2]
WRITTEN = ["bars", "settlements", "margins", "challenge"]


@pytest.mark.real_contracts
def test_dry_run_writes_all_valid_envelopes(tmp_path, now):
    lines = []
    assert refresh.run_all(refresh.ALL, tmp_path, dry_run=True, now=now, print_fn=lines.append) == 0
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(f"{n}.json" for n in WRITTEN)
    for name in WRITTEN:
        env = json.loads((tmp_path / f"{name}.json").read_text())
        validate(name, env)
        assert env["status"] == "ok", (name, env["errors"])
        assert "SYNTHETIC" in env["source"]
    assert [ln.split(":")[0] for ln in lines] == refresh.ALL
    assert lines[-1].startswith("calendar: ok")


def test_one_job_raising_does_not_block_others(tmp_path, now, monkeypatch):
    def boom(now_, out, dry):
        raise RuntimeError("kaboom")
    monkeypatch.setitem(refresh.RUNNERS, "settlements", boom)
    lines = []
    rc = refresh.run_all(WRITTEN, tmp_path, dry_run=True, now=now, print_fn=lines.append)
    assert rc == 0
    for name in WRITTEN:
        env = json.loads((tmp_path / f"{name}.json").read_text())
        validate(name, env)
        if name == "settlements":
            assert env["status"] == "error" and "job crashed: RuntimeError: kaboom" in env["errors"][0]
        else:
            assert env["status"] == "ok"


def test_adr005_unchanged_envelope_is_not_rewritten(tmp_path, now):
    # challenge data_as_of is pinned to the fixture's trade date, so a later run differs only in generated_at.
    import os
    from datetime import timedelta

    refresh.run_all(["challenge"], tmp_path, dry_run=True, now=now, print_fn=lambda s: None)
    out = tmp_path / "challenge.json"
    os.utime(out, (1_000_000_000, 1_000_000_000))
    before_bytes, before_mtime = out.read_bytes(), out.stat().st_mtime_ns
    lines = []
    assert refresh.run_all(["challenge"], tmp_path, dry_run=True, now=now + timedelta(hours=1),
                           print_fn=lines.append) == 0
    assert lines == ["challenge: unchanged"]
    assert out.read_bytes() == before_bytes
    assert out.stat().st_mtime_ns == before_mtime


def test_adr005_changed_data_as_of_is_written(tmp_path, now):
    # margins data_as_of is the fetch time, so a later run changes it and must be written.
    import os
    from datetime import timedelta

    refresh.run_all(["margins"], tmp_path, dry_run=True, now=now, print_fn=lambda s: None)
    out = tmp_path / "margins.json"
    os.utime(out, (1_000_000_000, 1_000_000_000))
    first = json.loads(out.read_text())
    lines = []
    refresh.run_all(["margins"], tmp_path, dry_run=True, now=now + timedelta(hours=1), print_fn=lines.append)
    second = json.loads(out.read_text())
    assert lines[0].startswith("margins: ok")
    assert second["data_as_of"] != first["data_as_of"] and second["generated_at"] != first["generated_at"]
    assert out.stat().st_mtime_ns != 1_000_000_000 * 10**9


def test_crashed_job_keeps_previous_data(tmp_path, now, monkeypatch):
    refresh.run_all(["margins"], tmp_path, dry_run=True, now=now, print_fn=lambda s: None)
    good = json.loads((tmp_path / "margins.json").read_text())
    monkeypatch.setitem(refresh.RUNNERS, "margins", lambda *a: 1 / 0)
    refresh.run_all(["margins"], tmp_path, dry_run=True, now=now, print_fn=lambda s: None)
    env = json.loads((tmp_path / "margins.json").read_text())
    assert env["status"] == "error" and env["data"] == good["data"] and env["data_as_of"] == good["data_as_of"]


def test_invalid_output_becomes_failure_envelope(tmp_path, now, monkeypatch):
    from jobs.common import publish as pub
    from jobs.common.envelope import make_envelope

    bad = make_envelope("margins", "s", "ok", [], {"rows": [{"root": "es!", "initial_usd": 1,
                        "maintenance_usd": 1, "as_of": None}]}, now, now)
    out = tmp_path / "margins.json"
    env = pub.publish("margins", "s", bad, out, None, now)
    assert env["status"] == "error" and env["data"] is None
    assert any("schema" in e for e in env["errors"])
    assert json.loads(out.read_text()) == env


def test_invalid_previous_is_dropped(tmp_path, now):
    from jobs.common import publish as pub
    from jobs.common.envelope import make_envelope

    prev = {"dataset": "margins", "data": {"rows": "corrupt"}, "data_as_of": "2026-09-29T00:00:00Z"}
    bad = make_envelope("margins", "s", "ok", [], {"rows": "nope"}, now, now)
    env = pub.publish("margins", "s", bad, tmp_path / "m.json", prev, now)
    validate("margins", env)
    assert env["data"] is None and env["data_as_of"] is None


def test_write_failure_gives_nonzero_exit(tmp_path, now, monkeypatch):
    from jobs.common import envelope

    def fail(*a, **k):
        raise OSError("read-only fs")
    monkeypatch.setattr(envelope.os, "replace", fail)
    lines = []
    assert refresh.run_all(["margins"], tmp_path, dry_run=True, now=now, print_fn=lines.append) == 1
    assert "WRITE FAILED" in lines[0]


def test_live_mode_without_network_or_key_fails_closed(tmp_path, now, monkeypatch):
    """No key and unconfigured CME sources: every dataset ends status:error, exit 0, nothing crashes."""
    monkeypatch.delenv("DATABENTO_API_KEY", raising=False)

    def no_net(*a, **k):
        raise ConnectionError("network disabled in test")
    from jobs.common import http
    monkeypatch.setattr(http, "_session_factory", no_net)
    lines = []
    assert refresh.run_all(WRITTEN, tmp_path, dry_run=False, now=now, print_fn=lines.append) == 0
    for name in WRITTEN:
        env = json.loads((tmp_path / f"{name}.json").read_text())
        validate(name, env)
        assert env["status"] == "error" and env["data"] is None


def test_cli_only_and_dry_run_guard(tmp_path):
    assert refresh.main(["--dry-run", "--only", "margins", "--data-dir", str(tmp_path)]) == 0
    assert [p.name for p in tmp_path.iterdir()] == ["margins.json"]
    with pytest.raises(SystemExit):
        refresh.main(["--only", "nope", "--dry-run", "--data-dir", str(tmp_path)])
    with pytest.raises(SystemExit):
        refresh.main(["--dry-run", "--data-dir", str(config.DEFAULT_DATA_DIR)])


def test_cli_module_entrypoint(tmp_path):
    r = subprocess.run([sys.executable, "-m", "jobs.refresh", "--dry-run", "--data-dir", str(tmp_path)],
                       cwd=REPO, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    assert [ln.split(":")[0] for ln in r.stdout.splitlines()[1:]] == refresh.ALL


@pytest.mark.real_contracts
def test_calendar_validation_is_read_only_and_ok(now):
    before = (config.DEFAULT_DATA_DIR / "calendar.json").read_bytes()
    res = validate_calendar.run(now)
    assert res["status"] == "ok", res["errors"]
    assert (config.DEFAULT_DATA_DIR / "calendar.json").read_bytes() == before


def test_calendar_validation_catches_problems(tmp_path, now):
    cal = json.loads((config.DEFAULT_DATA_DIR / "calendar.json").read_text())
    cal["data"]["expirations"] = [{"root": "ZZ", "contract_code": "ESZ26", "date": "2026-02-30", "source": "x"}]
    write_atomic(tmp_path / "cal.json", cal)
    res = validate_calendar.run(now, tmp_path / "cal.json")
    assert res["status"] == "error" and len(res["errors"]) == 3
    (tmp_path / "bad.json").write_text("{")
    assert validate_calendar.run(now, tmp_path / "bad.json")["status"] == "error"
    cal["status"] = "great"
    write_atomic(tmp_path / "cal2.json", cal)
    assert validate_calendar.run(now, tmp_path / "cal2.json")["errors"][0].startswith("schema:")


@pytest.mark.parametrize("name", WRITTEN)
def test_committed_seed_envelopes_are_valid(name):
    env = json.loads((config.DEFAULT_DATA_DIR / f"{name}.json").read_text())
    validate(name, env)
    # Committed files start as "not yet fetched" seeds and are later replaced by the bot with real data, so the
    # invariant is: schema-valid, never SYNTHETIC fixture data, and no data without a data_as_of (D7).
    assert "SYNTHETIC" not in env["source"]
    assert (env["data"] is None) == (env["data_as_of"] is None)
    if env["status"] != "error":
        assert env["data"] is not None
