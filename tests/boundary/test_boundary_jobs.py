"""Planner-owned boundary tests for jobs/ (A9, A10, A11). Never weaken these to get green."""
import ast
import json
import pathlib

import jsonschema
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
JOBS = ROOT / "jobs"
SCHEMAS = ROOT / "plan" / "schemas"

NET_MODULES = {"requests", "urllib", "urllib3", "http", "httpx", "aiohttp", "socket", "ftplib", "smtplib"}


def _imports(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    mods: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods.add(node.module.split(".")[0])
    return mods


def _py_files():
    return [p for p in JOBS.rglob("*.py")] if JOBS.exists() else []


def test_jobs_exist():
    assert (JOBS / "common" / "http.py").exists(), "jobs/common/http.py (allowlisted HTTP) missing"


@pytest.mark.parametrize("path", _py_files(), ids=lambda p: str(p.relative_to(ROOT)))
def test_network_only_via_http_module(path):
    rel = path.relative_to(ROOT).as_posix()
    mods = _imports(path)
    if rel != "jobs/common/http.py":
        assert not (mods & NET_MODULES), f"{rel} imports {mods & NET_MODULES}; use jobs.common.http"
    if "databento" in mods:
        assert rel == "jobs/fetch_bars.py", f"{rel}: databento client only allowed in jobs/fetch_bars.py"


def test_allowlist_is_cme_only():
    tree = ast.parse((JOBS / "common" / "http.py").read_text())
    hosts = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "ALLOWED_HOSTS" for t in node.targets):
            hosts = ast.literal_eval(node.value.args[0] if isinstance(node.value, ast.Call) else node.value)
    assert hosts, "ALLOWED_HOSTS literal not found in jobs/common/http.py"
    for h in hosts:
        assert h == "cmegroup.com" or h.endswith(".cmegroup.com"), f"host {h} not allowlisted by plan"


def test_databento_cost_checked_before_spend():
    src = (JOBS / "fetch_bars.py").read_text()
    assert "get_cost" in src, "fetch_bars.py must call metadata.get_cost"
    assert src.index("get_cost") < src.index("get_range"), "get_cost must precede get_range"


DATASETS = ["bars", "settlements", "margins", "challenge", "calendar"]


@pytest.mark.parametrize("name", DATASETS)
def test_committed_data_matches_schema(name):
    path = ROOT / "docs" / "data" / f"{name}.json"
    assert path.exists(), f"docs/data/{name}.json missing (seed an envelope with data:null, status:error)"
    schema = json.loads((SCHEMAS / f"{name}.schema.json").read_text())
    jsonschema.validate(json.loads(path.read_text()), schema)


@pytest.mark.parametrize("name", ["rules", "contracts"])
def test_static_files_match_schema(name):
    schema = json.loads((SCHEMAS / f"{name}.schema.json").read_text())
    jsonschema.validate(json.loads((ROOT / "docs" / "data" / f"{name}.json").read_text()), schema)


def test_every_rule_has_source_when_known():
    rules = json.loads((ROOT / "docs" / "data" / "rules.json").read_text())["rules"]
    for key, rule in rules.items():
        if rule["value"] is not None:
            assert rule["source"], f"rule {key} has a value but no source (D10)"
