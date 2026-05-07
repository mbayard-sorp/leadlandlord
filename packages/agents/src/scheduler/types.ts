/**
 * One unit of work the scheduler wants to enqueue. Translated 1:1 into a
 * row in `agent_events` by the cron route handler.
 *
 * `dedupeKey` is a logical idempotency tag for the work item itself — e.g.
 * `invoice:abc:sms_day_1` or `tenant-prospector:site:123:2026-W18`. The
 * scheduler skips creating a new event when an `agent_events` row with the
 * same dedupeKey was inserted in the recent past (windowed in the cron
 * route). Distinct from the per-run dedupe in BaseAgent, which dedupes by
 * agent_runs.dedupe_key — that one prevents re-execution if an event fires
 * the agent twice; this one prevents flooding the queue if the cron fires
 * the scheduler twice.
 */
export interface ScheduledEvent {
  /** Target agent name in the registry (e.g. 'tenant-prospector'). */
  agent: string;
  /** Input the agent expects — must validate against the agent's input schema. */
  payload: Record<string, unknown>;
  /** Logical key for queue-level dedupe within the recent window. */
  dedupeKey: string;
}

/**
 * Scheduler interface — a function that scans DB state and decides what work
 * needs to be queued right now. Pure read + event construction; no writes.
 *
 * The cron route handler is responsible for enqueueing. Keeping this pure
 * makes the schedulers trivially unit-testable.
 */
export type Scheduler = () => Promise<ScheduledEvent[]>;
