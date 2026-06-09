/**
 * Orchestrator LLM loop (orchestrator Phase 6 — STUB).
 *
 * Runs the Anthropic tool-use loop over the shared context (context.ts) + tool
 * allowlist (tools.ts) for the operator chat UI and the proactive
 * raise-question-to-human flow. Cost is capped by a dedicated agent_budgets
 * row (agent='orchestrator') + the global cap.
 *
 * Intentionally empty until Phase 6; the file exists now so the module shape is
 * committed in Phase 3.
 */
export const ORCHESTRATOR_BRAIN_PLACEHOLDER = true as const;
