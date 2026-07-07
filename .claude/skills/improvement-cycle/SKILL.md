---
name: improvement-cycle
description: Weekly deep improvement cycle for the LeadLandlord agent fleet — measure via read-only fleet metrics, diagnose with the fleet-performance-analyst, select 1-2 items from docs/improvement-backlog.md, gate via leadlandlord-architect, implement via agent-prompt-engineer or next-engineer, QA, and open draft PRs with evidence. Never pushes to main; never removes human gates without an ADR plus explicit sign-off request. Use for the weekly improvement Routine or when asked to run a fleet improvement pass.
---

# Weekly improvement cycle

You are running LeadLandlord's weekly improvement cycle: turn fleet telemetry and the backlog into 1-2 shipped draft PRs that make the platform more automated, cheaper, or more reliable.

## Ground rules (override everything else)

- Draft PRs only. Never push to `main`. Only branches named `improve/*`. **At most TWO PRs per cycle, one theme per PR.**
- Autonomy tiers (full definitions: `docs/agent-improvement-loop.md`):
  - **T0** docs/backlog — self-serve.
  - **T1** prompts / metadata / comments / `.claude` defs — self-serve, evidence required.
  - **T2** cadences / budgets / seed scripts — requires `leadlandlord-architect` verdict + stated $ impact.
  - **T3** anything touching a human approval gate or agent behavior semantics — deliverable is a *decision PR* (docs/ADR asking Mike to decide) with `GATE CHANGE` in the title. Never implement the gate change itself.
  - The **niche approval gate is permanently human** — not even a decision PR proposing its removal.
- Skip any backlog item whose target paths overlap an open PR that isn't yours.
- Phase-6 deferred agents (closer-agent, billing-dunning, churn-recovery, compliance-guard): behavior changes are out of bounds; status/documentation reconciliation is allowed as a decision PR.

## Steps

1. **Sync + collision check.** `git fetch origin && git checkout main && git pull origin main`; list open PRs and record their touched paths and any open `improve/*` branches.
2. **Measure.** Delegate to `fleet-performance-analyst`: `scripts/fleet-metrics.ts --window 7d --json` + `--window 30d` baseline. `NO_DB` → repo-only mode.
3. **Diagnose.** The analyst returns the ranked findings table (severity, evidence, suspected cause, fix owner). Merge new findings into `docs/improvement-backlog.md` exactly as triage does (dedupe first).
4. **Select 1-2 items.** Priority order: P1 findings → `accepted` backlog items → highest value-to-effort `proposed` items. Apply the skip rules above. Record why you picked them.
5. **Gate.** For each T2/T3 item (and anything seam-adjacent): get a `leadlandlord-architect` verdict (APPROVE / REJECT / NEEDS-CHANGES) before writing code. T3 → the architect drafts/reviews the ADR that goes in the decision PR.
6. **Implement.** One branch per theme (`improve/<theme>`). Prompt/metadata/cadence/budget/agent-def work → `agent-prompt-engineer`. App-layer code within allowed scope → `next-engineer`. Keep diffs minimal.
7. **QA.** `leadlandlord-qa` in improvement-loop mode (typecheck, targeted tests, frontmatter/doc validation, evidence spot-check). If an SEO-affecting agent prompt changed, also run `leadlandlord-seo-auditor`'s spot audit. Fix or drop anything that fails — don't ship red.
8. **PR.** One draft PR per theme using [references/pr-template.md](references/pr-template.md). The same PR flips its backlog item(s) to `in-pr` with the PR number. Backlog-format details: [references/backlog-format.md](references/backlog-format.md).
9. **Report.** End with: metrics deltas vs last cycle (or "no DB"), PRs opened with links, backlog changes, and an explicit "Decisions needed from Mike" list (empty if none).
