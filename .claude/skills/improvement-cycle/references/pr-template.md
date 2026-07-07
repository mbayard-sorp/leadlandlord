# Improvement-loop PR body template

Title: `improve: <theme>` (append ` [GATE CHANGE]` for Tier-3 decision PRs). Always `--draft`.

```markdown
## Problem
<one paragraph: what is wrong or manual today, and why it matters>

## Evidence
<bullets: fleet-metrics output lines, file:line citations, backlog item ids (BL-###)>

## Change
<bullets: what this PR does, per file group. State the autonomy tier (T0-T3).>

## Risk & rollback
<blast radius; how to revert (git revert, env override, threshold flag); $ impact for cadence/budget changes>

## Verification
<what was run: typecheck/tests/frontmatter checks, with results>

## Backlog
<BL-### items advanced by this PR and their new status>
```

Rules:
- One theme per PR. If a second theme emerges while implementing, put it in the backlog, not the diff.
- Every Evidence bullet must be independently checkable (a command someone can rerun, or a file:line).
- Tier-3 decision PRs contain ONLY docs/ADR content and end the Problem section with the explicit question Mike must answer.
