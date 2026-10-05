import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture
def now() -> datetime:
    # A Wednesday during CDT; minutes non-zero so hour flooring is exercised.
    return datetime(2026, 9, 30, 15, 23, 45, tzinfo=timezone.utc)


def pytest_configure(config):
    config.addinivalue_line("markers", "real_contracts: use the committed docs/data/contracts.json (cross-file checks)")


@pytest.fixture(autouse=True)
def pinned_contracts(monkeypatch, request):
    """Job tests run against a fixed contract list (the original 8 roots) so they test logic, not whatever
    docs/data/contracts.json currently lists (it grows as new products are traded, e.g. ZT/ZN/HO, ADR-009).
    Cross-file consistency tests opt out with @pytest.mark.real_contracts."""
    import json

    if request.node.get_closest_marker("real_contracts"):
        return None

    from jobs.common import config

    fixed = json.loads((Path(__file__).parent / "fixtures" / "contracts_v1.json").read_text())["contracts"]
    monkeypatch.setattr(config, "load_contracts", lambda *a, **k: [dict(c) for c in fixed])
    return fixed
