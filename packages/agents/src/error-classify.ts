import { ZodError } from 'zod';
import {
  AgentRunError,
  AgentDisabledError,
  KillSwitchActiveError,
  GlobalBudgetExceededError,
  NotImplementedError,
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
 *  - Anything else (integration timeouts, DB hiccups, bugs in execute) →
 *    runtime_error, eligible for backoff retry.
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
  if (err instanceof AgentRunError) {
    if (err.underlying instanceof ZodError) return 'validation_error';
    if (err.underlying instanceof NotImplementedError) return 'not_implemented';
    if (err.underlying instanceof AgentDisabledError) return 'agent_disabled';
    if (err.underlying instanceof KillSwitchActiveError) return 'kill_switch';
    if (err.underlying instanceof GlobalBudgetExceededError) return 'global_budget';
  }
  if (err instanceof NotImplementedError) return 'not_implemented';
  return 'runtime_error';
}
