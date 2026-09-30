# Decisions log

- 2026-09-30 ADR-000: Original CME-REQUEST.md unavailable to the build session; user chose "reconstruct and build".
  plan/REQUEST.md is the reconstruction; defaults listed in plan/PLAN.md §6.
- 2026-09-30 ADR-001: Planner role run by Opus (ORCHESTRATION §1 fallback) — Fable not reachable from the cloud session.
- 2026-09-30 ADR-002: Expirations: equity-index roots computed (third Friday, holiday-unadjusted); energy/metals are
  `manual` and must be entered in docs/data/calendar.json. Calendar entries override computed dates.
- 2026-09-30 ADR-003: Calendar is human-curated (no bot producer); freshness policy intraday 14 days.
- 2026-09-30 ADR-004: Margins fall back to an optional Sheet `Margins` tab when the CME margins envelope is not fresh.
