import type { ScheduledEvent } from './types';
import { currentIsoWeekMonday } from '../niche-prior-suggester/index';

/**
 * Niche Prior Suggester scheduler — weekly, Tuesday 09:00 UTC (the day after
 * niche-calibrator's Monday run, so a full week of fresh niche_outcome_snapshots
 * rows is available to pool). One event per firing; the agent itself pools
 * across all sites/weeks in-process.
 *
 * Dedupe key is ISO-week scoped so a duplicate cron tick within the same week
 * is a no-op.
 */
export async function scheduleNichePriorSuggester(): Promise<ScheduledEvent[]> {
  const week = currentIsoWeekMonday();
  return [
    {
      agent: 'niche-prior-suggester',
      payload: {},
      dedupeKey: `niche-prior-suggester:${week}`,
    },
  ];
}
