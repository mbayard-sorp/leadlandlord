import type { ScheduledEvent } from './types';
import { operatorMinuteBucket } from '../operator/index';

/**
 * Operator orchestrator scheduler — runs every 10 minutes via cron and
 * enqueues a single empty-payload event. The agent's own dedupeKeyFn keys
 * by minute bucket, so a duplicate fan-out within the same minute collapses
 * to one execution; the queue-level dedupeKey here keys by the same bucket
 * to prevent flooding the queue if cron retries quickly.
 */
export async function scheduleOperator(): Promise<ScheduledEvent[]> {
  const bucket = operatorMinuteBucket();
  return [
    {
      agent: 'operator',
      payload: {},
      dedupeKey: `operator:${bucket}`,
    },
  ];
}
