# Decisions log

- 2026-09-30 ADR-000: Original CME-REQUEST.md unavailable to the build session; user chose "reconstruct and build".
  plan/REQUEST.md is the reconstruction; defaults listed in plan/PLAN.md §6.
- 2026-09-30 ADR-001: Planner role run by Opus (ORCHESTRATION §1 fallback) — Fable not reachable from the cloud session.
- 2026-09-30 ADR-002: Expirations: equity-index roots computed (third Friday, holiday-unadjusted); energy/metals are
  `manual` and must be entered in docs/data/calendar.json. Calendar entries override computed dates.
- 2026-09-30 ADR-003: Calendar is human-curated (no bot producer); freshness policy intraday 14 days.
- 2026-09-30 ADR-004: Margins fall back to an optional Sheet `Margins` tab when the CME margins envelope is not fresh.
- 2026-09-30 ADR-005: skip data writes when only generated_at changes (jobs/common/publish.py compares with the file
  on disk ignoring generated_at; refresh prints "<dataset>: unchanged"). Site freshness uses data_as_of.
- 2026-09-30 ADR-006: Drop `frame-ancestors` from the <meta> CSP. Browsers ignore it there (Chromium logs an error) and
  GitHub Pages cannot set response headers, so the site has no clickjacking protection. Accepted: the page is read-only
  (no actions to hijack); the Sheet key lives only in localStorage of the owner's browser.
- 2026-10-01 ADR-007: CME website scraping disabled. Recon from GitHub Actions (branch recon/cme-phase0, run 2026-10-01T00:23Z):
  every www.cmegroup.com URL incl. robots.txt, both rules PDFs, the settlements JSON endpoint and the margins pages → HTTP 403
  from AkamaiGHost, body: "This IP address is blocked due to suspected web scraping activity … Use of scripts, software, spiders,
  robots … is strictly prohibited by CME Group's website Data Terms of Use." All CME website sources in jobs/config/sources.json
  are now null (jobs fail closed). Margins → Sheet `Margins` tab; daily results → Sheet `Daily` tab. Settlements: none until a
  licensed feed is added (candidate: Databento GLBX.MDP3 `statistics` schema). Never re-enable website scraping.
