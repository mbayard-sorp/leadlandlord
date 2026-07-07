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
  'build_failed',
  'compliance_blocked',
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
    // One of the 9 niche-hunter CategoryEnum values, captured at brainstorm time.
    // Nullable: legacy rows predate this column and stay null until re-run.
    category: text('category'),
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
    // ADR 0009 Phase 1 / A1: sum of search_volume across commercial/transactional
    // phrases from getKeywordCandidates (Labs, 90-day cache, city-independent).
    // Null until validateNiche runs. Used as a demand cross-check alongside
    // dfsSearchVolume; see scoring-config.ts GEO_SHARE_PRIOR.
    dfsClusterVolume: integer('dfs_cluster_volume'),
    // ADR 0009 Phase 2 / B1: Google Places contractor count (first-page result
    // count, capped at 20). Null until validateNiche runs. Cached 30 days.
    contractorCount: integer('contractor_count'),
    // ADR 0009 Phase 2 / C1: rentability score (0-100), separate from SEO
    // winnability score. Computed from contractor_count + avg_cpc + lead price.
    rentabilityScore: numeric('rentability_score', { precision: 6, scale: 2 }),
    // ADR 0029 (rentability scoring v2 / Places supply signal, migration 0057):
    // of `contractorCount` results, how many have no `websiteUri`. Null until
    // re-validated post-deploy (old rows keep the v1 rentability formula).
    contractorsWithoutWebsite: integer('contractors_without_website'),
    // ADR 0029: median Google review count across `contractorCount` results.
    // Null until re-validated post-deploy.
    contractorMedianReviews: integer('contractor_median_reviews'),
    // Phase 5 (Niche Algorithm Accuracy plan, migration 0058): trough/peak of
    // the trailing ~12mo monthly_searches from validateNicheCore, 0-1. Near 1
    // = flat demand year-round; near 0 = highly seasonal (e.g. snow removal).
    // Null until re-validated post-deploy, or when DFS returned no monthly
    // history. Below SEASONALITY_DAMPENING_THRESHOLD (0.35), validateNicheCore
    // dampens the measured volume toward the annual mean before it reaches the
    // dollar-value model — see scoring-config.ts.
    seasonalityIndex: numeric('seasonality_index', { precision: 4, scale: 3 }),
    // Scout/validate engine (migration 0043). Scout-time expected monthly
    // value (population-proportional, cached/static inputs) and the measured
    // validation-time value. Both persisted, never overwritten, so predicted
    // vs actual call volume can be calibrated later.
    estMonthlyValueUsd: numeric('est_monthly_value_usd', { precision: 12, scale: 2 }),
    validatedMonthlyValueUsd: numeric('validated_monthly_value_usd', { precision: 12, scale: 2 }),
    // Claude annotation from the validator (seasonality flag, licensing
    // concern, one-line caution). Null on legacy / manually seeded rows.
    annotations: jsonb('annotations'),
    // Rentability-weighted validated dollar score (migration 0048, ADR niche-engine fix).
    validatedScore: numeric('validated_score', { precision: 12, scale: 2 }),
    // Scout-time proxy winnability carried forward from the originating candidate.
    scoutWinnability: numeric('scout_winnability', { precision: 4, scale: 3 }),
    // National cluster KD from the scout pass that produced this niche.
    scoutClusterDifficulty: numeric('scout_cluster_difficulty', { precision: 5, scale: 2 }),
    // True when the validation SERP composition was a fabricated fallback (API error).
    dfsFallback: boolean('dfs_fallback'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    nicheCityStateUniq: uniqueIndex('niches_niche_city_state_uniq').on(t.niche, t.city, t.state),
    decisionIdx: index('niches_decision_idx').on(t.decision),
  }),
);

/**
 * One row per scout run (migration 0043). The full trade x city grid is
 * scored in memory and never persisted — only the top `persisted_candidates`
 * rows land in niche_candidates, and the report jsonb captures everything the
 * operator needs (value curve, recommendation, insights). A new scout for the
 * same states marks prior 'current' runs 'superseded'.
 */
export const nicheScoutRuns = pgTable('niche_scout_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentRunId: uuid('agent_run_id'),
  /** Two-letter state codes, e.g. ["AZ","NM"]. */
  states: jsonb('states').$type<string[]>().notNull(),
  /** Null = all 9 categories. */
  categoryFilter: text('category_filter'),
  populationMin: integer('population_min').notNull(),
  populationMax: integer('population_max').notNull(),
  gridCells: integer('grid_cells').notNull(),
  persistedCandidates: integer('persisted_candidates').notNull(),
  report: jsonb('report').notNull(),
  /** 'current' | 'superseded' */
  status: text('status').notNull().default('current'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nicheCandidates = pgTable(
  'niche_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scoutRunId: uuid('scout_run_id')
      .notNull()
      .references(() => nicheScoutRuns.id, { onDelete: 'cascade' }),
    trade: text('trade').notNull(),
    category: text('category').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    population: integer('population').notNull(),
    /** Null = no cached cluster (data_confidence 'benchmark_only'). */
    clusterVolume: integer('cluster_volume'),
    estCityVolume: numeric('est_city_volume', { precision: 12, scale: 2 }),
    leadBenchmarkPrice: numeric('lead_benchmark_price', { precision: 8, scale: 2 }).notNull(),
    rentabilityPrior: numeric('rentability_prior', { precision: 4, scale: 3 }).notNull(),
    estMonthlyValueUsd: numeric('est_monthly_value_usd', { precision: 12, scale: 2 }).notNull(),
    rank: integer('rank').notNull(),
    isNovelTrade: boolean('is_novel_trade').notNull().default(false),
    /** 'cluster' | 'benchmark_only' */
    dataConfidence: text('data_confidence').notNull().default('cluster'),
    /** 'scouted' | 'queued' | 'validated' | 'validation_failed' */
    status: text('status').notNull().default('scouted'),
    nicheId: uuid('niche_id').references(() => niches.id, { onDelete: 'set null' }),
    validatedValueUsd: numeric('validated_value_usd', { precision: 12, scale: 2 }),
    /**
     * SEO competition winnability persisted at scout time (ADR 0021).
     * clamp((100 - clusterDifficulty) / 100) or DEFAULT_BENCHMARK_WINNABILITY.
     * Nullable for rows created before migration 0044.
     */
    winnability: numeric('winnability', { precision: 4, scale: 3 }),
    /**
     * Volume-weighted avg keyword_difficulty from computeClusterDifficulty.
     * Null when no usable kd values existed in the cluster (all kd <= 0).
     */
    clusterDifficulty: numeric('cluster_difficulty', { precision: 5, scale: 2 }),
    // ──────────────────────────────────────────────────────────
    // Geographic targeting signals (migration 0045, ADR 0022).
    // Nullable for rows created before the geo-targeting redesign.
    // ──────────────────────────────────────────────────────────
    /**
     * Local-SERP keyword difficulty from the bounded refinement pass
     * (getSerpComposition). Null when the cell was never refined (proxy-only).
     */
    localSerpDifficulty: numeric('local_serp_difficulty', { precision: 5, scale: 2 }),
    /** Share of the local SERP held by directory/aggregator results (0-1). */
    localAggregatorShare: numeric('local_aggregator_share', { precision: 4, scale: 3 }),
    /** Whether the local SERP rendered a map/local pack. */
    hasLocalPack: boolean('has_local_pack'),
    /** Measured local search volume from the refinement pass (gated by knob). */
    localMeasuredVolume: integer('local_measured_volume'),
    /** 'proxy' (full-grid structural signal) | 'local_serp' (refined). */
    refinementSource: text('refinement_source'),
    /**
     * Metro density multiplier (0.15-1.0) from computeCityMarketScores:
     * nearby population excluding the city, a local-competition proxy.
     */
    metroDensityMult: numeric('metro_density_mult', { precision: 4, scale: 3 }),
    /** Composite demand-quality signal (0-1) from owner-occ + wealth ratios. */
    demandQuality: numeric('demand_quality', { precision: 4, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runCellUniq: uniqueIndex('niche_candidates_run_cell_uniq').on(t.scoutRunId, t.trade, t.city, t.state),
    runRankIdx: index('niche_candidates_run_rank_idx').on(t.scoutRunId, t.rank),
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
    /**
     * Output from the Competitor Analyzer agent, persisted at build time.
     * Null until the first successful analyzer run. Stored loosely typed so
     * the db package does not take a hard dep on @leadlandlord/agents.
     */
    competitorBrief: jsonb('competitor_brief').$type<Record<string, unknown>>(),
    /** thin = 6-8 pages (default); content_rich = ~28 pages (opt-in). */
    siteMode: siteModeEnum('site_mode').notNull().default('thin'),
    /**
     * Per-site opt-in for the local-content-scout. Default false so the
     * scheduler only fans out to sites explicitly enrolled in the content
     * pilot; flip more sites true to expand the rollout. See content_ideas.
     */
    localContentEnabled: boolean('local_content_enabled').notNull().default(false),
    /**
     * Stable per-build token. Anchors site-builder's expensive sub-agent
     * dedupe keys (content-engine, keyword-planner, compliance-guard) so a
     * reaper-triggered re-run reuses the cached agent_runs output instead of
     * re-executing the multi-minute Claude call. Set once on first build;
     * bumped only when the operator wants fresh content (see SiteBuilderInput).
     */
    buildEpoch: text('build_epoch'),
    /**
     * Plain-text summary of the most recent build failure. Set by site-builder
     * when it writes status='build_failed' or status='compliance_blocked'.
     * Cleared (set null) when a subsequent build succeeds. Exposed in the
     * operator site detail panel so Mike can triage without digging into agent_runs.
     */
    lastBuildError: text('last_build_error'),
    /**
     * Checkpoint of the last successfully-generated ContentBundle, scoped to the
     * build_epoch it was produced under. Lets site-builder skip a multi-minute
     * content-engine re-run on a retry that failed AFTER content generation
     * (e.g. a Sanity hiccup) — the dedupe key already covers a re-run that fails
     * before/during content-engine, this covers the tail. Loosely typed (jsonb)
     * so the db package takes no dep on @leadlandlord/shared. Nullable.
     */
    contentBundle: jsonb('content_bundle').$type<Record<string, unknown>>(),
    /** When `content_bundle` was last written. Pairs with build_epoch for staleness. */
    contentBundleAt: timestamp('content_bundle_at', { withTimezone: true }),
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
    /** Caller's name from Twilio CNAM lookup (param `CallerName`); often empty for mobile callers. */
    callerName: text('caller_name'),
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
    /** Outreach contact, pre-filled by MollyScorer (Firecrawl/Apollo) or entered by operator. */
    contactEmail: text('contact_email'),
    contactName: text('contact_name'),
    /** 'found' (scraped/Apollo-confirmed) | 'guessed' (operator-entered or pattern) | 'missing'. */
    contactState: text('contact_state'),
    /** DFS signals, Apollo enrichment, Firecrawl receptivity results, snoozedUntil/snoozeReason. */
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
// Backlink niche tastes — operator rejection feedback per niche
// ────────────────────────────────────────────────────────────

/**
 * One row per operator prospect rejection. Accumulates a per-niche "taste
 * profile" that MollyScorer feeds into its scoring prompt (20 most recent
 * rows per niche) so future scouting avoids site types the operator keeps
 * rejecting. Keyed on the lowercased niche string (not niches.id) so the
 * profile survives niche-row revisions. Insert path dedupes (niche, domain)
 * within 30 days.
 */
export const backlinkNicheTastes = pgTable(
  'backlink_niche_tastes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercased niche name, normalized at insert time. */
    niche: text('niche').notNull(),
    domain: text('domain').notNull(),
    /** Operator's one-line rejection reason (preset chip and/or free text). */
    reason: text('reason').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    prospectId: uuid('prospect_id').references(() => backlinkProspects.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    nicheRecordedIdx: index('backlink_niche_tastes_niche_recorded_idx').on(
      t.niche,
      t.recordedAt,
    ),
  }),
);

export type BacklinkNicheTaste = typeof backlinkNicheTastes.$inferSelect;
export type InsertBacklinkNicheTaste = typeof backlinkNicheTastes.$inferInsert;

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
     * The agent_events.id that triggered this run. Nullable — runs started
     * directly (e.g. via the operator UI or a scheduler) have no source event.
     * Used by the reaper liveness guard to correlate a stalled run back to its
     * originating event so the event's lease can be released without scanning
     * all of agent_events. No FK — events can be deleted/dead-lettered after
     * the run completes and we don't want cascades here.
     */
    sourceEventId: uuid('source_event_id'),
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
    // Operator overview sums today's runs/cost via `WHERE started_at >= CURRENT_DATE`
    // with no agent/site filter, so the composite indexes above (leading column
    // agent/site) don't help. A bare startedAt index keeps that query off a seq scan.
    startedIdx: index('agent_runs_started_idx').on(t.startedAt),
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
 * Per-agent audit + failure tracking (orchestrator Phase 1). One row per
 * registry kind (+ the deferred stubs), written by scripts/agent-audit.ts.
 *
 * Pure observability — no agent behavior reads this yet. ON/OFF still lives in
 * agent_budgets.enabled. The Phase 3 operator supervisory pass will read
 * consecutive_failures to auto-disable repeat-failure agents.
 *
 * audit_status ∈ 'pass' | 'fail' | 'needs_creds' | 'not_implemented' | 'skipped'
 * (plain text, not an enum, so the audit can add states without a migration).
 */
export const agentHealth = pgTable('agent_health', {
  agent: text('agent').primaryKey(),
  auditStatus: text('audit_status').notNull(),
  lastAuditAt: timestamp('last_audit_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastError: text('last_error'),
  /** Env var names the agent needs to do real work (one entry per requirement). */
  requiredEnv: jsonb('required_env'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * DB-driven agent cadence (orchestrator Phase 3). SOURCE OF TRUTH for how
 * often the 10-minute tick enqueues each scheduler — so the orchestrator can
 * re-schedule agents without a Vercel redeploy.
 *
 * Keyed on the SCHEDULER registry name (packages/agents/src/scheduler), NOT
 * the agent kind: the tick fires via runScheduler(scheduler_name), and
 * schedulers are not 1:1 with agents (e.g. molly-nudge -> molly,
 * wave-progression -> wave-launcher). target_agent records the registry kind a
 * scheduler feeds, for the orchestrator UI/supervision (nullable; informational).
 *
 * Two independent gates, kept distinct:
 *   - `paused` (here): stop enqueuing on cadence, but the agent still runs on
 *     demand / events. A cadence-only suspend.
 *   - `agent_budgets.enabled=false`: don't run the agent AT ALL (enforced at
 *     enqueue in run-scheduler.ts + at the gate in BaseAgent.run).
 */
export const agentSchedules = pgTable('agent_schedules', {
  schedulerName: text('scheduler_name').primaryKey(),
  targetAgent: text('target_agent'),
  cadenceKind: text('cadence_kind').notNull(), // 'cron' | 'poll' | 'event' | 'manual'
  cronExpr: text('cron_expr'),
  intervalMinutes: integer('interval_minutes'),
  lastEnqueuedAt: timestamp('last_enqueued_at', { withTimezone: true }),
  paused: boolean('paused').notNull().default(false),
  managedBy: text('managed_by').notNull().default('human'), // 'human' | 'orchestrator'
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Orchestrator chat threads (orchestrator Phase 6). One row per conversation
 * between Mike and the fleet orchestrator — either Mike-initiated (`origin='chat'`)
 * or orchestrator-initiated (`origin='orchestrator_question'`, raised by the brain
 * or the supervisory pass when it needs a human decision). IDs are randomUUID.
 */
export const orchestratorThreads = pgTable('orchestrator_threads', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  origin: text('origin').notNull(), // 'chat' | 'orchestrator_question'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Messages within an orchestrator thread (orchestrator Phase 6). Every write
 * the orchestrator performs also lands here as a `kind='action'` row (the audit
 * trail, written BEFORE the mutation). Proactive questions are `kind='question'`
 * with `requires_human_response=true`; answering in chat flips `resolved`.
 */
export const orchestratorMessages = pgTable(
  'orchestrator_messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => orchestratorThreads.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'human' | 'orchestrator' | 'system'
    kind: text('kind').notNull().default('message'), // 'message' | 'question' | 'action'
    body: text('body').notNull(),
    /** Tool calls, the diff an action applied, the agent affected, etc. */
    metadata: jsonb('metadata'),
    requiresHumanResponse: boolean('requires_human_response').notNull().default(false),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    threadCreatedIdx: index('orchestrator_messages_thread_created_idx').on(
      t.threadId,
      t.createdAt,
    ),
    // The digest counts open questions: requires_human_response AND NOT resolved.
    openQuestionIdx: index('orchestrator_messages_open_question_idx')
      .on(t.createdAt)
      .where(sql`${t.requiresHumanResponse} = true AND ${t.resolved} = false`),
  }),
);

export type OrchestratorThread = typeof orchestratorThreads.$inferSelect;
export type NewOrchestratorThread = typeof orchestratorThreads.$inferInsert;
export type OrchestratorMessage = typeof orchestratorMessages.$inferSelect;
export type NewOrchestratorMessage = typeof orchestratorMessages.$inferInsert;

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
  /**
   * Network cross-link kill switch. When true, site-host injects NO cross-links
   * at render time (every placed link vanishes instantly) and the request seeder
   * stops enqueuing. Independent of the portfolio-wide killSwitch.
   */
  crossLinkPaused: boolean('cross_link_paused').notNull().default(false),
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
  // ──────────────────────────────────────────────────────────
  // Niche-scoring priors (ADR 0009 Task B). Operator-overridable
  // tuning knobs. NULL = fall back to the hardcoded default in the
  // agents package (geoSharePrior 0.15, cpc ceiling 12, lead-price
  // ceiling 100). Set via /operator/control so changes don't need a
  // deploy. Stored as numeric strings by Drizzle.
  // ──────────────────────────────────────────────────────────
  geoSharePrior: numeric('geo_share_prior', { precision: 4, scale: 3 }),
  rentabilityCpcCeiling: numeric('rentability_cpc_ceiling', { precision: 6, scale: 2 }),
  rentabilityLeadPriceCeiling: numeric('rentability_lead_price_ceiling', { precision: 7, scale: 2 }),
  // Scout/validate value-model knobs (migration 0043). NULL = fall back to
  // the defaults in packages/agents/src/niche-hunter/value-model.ts
  // (CTR 0.20, call rate 0.10).
  scoutCtrAtRank: numeric('scout_ctr_at_rank', { precision: 5, scale: 4 }),
  scoutCallRate: numeric('scout_call_rate', { precision: 5, scale: 4 }),
  // Ability-to-pay floor overrides (migration 0044, ADR 0021). NULL = fall
  // back to MIN_LEAD_BENCHMARK_PRICE ($50) and MIN_RENTABILITY_PRIOR (0.60)
  // in scoring-config.ts. Set via /operator/control for exploratory runs.
  scoutMinLeadPrice: numeric('scout_min_lead_price', { precision: 8, scale: 2 }),
  scoutMinRentabilityPrior: numeric('scout_min_rentability_prior', { precision: 4, scale: 3 }),
  // Operator override for MIN_WINNABILITY_FLOOR (NULL = code default).
  scoutMinWinnability: numeric('scout_min_winnability', { precision: 4, scale: 3 }),
  // Geographic-targeting + refinement knobs (migration 0045, ADR 0022). NULL =
  // fall back to the defaults in packages/agents/src/niche-hunter/
  // {value-model,scoring-config}.ts. Set via /operator/control.
  //   scoutGeoCompBlend / scoutGeoDemandBlend: α-blend strengths for the
  //     multiplicative geo competition + demand levers. NULL falls back to the
  //     code default (0.25, active) in scoring-config.ts; 0 fully disables the
  //     fold.
  //   scoutPerStateCap: per-state/metro diversity cap on the persisted set.
  //   scoutRefineTopK: top-K cells fed to the bounded local-SERP refine pass
  //     (0 = refinement off).
  //   scoutRefineBudgetUsd: in-run DataForSEO budget cap for refinement.
  //   scoutRefineMeasureVolume: also measure local volume during refinement.
  scoutGeoCompBlend: numeric('scout_geo_comp_blend', { precision: 4, scale: 3 }),
  scoutGeoDemandBlend: numeric('scout_geo_demand_blend', { precision: 4, scale: 3 }),
  scoutPerStateCap: integer('scout_per_state_cap'),
  scoutRefineTopK: integer('scout_refine_top_k'),
  scoutRefineBudgetUsd: numeric('scout_refine_budget_usd', { precision: 8, scale: 2 }),
  scoutRefineMeasureVolume: boolean('scout_refine_measure_volume'),
  // Below-top-K sampling (migration 0058, Phase 5 follow-up to ADR 0024). NULL
  // = fall back to DEFAULT_SCOUT_BELOW_TOPK_SAMPLE_COUNT (10) in
  // scoring-config.ts. 0 disables the sampling pass entirely.
  scoutBelowTopkSampleCount: integer('scout_below_topk_sample_count'),
  // Candidate diversity caps (migration 0046, ADR 0023). NULL = fall back to
  // SCOUT_MAX_PER_TRADE (8) and SCOUT_MAX_CATEGORY_SHARE (0.30) in
  // scoring-config.ts. Bound how much of a scout run any single trade /
  // category may occupy so a high-ticket category can't sweep the list.
  scoutMaxPerTrade: integer('scout_max_per_trade'),
  scoutMaxCategoryShare: numeric('scout_max_category_share', { precision: 4, scale: 3 }),
  // Approval-time diversity warning (migration 0058, Phase 5). NULL = fall
  // back to DEFAULT_APPROVE_MAX_PER_STATE_SHARE (0.40) in scoring-config.ts.
  // Non-blocking: crossing this share (or the >=3-per-trade threshold) only
  // surfaces a warning in the operator approve flow — it never blocks the
  // decision. DB-only knob (no Control-panel field yet), matching the
  // scoutMaxPerTrade / scoutMaxCategoryShare precedent above.
  approveMaxPerStateShare: numeric('approve_max_per_state_share', { precision: 4, scale: 3 }),
  // ──────────────────────────────────────────────────────────
  // Portfolio-wide daily spend ceiling (orchestrator Phase 2).
  // Enforced in BaseAgent.assertBudgetAvailable BEFORE the per-agent
  // cap, so "bring the fleet online" can't blow the budget. The
  // counter resets at the UTC-day boundary anchored on
  // global_spend_reset_at. A cap of 0 disables the ceiling.
  // ──────────────────────────────────────────────────────────
  globalDailyCostCapUsd: numeric('global_daily_cost_cap_usd', { precision: 10, scale: 2 })
    .notNull()
    .default('50'),
  globalSpentTodayUsd: numeric('global_spent_today_usd', { precision: 10, scale: 4 })
    .notNull()
    .default('0'),
  globalSpendResetAt: timestamp('global_spend_reset_at', { withTimezone: true }),
  // ──────────────────────────────────────────────────────────
  // Operator display time zone (migration 0047). IANA zone name
  // (e.g. 'America/Phoenix'). The operator dashboard renders all
  // timestamps in this zone via apps/operator/lib/format-date.ts;
  // it does NOT change cron execution (Vercel runs crons in UTC).
  // Defaults to UTC. Set via /operator/control.
  // ──────────────────────────────────────────────────────────
  operatorTimeZone: text('operator_time_zone').notNull().default('UTC'),
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
// Niche calibration feedback loop (migration 0056, Phase 2 of the Niche
// Algorithm Accuracy plan). Compares scout/validate predictions (niches.
// est_monthly_value_usd, scoutCtrAtRank/scoutCallRate priors) against
// measured outcomes so the static lead-benchmarks.ts priors can eventually
// be tuned from data instead of market intuition alone.
// ────────────────────────────────────────────────────────────

/**
 * One row per (site, ISO week) — the measured GSC-derived outcome for that
 * site's money keywords vs its overall query set. Deliberately does NOT
 * duplicate calls/leads/tenants/mrr — those already live in
 * `portfolio_snapshots` (daily, per-site) and are joined by (siteId, date)
 * at read time. This table is GSC-only.
 */
export const nicheOutcomeSnapshots = pgTable(
  'niche_outcome_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    nicheId: uuid('niche_id').references(() => niches.id, { onDelete: 'set null' }),
    /** Monday of the ISO week this snapshot summarizes (YYYY-MM-DD). */
    weekStart: text('week_start').notNull(),
    /** Weighted-avg GSC position across money-keyword rows for the week. Null if no money-keyword rows matched. */
    moneyKwPosition: numeric('money_kw_position', { precision: 6, scale: 2 }),
    /** Weighted-avg GSC position across ALL query rows for the week. */
    overallPosition: numeric('overall_position', { precision: 6, scale: 2 }),
    /** Sum of impressions across all query rows for the week. */
    impressions: integer('impressions').notNull().default(0),
    /** Sum of clicks across all query rows for the week. */
    clicks: integer('clicks').notNull().default(0),
    /** Sum of impressions across money-keyword rows only. */
    moneyKwImpressions: integer('money_kw_impressions').notNull().default(0),
    /** Sum of clicks across money-keyword rows only. */
    moneyKwClicks: integer('money_kw_clicks').notNull().default(0),
    /** moneyKwClicks / moneyKwImpressions. Null (not 0) when impressions are 0 — "no data" must never look like "0% CTR". */
    observedCtr: numeric('observed_ctr', { precision: 6, scale: 4 }),
    /** portfolio_snapshots calls (that week, summed) / moneyKwClicks. Null when moneyKwClicks is 0. */
    observedCallRate: numeric('observed_call_rate', { precision: 6, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteWeekUniq: uniqueIndex('niche_outcome_snapshots_site_week_uniq').on(t.siteId, t.weekStart),
    siteIdx: index('niche_outcome_snapshots_site_idx').on(t.siteId),
    weekIdx: index('niche_outcome_snapshots_week_idx').on(t.weekStart),
  }),
);

/**
 * Data-derived suggestions for the scout's static priors (scout_ctr_at_rank,
 * scout_call_rate). Pooled (sum of clicks/calls, not average-of-ratios) across
 * niche_outcome_snapshots, grouped at 'global' | 'trade' | 'trade_state' scope.
 *
 * ONLY scope='global' rows may be applied directly to a system_state knob —
 * see /operator/niches SuggestionsPanel + actions.applyCalibrationSuggestion,
 * which validates scope server-side regardless of what the client sent.
 * 'trade' / 'trade_state' rows are informational only, meant to guide manual
 * hand-tuning of TRADE_BENCHMARKS entries in lead-benchmarks.ts.
 */
export const calibrationSuggestions = pgTable(
  'calibration_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'global' | 'trade' | 'trade_state' */
    scope: text('scope').notNull(),
    /** Matched trade keyword (lead-benchmarks.ts). Null for scope='global'. */
    trade: text('trade'),
    /** Two-letter state code. Only set for scope='trade_state'. */
    state: text('state'),
    /** 'scout_ctr_at_rank' | 'scout_call_rate' */
    knob: text('knob').notNull(),
    suggestedValue: numeric('suggested_value', { precision: 8, scale: 4 }).notNull(),
    sampleSize: integer('sample_size').notNull(),
    /** Pooled observed value, current prior, shrinkage weight, etc — audit trail for the suggestion. */
    evidence: jsonb('evidence').notNull(),
    /** 'open' | 'applied' | 'dismissed' | 'superseded' */
    status: text('status').notNull().default('open'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique index: only one OPEN suggestion per (scope, trade, state, knob)
    // tuple at a time. The suggester marks prior open rows 'superseded' before
    // inserting a new open one for the same tuple (see niche-prior-suggester).
    openScopeTradeStateKnobUniq: uniqueIndex('calibration_suggestions_open_scope_trade_state_knob_uniq')
      .on(t.scope, t.trade, t.state, t.knob)
      .where(sql`${t.status} = 'open'`),
    scopeIdx: index('calibration_suggestions_scope_idx').on(t.scope),
    statusIdx: index('calibration_suggestions_status_idx').on(t.status),
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
 * Local-content pipeline domain table. The local-content-scout proposes one
 * row per content idea; the local-content-writer drafts + publishes it to
 * Sanity on approval. scoutRunId/writerRunId link to agent_runs.cost_usd so the
 * operator can see research-vs-writing cost per published page.
 *
 * Footprint variance: archetype + voiceSeed are assigned by the scout
 * (deterministic from siteId+week) and passed into generation so output
 * structure/voice differs across the fleet.
 */
export const contentIdeas = pgTable(
  'content_ideas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Human-readable topic, e.g. "When to schedule fall tree trimming in Tucson". */
    topic: text('topic').notNull(),
    /** URL-safe slug; the published info page renders at /pages/<topicSlug>. */
    topicSlug: text('topic_slug').notNull(),
    /** Primary long-tail keyword the page targets (must not collide with an owned cluster). */
    targetKeyword: text('target_keyword').notNull(),
    /** The "why now" angle — seasonal hook, local trend, demand gap. */
    angle: text('angle'),
    /**
     * One of: seasonal | how_to | cost_guide | comparison | local_spotlight
     * | job_story_diagnosis | job_story_second_opinion | job_story_emergency.
     * The job_story_* archetypes produce narrative use-case posts.
     */
    archetype: text('archetype').notNull(),
    /** Voice-rotation seed passed into the writer's prompt for stylistic variance. */
    voiceSeed: text('voice_seed').notNull(),
    rationale: text('rationale'),
    /**
     * Factual skeleton for job-story (use-case) archetypes, populated by the
     * scout and dramatized — without inventing technique — by the writer.
     * Null for the five non-narrative archetypes. The customer is fictional and
     * unnamed (composite/illustrative framing); rootCause/resolution must be a
     * genuine, common scenario for the niche.
     */
    storyScaffold: jsonb('story_scaffold').$type<{
      /** What the (fictional) customer first reported. */
      presentingSymptom: string;
      /** The real underlying issue discovered on site — a genuine, common cause in the niche. */
      rootCause: string;
      /** The factual fix / scope of work. */
      resolution: string;
      /** Honest "what to watch for" lesson for readers. */
      preventionTakeaway: string;
      /** Neighborhood / home-type flavor (no named person). */
      settingHint: string;
    } | null>(),
    /** pending | approved | rejected | published | auto_approved | expired */
    status: text('status').notNull().default('pending'),
    /** agent_runs.id of the scout run that produced this idea (research cost). */
    scoutRunId: uuid('scout_run_id').notNull(),
    /** agent_runs.id of the writer run that published it (writing cost); null until published. */
    writerRunId: uuid('writer_run_id'),
    /** Sanity page doc ID once published. */
    publishedPageDocId: text('published_page_doc_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    // Topic-level dedupe per site — the scout must never re-propose a slug it
    // already raised for a site (cannibalization + footprint guard).
    siteTopicUniq: uniqueIndex('content_ideas_site_topic_uniq').on(t.siteId, t.topicSlug),
    siteStatusIdx: index('content_ideas_site_status_idx').on(t.siteId, t.status),
  }),
);

export type ContentIdea = typeof contentIdeas.$inferSelect;
export type NewContentIdea = typeof contentIdeas.$inferInsert;

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
    /**
     * Verbatim source sentence (the LLM's `beforeSentence`) that site-host
     * string-matches against the rendered MDX to locate the injection point.
     */
    matchContext: text('match_context'),
    /**
     * The source sentence rewritten with the inline markdown link (the LLM's
     * `afterSentence`). site-host replaces `matchContext` with this at render.
     */
    injectedMarkdown: text('injected_markdown'),
    /** Target page kind (e.g. 'service', 'home'); null = homepage. */
    targetPageKind: text('target_page_kind'),
    /** Target page slug for deep-links; null = homepage. */
    targetPageSlug: text('target_page_slug'),
    /** SHA-256 of `matchContext` — used to detect link drift. */
    surroundingContextHash: text('surrounding_context_hash'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Last time the verifier confirmed the link renders in served HTML. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** Last time the verifier checked this link (regardless of outcome). */
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
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

/**
 * ADR 0013 — First-Party Core Web Vitals Field Data Collection.
 *
 * Pre-aggregated daily rollups, one row per (site, day, metric). The p75_approx
 * is an exponential moving average, not a true p75 — sufficient for trend
 * detection, not SLA enforcement. Variant column is the primary observability
 * axis: answers "is INP degrading on the premium template?" without joining to
 * Sanity. Retention: 90 days (DELETE WHERE metric_date < NOW() - INTERVAL '90 days').
 */
export const cwvDailyRollups = pgTable(
  'cwv_daily_rollups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD; stored as text for portability, matching seoMetricsDaily/ga4MetricsDaily convention. */
    metricDate: text('metric_date').notNull(),
    /** One of: LCP, CLS, INP, FCP, TTFB */
    metricName: text('metric_name').notNull(),
    sampleCount: integer('sample_count').notNull().default(0),
    /** Sum of raw metric values — divide by sample_count for mean. */
    valueSum: integer('value_sum').notNull().default(0),
    /** Exponential moving average approximating p75. See ADR 0013 §2. */
    p75Approx: integer('p75_approx').notNull().default(0),
    ratingGood: integer('rating_good').notNull().default(0),
    ratingNeedsImprovement: integer('rating_needs_improvement').notNull().default(0),
    ratingPoor: integer('rating_poor').notNull().default(0),
    /** Variant/theme name at collection time (classic|modern|premium|bright). Denormalised for fast group-by without Sanity join. */
    variant: text('variant').notNull().default('classic'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteMetricDateUniq: uniqueIndex('cwv_daily_rollups_site_metric_date_uniq').on(
      t.siteId,
      t.metricDate,
      t.metricName,
    ),
    siteDateIdx: index('cwv_daily_rollups_site_date_idx').on(t.siteId, t.metricDate),
    variantMetricIdx: index('cwv_daily_rollups_variant_metric_idx').on(t.variant, t.metricName),
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
export type CwvDailyRollup = typeof cwvDailyRollups.$inferSelect;
export type NewCwvDailyRollup = typeof cwvDailyRollups.$inferInsert;
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
export type NicheOutcomeSnapshot = typeof nicheOutcomeSnapshots.$inferSelect;
export type NewNicheOutcomeSnapshot = typeof nicheOutcomeSnapshots.$inferInsert;
export type CalibrationSuggestion = typeof calibrationSuggestions.$inferSelect;
export type NewCalibrationSuggestion = typeof calibrationSuggestions.$inferInsert;
export type EmailSend = typeof emailSends.$inferSelect;
export type NewEmailSend = typeof emailSends.$inferInsert;
export type PhoneProvision = typeof phoneProvisions.$inferSelect;
export type NewPhoneProvision = typeof phoneProvisions.$inferInsert;
export type Network = typeof networks.$inferSelect;
export type NewNetwork = typeof networks.$inferInsert;
export type SiteNetworkMembership = typeof siteNetworkMemberships.$inferSelect;
export type NewSiteNetworkMembership = typeof siteNetworkMemberships.$inferInsert;
export type CrossSiteLink = typeof crossSiteLinks.$inferSelect;
export type NewCrossSiteLink = typeof crossSiteLinks.$inferInsert;
export type LinkRequest = typeof linkRequests.$inferSelect;
export type NewLinkRequest = typeof linkRequests.$inferInsert;

// ────────────────────────────────────────────────────────────
// GEO / Local-SEO / Original-content auditors (Phase 3)
// ────────────────────────────────────────────────────────────

/**
 * Time-series audit-score snapshots for the three recurring auditor agents
 * (geo-aeo-auditor, local-seo-optimizer, content-data-auditor). One row per
 * review run; recommendations themselves live in `seo_recommendations`. The
 * `(siteId, auditor, auditedAt)` index drives the per-site improvement chart;
 * `(auditor, auditedAt)` drives fleet-wide trend dashboards.
 */
export const geoSeoAudits = pgTable(
  'geo_seo_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** 'geo_aeo' | 'content_data' | 'local_seo' */
    auditor: text('auditor').notNull(),
    /** agent_runs.id of the review run that produced this snapshot. No FK (house style). */
    runId: uuid('run_id'),
    /** 0-100 composite for this auditor. */
    score: numeric('score', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Auditor-specific subscores, e.g. { llmsTxtCompleteness, schemaCoverage, ... }. */
    subscores: jsonb('subscores').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** Raw evidence: failed checks, fetched JSON-LD, NAP diffs — for debugging + UI drill-down. */
    findings: jsonb('findings').$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
    /** Count of recommendations emitted this run (quick UI badge). */
    recommendationCount: integer('recommendation_count').notNull().default(0),
    /** Reserved seam for deferred live answer-engine probing; null in v1. */
    liveCitationProbe: jsonb('live_citation_probe').$type<Record<string, unknown>>(),
    auditedAt: timestamp('audited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteAuditorAuditedIdx: index('geo_seo_audits_site_auditor_audited_idx').on(
      t.siteId,
      t.auditor,
      t.auditedAt,
    ),
    auditorAuditedIdx: index('geo_seo_audits_auditor_audited_idx').on(t.auditor, t.auditedAt),
  }),
);

/**
 * Operator-captured proprietary inputs that ground non-commodity content
 * (case studies, firsthand reviews, contrarian takes). One row per site. Kept
 * in Postgres (not Sanity) so raw proprietary inputs stay off the public
 * dataset and on the agents' Postgres read path; rendered output still lands in
 * Sanity via the normal pipeline.
 */
export const siteOriginalDataInputs = pgTable(
  'site_original_data_inputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** Case-study seeds: [{ problem, solution, outcome, city, jobType, photos? }]. */
    caseStudyInputs: jsonb('case_study_inputs')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Firsthand-review seeds: [{ subject, experience, verdict, comparisons[] }]. */
    firsthandInputs: jsonb('firsthand_inputs')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Contrarian seeds: [{ claim, reasoning, evidence }]. Never auto-generated. */
    contrarianTakes: jsonb('contrarian_takes')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Free-form vouched facts (hours, certifications, equipment, guarantees). */
    proprietaryFacts: jsonb('proprietary_facts')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** E-E-A-T: who authored/vouches — drives author schema + bylines. */
    expertiseProfile: jsonb('expertise_profile').$type<Record<string, unknown>>(),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteUniq: uniqueIndex('site_original_data_inputs_site_uniq').on(t.siteId),
  }),
);

/**
 * Computed network-aggregated metric snapshots, derived from data we already
 * own (calls, DataForSEO cache, GSC). The content-data-auditor reads these as
 * citation-safe facts (with sample sizes) instead of running ad-hoc
 * aggregations at audit time. Per-site rows set `siteId`; per-niche aggregates
 * set `niche` with `siteId` null.
 */
export const siteNetworkMetrics = pgTable(
  'site_network_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    niche: text('niche'),
    /** 'call_volume' | 'job_type_mix' | 'local_pricing' | 'serp_landscape' | 'seasonality' */
    metricKind: text('metric_kind').notNull(),
    /** Computed metric body, e.g. { median, p25, p75, byMonth[] }. */
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    /** Underlying observation count — gate for "enough data to publish" (anti-fabrication). */
    sampleSize: integer('sample_size').notNull().default(0),
    /** Window the metric covers, e.g. 'last_90d'. */
    window: text('window').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteKindComputedIdx: index('site_network_metrics_site_kind_computed_idx').on(
      t.siteId,
      t.metricKind,
      t.computedAt,
    ),
    nicheKindComputedIdx: index('site_network_metrics_niche_kind_computed_idx').on(
      t.niche,
      t.metricKind,
      t.computedAt,
    ),
  }),
);

export type GeoSeoAudit = typeof geoSeoAudits.$inferSelect;
export type NewGeoSeoAudit = typeof geoSeoAudits.$inferInsert;
export type SiteOriginalDataInputs = typeof siteOriginalDataInputs.$inferSelect;
export type NewSiteOriginalDataInputs = typeof siteOriginalDataInputs.$inferInsert;
export type SiteNetworkMetric = typeof siteNetworkMetrics.$inferSelect;
export type NewSiteNetworkMetric = typeof siteNetworkMetrics.$inferInsert;

// ════════════════════════════════════════════════════════════
// Build & Sell (B&S) — spec-site business line.
//
// Deliberately ISOLATED from the Rank-and-Rent (R&R) tables above:
// NONE of the three tables below FK into `sites`, `niches`, `tenants`,
// or `invoices`. B&S brings its own lead store, its own draft-site
// table, and its own lead-capture table so the two business lines
// share no mutable surface. See docs plan "Build & Sell".
// ════════════════════════════════════════════════════════════

export const buildsellStatusEnum = pgEnum('buildsell_status', [
  'draft',
  'building',
  'invoiced',
  'paid',
  'live',
  'failed',
]);

/**
 * Ephemeral Google Places store + B&S lead source of truth.
 *
 * ToS guard: `place_id` is the ONLY field persisted indefinitely. Every
 * other column is a 30-day cache that `reapExpiredBuildSellPii()` nulls
 * once `cached_until` passes (the reaper keeps place_id/trade/city/state,
 * drops all PII). The table doubles as the 30-day Places cache: repeat
 * searches serve fresh rows; only stale/missing places hit the API.
 */
export const buildsellLeads = pgTable(
  'buildsell_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The only field persisted indefinitely (Places ToS).
    placeId: text('place_id').notNull().unique(),
    // Cache fields — nulled by the reaper past cached_until.
    displayName: text('display_name'),
    formattedAddress: text('formatted_address'),
    nationalPhone: text('national_phone'),
    primaryType: text('primary_type'),
    types: jsonb('types'),
    rating: numeric('rating', { precision: 2, scale: 1 }),
    userRatingCount: integer('user_rating_count'),
    websiteUri: text('website_uri'),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    // Search context (trade/city/state survive the reaper).
    trade: text('trade'),
    city: text('city'),
    state: text('state'),
    // ── Operator CRM fields (NOT Places-sourced → NOT nulled by the reaper) ──
    // Persisted lazily when the operator first acts on a lead while working a
    // call list. A lead with any of these set is a "saved" lead.
    called: boolean('called').notNull().default(false),
    calledAt: timestamp('called_at', { withTimezone: true }),
    note: text('note'),
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    cachedUntil: timestamp('cached_until', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cachedUntilIdx: index('buildsell_leads_cached_until_idx').on(t.cachedUntil),
    followUpIdx: index('buildsell_leads_follow_up_idx').on(t.followUpAt),
  }),
);

/**
 * The B&S draft/sold site — an independent mirror of what `sites` is for
 * R&R. `placeId` is a soft link BY VALUE to buildsell_leads, NOT a FK.
 * The full theme + content lives in the Sanity `bs-site-${id}` doc.
 */
export const buildsellSites = pgTable(
  'buildsell_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    placeId: text('place_id'),
    businessName: text('business_name').notNull(),
    trade: text('trade').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    // Set at build; powers the /buildsell/{slug} live URL.
    slug: text('slug').unique(),
    ownerEmail: text('owner_email'),
    status: buildsellStatusEnum('status').notNull().default('draft'),
    // The palette preset name chosen (e.g. "Aqua Slate"); full theme in Sanity.
    themePreset: text('theme_preset'),
    // Invoice fields — operator-driven, out-of-band payment.
    priceUsd: numeric('price_usd', { precision: 10, scale: 2 }),
    paymentLink: text('payment_link'),
    invoiceNumber: text('invoice_number').unique(),
    invoiceSentAt: timestamp('invoice_sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    liveAt: timestamp('live_at', { withTimezone: true }),
    // Dedupe anchor for the spec-site-builder agent.
    buildEpoch: text('build_epoch'),
    lastBuildError: text('last_build_error'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('buildsell_sites_status_idx').on(t.status),
  }),
);

/**
 * Draft contact-form submissions. Cannot reuse R&R `leads` (that table's
 * site_id FKs `sites` CASCADE); B&S leads FK their own buildsell_sites.
 */
export const buildsellSiteLeads = pgTable(
  'buildsell_site_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildsellSiteId: uuid('buildsell_site_id')
      .notNull()
      .references(() => buildsellSites.id, { onDelete: 'cascade' }),
    name: text('name'),
    phone: text('phone'),
    email: text('email'),
    message: text('message'),
    source: text('source').default('contact'),
    // pending | sent | skipped | failed
    forwardStatus: text('forward_status'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteCreatedIdx: index('buildsell_site_leads_site_created_idx').on(
      t.buildsellSiteId,
      t.createdAt,
    ),
  }),
);

export type BuildsellLead = typeof buildsellLeads.$inferSelect;
export type NewBuildsellLead = typeof buildsellLeads.$inferInsert;
export type BuildsellSite = typeof buildsellSites.$inferSelect;
export type NewBuildsellSite = typeof buildsellSites.$inferInsert;
export type BuildsellSiteLead = typeof buildsellSiteLeads.$inferSelect;
export type NewBuildsellSiteLead = typeof buildsellSiteLeads.$inferInsert;

/**
 * Customer self-service portal access grants.
 *
 * Maps a Neon Auth user (stored as text — no FK into neon_auth schema) to a
 * buildsell_sites row. A row with revoked_at IS NULL is an active grant.
 * Soft-revoke (set revoked_at = now()) rather than delete so the audit trail
 * is preserved. One unique grant per (auth_user_id, buildsell_site_id) pair;
 * re-granting the same user/site requires clearing or the upsert path.
 */
export const bsCustomerSiteAccess = pgTable(
  'bs_customer_site_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Neon Auth user id (UUID string). No FK into neon_auth schema. */
    authUserId: text('auth_user_id').notNull(),
    buildsellSiteId: uuid('buildsell_site_id')
      .notNull()
      .references(() => buildsellSites.id, { onDelete: 'cascade' }),
    /** 'operator' | 'auto-markpaid' */
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** null = active; set to revoke without deleting. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    authUserSiteUniq: uniqueIndex('bs_customer_site_access_user_site_uniq').on(
      t.authUserId,
      t.buildsellSiteId,
    ),
    authUserIdx: index('bs_customer_site_access_auth_user_idx').on(t.authUserId),
  }),
);

export type BsCustomerSiteAccess = typeof bsCustomerSiteAccess.$inferSelect;
export type NewBsCustomerSiteAccess = typeof bsCustomerSiteAccess.$inferInsert;
