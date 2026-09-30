# CME Dashboard — Orchestration Protocol (Fable 5.1 plans · Opus 5.5 builds · Haiku 4.5 explores)

> Companion to CME-REQUEST.md. Keep in the repo at `plan/ORCHESTRATION.md`.
> Model IDs: `claude-fable-5-1`, `claude-opus-5-5`, `claude-haiku-4-5-20251001`.
> UNVERIFIED: whether your Claude Code version accepts these IDs in `/model` or agent frontmatter. If one is rejected, switch via `/model` interactively and tell me the exact error.

---

## 1. Topology

| Role | Model | Surface | Writes | Reads |
|---|---|---|---|---|
| Planner + Advisor (Instance 1) | Fable 5.1 | Claude Code, main worktree, plan mode | `plan/**`, `.workflows/_shared/advice/**`. Never product code | Everything, including builder branches via `git diff` |
| Builder A/B/C (Instances 2–4) | Opus 5.5 | One Claude Code session per WP, each in its own `git worktree` | Only its owned paths (REQUEST §4) | Its WP file, frozen interfaces, gotchas |
| Explorer | Haiku 4.5 | Existing Explorer agent, invoked by any instance | Nothing (read-only) | Web, repo, docs via Context7 and Firecrawl MCP |
| Adversarial pass (Gate 3) | Opus 5.5 | Existing `/redteam` and `/audit` | Reports only | Changed files |

Why this shape (evidence from your own records):
- Your model allocation is already "Fable for orchestration and judgment, cheaper model for implementation, Haiku for utilities". Opus takes the implementation slot here because the work is long-horizon and correctness-critical.
- Separate worktrees, not subagents in one tree: parallel agents committing in one working tree collide on the git index and pollute the planner's context. Worktrees give disjoint ownership, per-WP branches, and `--no-ff` merges.
- Not using agent teams: your notes record 3–7× cost and experimental status.
- Fable runs at 4 gates only. It is the scarce, judgment-dense resource; Opus does the token-heavy work.
- Fable never runs `/review`, `/redteam`, `/audit`, or ultrathink-style commands. Your notes flag a likely `reasoning_extraction` refusal category that causes silent fallbacks. Fable uses the custom `/gate` command below (plain output spec, no request for reasoning traces). Opus runs the existing adversarial commands.
- Fallback: Fable access was suspended once (Jun 12 → Jul 1). If it is unavailable, Opus 5.5 takes the planner role in plan mode with the same prompts. Do not block the Oct 3 deadline on it.

## 2. Pre-flight (human, ~30 min, before Gate 0)

1. Create the repo; enable Pages from `main:/docs`; add secret `DATABENTO_API_KEY`.
2. Create the Google Sheet (tabs per REQUEST §5) and deploy the Apps Script JSON endpoint with a shared-secret check.
3. Paste official rules into `plan/RULES.md`.
4. Audit your commands for Fable compatibility: `grep -rniE "show your (reasoning|thinking)|step by step|chain of thought|think out loud|reasoning trace" ~/.claude/commands ~/.claude/CLAUDE.md` and strip matches from anything Fable will run.
5. `bash ~/.claude/memory.sh` still prints a stale ASTROPHYSICS narrative block (your gotchas record this). Every kickoff below tells agents to ignore it. Fix the script when convenient.
6. Bootstrap `.workflows/_knowledge/{decisions.md,gotchas.md}` and `primer.md`, plus the project CLAUDE.md (section 7).
7. Copy CME-REQUEST.md to `.workflows/workflows/feature-development/data/request.md`.
8. Use never-used ports for every verification run; never verify on a reused port.

## 3. Gates

| Gate | When | Fable produces | Human action |
|---|---|---|---|
| G0 Plan | After Phase 0 recon | `plan/PLAN.md`, `plan/wp-*.md`, `plan/schemas/*.json`, risk register, cut-line order | Review; approve or redirect |
| G1 Interface freeze | Before builders start | Consistency verdict across schemas ↔ Python producers ↔ JS consumers ↔ golden vectors | Approve freeze |
| G2 Wave advisory | After each WP branch is green | Verdicts on the branch diff | Decide which findings to send back |
| G3 Pre-ship | Oct 3 after merge | Final verdict on boundary, stale/failure states, vector coverage | Close visual gate on real iPhone; ship |

Any builder request to change a frozen interface goes to Fable as an ADR request (one paragraph in `.workflows/_shared/outbox.md`). Builders never change frozen interfaces on their own.

## 4. Phase 0 recon (Haiku Explorer; report to `.workflows/_shared/outbox.md`)

```
Read-only recon. No spending, no writes outside the outbox. For each source report: URL, HTTP status,
content-type, whether the data table is in server-rendered HTML or needs JS, any login wall,
robots.txt and terms stance on automated access, and a 5-line sample of the table structure.
Sources: CME margins page, CME settlements pages, CME challenge daily results page.
Then via Context7: current Databento Python client docs for continuous symbology (stype_in), roll
conventions, metadata.get_cost, and OHLCV-1h schema; and GitHub Actions scheduled-workflow limits.
Then run get_cost (free) for every planned Databento request and report the projected total.
Report facts and unknowns separately. Do not guess.
```

## 5. Prompts

### 5a. Fable — G0 planner (launch with `/feature`, plan mode)

```
Read in this order: CLAUDE.md, .workflows/_knowledge/gotchas.md, plan/RULES.md,
.workflows/_shared/outbox.md (Phase 0 recon), plan/ORCHESTRATION.md, then the request file.
Ignore the project-status narrative printed by memory.sh; it belongs to a different project.

You are the planner and advisor. You do not write product code.

Produce:
1. plan/PLAN.md: work-package DAG (start from the proposed WP-CORE / WP-JOBS / WP-UI; change it if
   recon justifies), critical path to the Oct 3 ship, and cut-line order if we fall behind.
2. plan/schemas/*.json: one JSON Schema per bot-written data file plus the Sheet row shapes,
   matching the D7 envelope.
3. Exact function signatures (JSDoc) for every module in docs/js/core, so WP-UI can build against stubs.
4. plan/wp-*.md: one file per WP containing owned paths, forbidden paths, inputs, signatures, gate
   commands, and its acceptance items from the request.
5. A risk register: each risk with the observable symptom that would reveal it early.
6. A list of request ambiguities I must resolve, ranked by blast radius. State your default for each.

Constraints: honor every decision D1–D11 and the boundary section. Where recon contradicts the
request (for example a source that is not scrapable), change the plan and say so explicitly.
Stop after writing the files and wait for my review.
```

### 5b. Fable — advisory gates (G1–G3), via `/gate`

```
/gate G2 wp-core
```

The command file (`.claude/commands/gate.md`):

```
---
description: Advisory gate on a branch. Usage: /gate <G1|G2|G3> <wp-name|all>
---
Scope: $ARGUMENTS
Read plan/PLAN.md, the named plan/wp-*.md, .workflows/_knowledge/gotchas.md, and run
`git diff main...<branch for the WP>`. Run the WP's gate commands and report their actual output.
Do not edit product code. Write to .workflows/_shared/advice/<gate>-<scope>.md.

For each finding give: severity (P0 = would mislead a trade decision or violate the boundary;
P1 = wrong or fragile behavior; P2 = polish), file:line, the concrete input or state that breaks it,
and the direction of the fix. Then list what you verified directly versus what you inferred.
Finish with a verdict: SHIP / FIX-THEN-SHIP / BLOCK.
Check in particular: money math against the golden vectors; unknown or stale data rendering as a
plausible number; any fetch outside docs/js/io; empty-state early returns hiding unrelated UI;
producer/consumer shape drift between jobs/ and docs/js/.
```

### 5c. Opus 5.5 — builder kickoff (one per WP; start in plan mode)

```
Read in this order: CLAUDE.md, .workflows/_knowledge/gotchas.md, plan/RULES.md, plan/PLAN.md,
plan/wp-<NAME>.md, plan/schemas/*.json. Ignore the project-status narrative printed by memory.sh;
it belongs to a different project.

You own only the paths listed in plan/wp-<NAME>.md. Touch nothing else, and flag anything broken
outside your scope instead of fixing it. Interfaces are frozen; if one is wrong, file an ADR request
in .workflows/_shared/outbox.md and continue on a stub.

Work on branch feat/<name> in this worktree. Show me your plan first and wait. Then implement in
small steps, one commit per step (typed message), running the WP gate commands and reading their
output before each commit. Expected values in tests come from tests/golden, never from the code
under test. Stop before pushing. Finish with the task report (CLAUDE.md section 12) in the outbox.

Boundary: this system never places orders or contacts CQG. Do not add any network call outside
docs/js/io (site) or the allowlisted hosts (jobs).
```

### 5d. Opus 5.5 — Gate 3 adversarial pass (after merge, existing commands)

```
/redteam   (scope: everything merged since G2)
/audit     (scope file: boundary tests, secret handling, CSP, workflow permissions, Apps Script key handling)
```

## 6. Session protocol (your existing commands, in order)

Start every instance: `cd` into its worktree → `bash ~/.claude/memory.sh` (ignore the narrative) → `/journal`.
End every instance: `/handoff` → `/sync` → daily-note entry.
Context hygiene: `/clear` between WPs; `/compact` past 60% context; Fable's session stays light because it reads plans and diffs, not exploration output.

## 7. Project CLAUDE.md block (append to the repo's CLAUDE.md)

```
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
```

## 8. Cost and throughput controls

- Fable: four gates, small inputs (plans and diffs). If it is slow or unavailable, fall back per section 1.
- Opus: at most three parallel builders. Stay on your default plan-mode + manual-approval flow. If throughput becomes the binding constraint on Oct 2, switching builders to accept-edits after plan approval is your call; I left your default in place.
- Databento: $2 cap per run, `get_cost` before every request, micros aliased to parent bars.

## 9. Cut-lines if behind (drop in this order)

1. Calendar polish (keep next-3 events and expirations).
2. Sizer hold selector extras beyond overnight/weekend multipliers.
3. Book reconciliation row (keep P&L and compliance).
4. Never cut: golden-vector tests, boundary tests, expiry and flatten banners, stale-data warnings, the daily-cap and margin reds.
