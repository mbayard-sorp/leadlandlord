/**
 * default-approval-rules.ts
 *
 * Seed objects for the `auto_approve_rules` table covering the 6 new
 * approval kinds introduced in Sprint 6 Phase 2.
 *
 * OPERATOR SEED USE ONLY — do NOT import these in application code.
 * Insert via the operator dashboard or a one-off script:
 *
 *   import { defaultApprovalRules } from '@leadlandlord/agents/default-approval-rules';
 *   await db.insert(autoApproveRules).values(defaultApprovalRules);
 *
 * These are NOT applied via drizzle-kit migrations.  Operator seeds manually.
 *
 * Matcher predicates use the same engine as approval-engine.ts:
 *   { $gte: number }, { $lte: number }, { $eq: value }, { $includes: string }
 * Dot-notation keys resolve nested payload paths.
 */

export interface SeedRule {
  kind: string;
  matcher: Record<string, unknown>;
  createdBy: string;
  active: boolean;
  description: string;
}

export const defaultApprovalRules: SeedRule[] = [
  // ── prospect_outreach_send ────────────────────────────────────────────────
  {
    kind: 'prospect_outreach_send',
    matcher: {
      channel: { $eq: 'sms' },
      est_cost_usd: { $lte: 0.5 },
    },
    createdBy: 'seed:sprint-6-phase-2',
    active: true,
    description: 'Auto-approve SMS outreach where estimated cost <= $0.50',
  },
  {
    kind: 'prospect_outreach_send',
    matcher: {
      channel: { $eq: 'email' },
    },
    createdBy: 'seed:sprint-6-phase-2',
    active: true,
    description: 'Auto-approve email outreach (no per-send cost)',
  },

  // ── subscription_checkout ─────────────────────────────────────────────────
  {
    kind: 'subscription_checkout',
    matcher: {
      prospect_score: { $gte: 80 },
    },
    createdBy: 'seed:sprint-6-phase-2',
    active: true,
    description: 'Auto-approve Stripe checkout for scored-A prospects (score >= 80)',
  },

  // ── prospect_promote_to_trial ─────────────────────────────────────────────
  {
    kind: 'prospect_promote_to_trial',
    matcher: {
      prospect_score: { $gte: 70 },
    },
    createdBy: 'seed:sprint-6-phase-2',
    active: true,
    description: 'Auto-approve trial promotion for prospects with score >= 70',
  },

  // ── dunning_action ────────────────────────────────────────────────────────
  // retry is low-risk — let it run automatically.
  {
    kind: 'dunning_action',
    matcher: {
      action: { $eq: 'retry' },
    },
    createdBy: 'seed:sprint-6-phase-2',
    active: true,
    description: 'Auto-approve dunning retry actions',
  },
  // cancel requires manual review — intentionally NO auto-approve rule.

  // ── churn_winback ─────────────────────────────────────────────────────────
  // Always manual — no default auto-approve rule.

  // ── trial_provisioning ────────────────────────────────────────────────────
  // Always manual — no default auto-approve rule.
];
