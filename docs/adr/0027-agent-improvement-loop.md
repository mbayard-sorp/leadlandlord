# ADR 0027 — Agent Improvement Loop

**Date:** 2026-07-07
**Status:** Accepted

## Context

The runtime fleet (~42 agents in `packages/agents/src`) produces rich telemetry — `agent_runs` cost/status, `agent_events` dead letters, `agent_health` consecutive-failure tracking, `agent_budgets` caps, alert rules — but nothing closes the loop. Telemetry is surfaced to Mike (fleet-digest, portfolio-analyst, `/operator/agents`), and agent prompts, cadences, and rules only improve when he intervenes by hand. Twelve pipeline points still require human action; several are pure toil (citation submission, manual_review triage) rather than deliberate gates.

Mike asked for a standing improvement loop: an agent team that continuously reviews the fleet, tightens prompts/rules/cadences, fixes defects, and proposes automation for the remaining human-action points — with the loop's own compute billed to his Claude Max subscription, not the platform's metered `ANTHROPIC_API_KEY`.

## Decision

The improvement loop lives entirely at the **Claude Code layer**, not the runtime:

1. **Two scheduled Claude Code web Routines** fire fresh sessions in the managed cloud environment: a daily triage and a weekly deep cycle. Each session syncs `main`, invokes a repo skill (`/improvement-triage`, `/improvement-cycle`), and ships **draft PRs only** — Mike merges. Billing rides the Max subscription.
2. **Two new project subagents** join the four existing ones: `fleet-performance-analyst` (read-only diagnostician over `scripts/fleet-metrics.ts`) and `agent-prompt-engineer` (implementation arm for prompt/metadata/cadence/budget changes). The existing four keep their altitudes: architect gates, next-engineer builds app code, qa verifies, seo-auditor audits SEO-affecting prompt changes.
3. **Read-only DB access** via `READONLY_DATABASE_URL` (a read-only Neon role) consumed only through `scripts/fleet-metrics.ts` (SELECT-only). When absent, the loop degrades to repo-only consistency analysis — it never blocks on credentials.
4. **Tiered autonomy** (enforced by the skills + architect rules): T0 docs/backlog, T1 prompts/metadata, T2 cadences/budgets (architect verdict + stated $ impact), T3 human-gate changes (decision PR + ADR only — the loop may propose, never self-approve). The niche approval gate is permanently human.
5. **Durable memory is `docs/improvement-backlog.md` on `main`.** Fresh sessions have no continuity; anything not merged is re-detected next cycle.

## Alternatives considered

- **A runtime "improver" BaseAgent** — rejected: burns metered API budget, cannot edit the repo or open PRs, and would put self-modification inside the production blast radius.
- **GitHub Actions running Claude** — rejected: no `.github/workflows` exist today, runtime limits are tight for a deep cycle, and it cannot bill the Max subscription or reach the operator DB without new secret plumbing.
- **Extending the orchestrator chat brain (ADR 0019)** — rejected: the brain's job is live fleet operation under a $5 cap, not code review; mixing repo-editing powers into a production-DB-writing agent widens its blast radius.

## Consequences

- The platform gains a self-tightening flywheel at zero marginal API cost; all changes remain human-merged.
- Two more subagent definitions and two skills to maintain; `AGENTS.md` and `.claude/CLAUDE.md` document them.
- `scripts/fleet-metrics.ts` becomes the single sanctioned read path for loop telemetry; widening it needs review.
- The Routines live outside the repo (Claude Code environment). Their prompts are recorded verbatim in `docs/agent-improvement-loop.md` so they can be recreated if lost.
- Backlog hygiene matters: the loop's memory is only as good as the merged backlog file.
