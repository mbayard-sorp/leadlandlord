/**
 * Fleet census logic (orchestrator Phase 1).
 *
 * Pure, side-effect-free functions that classify each agent's health from
 * (a) a static map of the external-credential env vars it needs and (b) its
 * recent agent_runs history. scripts/agent-audit.ts wires process.env + the
 * DB into these and writes the result to agent_health.
 *
 * Deliberately STATIC: the audit never executes an agent, so it can never
 * send an email, provision a phone number, or charge a card. Credential gaps
 * are detected by env presence, not by attempting a live call.
 */

export type AgentHealthAuditStatus =
  | 'pass'
  | 'fail'
  | 'needs_creds'
  | 'not_implemented'
  | 'skipped';

/**
 * Per-agent external-credential requirements. Each entry is a GROUP of
 * acceptable alternatives (any-of): the requirement is satisfied if ANY var in
 * the group is present. `ANTHROPIC_API_KEY` is treated as always-available
 * (MOCK_AI bypasses it), so Anthropic-only "owned-asset" agents list `[]`.
 *
 * Keys MUST stay in sync with the registry (asserted in the tests).
 */
export const AGENT_REQUIRED_ENV: Record<string, string[][]> = {
  'site-builder': [], // Imagen + Klaviyo are optional/skipped when unset.
  'content-engine': [], // Anthropic-only.
  'tracking-setup': [['TWILIO_ACCOUNT_SID'], ['TWILIO_AUTH_TOKEN']],
  'niche-scout': [['DATAFORSEO_AUTH']],
  'niche-validator': [['DATAFORSEO_AUTH']],
  'niche-keyword-refresher': [['DATAFORSEO_AUTH']],
  'keyword-planner': [['DATAFORSEO_AUTH']],
  'domain-procurer': [
    ['NAMECHEAP_API_USER'],
    ['NAMECHEAP_API_KEY'],
    ['NAMECHEAP_CLIENT_IP'],
    ['VERCEL_TOKEN'],
  ],
  'seo-operator': [], // Anthropic-only.
  'seo-ingest-gsc': [['GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH']],
  'seo-ingest-ga4': [['GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH']],
  'lighthouse-audit': [], // PageSpeed works keyless; PAGESPEED_API_KEY optional.
  'tenant-prospector': [['GOOGLE_PLACES_API_KEY'], ['APOLLO_API_KEY']],
  'outreach-agent': [
    ['TWILIO_ACCOUNT_SID'],
    ['TWILIO_AUTH_TOKEN'],
    ['TWILIO_FROM_NUMBER'],
    ['RESEND_API_KEY', 'ZOHO_MCP_URL'],
    ['RESEND_FROM_ADDRESS', 'ZOHO_DEFAULT_FROM'],
  ],
  'trial-manager': [['TWILIO_ACCOUNT_SID'], ['TWILIO_AUTH_TOKEN'], ['TWILIO_FROM_NUMBER']],
  'closer-agent': [['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_TEST']],
  'billing-dunning': [
    ['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_TEST'],
    ['RESEND_API_KEY'],
    ['RESEND_FROM_ADDRESS'],
  ],
  'churn-recovery': [], // DB + queueing; prospect top-up is best-effort.
  'portfolio-analyst': [], // Digest delivery is opt-in; analysis needs no cred.
  maintenance: [['VERCEL_TOKEN']],
  'compliance-guard': [], // Rules + Anthropic.
  'call-classifier': [], // Anthropic-only.
  operator: [], // Owned-asset orchestration; DB only.
  'molly': [['ZOHO_MCP_URL'], ['ZOHO_ACCOUNT_ID']], // guest-post outreach; Zoho optional (ZOHO_MOLLY_ENABLED gate).
  'molly-scorer': [], // Firecrawl receptivity scrape is best-effort.
  'molly-digest': [['RESEND_API_KEY', 'ZOHO_MCP_URL'], ['RESEND_FROM_ADDRESS', 'ZOHO_MOLLY_FROM']],
  'molly-inbox': [['ZOHO_MCP_URL'], ['ZOHO_ACCOUNT_ID']],
  'molly-copywriter': [], // Anthropic + best-effort Firecrawl.
  'network-linker': [], // Anthropic + Sanity (owned).
  'wave-launcher': [['GOOGLE_SERVICE_ACCOUNT_KEY_JSON', 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH']],
  'local-content-scout': [['DATAFORSEO_AUTH']],
  'local-content-writer': [], // Anthropic + Sanity (owned).
  'indexnow-submitter': [], // Per-site key, not an env secret.
  'competitor-analyzer': [['SEMRUSH_API_KEY']],
  'geo-aeo-auditor': [], // Owned-asset; inspects our own markup.
  'local-seo-optimizer': [], // Owned-asset.
  'network-metrics-aggregator': [], // Owned-asset DB aggregation.
  'content-data-auditor': [], // Owned-asset content audit.
  // Internal status email to the operator (not third-party outreach).
  'fleet-digest': [['ZOHO_MCP_URL'], ['ZOHO_ACCOUNT_ID'], ['FLEET_DIGEST_TO', 'OPERATOR_EMAIL']],
  // FIRECRAWL_API_KEY is optional: NAP verification is skipped (not errored) when absent.
  'citation-runner': [],
  // Build & Sell spec-site builder. Imagen is used when available; falls back to no hero image.
  'spec-site-builder': [],
  // Build & Sell content migrator. FIRECRAWL_API_KEY is required — the crawl
  // hard-fails without it (Anthropic vision uses the fleet-wide ANTHROPIC_API_KEY).
  'content-migrator': [['FIRECRAWL_API_KEY']],
  // Build & Sell monthly review refresh. Places Details fetch needs the key.
  'buildsell-review-refresh': [['GOOGLE_PLACES_API_KEY']],
};

/**
 * Agents referenced in the codebase but never built (only TODO stubs). They
 * are NOT in the registry, so the audit adds them explicitly as
 * `not_implemented` for visibility. See orchestrator plan §1.1.
 */
export const DEFERRED_STUBS: readonly string[] = ['backlink-copycat'];

const FAILURE_STATUSES = new Set(['failed', 'budget_exceeded', 'not_implemented']);
const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'budget_exceeded',
  'not_implemented',
]);

export interface RunRecord {
  agent: string;
  status: string;
  startedAt: Date | null;
  error: string | null;
}

export interface AgentRunHistory {
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface AgentHealthRow {
  agent: string;
  auditStatus: AgentHealthAuditStatus;
  lastAuditAt: Date;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  requiredEnv: string[];
  notes: string | null;
  updatedAt: Date;
}

function envPresent(env: Record<string, string | undefined>, name: string): boolean {
  const v = env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

const EMPTY_HISTORY: AgentRunHistory = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  lastError: null,
};

/**
 * Fold a list of agent_runs rows (ordered NEWEST first) into per-agent
 * history. consecutiveFailures = number of leading terminal failures before
 * the most recent success. In-flight (pending/running) rows are ignored for
 * the streak but still count toward lastRunAt.
 */
export function summarizeRunHistory(runsNewestFirst: RunRecord[]): Record<string, AgentRunHistory> {
  const out: Record<string, AgentRunHistory> = {};
  const streakOpen = new Set<string>();
  for (const r of runsNewestFirst) {
    let h = out[r.agent];
    if (!h) {
      h = { ...EMPTY_HISTORY };
      out[r.agent] = h;
      streakOpen.add(r.agent);
    }
    if (!h.lastRunAt) h.lastRunAt = r.startedAt;
    if (r.status === 'succeeded' && !h.lastSuccessAt) h.lastSuccessAt = r.startedAt;
    if (FAILURE_STATUSES.has(r.status) && !h.lastFailureAt) {
      h.lastFailureAt = r.startedAt;
      if (!h.lastError) h.lastError = r.error;
    }
    if (streakOpen.has(r.agent) && TERMINAL_STATUSES.has(r.status)) {
      if (FAILURE_STATUSES.has(r.status)) h.consecutiveFailures += 1;
      else streakOpen.delete(r.agent); // a success closes the streak
    }
  }
  return out;
}

export interface BuildAuditRowsOptions {
  registryKeys: string[];
  env: Record<string, string | undefined>;
  history?: Record<string, AgentRunHistory>;
  now: Date;
  deferredStubs?: readonly string[];
  requirements?: Record<string, string[][]>;
}

/**
 * Build one agent_health row per registry key, plus one per deferred stub.
 * Status is derived purely from env presence (+ the not_implemented stubs);
 * no agent is executed.
 */
export function buildAuditRows(opts: BuildAuditRowsOptions): AgentHealthRow[] {
  const requirements = opts.requirements ?? AGENT_REQUIRED_ENV;
  const stubs = opts.deferredStubs ?? DEFERRED_STUBS;
  const history = opts.history ?? {};
  const rows: AgentHealthRow[] = [];

  for (const agent of opts.registryKeys) {
    const groups = requirements[agent] ?? [];
    const missing = groups.filter((group) => !group.some((name) => envPresent(opts.env, name)));
    const requiredEnv = groups.flatMap((group) => (group[0] ? [group[0]] : []));
    const h = history[agent] ?? EMPTY_HISTORY;
    rows.push({
      agent,
      auditStatus: missing.length > 0 ? 'needs_creds' : 'pass',
      lastAuditAt: opts.now,
      lastRunAt: h.lastRunAt,
      lastSuccessAt: h.lastSuccessAt,
      lastFailureAt: h.lastFailureAt,
      consecutiveFailures: h.consecutiveFailures,
      lastError: h.lastError,
      requiredEnv,
      notes:
        missing.length > 0
          ? `missing creds: ${missing.map((group) => group.join('|')).join(', ')}`
          : null,
      updatedAt: opts.now,
    });
  }

  for (const agent of stubs) {
    const h = history[agent] ?? EMPTY_HISTORY;
    rows.push({
      agent,
      auditStatus: 'not_implemented',
      lastAuditAt: opts.now,
      lastRunAt: h.lastRunAt,
      lastSuccessAt: h.lastSuccessAt,
      lastFailureAt: h.lastFailureAt,
      consecutiveFailures: h.consecutiveFailures,
      lastError: h.lastError,
      requiredEnv: [],
      notes: 'deferred — referenced in code but never built',
      updatedAt: opts.now,
    });
  }

  return rows;
}

export interface AuditSummary {
  total: number;
  byStatus: Record<AgentHealthAuditStatus, number>;
  lines: string[];
}

/** One-line-per-agent report + status tallies, for the audit script's stdout. */
export function summarizeAudit(rows: AgentHealthRow[]): AuditSummary {
  const byStatus: Record<AgentHealthAuditStatus, number> = {
    pass: 0,
    fail: 0,
    needs_creds: 0,
    not_implemented: 0,
    skipped: 0,
  };
  const lines: string[] = [];
  for (const row of rows) {
    byStatus[row.auditStatus] += 1;
    const cf = row.consecutiveFailures > 0 ? ` consec_fail=${row.consecutiveFailures}` : '';
    const detail = row.notes ? ` — ${row.notes}` : '';
    lines.push(`  ${row.auditStatus.padEnd(16)} ${row.agent}${cf}${detail}`);
  }
  return { total: rows.length, byStatus, lines };
}
