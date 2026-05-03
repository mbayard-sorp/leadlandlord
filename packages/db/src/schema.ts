import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';

// ────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────

export const siteStatusEnum = pgEnum('site_status', [
  'queued',
  'building',
  'warming',
  'live',
  'rented',
  'paused',
  'archived',
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'trial',
  'active',
  'past_due',
  'churned',
]);

export const prospectStatusEnum = pgEnum('prospect_status', [
  'new',
  'contacted',
  'replied',
  'accepted_trial',
  'declined',
  'unreachable',
  'converted',
  'lost',
]);

export const trialDecisionEnum = pgEnum('trial_decision', [
  'pending',
  'won',
  'lost',
  'no_decision',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'failed',
  'recovered',
  'void',
]);

export const niceDecisionEnum = pgEnum('niche_decision', [
  'pending',
  'approved',
  'approved_dry_run',
  'rejected',
]);

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'budget_exceeded',
  'not_implemented',
]);

export const callClassificationEnum = pgEnum('call_classification', [
  'unclassified',
  'won',
  'quoted',
  'lost',
  'spam',
  'no_voicemail',
]);

export const backlinkTypeEnum = pgEnum('backlink_type', [
  'citation',
  'directory',
  'haro',
  'guest_post',
  'pbn',
  'other',
]);

export const backlinkStatusEnum = pgEnum('backlink_status', [
  'pending',
  'submitted',
  'live',
  'rejected',
  'lost',
]);

// ────────────────────────────────────────────────────────────
// Tables (spec §5 + agent runtime extensions)
// ────────────────────────────────────────────────────────────

export const niches = pgTable(
  'niches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    niche: text('niche').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    searchVolume: integer('search_volume'),
    kd: integer('kd'),
    estAvgJobValueUsd: numeric('est_avg_job_value_usd', { precision: 10, scale: 2 }),
    estCloseRate: numeric('est_close_rate', { precision: 5, scale: 4 }),
    score: numeric('score', { precision: 6, scale: 2 }),
    decision: niceDecisionEnum('decision').notNull().default('pending'),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    nicheCityStateUniq: uniqueIndex('niches_niche_city_state_uniq').on(t.niche, t.city, t.state),
    decisionIdx: index('niches_decision_idx').on(t.decision),
  }),
);

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nicheId: uuid('niche_id').references(() => niches.id, { onDelete: 'set null' }),
    niche: text('niche').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    domain: text('domain'),
    vercelProjectId: text('vercel_project_id'),
    vercelProjectName: text('vercel_project_name'),
    status: siteStatusEnum('status').notNull().default('queued'),
    trackingNumber: text('tracking_number'),
    trackingProvider: text('tracking_provider'),
    deployedAt: timestamp('deployed_at', { withTimezone: true }),
    currentRank: integer('current_rank'),
    calls30d: integer('calls_30d').notNull().default(0),
    mrrUsd: numeric('mrr_usd', { precision: 10, scale: 2 }).notNull().default('0'),
    tenantId: uuid('tenant_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nicheCityStateUniq: uniqueIndex('sites_niche_city_state_uniq').on(t.niche, t.city, t.state),
    statusIdx: index('sites_status_idx').on(t.status),
    tenantIdx: index('sites_tenant_idx').on(t.tenantId),
  }),
);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubId: text('stripe_sub_id'),
    status: tenantStatusEnum('status').notNull().default('trial'),
    monthlyRentUsd: numeric('monthly_rent_usd', { precision: 10, scale: 2 }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    churnedAt: timestamp('churned_at', { withTimezone: true }),
    churnReason: text('churn_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('tenants_status_idx').on(t.status),
    stripeCustomerIdx: index('tenants_stripe_customer_idx').on(t.stripeCustomerId),
  }),
);

export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    websiteUrl: text('website_url'),
    source: text('source'),
    lastOutreachAt: timestamp('last_outreach_at', { withTimezone: true }),
    status: prospectStatusEnum('status').notNull().default('new'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteStatusIdx: index('prospects_site_status_idx').on(t.siteId, t.status),
  }),
);

export const outreachEvents = pgTable(
  'outreach_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    templateId: text('template_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    response: text('response'),
    sentiment: text('sentiment'),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    prospectIdx: index('outreach_events_prospect_idx').on(t.prospectId),
  }),
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    callerNumber: text('caller_number'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationS: integer('duration_s'),
    recordingUrl: text('recording_url'),
    transcript: text('transcript'),
    classification: callClassificationEnum('classification').notNull().default('unclassified'),
    estRevenueUsd: numeric('est_revenue_usd', { precision: 10, scale: 2 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteStartIdx: index('calls_site_started_idx').on(t.siteId, t.startedAt),
    classificationIdx: index('calls_classification_idx').on(t.classification),
  }),
);

export const trials = pgTable(
  'trials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    callsCount: integer('calls_count').notNull().default(0),
    wonCount: integer('won_count').notNull().default(0),
    estRevenueUsd: numeric('est_revenue_usd', { precision: 10, scale: 2 }),
    decision: trialDecisionEnum('decision').notNull().default('pending'),
    quotedRentUsd: numeric('quoted_rent_usd', { precision: 10, scale: 2 }),
  },
  (t) => ({
    siteIdx: index('trials_site_idx').on(t.siteId),
  }),
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    stripeInvoiceId: text('stripe_invoice_id'),
    amountUsd: numeric('amount_usd', { precision: 10, scale: 2 }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    tenantStatusIdx: index('invoices_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export const backlinks = pgTable(
  'backlinks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    sourceDomain: text('source_domain').notNull(),
    targetUrl: text('target_url'),
    type: backlinkTypeEnum('type').notNull(),
    status: backlinkStatusEnum('status').notNull().default('pending'),
    dr: integer('dr'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    siteIdx: index('backlinks_site_idx').on(t.siteId),
  }),
);

// ────────────────────────────────────────────────────────────
// Agent runtime tables
// ────────────────────────────────────────────────────────────

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agent: text('agent').notNull(),
    dedupeKey: text('dedupe_key'),
    status: agentRunStatusEnum('status').notNull().default('pending'),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    error: text('error'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    parentRunId: uuid('parent_run_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => ({
    agentDedupeUniq: uniqueIndex('agent_runs_agent_dedupe_uniq')
      .on(t.agent, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    agentStartedIdx: index('agent_runs_agent_started_idx').on(t.agent, t.startedAt),
    statusIdx: index('agent_runs_status_idx').on(t.status),
  }),
);

export const agentEvents = pgTable(
  'agent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agent: text('agent').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    targetAgent: text('target_agent'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processingAt: timestamp('processing_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => ({
    unprocessedIdx: index('agent_events_unprocessed_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
    targetAgentIdx: index('agent_events_target_agent_idx').on(t.targetAgent),
    approvalIdx: index('agent_events_approval_idx')
      .on(t.requiresApproval)
      .where(sql`${t.processedAt} IS NULL`),
  }),
);

export const agentBudgets = pgTable('agent_budgets', {
  agent: text('agent').primaryKey(),
  dailyCostCapUsd: numeric('daily_cost_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('5'),
  spentTodayUsd: numeric('spent_today_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────
// Type exports
// ────────────────────────────────────────────────────────────

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type Prospect = typeof prospects.$inferSelect;
export type Trial = typeof trials.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Backlink = typeof backlinks.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
