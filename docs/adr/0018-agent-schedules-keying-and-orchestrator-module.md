# ADR 0018 — Agent Schedules Keying & Orchestrator Module

**Date:** 2026-06-09
**Status:** Accepted

## Context

Phase 3 of the Fleet Orchestrator (docs/orchestrator-plan.md) makes agent cadence DB-driven so the orchestrator can re-schedule agents without a Vercel redeploy, and lets the operator auto-disable repeat-failure agents. The 10-minute `/api/cron/tick` becomes the single dispatcher, reading a new `agent_schedules` table instead of the hardcoded `POLL_SCHEDULERS` array + the 16 per-agent `vercel.json` cron lines.

Two design questions were non-obvious enough (per `leadlandlord-architect` review) to record.

## Decision

### 1. Key `agent_schedules` on the SCHEDULER name, not the agent kind

The tick fires via `runScheduler(name)` where `name` is a key in the scheduler registry (`packages/agents/src/scheduler/index.ts`, 22 entries). Schedulers are **not** 1:1 with agents (35 registry kinds): `molly-nudge` feeds the unregistered `molly` kind, `wave-progression` feeds `wave-launcher`, and many agents are event/manual-triggered with no scheduler. Keying on agent kind cannot express `molly-nudge`/`wave-progression` and lies about the relationship.

`agent_schedules.scheduler_name` is the PK. A nullable `target_agent` column records the registry kind a scheduler feeds (informational, for the orchestrator UI/supervision; not a FK — the registry is code). The existing `agent_budgets.enabled` filter in `run-scheduler.ts` still gates by agent kind inside the returned `ScheduledEvent[]`, so supervision disables by kind through the existing path.

### 2. Two independent gates, collapsed to one legible state for output

`agent_budgets.enabled` (run at all) and `agent_schedules.paused` (schedule on cadence) are distinct and both kept. The raw boolean pair is never surfaced; `getEffectiveAgentState()` (orchestrator/context.ts) collapses it to `'active' | 'demand_only' | 'disabled'` for the digest/chat.

### 3. Cron evaluation: dependency-free, prev-fire comparison

A 5-field UTC cron evaluator (`scheduler/cron.ts`, no dependency added) computes the most recent fire time at/before `now`; a scheduler is due when `prevFire > last_enqueued_at`. This self-heals missed ticks, never double-fires (the 7-day `__schedule_key` dedupe is the second guard), and avoids storing a stale `next_fire_at`. `cron-parser` was not added — our expressions are simple and a tested in-house evaluator is more controlled in this monorepo.

### 4. Extract `packages/agents/src/orchestrator/` now (Phase 3), not Phase 6

The shared "brain" module is introduced in Phase 3 with `context.ts` + `supervisor.ts` (real) and `tools.ts` + `brain.ts` (stubs). Putting supervision in `operator/index.ts` would force Phase 6 to either refactor a live prod file or duplicate logic (the "two systems" anti-pattern the plan warns against). The operator agent + the Phase 6 chat both become call sites of the same module.

### 5. Supervision runs from the tick, not the operator agent (deviation from review)

`runSupervisionPass` is invoked from `poll-tick.ts` (an app endpoint, not budget-gated) rather than from inside the operator agent. Rationale: (a) it keeps working during a global-budget pause, when the operator agent itself is blocked at the budget gate; (b) it leaves the operator agent's 417-test decision tree untouched, eliminating regression risk. The shared-module goal (decision 4) is unaffected — the logic still lives in `orchestrator/supervisor.ts` for Phase 6 reuse.

### 6. Global-budget short-circuit in the tick

The tick reads `system_state` once at start; if the Phase 2 global daily cap is exceeded, it skips the scheduler fan-out. Without this, Phase 2's release-without-attempt events would re-enqueue every tick and flood the queue. Fails open (does not block scheduling) if the column is unmigrated.

## Cutover & rollback

`vercel.json` per-agent cron lines are **kept in this PR** (overlap is absorbed by the `__schedule_key` dedupe) because migrations apply manually — trimming them while `agent_schedules` is empty would dark the daily/weekly agents. The tick falls back to the hardcoded `POLL_SCHEDULERS_FALLBACK` if `agent_schedules` is empty/unavailable, so it never goes dark. After the seed is applied and the DB path is verified clean in prod for ~24h, the per-agent cron lines are trimmed (fast-follow) and the fallback removed. Rollback: restore the cron lines (inert alongside the DB path).

## Consequences

- New `cron_expr` values must be valid 5-field expressions our evaluator supports (star, step, list, range). Invalid exprs throw per-row inside the tick's try/catch (logged, non-fatal).
- During cutover, scheduler fan-out happens via both paths; safe but means cadence changes via `agent_schedules` are only fully authoritative after the `vercel.json` lines are trimmed.
- Migration 0038 is guarded (`CREATE TABLE IF NOT EXISTS`); unaffected by the orphaned, journal-absent `0029`.
