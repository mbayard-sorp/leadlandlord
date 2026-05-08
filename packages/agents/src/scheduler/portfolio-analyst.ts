import type { ScheduledEvent } from './types';

/**
 * Portfolio Analyst scheduler — daily 18:00 UTC, after every other agent
 * has had its run for the day. One event per cron firing; the analyst
 * itself iterates all sites and produces snapshots.
 *
 * Dedupe key includes the analysis date (yesterday UTC) so re-firing the
 * cron within the same UTC day is a no-op.
 */
export async function schedulePortfolioAnalyst(): Promise<ScheduledEvent[]> {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const date = d.toISOString().slice(0, 10);
  return [
    {
      agent: 'portfolio-analyst',
      payload: { date },
      dedupeKey: `portfolio-analyst:${date}`,
    },
  ];
}
