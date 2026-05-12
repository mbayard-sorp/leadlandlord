import type { ScheduledEvent } from './types';

/**
 * MollyInbox poll scheduler. Cron `*\/15 * * * *` (every 15 min — Zoho has
 * no webhooks in this setup). One event per tick fanned out to the
 * `molly-inbox` agent.
 *
 * Dedupe: `molly-inbox:<15-min-bucket>` mirrors the agent's own dedupeKeyFn
 * so a duplicate cron firing collapses both at the queue layer and at the
 * agent_runs layer.
 */
export async function scheduleMollyInbox(): Promise<ScheduledEvent[]> {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  return [
    {
      agent: 'molly-inbox',
      payload: {},
      dedupeKey: `molly-inbox:bucket:${bucket}`,
    },
  ];
}
