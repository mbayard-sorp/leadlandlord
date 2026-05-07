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
    /** Twilio IncomingPhoneNumber SID — needed to update VoiceUrl/recording later. */
    twilioPhoneSid: text('twilio_phone_sid'),
    /** Destination phone for inbound calls. Operator phone during warming, tenant phone during trial. */
    forwardingNumber: text('forwarding_number'),
    /** Whisper announcement played to the answering party so they know it's a tracking number. */
    whisperMessage: text('whisper_message'),
    /** Whether to record + transcribe inbound calls. */
    recordingEnabled: boolean('recording_enabled').notNull().default(true),
    /** GA4 measurement ID baked into the site's NEXT_PUBLIC_GA_MEASUREMENT_ID. */
    gaMeasurementId: text('ga_measurement_id'),
    /** One Klaviyo list per niche × city for lead-form submissions. */
    klaviyoListId: text('klaviyo_list_id'),
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
    twilioSidIdx: index('sites_twilio_sid_idx').on(t.twilioPhoneSid),
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
    /** Twilio Call SID — used to correlate voice/recording/transcription webhooks. */
    twilioCallSid: text('twilio_call_sid'),
    /** Twilio Recording SID — set once recording status callback arrives. */
    twilioRecordingSid: text('twilio_recording_sid'),
    callerNumber: text('caller_number'),
    /** Number that was called (the tracking number on the site). */
    calledNumber: text('called_number'),
    /** 'inbound' for tracked calls; 'outbound' reserved for Phase-6 outreach. */
    direction: text('direction').notNull().default('inbound'),
    /** True when the call went to voicemail (no human answer). */
    isVoicemail: boolean('is_voicemail').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
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
    twilioCallSidIdx: uniqueIndex('calls_twilio_call_sid_uniq')
      .on(t.twilioCallSid)
      .where(sql`${t.twilioCallSid} IS NOT NULL`),
  }),
);

/**
 * Lead-form submissions from `/api/lead`. One row per submitted form on a
 * tenant site. `klaviyoProfileId` is set when the Klaviyo upsert succeeds.
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name'),
    phone: text('phone'),
    email: text('email'),
    zip: text('zip'),
    message: text('message'),
    /** Which form on the site fired this — 'home', 'contact', 'hero', etc. */
    source: text('source').notNull().default('unknown'),
    klaviyoProfileId: text('klaviyo_profile_id'),
    /** SMS notification status — 'pending' | 'sent' | 'skipped' | 'failed'. */
    smsStatus: text('sms_status'),
    emailStatus: text('email_status'),
    /** User agent + referrer + utm_* etc. captured from the form post. */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteCreatedIdx: index('leads_site_created_idx').on(t.siteId, t.createdAt),
    phoneIdx: index('leads_phone_idx').on(t.phone),
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

/**
 * Global suppression list — TCPA / CAN-SPAM / "STOP" handling. Entries are
 * shared across the entire portfolio (suppression is per-account, not per-site
 * under TCPA). Phones are stored E.164 normalized; emails lowercase.
 */
export const suppressionList = pgTable(
  'suppression_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** E.164 phone (e.g. +15125550100) or lowercase email. */
    identifier: text('identifier').notNull(),
    /** 'phone' | 'email'. */
    identifierType: text('identifier_type').notNull(),
    /** Why suppressed: 'sms_stop' | 'voice_dnc' | 'email_unsubscribe' | 'manual' | 'trial_decline' | 'churn'. */
    reason: text('reason'),
    /** Site that originated the suppression (informational; suppression itself is global). */
    sourceSiteId: uuid('source_site_id').references(() => sites.id, { onDelete: 'set null' }),
    /** Channel that triggered the suppression — 'sms' | 'voice' | 'email' | 'manual'. */
    channel: text('channel'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    identifierUniq: uniqueIndex('suppression_list_identifier_uniq').on(
      t.identifier,
      t.identifierType,
    ),
    typeIdx: index('suppression_list_type_idx').on(t.identifierType),
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
    /**
     * Latest progress message emitted by the running agent (e.g. "generating
     * page 14/21"). Read by the operator activity panel at ~4s polling. Reset
     * to null when the run finishes — the run row itself becomes the history
     * entry. See BaseAgent.AgentContext.progress.
     */
    progressMessage: text('progress_message'),
    progressStep: integer('progress_step'),
    progressTotal: integer('progress_total'),
    progressUpdatedAt: timestamp('progress_updated_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => ({
    agentDedupeUniq: uniqueIndex('agent_runs_agent_dedupe_uniq')
      .on(t.agent, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} = 'succeeded'`),
    agentStartedIdx: index('agent_runs_agent_started_idx').on(t.agent, t.startedAt),
    statusIdx: index('agent_runs_status_idx').on(t.status),
    // Activity panel reads in-flight + recent runs scoped to a site, ordered
    // by startedAt desc. Without this index a populated agent_runs table forces
    // a full scan + sort on every poll.
    siteStartedIdx: index('agent_runs_site_started_idx').on(t.siteId, t.startedAt),
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
    /**
     * Number of times this event has been claimed and failed. Reset to 0 on
     * a successful processing. Bounded by maxAttempts in markEventFailed.
     */
    attempts: integer('attempts').notNull().default(0),
    /**
     * Earliest time at which this event may be re-claimed. Null means
     * "claim immediately". Set on transient failures to implement linear backoff.
     */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /**
     * Non-null means terminal — the event will never be claimed again. Set when:
     *  - input validation fails (ZodError) — schema mismatch is a code bug
     *  - the target agent is unknown — registry mismatch is a code bug
     *  - the target agent is not implemented — deterministic, not transient
     *  - attempts exceed the runtime-error retry budget
     * The operator UI surfaces these for triage; manual replay clears the field.
     */
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    /**
     * Tag describing why an event failed. One of: 'validation_error',
     * 'unknown_agent', 'not_implemented', 'runtime_error'. Used by the UI
     * and by replay logic to decide whether to re-attempt a dead-letter.
     */
    failureKind: text('failure_kind'),
  },
  (t) => ({
    unprocessedIdx: index('agent_events_unprocessed_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
    targetAgentIdx: index('agent_events_target_agent_idx').on(t.targetAgent),
    approvalIdx: index('agent_events_approval_idx')
      .on(t.requiresApproval)
      .where(sql`${t.processedAt} IS NULL`),
    // Replaces unprocessedIdx for claim-path queries — narrows to rows actually
    // eligible for claim (not done, not dead-lettered). Kept alongside the older
    // index because other consumers (operator UI history) still filter by just
    // processed_at IS NULL.
    claimableIdx: index('agent_events_claimable_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL AND ${t.deadLetteredAt} IS NULL`),
    deadLetteredIdx: index('agent_events_dead_lettered_idx')
      .on(t.deadLetteredAt)
      .where(sql`${t.deadLetteredAt} IS NOT NULL`),
  }),
);

export const agentBudgets = pgTable('agent_budgets', {
  agent: text('agent').primaryKey(),
  dailyCostCapUsd: numeric('daily_cost_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('5'),
  spentTodayUsd: numeric('spent_today_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  /**
   * Per-agent enable flag. When `false`, BaseAgent.run throws AgentDisabledError
   * before any work happens, the dispatcher classifies as terminal `agent_disabled`
   * and dead-letters the event (no 5-attempt retry storm). Operator escape hatch
   * during incidents — flip via `UPDATE agent_budgets SET enabled = false WHERE agent = ?`
   * to surgically pause one agent (e.g. content-engine) without killing the whole
   * portfolio via the global kill switch.
   */
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-row settings table for portfolio-wide controls. Keyed by a constant
 * `id = 'global'` so the operator dashboard can flip the kill switch without
 * needing a separate row per tenant. New flags get added as columns; the
 * insert/upsert path in helpers/system-state.ts keeps the row alive.
 */
export const systemState = pgTable('system_state', {
  id: text('id').primaryKey().default('global'),
  killSwitch: boolean('kill_switch').notNull().default(false),
  killSwitchReason: text('kill_switch_reason'),
  killSwitchActivatedAt: timestamp('kill_switch_activated_at', { withTimezone: true }),
  killSwitchActivatedBy: text('kill_switch_activated_by'),
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
export type NewProspect = typeof prospects.$inferInsert;
export type Trial = typeof trials.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Suppression = typeof suppressionList.$inferSelect;
export type NewSuppression = typeof suppressionList.$inferInsert;
export type Backlink = typeof backlinks.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type SystemState = typeof systemState.$inferSelect;
