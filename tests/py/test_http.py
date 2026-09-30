import pytest
import requests

from jobs.common import http


class FakeResp:
    def __init__(self, status, location=None):
        self.status_code = status
        self.headers = {"Location": location} if location else {}
        self.is_redirect = bool(location) and status in (301, 302, 303, 307, 308)


class FakeSession:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, **kw):
        self.calls.append((url, kw))
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture
def session(monkeypatch):
    holder = {}

    def install(script):
        s = FakeSession(script)
        holder["s"] = s
        monkeypatch.setattr(http, "_session_factory", lambda: s)
        return s

    monkeypatch.setattr(http, "_sleep", lambda _s: None)
    return install


def _no_io(monkeypatch):
    def fail():
        raise AssertionError("I/O attempted for a disallowed URL")

    monkeypatch.setattr(http, "_session_factory", fail)


@pytest.mark.parametrize("url", [
    "http://www.cmegroup.com/x",                 # not https
    "https://cmegroup.com.evil.io/x",            # lookalike suffix
    "https://www.cmegroup.com.evil.io/x",
    "https://evilcmegroup.com/x",
    "https://evil.io/www.cmegroup.com",
    "https://evil.io/?u=https://www.cmegroup.com",
    "https://user:pw@www.cmegroup.com/x",        # userinfo
    "https://www.cmegroup.com@evil.io/x",
    "https://www.cmegroup.com:8443/x",           # odd port
    "ftp://www.cmegroup.com/x",
    "https:///x",
    "www.cmegroup.com/x",
    "https://[::1]/x",
])
def test_rejects_before_io(monkeypatch, url):
    _no_io(monkeypatch)
    with pytest.raises(http.HostNotAllowed):
        http.get(url)


def test_allows_exact_host_case_insensitive():
    assert http.check_url("https://WWW.CMEGROUP.COM/a?b=1") == "www.cmegroup.com"
    assert http.check_url("https://www.cmegroup.com:443/a") == "www.cmegroup.com"


def test_allowlist_is_cme_only():
    assert http.ALLOWED_HOSTS
    assert all(h == "cmegroup.com" or h.endswith(".cmegroup.com") for h in http.ALLOWED_HOSTS)


def test_honest_user_agent_and_no_redirect_following(session):
    s = session([FakeResp(200)])
    r = http.get("https://www.cmegroup.com/a", accept="application/json")
    assert r.status_code == 200
    (url, kw), = s.calls
    assert kw["allow_redirects"] is False
    assert kw["headers"]["Accept"] == "application/json"
    assert "research" in kw["headers"]["User-Agent"]
    assert "Mozilla" not in kw["headers"]["User-Agent"]


def test_retries_5xx_twice_then_returns_last(session):
    s = session([FakeResp(503), FakeResp(502), FakeResp(500)])
    assert http.get("https://www.cmegroup.com/a").status_code == 500
    assert len(s.calls) == 3


def test_retry_recovers(session):
    s = session([requests.ConnectionError("reset"), FakeResp(200)])
    assert http.get("https://www.cmegroup.com/a").status_code == 200
    assert len(s.calls) == 2


def test_connection_errors_exhaust_and_raise(session):
    s = session([requests.ConnectionError("x"), requests.Timeout("y"), requests.ConnectionError("z")])
    with pytest.raises(requests.ConnectionError):
        http.get("https://www.cmegroup.com/a")
    assert len(s.calls) == 3


def test_no_retry_on_4xx(session):
    s = session([FakeResp(403)])
    assert http.get("https://www.cmegroup.com/a").status_code == 403
    assert len(s.calls) == 1


def test_redirect_to_allowed_host_followed(session):
    s = session([FakeResp(302, "/b"), FakeResp(200)])
    assert http.get("https://www.cmegroup.com/a").status_code == 200
    assert s.calls[1][0] == "https://www.cmegroup.com/b"


def test_redirect_off_allowlist_rejected(session):
    s = session([FakeResp(302, "https://evil.io/x")])
    with pytest.raises(http.HostNotAllowed):
        http.get("https://www.cmegroup.com/a")
    assert len(s.calls) == 1


def test_redirect_loop_capped(session):
    session([FakeResp(302, "/a")] * 10)
    with pytest.raises(requests.TooManyRedirects):
        http.get("https://www.cmegroup.com/a")
