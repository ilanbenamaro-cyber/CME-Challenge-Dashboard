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
