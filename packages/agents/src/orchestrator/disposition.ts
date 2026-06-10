/**
 * The agreed fleet disposition (orchestrator Phase 4, plan Appendix A).
 *
 * SOURCE OF TRUTH for ON/OFF is agent_budgets.enabled; this map is the
 * human-authored intent the seed script (scripts/seed-fleet-disposition.ts)
 * writes there, plus conservative starting daily caps. Cadence lives in
 * agent_schedules (seeded in Phase 3). Tune caps from the digest afterward.
 *
 * "armed" = enabled but only fires on a human-initiated event (niche approval,
 * a build) — never on a timer. These agents have no scheduler row, so being
 * enabled does not put them on a cadence.
 */

export interface AgentDisposition {
  enabled: boolean;
  dailyCapUsd: number;
  /** Enabled but event/manual-only (never scheduled). */
  armed?: boolean;
  note?: string;
}

/** Cap left on a disabled agent's row so re-enabling it later has a sane default. */
export const DISABLED_DEFAULT_CAP_USD = 5;

/** Recommended starting portfolio-wide daily ceiling; tune via fleet-config. */
export const GLOBAL_DAILY_COST_CAP_START_USD = 40;

const ON = (dailyCapUsd: number): AgentDisposition => ({ enabled: true, dailyCapUsd });
const ARMED = (dailyCapUsd: number): AgentDisposition => ({ enabled: true, dailyCapUsd, armed: true });
const OFF = (note: string): AgentDisposition => ({
  enabled: false,
  dailyCapUsd: DISABLED_DEFAULT_CAP_USD,
  note,
});

/**
 * Keyed by registry kind, plus the two not-yet-built agents (fleet-digest,
 * orchestrator) and the two deferred stubs. The seed enumerates the live
 * registry and the registry wins on any mismatch.
 */
export const FLEET_DISPOSITION: Record<string, AgentDisposition> = {
  // ── Owned-asset, ON (no outbound email to third parties) ──
  'content-engine': ON(8),
  'keyword-planner': ON(4),
  'seo-operator': ON(4),
  'seo-ingest-gsc': ON(2),
  'seo-ingest-ga4': ON(2),
  'lighthouse-audit': ON(2),
  'geo-aeo-auditor': ON(3),
  'local-seo-optimizer': ON(3),
  'content-data-auditor': ON(3),
  'local-content-scout': ON(3),
  'local-content-writer': ON(5),
  'network-linker': ON(3),
  'indexnow-submitter': ON(1),
  'network-metrics-aggregator': ON(2),
  'competitor-analyzer': ON(4),
  'portfolio-analyst': ON(3),
  maintenance: ON(2),
  'compliance-guard': ON(2),
  'call-classifier': ON(2),
  operator: ON(2),
  'fleet-digest': ON(1), // Phase 5
  orchestrator: ON(5), // Phase 6

  // ── Armed: enabled but fires only on a human-initiated event ──
  'niche-hunter': ARMED(5), // proposes -> Mike approves; never auto
  'site-builder': ARMED(10), // fires only on niche.approved
  'domain-procurer': ARMED(3),
  'tracking-setup': ARMED(3),

  // ── Disabled until tenants exist / workstream paused / deferred ──
  'tenant-prospector': OFF('until tenants; Apollo/Places creds'),
  'outreach-agent': OFF('until tenants; sends real email'),
  'trial-manager': OFF('until trials exist'),
  'closer-agent': OFF('until trials exist'),
  'billing-dunning': OFF('until paying tenants; Stripe'),
  'churn-recovery': OFF('until paying tenants'),
  'molly': ON(5), // guest-post outreach; all sends human-gated
  'molly-scorer': ON(1), // pilot revival 2026-06
  'molly-digest': OFF('superseded by fleet-digest'),
  'molly-inbox': ON(2), // pilot revival 2026-06
  'molly-copywriter': ON(5), // pilot revival 2026-06
  'wave-launcher': OFF('skips backlinks; revisit later'),
  'backlink-copycat': OFF('deferred — not built'),
  'citation-runner': ON(1), // citations v1
};

export interface DispositionSummary {
  /** Enabled + scheduled (owned-asset + operator/digest/orchestrator). */
  enabled: string[];
  /** Enabled but event/manual-only. */
  armed: string[];
  disabled: string[];
}

export function summarizeDisposition(
  d: Record<string, AgentDisposition> = FLEET_DISPOSITION,
): DispositionSummary {
  const enabled: string[] = [];
  const armed: string[] = [];
  const disabled: string[] = [];
  for (const [agent, v] of Object.entries(d)) {
    if (!v.enabled) disabled.push(agent);
    else if (v.armed) armed.push(agent);
    else enabled.push(agent);
  }
  return { enabled, armed, disabled };
}
