# ADR 0019 — Orchestrator Chat Brain Design

**Date:** 2026-06-09
**Status:** Accepted

## Context

Phase 6 of the Fleet Orchestrator (docs/orchestrator-plan.md §3.6) gives Mike a chat with the orchestrator in the operator app and lets the orchestrator email Mike questions when blocked. It fills the Phase 3 stubs (`orchestrator/tools.ts`, `orchestrator/brain.ts`), adds migration `0039` (`orchestrator_threads` / `orchestrator_messages`), and ships the `/operator/orchestrator` route. It is the first genuine multi-turn Anthropic tool-use loop in the codebase, and it can take live fleet write actions, so the design was reviewed by `leadlandlord-architect` (the plan's second required architecture gate). The non-obvious decisions are recorded here.

The hard constraints are unchanged and absolute: the orchestrator may never approve a niche, create a site, or take a site live. Phase 0 enforces this at the config layer; this ADR's tool allowlist is the code-layer enforcement.

## Decision

### 1. The brain is a `BaseAgent` subclass, but is NOT in the agent registry

`Orchestrator` (orchestrator/brain.ts) extends `BaseAgent` (kind `orchestrator`, $5 daily cap) so it inherits Phase 2's gating for free: the kill switch, the global daily cap, and the per-agent daily/monthly caps — including the atomic UTC-day/month spend resets in `assertBudgetAvailable`/`creditBudget`, which a hand-rolled budget check would race across midnight. `dedupeKeyFn` keys on the triggering human message id, so a retry reuses the prior reply while each distinct message is its own non-idempotent turn.

It is deliberately **absent from `agentRegistry`**. The registry feeds the cron worker (`/api/cron/agent/[name]`); registering the brain would make it firable by an arbitrary HTTP POST. Instead the operator chat server action instantiates it directly in response to a human message. Its `agent_budgets` row is created via `FLEET_DISPOSITION` + the seed script, not the registry. A comment in registry.ts documents the intentional absence.

### 2. Tool executors record their audit row BEFORE the mutation

Each write tool (orchestrator/tools.ts) writes an `orchestrator_messages(kind='action', metadata={before,after,...})` row **before** it performs the mutation. A mutation that succeeds always has a trail; a mutation that fails after the row is written is correctly recorded as attempted. Executor-records (vs. the brain recording centrally) is required because the supervisory pass calls `raiseQuestion` directly — without the LLM — when it auto-disables an agent, and that path must still produce an audit trail. The `agents` package writing UI-chat tables is an accepted coupling: those tables are part of the operator DB, same as `agent_runs`/`agent_budgets`.

### 3. `requeue_dead_letter` blocks the niche/site/go-live event chain

The one indirect hard-constraint leak the review surfaced: requeuing a dead-lettered `niche.approved` event would kick off a site build. `requeue_dead_letter` fetches the event first and refuses (`isProtectedEventType`) any type prefixed `niche.` / `site.` / `sites.` or equal to `domain.approval.granted`, returning an error to the model. Prefix-based so future trigger types stay covered without a code change.

### 4. The multi-turn loop is a pure, client-injectable function with a hard turn cap

`runOrchestratorBrain` (orchestrator/brain.ts) is decoupled from the Anthropic SDK behind a minimal `BrainClient` interface and an injectable `dispatch`, so it is unit-tested with a hand-rolled fake — the shared `MOCK_AI` client always returns a `tool_use` block and would loop forever. `MAX_BRAIN_TURNS = 8` caps tool rounds; on cap-hit the loop returns a graceful "reached my step limit" reply rather than throwing, so the server action never surfaces a generic error. Tool errors become `is_error` tool_results and the loop continues. The default `dispatch` resolves tools via the allowlist only, so a hallucinated `approve_niche` has no executor and errors out — the allowlist is the boundary.

### 5. `randomUUID` for thread/message IDs (no nanoid)

The spec said nanoid; the codebase has no nanoid dependency and already uses `node:crypto` `randomUUID` (base.ts). UUID4 is collision-safe and works unencoded in the `?thread=<id>` deep-link query param. Adding a dep for cosmetic URL brevity wasn't worth it.

### 6. Synchronous server action with explicit `maxDuration`, defensive reads

`postOrchestratorMessage` runs the brain synchronously (await) — acceptable for a v1 chat where the user is already waiting. `/operator/orchestrator` exports `maxDuration = 120` for headroom over the 8-turn loop. Queue-backing the brain is the documented v2. All read paths and write actions tolerate `orchestrator_*` not existing yet (migration 0039 unapplied) — they render an empty state / return a friendly message rather than 500ing — mirroring the fleet-digest `safe()` and supervisor try/catch pattern.

## Consequences

- New env (Appendix B): `ORCHESTRATOR_QUESTION_TO` (default `OPERATOR_EMAIL`), `ORCHESTRATOR_QUESTION_FROM` (default Molly), `ORCHESTRATOR_MODEL` (default `ANTHROPIC_MODEL` → `claude-sonnet-4-6`), `OPERATOR_BASE_URL`/`BASE_URL` for deep links.
- Migration `0039_orchestrator_chat` must be applied to prod before the route is usable; the page degrades gracefully until then.
- The supervisory pass (Phase 3) now raises a question + emails on auto-disable (the deferred "Phase 6 hook"), and the fleet-digest "needs attention" block counts open questions.
- v2 (documented, not built): inbound email-reply parsing so Mike can answer questions by replying to the email instead of in the chat.
