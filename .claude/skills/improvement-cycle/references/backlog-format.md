# Backlog format (docs/improvement-backlog.md)

One table, newest items appended at the bottom. Columns:

`ID | Item | Source | Severity | Tier | Status | Updated | Evidence / notes`

- **ID**: `BL-###`, monotonically increasing, never reused.
  - Before assigning a new ID, check for IDs already claimed by in-flight work: run `git log main..HEAD -- docs/improvement-backlog.md` on any local branches, and check open GitHub PRs/branches (list open PRs, check whether their diffs touch `docs/improvement-backlog.md` and what IDs they claim). Assign the next ID after the highest one found across all of those sources, not just the highest on `main`.
- **Source**: `triage <date>`, `cycle <date>`, `seed audit`, `Mike`, etc.
- **Severity**: P1 (fleet broken / money burning), P2 (degraded / drifting), P3 (polish / debt).
- **Tier**: T0-T3 autonomy tier of the likely fix (see docs/agent-improvement-loop.md).
- **Status lifecycle**: `proposed → accepted → in-pr (#NNN) → merged → verified` | `rejected`.
  - `accepted` is set by Mike (or by a cycle when a P1 makes it self-evident — say so in the notes).
  - `in-pr` always carries the PR number.
  - `merged → verified`: a later triage/cycle confirms the fix had its intended effect (metrics moved, defect gone) and flips it. If the effect didn't materialize, reopen as a new item referencing the old id.
- **Dedupe rule**: before adding a row, search the table for the same agent + failure signature. Refresh the existing row instead of duplicating.
- Keep rows to one line each; long evidence goes in the PR, not the backlog.
