import type { Scheduler } from './types';
import { scheduleTenantProspector } from './tenant-prospector';
import { scheduleOutreachAgent } from './outreach-agent';
import { scheduleTrialManager } from './trial-manager';
import { scheduleBillingDunning } from './billing-dunning';
import { scheduleChurnRecovery } from './churn-recovery';

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
};

export type { Scheduler, ScheduledEvent } from './types';
