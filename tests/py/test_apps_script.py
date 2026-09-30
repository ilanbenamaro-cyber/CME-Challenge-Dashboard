"""Run apps_script/Code.gs under Node with stubbed Apps Script services (no Google access needed)."""
import json
import shutil
import subprocess
from pathlib import Path

import jsonschema
import pytest

REPO = Path(__file__).resolve().parents[2]
CODE = REPO / "apps_script" / "Code.gs"
SHEET_SCHEMA = json.loads((REPO / "plan" / "schemas" / "sheet.schema.json").read_text())

HARNESS = r"""
const vm = require('node:vm');
const crypto = require('node:crypto');
const fs = require('node:fs');
const [codePath, scenarioJson] = process.argv.slice(1);
const sc = JSON.parse(scenarioJson);
const writes = [];
const revive = (v) => (v && typeof v === 'object' && v.$date) ? new Date(v.$date) : v;
function sheet(values) {
  return {
    getDataRange: () => ({ getValues: () => values.map((r) => r.map(revive)) }),
    getRange: () => { writes.push('getRange'); return { setValue: () => writes.push('setValue') }; },
    appendRow: () => writes.push('appendRow'),
  };
}
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'SHEET_KEY' ? sc.secret : null) }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: (n) => (sc.tabs[n] ? sheet(sc.tabs[n]) : null) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    formatDate: (d, tz, fmt) => {
      // Test stub: fixed CDT offset is fine for the fixture dates (all in September).
      const p = new Date(d.getTime() - 5 * 3600e3).toISOString();
      return fmt === 'yyyy-MM-dd' ? p.slice(0, 10) : p.slice(0, 19) + '-05:00';
    },
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
const out = ctx.doGet(sc.event);
process.stdout.write(JSON.stringify({ body: JSON.parse(out.text), writes }));
"""

TABS = {
    "Trades": [
        ["id", "root", "side", "qty", "entry", "exit", "entry_time", "exit_time", "fees_usd", "notes"],
        [1, "MES", "long", 2, 5000.25, "", {"$date": "2026-09-29T14:30:00Z"}, "", 2.5, ""],
        ["", "", "", "", "", "", "", "", "", ""],
    ],
    "Daily": [
        ["date", "reported_pnl_usd", "reported_balance_usd"],
        [{"$date": "2026-09-29T05:00:00Z"}, -12.5, ""],
    ],
}


def _run(secret, event, tabs=TABS):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, "-e", HARNESS, str(CODE), json.dumps({"secret": secret, "event": event, "tabs": tabs})],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


@pytest.mark.parametrize("secret,event", [
    ("s3cret-value-long", {"parameter": {"key": "wrong"}}),
    ("s3cret-value-long", {"parameter": {}}),
    ("s3cret-value-long", None),
    ("s3cret-value-long", {"parameter": {"key": "s3cret-value-lon"}}),
    (None, {"parameter": {"key": ""}}),
    (None, {"parameter": {"key": "anything"}}),
])
def test_unauthorized(secret, event):
    out = _run(secret, event)
    assert out["body"] == {"error": "unauthorized"}


def test_authorized_shape_and_read_only():
    out = _run("s3cret-value-long", {"parameter": {"key": "s3cret-value-long"}})
    body = out["body"]
    jsonschema.validate(body, SHEET_SCHEMA)
    assert out["writes"] == []
    assert body["schema_version"] == 1
    assert "Margins" not in body["tabs"]
    (trade,) = body["tabs"]["Trades"]  # blank row skipped
    assert trade["exit"] == "" and trade["exit_time"] == ""  # blank stays "", never 0
    assert trade["entry_time"] == "2026-09-29T09:30:00-05:00"
    assert body["tabs"]["Daily"] == [{"date": "2026-09-29", "reported_pnl_usd": -12.5, "reported_balance_usd": ""}]


def test_missing_required_tab_is_error():
    out = _run("k" * 20, {"parameter": {"key": "k" * 20}}, tabs={"Trades": TABS["Trades"]})
    assert out["body"] == {"error": "read failed: missing tab Daily"}


def test_optional_margins_tab():
    tabs = dict(TABS, Margins=[["root", "initial_usd", "maintenance_usd", "as_of"], ["ES", 1, "", ""]])
    out = _run("k" * 20, {"parameter": {"key": "k" * 20}}, tabs=tabs)
    jsonschema.validate(out["body"], SHEET_SCHEMA)
    assert out["body"]["tabs"]["Margins"] == [{"root": "ES", "initial_usd": 1, "maintenance_usd": "", "as_of": ""}]
