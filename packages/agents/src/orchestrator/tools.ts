/**
 * Orchestrator tool allowlist (orchestrator Phase 6 — STUB).
 *
 * The shared write/read tool layer that the Phase 6 chat brain and the
 * supervisory pass will both use. It MUST NEVER expose a tool that approves a
 * niche, creates a site, or takes a site live — the three hard constraints in
 * docs/orchestrator-plan.md §0.1. Read: get_fleet_status, get_agent_detail,
 * get_recent_runs, get_budget_status, get_queue_state, get_pending_approvals,
 * get_schedules. Write: enable_agent, disable_agent, set_agent_cadence,
 * set_agent_cap, set_global_cap, requeue_dead_letter, raise_question_to_human.
 *
 * Intentionally empty until Phase 6 fills it; the file exists now so Phase 3's
 * orchestrator/ module commits the shape and Phase 6 fills stubs rather than
 * creating new files.
 */
export const ORCHESTRATOR_TOOLS_PLACEHOLDER = true as const;
