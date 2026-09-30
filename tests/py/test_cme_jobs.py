import json
from datetime import datetime, timedelta, timezone

import pytest

from jobs import fetch_challenge, fetch_margins, fetch_settlements
from jobs.common import config, http
from jobs.common.envelope import make_envelope, write_atomic
from jobs.common.fakes import SOURCES_FIXTURE, FakeResponse, fixture_fetch
from jobs.common.schema import validate
from jobs.common.scrape import ParseError, parse_date, parse_int, parse_number

FIX = config.FIXTURES_DIR
SYN_SOURCES = config.load_sources(SOURCES_FIXTURE)


def fx(name):
    return (FIX / name).read_text()


# ---------- cell helpers ----------

@pytest.mark.parametrize("cell,expected", [
    ("1,234.50", 1234.5), ("$1,234.50", 1234.5), ("-$400.50", -400.5), ("($300.00)", -300.0),
    ("− 12", -12.0),("−12", -12.0), (7, 7.0), (2.5, 2.5), ("0", 0.0), ("0.00", 0.0),
    ("", None), ("  ", None), ("-", None), ("—", None), ("N/A", None), (None, None), (True, None),
    ("abc", None), ("1.2.3", None), ("nan", None), ("inf", None), (float("nan"), None), ({}, None),
])
def test_parse_number(cell, expected):
    assert parse_number(cell) == expected


def test_parse_number_zero_only_from_literal_zero():
    assert all(parse_number(x) is None for x in ("", "-", None, "n/a", "x"))


def test_parse_int_and_date():
    assert parse_int("42") == 42 and parse_int("4.5") is None and parse_int("-") is None
    assert parse_date("09/29/2026", ["%m/%d/%Y"]).isoformat() == "2026-09-29"
    assert parse_date("2026-13-01", ["%Y-%m-%d"]) is None and parse_date(None, ["%Y"]) is None


# ---------- settlements ----------

def test_parse_settlements_synthetic_fixture():
    rows = fetch_settlements.parse_settlements(fx("settlements_ES.SYNTHETIC.json"), "ES")
    assert rows == [
        {"root": "ES", "contract_code": "ESZ26", "settle": 5012.25, "trade_date": "2026-09-29"},
        {"root": "ES", "contract_code": "ESH27", "settle": 5015.25, "trade_date": "2026-09-29"},
        {"root": "ES", "contract_code": "ESM27", "settle": 5018.25, "trade_date": "2026-09-29"},
        {"root": "ES", "contract_code": "ESU27", "settle": 5021.25, "trade_date": "2026-09-29"},
    ]


def test_parse_settlements_drops_missing_settle_never_zero():
    payload = {"tradeDate": "09/29/2026", "settlements": [
        {"month": "DEC 26", "settle": "-"}, {"month": "MAR 27", "settle": ""},
        {"month": "JUN 27", "settle": "5,001.00"}, {"month": "Total", "settle": "0"}]}
    rows = fetch_settlements.parse_settlements(payload, "ES")
    assert [(r["contract_code"], r["settle"]) for r in rows] == [("ESM27", 5001.0)]


def test_contract_code():
    assert fetch_settlements.contract_code("CL", "NOV 26") == "CLX26"
    assert fetch_settlements.contract_code("GC", "dec27") == "GCZ27"
    assert fetch_settlements.contract_code("ES", "Total") is None
    assert fetch_settlements.contract_code("ES", "XYZ 26") is None


@pytest.mark.parametrize("payload", [
    "<html>Access denied</html>",
    "",
    "[]",
    '{"settlements": []}',                                     # no trade date
    '{"tradeDate": "09/29/2026"}',                             # no rows
    '{"tradeDate": "yesterday", "settlements": []}',
    '{"tradeDate": "09/29/2026", "settlements": {"a": 1}}',
    '{"tradeDate": "09/29/2026", "settlements": [{"contract": "DEC 26", "px": "1"}]}',
    '{"tradeDate": "09/29/2026", "settlements": [{"month": "DEC 26", "settle": "1"}, 5]}',
])
def test_parse_settlements_malformed(payload):
    with pytest.raises(ParseError):
        fetch_settlements.parse_settlements(payload, "ES")


def test_settlements_run_dry(now, tmp_path):
    e = fetch_settlements.run(now, tmp_path / "s.json", dry_run=True)
    validate("settlements", e)
    assert e["status"] == "ok" and "SYNTHETIC" in e["source"]
    assert {r["root"] for r in e["data"]["rows"]} == {"ES", "NQ", "CL", "GC"}
    # trade date 2026-09-29 16:00 CDT = 21:00Z
    assert e["data_as_of"] == "2026-09-29T21:00:00Z"


def test_settlements_run_partial_on_one_root_403(now, tmp_path):
    def fetch(url, **kw):
        if url.endswith("/NQ.json"):
            return FakeResponse(403, "denied", "text/html")
        return fixture_fetch(url, **kw)
    e = fetch_settlements.run(now, tmp_path / "s.json", fetch=fetch, sources=SYN_SOURCES)
    validate("settlements", e)
    assert e["status"] == "partial"
    assert e["errors"] == ["NQ: HTTP 403 from www.cmegroup.com"]
    assert "NQ" not in {r["root"] for r in e["data"]["rows"]}


def test_settlements_all_fail_keeps_previous(now, tmp_path):
    out = tmp_path / "s.json"
    prev = make_envelope("settlements", "s", "ok", [],
                         {"rows": [{"root": "ES", "contract_code": "ESZ26", "settle": 1.0, "trade_date": "2026-09-28"}]},
                         datetime(2026, 9, 28, 21, tzinfo=timezone.utc), now - timedelta(days=1))
    write_atomic(out, prev)
    e = fetch_settlements.run(now, out, fetch=lambda u, **k: FakeResponse(403, "x", "text/html"),
                              sources=SYN_SOURCES)
    assert e["status"] == "error" and e["data"] == prev["data"] and e["data_as_of"] == prev["data_as_of"]
    assert json.loads(out.read_text()) == e


def test_settlements_not_configured(now, tmp_path):
    e = fetch_settlements.run(now, tmp_path / "s.json", fetch=lambda *a, **k: 1 / 0,
                              sources={"settlements": {"url_template": None, "products": {}}})
    assert e["status"] == "error" and "not configured" in e["errors"][0]


def test_settlements_disallowed_host_is_error_not_crash(now, tmp_path):
    src = json.loads(json.dumps(SYN_SOURCES))
    src["settlements"]["url_template"] = "https://example.com/{product_id}"
    e = fetch_settlements.run(now, tmp_path / "s.json", fetch=http.get, sources=src)
    assert e["status"] == "error"
    assert all("host not allowlisted" in x for x in e["errors"])


def test_live_sources_are_unverified():
    live = config.load_sources()
    for name in ("settlements", "margins", "challenge"):
        assert live[name]["verified"] is False
    for p in live["settlements"]["products"].values():
        assert p["verified"] is False


# ---------- margins ----------

def test_parse_margins_synthetic_fixture():
    rows = fetch_margins.parse_margins(fx("margins.SYNTHETIC.json"), roots=config.all_roots(config.load_contracts()))
    assert [r["root"] for r in rows] == ["ES", "MES", "NQ", "MNQ", "CL", "MCL", "GC", "MGC"]  # ZZ filtered
    assert rows[0] == {"root": "ES", "initial_usd": 11000.0, "maintenance_usd": 10000.0, "as_of": "2026-09-29"}
    assert rows[4]["initial_usd"] == 6600.0


def test_parse_margins_blank_is_null():
    rows = fetch_margins.parse_margins({"rows": [{"root": "ES", "initial": "", "maintenance": "abc"}]})
    assert rows == [{"root": "ES", "initial_usd": None, "maintenance_usd": None, "as_of": None}]


@pytest.mark.parametrize("payload", [
    "<html>blocked</html>", "{}", '{"rows": "x"}', '{"rows": []}', '{"rows": [{"product": "ES"}]}',
    '{"rows": [{"root": "ES"}, "junk"]}',
])
def test_parse_margins_malformed(payload):
    with pytest.raises(ParseError):
        fetch_margins.parse_margins(payload)


def test_margins_run_dry(now, tmp_path):
    e = fetch_margins.run(now, tmp_path / "m.json", dry_run=True)
    validate("margins", e)
    assert e["status"] == "ok" and len(e["data"]["rows"]) == 8
    assert e["data_as_of"] == "2026-09-30T15:23:45Z"


def test_margins_run_partial_on_missing_root_and_null(now, tmp_path):
    payload = json.dumps({"asOf": "2026-09-29", "rows": [{"root": "ES", "initial": "1", "maintenance": ""}]})
    e = fetch_margins.run(now, tmp_path / "m.json", fetch=lambda u, **k: FakeResponse(200, payload, "application/json"),
                          sources=SYN_SOURCES)
    validate("margins", e)
    assert e["status"] == "partial"
    assert e["data"]["rows"] == [{"root": "ES", "initial_usd": 1.0, "maintenance_usd": None, "as_of": "2026-09-29"}]
    assert any("missing roots" in x for x in e["errors"])
    assert any("ES: maintenance_usd" in x for x in e["errors"])


def test_margins_live_config_fails_closed_without_io(now, tmp_path):
    def no_io(*a, **k):
        raise AssertionError("no fetch expected")
    e = fetch_margins.run(now, tmp_path / "m.json", fetch=no_io)
    assert e["status"] == "error" and "not configured" in e["errors"][0]
    validate("margins", e)


def test_margins_bot_wall_html_is_parse_error(now, tmp_path):
    e = fetch_margins.run(now, tmp_path / "m.json",
                          fetch=lambda u, **k: FakeResponse(200, "<html>captcha</html>", "text/html"),
                          sources=SYN_SOURCES)
    assert e["status"] == "error" and "not JSON" in e["errors"][0]


def test_margins_transport_exception(now, tmp_path):
    def boom(u, **k):
        raise ConnectionError("reset by peer")
    e = fetch_margins.run(now, tmp_path / "m.json", fetch=boom, sources=SYN_SOURCES)
    assert e["status"] == "error" and "reset by peer" in e["errors"][0]


# ---------- challenge ----------

def test_parse_challenge_synthetic_fixture():
    rows = fetch_challenge.parse_challenge(fx("challenge.SYNTHETIC.html"), "SYNTH-0001")
    assert rows == [
        {"date": "2026-09-28", "account": "SYNTH-0001", "pnl_usd": 1250.0, "balance_usd": 101250.0, "rank": 42},
        {"date": "2026-09-29", "account": "SYNTH-0001", "pnl_usd": -400.5, "balance_usd": 100849.5, "rank": 45},
    ]


def test_parse_challenge_all_accounts_and_null_rank():
    rows = fetch_challenge.parse_challenge(fx("challenge.SYNTHETIC.html"))
    assert len(rows) == 4
    beta = [r for r in rows if r["account"] == "SYNTH-0002"]
    assert beta[0]["pnl_usd"] == -300.0 and beta[1]["rank"] is None


def test_parse_challenge_blank_cells_are_null():
    html = ("<table><tr><th>Date</th><th>Account</th><th>P&amp;L</th><th>Balance</th><th>Rank</th></tr>"
            "<tr><td>2026-09-29</td><td>A</td><td></td><td>-</td><td>3</td></tr>"
            "<tr><td colspan='5'>End of results</td></tr></table>")
    assert fetch_challenge.parse_challenge(html, "a") == [
        {"date": "2026-09-29", "account": "A", "pnl_usd": None, "balance_usd": None, "rank": 3}]


@pytest.mark.parametrize("payload", [
    "", "<html><body>Please enable JavaScript</body></html>",
    "<table><tr><th>Date</th><th>Account</th></tr></table>",
    "<table><tr><th>Date</th><th>Account</th><th>P&amp;L</th><th>Balance</th><th>Rank</th></tr>"
    "<tr><td>Sept 29th</td><td>A</td><td>1</td><td>2</td><td>3</td></tr></table>",
])
def test_parse_challenge_malformed(payload):
    with pytest.raises(ParseError):
        fetch_challenge.parse_challenge(payload, "A")


def test_challenge_run_dry(now, tmp_path):
    e = fetch_challenge.run(now, tmp_path / "c.json", dry_run=True)
    validate("challenge", e)
    assert e["status"] == "ok" and len(e["data"]["rows"]) == 2
    assert e["data_as_of"] == "2026-09-29T21:00:00Z"


def test_challenge_account_missing_is_error(now, tmp_path):
    src = json.loads(json.dumps(SYN_SOURCES))
    src["challenge"]["account"] = "NOPE"
    e = fetch_challenge.run(now, tmp_path / "c.json", fetch=fixture_fetch, sources=src)
    assert e["status"] == "error" and e["data"] is None


def test_challenge_live_config_fails_closed(now, tmp_path):
    e = fetch_challenge.run(now, tmp_path / "c.json", fetch=lambda *a, **k: 1 / 0)
    assert e["status"] == "error" and "not configured" in e["errors"][0]


def test_challenge_null_pnl_is_partial(now, tmp_path):
    html = ("<table><tr><th>Date</th><th>Account</th><th>P&amp;L</th><th>Balance</th><th>Rank</th></tr>"
            "<tr><td>09/29/2026</td><td>SYNTH-0001</td><td></td><td>$1.00</td><td>3</td></tr></table>")
    e = fetch_challenge.run(now, tmp_path / "c.json", fetch=lambda u, **k: FakeResponse(200, html, "text/html"),
                            sources=SYN_SOURCES)
    validate("challenge", e)
    assert e["status"] == "partial" and e["data"]["rows"][0]["pnl_usd"] is None


def test_ct_close_is_dst_aware():
    from datetime import date
    assert config.ct_close_utc(date(2026, 9, 29)).isoformat() == "2026-09-29T21:00:00+00:00"   # CDT
    assert config.ct_close_utc(date(2026, 11, 2)).isoformat() == "2026-11-02T22:00:00+00:00"   # CST
