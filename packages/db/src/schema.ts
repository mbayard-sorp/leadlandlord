import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  varchar,
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

export const siteModeEnum = pgEnum('site_mode', ['thin', 'content_rich']);

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

/**
 * Backlink prospect status — pre-pitch pipeline for the Molly guest-post flow.
 * Separate from `prospect_status` which is the tenant sales CRM enum.
 */
export const backlinkProspectStatusEnum = pgEnum('backlink_prospect_status', [
  'prospected',
  'scored',
  'flagged_top5',
  'approved',
  'pitched',
]);

/**
 * Backlink acquisition status.
 *
 * Convention on `live` vs `published`:
 *   `live`      — citation/directory rows: the link is confirmed live.
 *   `published` — guest-post rows: the post is confirmed published.
 *   `verified`  — guest-post rows: GSC confirms the link is indexed.
 * Do NOT use `live` for guest-post rows; use `published` → `verified` instead.
 */
export const backlinkStatusEnum = pgEnum('backlink_status', [
  // Original five values — kept as-is for citations and directory rows.
  'pending',
  'submitted',
  'live',
  'rejected',
  'lost',
  // R4.2: guest-post reply state machine (ADR-0006).
  'awaiting_reply',
  'reply_received',
  'accepted',
  'declined',
  'silent',
  'escalated',
  'drafting',
  'draft_pending_review',
  'draft_approved',
  'delivered',
  'published',
  'verified',
  'dormant',
  'manual_review',
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
    // 'claude_estimate' until an operator validates the row, then 'dataforseo'.
    volumeSource: text('volume_source').notNull().default('claude_estimate'),
    // Claude's estimate midpoint, preserved separately from the measured value.
    estSearchVolume: integer('est_search_volume'),
    // Measured volume/difficulty from a DataForSEO validation (null until validated).
    dfsSearchVolume: integer('dfs_search_volume'),
    dfsKd: integer('dfs_kd'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    // Full raw DataForSEO response(s) captured at validation, for field discovery.
    dfsRaw: jsonb('dfs_raw'),
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
    /** Greeting played to the inbound caller (via Polly TTS) before the call is forwarded or sent to voicemail. */
    inboundGreeting: text('inbound_greeting'),
    /** Whether to record + transcribe inbound calls. */
    recordingEnabled: boolean('recording_enabled').notNull().default(true),
    /** GA4 measurement ID baked into the site's NEXT_PUBLIC_GA_MEASUREMENT_ID. */
    gaMeasurementId: text('ga_measurement_id'),
    /** One Klaviyo list per niche × city for lead-form submissions. */
    klaviyoListId: text('klaviyo_list_id'),
    /**
     * Competitor domains seeded by Niche Hunter (or operator-curated). Used
     * by Backlink Builder's prospect mode as targets for DataForSEO domain
     * intersection queries. Bare hosts, no protocol. May be null until the
     * niche has been mined.
     */
    competitorSeeds: jsonb('competitor_seeds').$type<string[]>(),
    /** thin = 6-8 pages (default); content_rich = ~28 pages (opt-in). */
    siteMode: siteModeEnum('site_mode').notNull().default('thin'),
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
    domainAuthority: integer('domain_authority'),
    pitchDraft: text('pitch_draft'),
    subjectLine: text('subject_line'),
    rejectionReason: text('rejection_reason'),
    dedupeKey: text('dedupe_key'),
    responseAt: timestamp('response_at', { withTimezone: true }),
    responseSnippet: text('response_snippet'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }),
    // R4.2 — Molly guest-post pipeline columns (ADR-0006).
    /** Raw SMTP Message-ID of the outbound pitch email. Used by MollyInbox to
     *  match inbound In-Reply-To headers. Indexed (partial). */
    messageId: text('message_id'),
    /** Anchor text bucket: 'branded' | 'naked' | 'generic' | 'partial'.
     *  Enforced by CHECK constraint in migration 0018. */
    anchorType: text('anchor_type'),
    /** MollyCopywriter draft output (markdown). Stored here while
     *  draft_pending_review; cleared after delivered. */
    draftMarkdown: text('draft_markdown'),
    /** Timestamp when the maintenance watcher confirmed the post is live. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Canonical URL of the live guest post once published. */
    publishedUrl: text('published_url'),
    /** Number of nudge emails sent to this target (max 7 over 21 days). */
    nudgeCount: integer('nudge_count').notNull().default(0),
    /** Timestamp of the most recent nudge send. */
    lastNudgeAt: timestamp('last_nudge_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata'),
  },
  (t) => ({
    siteIdx: index('backlinks_site_idx').on(t.siteId),
    dedupeUniq: uniqueIndex('backlinks_dedupe_key_uniq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    messageIdIdx: index('backlinks_message_id_idx')
      .on(t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
  }),
);

/**
 * Backlink prospect candidates — domain-level pre-pitch records created by
 * BacklinkBuilder's `prospect` mode (DFS discovery → Apollo enrichment).
 *
 * One row per (site, domain) pair. Separate from the `prospects` table which
 * is the tenant sales CRM (tracks business owners as rental prospects).
 *
 * State machine (ADR-0006):
 *   prospected → scored → flagged_top5 → approved → pitched
 *
 * When a row reaches `approved`, a `prospect.approved` agent event is emitted
 * and BacklinkBuilder.guest_post creates the corresponding `backlinks` row
 * (status=submitted), at which point `backlink_id` is set and status moves
 * to `pitched`.
 */
export const backlinkProspects = pgTable(
  'backlink_prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    /** DataForSEO domain_rank at discovery time. DA filter: 25–60 in MollyScorer. */
    domainRank: integer('domain_rank'),
    status: backlinkProspectStatusEnum('status').notNull().default('prospected'),
    /** MollyScorer score 0–100. */
    score: numeric('score', { precision: 5, scale: 2 }),
    /** MollyScorer one-sentence rationale (max 25 words). */
    rationale: text('rationale'),
    /** Set when MollyScorer selects this as a top-5 pick. */
    flaggedTop5At: timestamp('flagged_top5_at', { withTimezone: true }),
    /** Set when operator approves in the top-5 review UI. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Set once BacklinkBuilder.guest_post creates the pitch backlinks row. */
    backlinkId: uuid('backlink_id').references(() => backlinks.id, { onDelete: 'set null' }),
    /** 'prospect:<siteId>:<domain>' — prevents re-discovering the same domain. */
    dedupeKey: text('dedupe_key'),
    /** DFS signals, Apollo enrichment, Firecrawl receptivity results. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteStatusIdx: index('backlink_prospects_site_status_idx').on(t.siteId, t.status),
    flaggedTop5AtIdx: index('backlink_prospects_flagged_top5_at_idx')
      .on(t.flaggedTop5At)
      .where(sql`${t.flaggedTop5At} IS NOT NULL`),
    dedupeUniq: uniqueIndex('backlink_prospects_dedupe_key_uniq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
  }),
);

export type BacklinkProspect = typeof backlinkProspects.$inferSelect;
export type InsertBacklinkProspect = typeof backlinkProspects.$inferInsert;

// ────────────────────────────────────────────────────────────
// Email sends — outbound mail audit log + per-mailbox throttle source
// ────────────────────────────────────────────────────────────

/**
 * One row per outbound email attempt (success, failure, or throttled-skip).
 * Read by `email-throttle.ts` to enforce a daily cap per `mailbox`, with a
 * configurable warmup ramp keyed off the first successful send. Counted rows
 * are filtered to `status = 'sent'` so throttled/failed attempts don't burn
 * the cap.
 */
export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    mailbox: varchar('mailbox', { length: 320 }).notNull(),
    toAddress: varchar('to_address', { length: 320 }).notNull(),
    subject: text('subject').notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 16 }).notNull(),
    externalId: text('external_id'),
    status: varchar('status', { length: 16 }).notNull(),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    mailboxSentAtIdx: index('email_sends_mailbox_sent_at_idx').on(t.mailbox, t.sentAt),
    siteIdIdx: index('email_sends_site_id_idx').on(t.siteId),
  }),
);

// ────────────────────────────────────────────────────────────
// BCC graduation — first-N-sends safety net per outbound agent
// ────────────────────────────────────────────────────────────

/**
 * Single-row-per-agent state machine controlling whether outbound emails are
 * BCC'd to a human reviewer. Used by Molly: the first 20 globally-outbound
 * pitches are BCC'd to `bcc_address`, then the agent "graduates" and BCC
 * stops. `manual_override = true` re-enables BCC indefinitely.
 *
 * Seeded with one row `agent_name='molly'` in migration 0019.
 */
export const bccGraduation = pgTable('bcc_graduation', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentName: text('agent_name').notNull().unique(),
  outboundCount: integer('outbound_count').notNull().default(0),
  graduatedAt: timestamp('graduated_at', { withTimezone: true }),
  manualOverride: boolean('manual_override').notNull().default(false),
  bccAddress: text('bcc_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BccGraduation = typeof bccGraduation.$inferSelect;

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
  weeklyCostCapUsd: numeric('weekly_cost_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('50'),
  monthlyCostCapUsd: numeric('monthly_cost_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('200'),
  spentTodayUsd: numeric('spent_today_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  spentThisWeekUsd: numeric('spent_this_week_usd', { precision: 10, scale: 4 })
    .notNull()
    .default('0'),
  spentThisMonthUsd: numeric('spent_this_month_usd', { precision: 10, scale: 4 })
    .notNull()
    .default('0'),
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
/**
 * Cache for DataForSEO API responses. Avoids re-paying for the same lookups
 * across builds — keyword-planner seeds like `<niche>`, `<niche> near me`,
 * `<niche> cost`, `<niche> services` are city-independent and reusable
 * across every site we ever build for that niche.
 *
 * Keyed by (endpoint, key) where:
 *   - endpoint: 'candidates' | 'metrics' | 'serp'
 *   - key: a deterministic string per endpoint (the seed for candidates;
 *          a hash of language|location|keywords for metrics; etc.)
 *
 * Caller checks freshness via `expires_at`. On hit, increments `hit_count`
 * + stamps `last_hit_at` so we can see what's actually being reused.
 */
export const dataforseoCache = pgTable(
  'dataforseo_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpoint: text('endpoint').notNull(),
    key: text('key').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
  },
  (t) => ({
    endpointKeyIdx: uniqueIndex('dataforseo_cache_endpoint_key_idx').on(t.endpoint, t.key),
    expiresAtIdx: index('dataforseo_cache_expires_at_idx').on(t.expiresAt),
  }),
);

export const systemState = pgTable('system_state', {
  id: text('id').primaryKey().default('global'),
  killSwitch: boolean('kill_switch').notNull().default(false),
  killSwitchReason: text('kill_switch_reason'),
  killSwitchActivatedAt: timestamp('kill_switch_activated_at', { withTimezone: true }),
  killSwitchActivatedBy: text('kill_switch_activated_by'),
  // ──────────────────────────────────────────────────────────
  // Operator orchestrator targets + autonomy mode (Phase F).
  // The operator agent reads these on every cron run to decide
  // whether/how to dispatch work. Defaults are deliberately
  // safe: operatorEnabled=false, mode=manual, all auto-approve
  // budgets at zero. Autonomous mode must be opted into by a
  // human via the /operator/control panel.
  // ──────────────────────────────────────────────────────────
  targetMrrUsd: numeric('target_mrr_usd', { precision: 10, scale: 2 }).notNull().default('0'),
  targetActiveSites: integer('target_active_sites').notNull().default(0),
  targetMonthlyMargin: numeric('target_monthly_margin', { precision: 5, scale: 4 })
    .notNull()
    .default('0'),
  autoApproveNiches: boolean('auto_approve_niches').notNull().default(false),
  autoApproveDomainBudgetUsd: numeric('auto_approve_domain_budget_usd', { precision: 8, scale: 2 })
    .notNull()
    .default('0'),
  operatorEnabled: boolean('operator_enabled').notNull().default(false),
  lastOperatorRunAt: timestamp('last_operator_run_at', { withTimezone: true }),
  operatorMode: text('operator_mode').notNull().default('manual'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────────────────────────────────────────────
// SEO / GA4 / Lighthouse / Recommendations (Phase A)
// ────────────────────────────────────────────────────────────

export const seoMetricsDaily = pgTable(
  'seo_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD; stored as text for portability across drizzle versions. */
    date: text('date').notNull(),
    query: text('query').notNull(),
    page: text('page').notNull(),
    clicks: integer('clicks').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    ctr: numeric('ctr', { precision: 6, scale: 4 }).notNull().default('0'),
    position: numeric('position', { precision: 6, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteDateQueryPageUniq: uniqueIndex('seo_metrics_daily_site_date_query_page_uniq').on(
      t.siteId,
      t.date,
      t.query,
      t.page,
    ),
    siteDateIdx: index('seo_metrics_daily_site_date_idx').on(t.siteId, t.date),
  }),
);

export const ga4MetricsDaily = pgTable(
  'ga4_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    sessions: integer('sessions').notNull().default(0),
    users: integer('users').notNull().default(0),
    engagedSessions: integer('engaged_sessions').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    avgEngagementS: numeric('avg_engagement_s', { precision: 8, scale: 2 }).default('0'),
    bounceRate: numeric('bounce_rate', { precision: 6, scale: 4 }).default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteDateUniq: uniqueIndex('ga4_metrics_daily_site_date_uniq').on(t.siteId, t.date),
  }),
);

export const seoRecommendations = pgTable(
  'seo_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** 'title_rewrite' | 'meta_rewrite' | 'alt_text' | 'internal_link' | 'schema_fix' | 'new_info_page' | 'copy_rewrite' | 'hero_regen' | 'lighthouse_perf' */
    type: text('type').notNull(),
    /** 'low' | 'medium' | 'high' */
    riskLevel: text('risk_level').notNull().default('medium'),
    /** Sanity slug or URL path. */
    targetPage: text('target_page'),
    rationale: text('rationale').notNull(),
    estImpactScore: numeric('est_impact_score', { precision: 6, scale: 2 }).default('0'),
    /** Self-contained instructions for the apply pass. */
    actionPayload: jsonb('action_payload').notNull(),
    /** 'pending' | 'auto_applied' | 'awaiting_review' | 'approved' | 'rejected' | 'blocked' | 'failed' */
    status: text('status').notNull().default('pending'),
    /** No FK constraint to keep things simple. */
    appliedRunId: uuid('applied_run_id'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteStatusIdx: index('seo_recommendations_site_status_idx').on(t.siteId, t.status),
    statusCreatedIdx: index('seo_recommendations_status_created_idx').on(t.status, t.createdAt),
  }),
);

export const lighthouseAudits = pgTable(
  'lighthouse_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Scores 0-100, nullable. */
    performance: integer('performance'),
    accessibility: integer('accessibility'),
    bestPractices: integer('best_practices'),
    seo: integer('seo'),
    lcpMs: integer('lcp_ms'),
    fcpMs: integer('fcp_ms'),
    ttiMs: integer('tti_ms'),
    clsMilli: integer('cls_milli'),
    rawJson: jsonb('raw_json'),
    auditedAt: timestamp('audited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteAuditedIdx: index('lighthouse_audits_site_audited_idx').on(t.siteId, t.auditedAt),
  }),
);

// ────────────────────────────────────────────────────────────
// Domain Procurer (Phase A2)
// ────────────────────────────────────────────────────────────

export const domainCandidates = pgTable(
  'domain_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** e.g. 'treeremovaltucson.com' */
    domain: text('domain').notNull(),
    registrar: text('registrar').notNull().default('cloudflare'),
    priceUsd: numeric('price_usd', { precision: 8, scale: 2 }),
    tld: text('tld'),
    /** 'exact' | 'partial' | 'keyword' */
    matchType: text('match_type'),
    /** 1..N from search */
    rank: integer('rank').notNull(),
    /** 'available' | 'pending_approval' | 'approved' | 'registered' | 'rejected' | 'taken' */
    status: text('status').notNull().default('available'),
    registeredAt: timestamp('registered_at', { withTimezone: true }),
    autoRenew: boolean('auto_renew').notNull().default(true),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteDomainUniq: uniqueIndex('domain_candidates_site_domain_uniq').on(t.siteId, t.domain),
    siteStatusIdx: index('domain_candidates_site_status_idx').on(t.siteId, t.status),
  }),
);

/**
 * Stripe webhook events — idempotency log. Stripe retries delivery on
 * non-2xx responses (and occasionally re-delivers a successful event due
 * to network conditions), so the webhook handler dedupes by `id` (the
 * Stripe event ID) before processing. INSERT ... ON CONFLICT DO NOTHING
 * at the top of the handler; if the insert is a no-op the event has
 * already been processed and we ack 200 immediately.
 */
export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  // Stripe event ID, e.g. evt_1Hh1H2HvpVfH...
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

// ────────────────────────────────────────────────────────────
// Phase D — Portfolio Analyst + Maintenance
// ────────────────────────────────────────────────────────────

/**
 * Per-site / per-niche / portfolio-wide daily snapshot rows.
 *
 *   - `siteId` set, `niche` null  → per-site row
 *   - `siteId` null, `niche` set  → per-niche aggregate row
 *   - `siteId` null, `niche` null → portfolio-wide aggregate row
 */
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: text('date').notNull(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    niche: text('niche'),
    mrrUsd: numeric('mrr_usd', { precision: 10, scale: 2 }).notNull().default('0'),
    costsUsd: numeric('costs_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    callsCount: integer('calls_count').notNull().default(0),
    leadsCount: integer('leads_count').notNull().default(0),
    trialActiveCount: integer('trial_active_count').notNull().default(0),
    tenantsActiveCount: integer('tenants_active_count').notNull().default(0),
    status: text('status'),
    rationale: text('rationale'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateSiteIdx: uniqueIndex('portfolio_snapshots_date_site_uniq')
      .on(t.date, t.siteId)
      .where(sql`${t.siteId} IS NOT NULL`),
    dateNicheIdx: uniqueIndex('portfolio_snapshots_date_niche_uniq')
      .on(t.date, t.niche)
      .where(sql`${t.siteId} IS NULL AND ${t.niche} IS NOT NULL`),
    datePortfolioIdx: uniqueIndex('portfolio_snapshots_date_portfolio_uniq')
      .on(t.date)
      .where(sql`${t.siteId} IS NULL AND ${t.niche} IS NULL`),
    dateIdx: index('portfolio_snapshots_date_idx').on(t.date),
  }),
);

/**
 * Findings emitted by the maintenance agent. The agent dedupes at write
 * time so a recurring finding for (siteId, category) with status='open'
 * updates the existing row instead of inserting a duplicate.
 */
export const maintenanceFindings = pgTable(
  'maintenance_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    detail: text('detail').notNull(),
    status: text('status').notNull().default('open'),
    autoFixedAt: timestamp('auto_fixed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    siteCategoryIdx: index('maintenance_findings_site_category_idx').on(t.siteId, t.category),
    statusIdx: index('maintenance_findings_status_idx').on(t.status),
  }),
);

// ────────────────────────────────────────────────────────────
// Alerts (Phase E)
// ────────────────────────────────────────────────────────────

/**
 * Configurable alerting rules evaluated by the alert-evaluator cron. Each
 * rule names a fixed evaluator (in apps/operator/app/api/cron/alert-evaluator)
 * and carries rule-specific thresholds + cooldown to suppress flapping.
 * Channels list is the default — actual fired channels are tracked per-event.
 */
export const alertRules = pgTable('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'agent_failure_rate' | 'llm_spend_spike' | 'stripe_webhook_failures' | 'ssl_expiry' | 'domain_expiry' */
  name: text('name').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  thresholds: jsonb('thresholds').notNull(),
  cooldownMinutes: integer('cooldown_minutes').notNull().default(60),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  channels: jsonb('channels').notNull().default(sql`'["pagerduty","slack"]'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const alertEvents = pgTable(
  'alert_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id').references(() => alertRules.id, { onDelete: 'cascade' }),
    ruleName: text('rule_name').notNull(),
    /** 'info' | 'warning' | 'critical' */
    severity: text('severity').notNull(),
    payload: jsonb('payload').notNull(),
    channelsFired: jsonb('channels_fired').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ruleCreatedIdx: index('alert_events_rule_created_idx').on(t.ruleName, t.createdAt),
  }),
);

// ────────────────────────────────────────────────────────────
// Sprint 0 — Approval gates, networks, cross-site linking
// ────────────────────────────────────────────────────────────

/**
 * Every side-effecting agent action queues here before execution.
 * Auto-approve rules may flip status to 'auto_approved' immediately.
 */
export const agentApprovals = pgTable(
  'agent_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    /** e.g. 'niche_candidate', 'site_bundle', 'cross_link_placement', 'backlink_submission', 'citation_submission' */
    kind: text('kind').notNull(),
    /** The proposed action; shape varies by kind. */
    payload: jsonb('payload').notNull(),
    /** pending | approved | rejected | expired | auto_approved */
    status: text('status').notNull().default('pending'),
    /** Operator email or 'rule:<ruleId>' if auto-approved. */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Auto-approve rule ID, if any. */
    ruleMatched: text('rule_matched'),
    rejectionReason: text('rejection_reason'),
    /** Default 7 days from createdAt. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusKindCreatedIdx: index('agent_approvals_status_kind_created_idx').on(
      t.status,
      t.kind,
      t.createdAt,
    ),
    agentRunIdx: index('agent_approvals_agent_run_idx').on(t.agentRunId),
  }),
);

/**
 * Operator-defined rules that auto-approve matching agentApprovals rows.
 * Each rule specifies a kind + JSON path predicates over payload.
 */
export const autoApproveRules = pgTable('auto_approve_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Matches agentApprovals.kind. */
  kind: text('kind').notNull(),
  /** JSON path predicates over payload, e.g. { "payload.linkType": "out_of_network" }. */
  matcher: jsonb('matcher').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  active: boolean('active').notNull().default(true),
  /** Usage telemetry: incremented on each auto-approval. */
  approvedCount: integer('approved_count').notNull().default(0),
});

/**
 * A named group of sites that may cross-link via network-linker.
 * Seeded with one row: slug='default'.
 */
export const networks = pgTable('networks', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Many-to-many: sites <-> networks. One row per (site, network) pair.
 * UNIQUE on siteId — each site belongs to at most one network.
 */
export const siteNetworkMemberships = pgTable(
  'site_network_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    networkId: uuid('network_id')
      .notNull()
      .references(() => networks.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Max outbound cross-site links this site may place. */
    linkBudgetOutbound: integer('link_budget_outbound').notNull().default(4),
    /** Max inbound cross-site links this site may receive. */
    linkBudgetInbound: integer('link_budget_inbound').notNull().default(8),
    /** active | paused | quarantined */
    status: text('status').notNull().default('active'),
  },
  (t) => ({
    siteUniq: uniqueIndex('site_network_memberships_site_uniq').on(t.siteId),
    networkIdx: index('site_network_memberships_network_idx').on(t.networkId),
  }),
);

/**
 * Individual cross-site links placed by network-linker. Each row represents
 * one live (or removed/broken) link in a page's MDX body.
 */
export const crossSiteLinks = pgTable(
  'cross_site_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSiteId: uuid('source_site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Sanity page doc ID where the link lives. */
    sourcePageId: text('source_page_id').notNull(),
    targetSiteId: uuid('target_site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
    anchorText: text('anchor_text').notNull(),
    /** SHA-256 of surrounding sentence context — used to detect link drift. */
    surroundingContextHash: text('surrounding_context_hash'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    /** active | removed | broken */
    status: text('status').notNull().default('active'),
  },
  (t) => ({
    sourceSiteIdx: index('cross_site_links_source_site_idx').on(t.sourceSiteId),
    targetSiteIdx: index('cross_site_links_target_site_idx').on(t.targetSiteId),
    sourcePageIdx: index('cross_site_links_source_page_idx').on(t.sourcePageId),
    pageTargetAnchorIdx: index('cross_site_links_page_target_anchor_idx').on(
      t.sourcePageId,
      t.targetUrl,
      t.anchorText,
    ),
    sourceTargetPlacedIdx: index('cross_site_links_source_target_placed_idx').on(
      t.sourceSiteId,
      t.targetSiteId,
      t.placedAt,
    ),
  }),
);

/**
 * Operator or agent requests for the network-linker to add links to a site.
 */
export const linkRequests = pgTable(
  'link_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestingSiteId: uuid('requesting_site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    desiredCount: integer('desired_count').notNull().default(1),
    /** pending | processing | completed | cancelled */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the drain cron may pick this request up. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    siteStatusIdx: index('link_requests_site_status_idx').on(t.requestingSiteId, t.status),
    statusScheduledIdx: index('link_requests_status_scheduled_idx').on(t.status, t.scheduledFor),
  }),
);

// ────────────────────────────────────────────────────────────
// Sprint 5 — Wave launcher
// ────────────────────────────────────────────────────────────

export const waveStateEnum = pgEnum('wave_state', [
  'draft',
  'launching',
  'aging',
  'linking',
  'backlinking',
  'monitoring',
  'completed',
]);

export interface WaveTransition {
  from: string;
  to: string;
  at: string;
  approvalId?: string;
  evidence?: string;
}

export const waves = pgTable(
  'waves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    niche: text('niche').notNull(),
    siteIds: uuid('site_ids').array().notNull().default(sql`'{}'::uuid[]`),
    state: waveStateEnum('state').notNull().default('draft'),
    agingUntil: timestamp('aging_until', { withTimezone: true }),
    transitions: jsonb('transitions').$type<WaveTransition[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateUpdatedIdx: index('waves_state_updated_idx').on(t.state, t.updatedAt),
  }),
);

export type Wave = typeof waves.$inferSelect;
export type NewWave = typeof waves.$inferInsert;

// ────────────────────────────────────────────────────────────
// Phone provisioning audit log (R3.5)
// ────────────────────────────────────────────────────────────

/**
 * Audit log for the Twilio phone-number provisioning flow.
 * One batch of rows per "Find phone numbers" request (up to 5 candidates).
 * The live-state column is sites.twilio_phone_sid — this table is history only.
 */
export const phoneProvisions = pgTable(
  'phone_provisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** E.164 format, e.g. +15205550100 */
    candidateE164: text('candidate_e164').notNull(),
    /** Twilio AvailablePhoneNumber SID (before actual provisioning). */
    twilioNumberSid: text('twilio_number_sid'),
    locality: text('locality'),
    region: text('region'),
    /** { voice: boolean, sms: boolean, mms: boolean } */
    capabilities: jsonb('capabilities').$type<{ voice: boolean; sms: boolean; mms: boolean }>(),
    /** True for the Haiku-recommended candidate. */
    recommended: boolean('recommended').notNull().default(false),
    /** Haiku one-sentence rationale. Null for runners-up. */
    rationale: text('rationale'),
    /** True once the operator clicked "Provision this number". */
    chosen: boolean('chosen').notNull().default(false),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteCreatedIdx: index('phone_provisions_site_created_idx').on(t.siteId, t.createdAt.desc()),
  }),
);

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
export type SeoMetricDaily = typeof seoMetricsDaily.$inferSelect;
export type NewSeoMetricDaily = typeof seoMetricsDaily.$inferInsert;
export type Ga4MetricDaily = typeof ga4MetricsDaily.$inferSelect;
export type NewGa4MetricDaily = typeof ga4MetricsDaily.$inferInsert;
export type SeoRecommendation = typeof seoRecommendations.$inferSelect;
export type NewSeoRecommendation = typeof seoRecommendations.$inferInsert;
export type LighthouseAudit = typeof lighthouseAudits.$inferSelect;
export type NewLighthouseAudit = typeof lighthouseAudits.$inferInsert;
export type DomainCandidate = typeof domainCandidates.$inferSelect;
export type NewDomainCandidate = typeof domainCandidates.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type NewAlertEvent = typeof alertEvents.$inferInsert;
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
export type OutreachEvent = typeof outreachEvents.$inferSelect;
export type NewOutreachEvent = typeof outreachEvents.$inferInsert;
export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;
export type MaintenanceFinding = typeof maintenanceFindings.$inferSelect;
export type NewMaintenanceFinding = typeof maintenanceFindings.$inferInsert;
export type EmailSend = typeof emailSends.$inferSelect;
export type NewEmailSend = typeof emailSends.$inferInsert;
export type PhoneProvision = typeof phoneProvisions.$inferSelect;
export type NewPhoneProvision = typeof phoneProvisions.$inferInsert;
export type AgentApproval = typeof agentApprovals.$inferSelect;
export type NewAgentApproval = typeof agentApprovals.$inferInsert;
export type AutoApproveRule = typeof autoApproveRules.$inferSelect;
export type NewAutoApproveRule = typeof autoApproveRules.$inferInsert;
export type Network = typeof networks.$inferSelect;
export type NewNetwork = typeof networks.$inferInsert;
export type SiteNetworkMembership = typeof siteNetworkMemberships.$inferSelect;
export type NewSiteNetworkMembership = typeof siteNetworkMemberships.$inferInsert;
export type CrossSiteLink = typeof crossSiteLinks.$inferSelect;
export type NewCrossSiteLink = typeof crossSiteLinks.$inferInsert;
export type LinkRequest = typeof linkRequests.$inferSelect;
export type NewLinkRequest = typeof linkRequests.$inferInsert;
