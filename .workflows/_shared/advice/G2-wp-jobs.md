# G2 — wp-jobs (2026-09-30)

Gate commands (planner, feat/jobs):
- `python3 -m pytest -q tests/py tests/boundary/test_boundary_jobs.py` → 177 passed (179 after ADR-005 @ 398234e)
- `python3 -m jobs.refresh --dry-run --data-dir $(mktemp -d)` → exit 0; bars/settlements/margins/challenge/calendar ok (SYNTHETIC fixtures)

Verified directly: diff confined to owned paths; refresh.yml permissions contents: write only, secret scoped to the
refresh step, commit step main-only with pull --rebase retry; ALLOWED_HOSTS www.cmegroup.com only.
Inferred / unverified: every CME URL and page shape (recon blocked); settlements product ids from builder memory;
Databento end-at-current-hour behaviour without an API key.

Findings:
- P1 (accepted, fixed) ADR-005: hourly no-op data commits → skip write when only generated_at changes.
- P1 (open, human) margins and challenge sources unconfigured → those chips will read ERROR until jobs/config/sources.json is filled from a live capture. Sheet Margins/Daily tabs cover the gap.
- P2 Parsers take extra args (hints/root/account) — payload-first, still pure. Accepted.

Verdict: FIX-THEN-SHIP → fix landed → SHIP
