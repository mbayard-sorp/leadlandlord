import { ZodError } from 'zod';
import { AgentRunError, NotImplementedError } from '@leadlandlord/shared/errors';

/**
 * Failure kinds the agent_events queue understands. Mirrors the FailureKind
 * union in @leadlandlord/db/queue. Kept as string literals here so this
 * module doesn't take a runtime dep on packages/db.
 */
export type AgentFailureKind =
  | 'validation_error'
  | 'unknown_agent'
  | 'not_implemented'
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
 *  - Anything else (integration timeouts, DB hiccups, bugs in execute) →
 *    runtime_error, eligible for backoff retry.
 *
 * `unknown_agent` is NOT classified here — that's a registry lookup error
 * surfaced by the dispatcher itself before agent.run() is called. The
 * dispatcher passes 'unknown_agent' to markEventFailed directly.
 */
export function classifyAgentError(err: unknown): AgentFailureKind {
  if (err instanceof ZodError) return 'validation_error';
  if (err instanceof AgentRunError) {
    if (err.underlying instanceof ZodError) return 'validation_error';
    if (err.underlying instanceof NotImplementedError) return 'not_implemented';
  }
  if (err instanceof NotImplementedError) return 'not_implemented';
  return 'runtime_error';
}
