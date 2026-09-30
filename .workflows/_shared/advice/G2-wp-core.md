# G2 — wp-core (2026-09-30)

Gate commands (run by planner on worktree-agent-a59fe4fa5ce6d4912 @ 2252e41):
- `npx tsc -p tsconfig.json` → exit 0, no output
- `node --test "tests/js/core/**/*.test.mjs"` → tests 182, pass 182, fail 0

Verified directly: diff touches only docs/js/core (not types.mjs), tests/js/core, outbox; tests/golden unchanged;
no Date.now/fetch/localStorage/DOM in core; money.mjs integer ticks+cents with on-tick check, -0 normalised,
open trade requires mark.
Inferred (not independently re-derived): DST choices in ctWallToMs (ambiguous → earlier/CDT; nonexistent → -06:00).

Findings:
- P2 book.mjs: reconcile can emit date key 'unknown' (both trade times unparsable) — UI must render it as a warn row.
- P2 No golden vector for spring-forward (2027-03-14); only builder tests cover it.

Verdict: SHIP
