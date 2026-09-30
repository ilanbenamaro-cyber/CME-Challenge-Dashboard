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
