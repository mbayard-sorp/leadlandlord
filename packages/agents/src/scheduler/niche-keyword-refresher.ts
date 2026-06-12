/**
 * Niche Keyword Refresher scheduler — quarterly cluster-cache warm.
 *
 * One event per quarter (cron `0 5 1 */3 *` = 05:00 UTC on the 1st of
 * Jan/Apr/Jul/Oct). Dedupe key is quarter-scoped so duplicate cron ticks
 * are queue-level no-ops, and BaseAgent's run dedupe (same key) makes a
 * re-dispatched event a cached no-op too.
 */
import type { ScheduledEvent } from './types';
import { quarterKey } from '../niche-hunter/refresher';

export async function scheduleNicheKeywordRefresher(): Promise<ScheduledEvent[]> {
  return [
    {
      agent: 'niche-keyword-refresher',
      payload: {},
      dedupeKey: `niche-keyword-refresher:${quarterKey()}`,
    },
  ];
}
