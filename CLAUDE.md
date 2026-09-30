# CME Challenge Dashboard

Static GitHub Pages dashboard (`docs/`) + Python refresh jobs (`jobs/`) for a CME futures trading
challenge. Read `plan/PLAN.md` first; the reconstructed request is `plan/REQUEST.md`.

## Commands
- `npm test`: tsc strict check + node tests (core, ui, boundary) + pytest (jobs, boundary)
- `npm run test:e2e`: headless Chromium smoke test on a random unused port (Playwright preinstalled)
- `python3 -m jobs.refresh --dry-run`: run all jobs without network (uses fixtures)

## Layout
- `docs/js/core/`: pure logic, no DOM, no fetch. `types.mjs` is the frozen interface.
- `docs/js/io/`: the ONLY place allowed to call fetch / localStorage.
- `docs/js/ui/`: rendering (HTML strings + DOM wiring). `docs/js/main.mjs` is the entry point.
- `docs/data/`: bot-written envelopes (D7) + human-maintained `rules.json`, `contracts.json`, `calendar.json`.
- `jobs/`: producers; network only via `jobs/common/http.py` (allowlist) and Databento in `jobs/fetch_bars.py`.
- `tests/golden/`: hand-computed expected values. `tests/boundary/`: planner-owned guards.

# Project: CME Trading Dashboard
- This system is research and risk tooling only. Never place, modify, or cancel orders. Never connect to CQG.
- Overrides global "TypeScript always": site code is .mjs + JSDoc checked with tsc --checkJs --strict (decision D1/D2).
- Only docs/js/io may call fetch. Expected test values come from tests/golden (hand-computed).
- Unknown or stale data must render as a visible warning, never as zero or a plausible number.
- Rule-dependent constants live in docs/data/rules.json with a source field. Never infer a rule.
- Bot commits to main: work on feature branches, merge --no-ff, never commit directly to main.
- Re-run jobs replays the ORIGINAL commit. After a workflow edit, trigger `gh workflow run refresh.yml`.
- Verify on a never-used port and assert the code under test is present before trusting browser results.
- Ilan closes visual verification gates. Do not self-approve them.
- Pause before push. Commit per step.

## 12. Task report format (append to .workflows/_shared/outbox.md)
```
## <WP> task report — <date>
Branch / commits:
Gate commands run + actual result lines:
Acceptance items covered (A#):
Deviations from plan / ADR requests:
Known gaps / risks:
```
