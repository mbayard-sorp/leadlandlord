import { ZodError } from 'zod';
import {
  AgentRunError,
  AgentDisabledError,
  BudgetExceededError,
  ComplianceBlockedError,
  KillSwitchActiveError,
  GlobalBudgetExceededError,
  NotImplementedError,
  ThinNicheError,
  DensityLintExhaustedError,
  UpstreamUnavailableError,
} from '@leadlandlord/shared/errors';

/**
 * Failure kinds the agent_events queue understands. Mirrors the FailureKind
 * union in @leadlandlord/db/queue. Kept as string literals here so this
 * module doesn't take a runtime dep on packages/db.
 */
export type AgentFailureKind =
  | 'validation_error'
  | 'unknown_agent'
  | 'not_implemented'
  | 'agent_disabled'
  | 'kill_switch'
  | 'global_budget'
  | 'budget_exceeded'
  | 'compliance_blocked'
  | 'content_quality'
  | 'runtime_error';

/**
 * Classify an error thrown during agent dispatch. Used by operator-tick
 * (and the legacy /api/cron/agent/[name] worker) to decide whether to
 * dead-letter immediately or schedule a retry.
 *
 * Rules:
 *  - ZodError (raw, from inputSchema.parse before BaseAgent's try/catch) →
 *    validation_error. Also covers the rare case where output validation
 *    throws after BaseAgent wrapped it in AgentRunError.
 *  - AgentRunError wrapping a NotImplementedError → not_implemented.
 *    BaseAgent.run wraps execute() failures in AgentRunError.underlying.
 *  - KillSwitchActiveError → kill_switch. The agent never ran (the switch
 *    threw before the run row was inserted), so this is NOT a failure of the
 *    work. The queue treats it as a non-attempt-consuming lease release so the
 *    event stays claimable once the switch is flipped off.
 *  - GlobalBudgetExceededError → global_budget. Same treatment as kill_switch:
 *    the agent never ran (the portfolio daily cap tripped at the gate), so the
 *    event is released without consuming an attempt and stays claimable until
 *    the global counter resets at the next UTC day. Never dead-letters.
 *  - BudgetExceededError → budget_exceeded. Per-agent daily/monthly cap
 *    tripped mid-run. base.ts re-throws it RAW (unwrapped) at every level, so
 *    it arrives here as the error itself, not wrapped in AgentRunError. Same
 *    non-attempt-consuming lease-release treatment as global_budget.
 *  - ComplianceBlockedError → compliance_blocked. Single-wrapped by BaseAgent
 *    (thrown inside execute(), caught and re-wrapped). Terminal: dead-letter.
 *  - ThinNicheError → content_quality. Thrown by keyword-planner when the
 *    niche has < 5 keyword candidates. Caught by site-builder but may propagate
 *    if uncaught. Terminal: the thin-market signal won't change on retry.
 *  - UpstreamUnavailableError → runtime_error. Provider down / seeds errored.
 *    Transient — retried with linear backoff.
 *  - Anything else (integration timeouts, DB hiccups, bugs in execute) →
 *    runtime_error, eligible for backoff retry.
 *
 * Single-level unwrap only: do NOT add recursive unwrap. A deep
 * ContentBundle ZodError wrapped inside AgentRunError must stay
 * 'runtime_error' (retryable) rather than becoming a terminal 'validation_error'.
 * Only the immediate AgentRunError.underlying is checked.
 *
 * `unknown_agent` is NOT classified here — that's a registry lookup error
 * surfaced by the dispatcher itself before agent.run() is called. The
 * dispatcher passes 'unknown_agent' to markEventFailed directly.
 */
export function classifyAgentError(err: unknown): AgentFailureKind {
  if (err instanceof ZodError) return 'validation_error';
  if (err instanceof AgentDisabledError) return 'agent_disabled';
  if (err instanceof KillSwitchActiveError) return 'kill_switch';
  if (err instanceof GlobalBudgetExceededError) return 'global_budget';
  // BudgetExceededError: base.ts re-throws it RAW (not wrapped) at every level
  // so it always arrives here directly, never inside AgentRunError.
  if (err instanceof BudgetExceededError) return 'budget_exceeded';
  // ThinNicheError and UpstreamUnavailableError: thrown inside execute() and
  // wrapped by BaseAgent into AgentRunError. Check both raw and wrapped forms
  // for callers that catch and re-throw without re-wrapping.
  if (err instanceof ThinNicheError) return 'content_quality';
  // DensityLintExhaustedError: content-engine had no publishable bundle (initial
  // stream timeout / no tool call). Terminal — a re-run faces the same budget
  // squeeze. Dead-letters on attempt 1 for one-click operator Retry.
  if (err instanceof DensityLintExhaustedError) return 'content_quality';
  if (err instanceof UpstreamUnavailableError) return 'runtime_error';
  if (err instanceof AgentRunError) {
    if (err.underlying instanceof ZodError) return 'validation_error';
    if (err.underlying instanceof NotImplementedError) return 'not_implemented';
    if (err.underlying instanceof AgentDisabledError) return 'agent_disabled';
    if (err.underlying instanceof KillSwitchActiveError) return 'kill_switch';
    if (err.underlying instanceof GlobalBudgetExceededError) return 'global_budget';
    if (err.underlying instanceof BudgetExceededError) return 'budget_exceeded';
    // ComplianceBlockedError is thrown directly inside site-builder.execute()
    // and single-wrapped by BaseAgent's catch block into AgentRunError.
    if (err.underlying instanceof ComplianceBlockedError) return 'compliance_blocked';
    if (err.underlying instanceof ThinNicheError) return 'content_quality';
    if (err.underlying instanceof DensityLintExhaustedError) return 'content_quality';
    if (err.underlying instanceof UpstreamUnavailableError) return 'runtime_error';
  }
  if (err instanceof NotImplementedError) return 'not_implemented';
  // ComplianceBlockedError raw (defensive — normally arrives wrapped):
  if (err instanceof ComplianceBlockedError) return 'compliance_blocked';
  return 'runtime_error';
}
