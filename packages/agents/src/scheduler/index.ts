import type { Scheduler } from './types';
import { scheduleTenantProspector } from './tenant-prospector';
import { scheduleOutreachAgent } from './outreach-agent';
import { scheduleTrialManager } from './trial-manager';
import { scheduleBillingDunning } from './billing-dunning';
import { scheduleChurnRecovery } from './churn-recovery';
import { scheduleSeoOperator } from './seo-operator';
import { scheduleSeoIngestGsc } from './seo-ingest-gsc';
import { scheduleSeoIngestGa4 } from './seo-ingest-ga4';
import { scheduleLighthouseAudit } from './lighthouse-audit';

/**
 * Map from cron-route name to a scheduler function. The cron route handler
 * at `/api/cron/schedule/[name]` looks up the scheduler here, runs it, and
 * inserts each returned ScheduledEvent into agent_events (after dedupe).
 */
export const schedulers: Record<string, Scheduler> = {
  'tenant-prospector': scheduleTenantProspector,
  'outreach-agent': scheduleOutreachAgent,
  'trial-manager': scheduleTrialManager,
  'billing-dunning': scheduleBillingDunning,
  'churn-recovery': scheduleChurnRecovery,
  'seo-operator': scheduleSeoOperator,
  'seo-ingest-gsc': scheduleSeoIngestGsc,
  'seo-ingest-ga4': scheduleSeoIngestGa4,
  'lighthouse-audit': scheduleLighthouseAudit,
};

export type { Scheduler, ScheduledEvent } from './types';
