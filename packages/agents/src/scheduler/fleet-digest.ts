import type { ScheduledEvent } from './types';

/**
 * Fleet digest — fires once per day (cron `0 13 * * *` UTC ≈ 6am MST, set in
 * agent_schedules). Emits a single event; the agent's own dedupe
 * (`fleet-digest:<date>`) + the queue-level dedupe prevent a double-send if the
 * tick fires twice. Orchestrator Phase 5.
 */
export async function scheduleFleetDigest(): Promise<ScheduledEvent[]> {
  const date = new Date().toISOString().slice(0, 10);
  return [
    {
      agent: 'fleet-digest',
      payload: { date },
      dedupeKey: `fleet-digest:${date}`,
    },
  ];
}
