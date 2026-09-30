"""The only module in jobs/ allowed to make HTTP requests (Databento's client in fetch_bars.py aside).

Every URL, including each redirect hop, must be https:// on an exact host in ALLOWED_HOSTS. The check
runs before any I/O. The User-Agent honestly identifies this personal research tool.
"""
from __future__ import annotations

import time
from typing import Callable
from urllib.parse import urljoin, urlsplit

import requests

ALLOWED_HOSTS = frozenset({"www.cmegroup.com"})

USER_AGENT = (
    "cme-challenge-dashboard-refresh/1.0 "
    "(personal research and risk dashboard; low-frequency scheduled fetch; python-requests)"
)
DEFAULT_ACCEPT = "application/json, text/html;q=0.9, */*;q=0.5"
MAX_RETRIES = 2  # retries after the first attempt, on 5xx or connection errors only
BACKOFF_S = (2.0, 5.0)
MAX_REDIRECTS = 3

_sleep: Callable[[float], None] = time.sleep
_session_factory: Callable[[], requests.Session] = requests.Session


class HostNotAllowed(Exception):
    """Raised before any I/O for a URL outside the allowlist (or not https)."""


def check_url(url: str) -> str:
    """Return the lower-cased host if `url` is allowed, else raise HostNotAllowed."""
    if not isinstance(url, str):
        raise HostNotAllowed(f"not a URL: {url!r}")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise HostNotAllowed(f"unparsable URL: {url!r}") from exc
    if parts.scheme != "https":
        raise HostNotAllowed(f"only https is allowed: {url!r}")
    if parts.username is not None or parts.password is not None:
        raise HostNotAllowed(f"credentials in URL are not allowed: {url!r}")
    if port not in (None, 443):
        raise HostNotAllowed(f"non-default port not allowed: {url!r}")
    host = (parts.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise HostNotAllowed(f"host not allowlisted: {host or '<none>'}")
    return host


def get(url: str, *, timeout: float = 20, accept: str = DEFAULT_ACCEPT) -> requests.Response:
    """GET an allowlisted https URL. Returns the final response whatever its status (the caller decides).

    2 retries with backoff on 5xx / connection errors; no retry on 4xx. Redirects are followed manually
    (max 3) so each hop is re-checked against the allowlist.
    """
    check_url(url)
    headers = {"User-Agent": USER_AGENT, "Accept": accept}
    with _session_factory() as session:
        current = url
        for _hop in range(MAX_REDIRECTS + 1):
            resp = _get_with_retries(session, current, headers, timeout)
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location")
                if not location:
                    return resp
                current = urljoin(current, location)
                check_url(current)
                continue
            return resp
    raise requests.TooManyRedirects(f"more than {MAX_REDIRECTS} redirects from {url}")


def _get_with_retries(session: requests.Session, url: str, headers: dict, timeout: float) -> requests.Response:
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = session.get(url, headers=headers, timeout=timeout, allow_redirects=False)
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
        else:
            if resp.status_code < 500 or attempt == MAX_RETRIES:
                return resp
        if attempt < MAX_RETRIES:
            _sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
    assert last_exc is not None
    raise last_exc
