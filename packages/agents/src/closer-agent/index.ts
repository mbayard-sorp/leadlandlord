import { z } from 'zod';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import {
  getDb,
  sites,
  prospects,
  trials,
  calls,
  agentApprovals,
  type Site,
  type Prospect,
  type Trial,
} from '@leadlandlord/db';
import {
  createCheckoutLink,
  recommendedMonthlyRent,
} from '@leadlandlord/integrations/stripe';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { startOutboundCall } from '@leadlandlord/integrations/elevenlabs';
import { BaseAgent, type AgentContext } from '../base';
import { checkAutoApprove } from '../approval-engine';

/**
 * Closer Agent — runs the end-of-trial close on a single trial:
 *   1. Aggregate trial metrics (calls, won, est revenue)
 *   2. Compute recommended monthly rent (~15% of est tenant revenue, $250–$5K)
 *   3. Generate a Stripe Checkout subscription link
 *   4. SMS the link to the prospect with context
 *   5. Place an ElevenLabs voice call to walk them through the offer
 *
 * Voice call comes AFTER SMS so the link is already in their hand when the
 * call connects. The agent's job on the call is to explain the results and
 * answer questions; the SMS link does the actual conversion.
 *
 * Outcome resolution is deferred — the trial.decision field stays 'pending'
 * until either:
 *   - Stripe webhook fires `checkout.session.completed` (decision='won')
 *   - Trial duration expires with no payment (decision='lost' via cron)
 *
 * Both wired up in Phase 6.6 (Stripe webhooks) + 6.7 (Billing & Dunning).
 */

export const CloserAgentInput = z.object({
  trial_id: z.string().uuid(),
  /** Override the recommended rent (e.g. operator manually decided $1500). */
  monthly_rent_usd_override: z.number().positive().optional(),
  /** Skip the voice call — useful for SMS-only prospects or operator-driven closes. */
  skip_voice: z.boolean().default(false),
});
export type CloserAgentInput = z.infer<typeof CloserAgentInput>;

export const CloserAgentOutput = z.object({
  trial_id: z.string().uuid(),
  outcome: z.enum(['follow_up', 'failed', 'skipped']),
  monthly_rent_usd: z.number(),
  stripe_checkout_url: z.string().url().optional(),
  voice_conversation_id: z.string().optional(),
  message: z.string().optional(),
});
export type CloserAgentOutput = z.infer<typeof CloserAgentOutput>;

export class CloserAgent extends BaseAgent<typeof CloserAgentInput, typeof CloserAgentOutput> {
  constructor() {
    super({
      name: 'closer-agent',
      inputSchema: CloserAgentInput,
      outputSchema: CloserAgentOutput,
      // One close per trial per UTC day — retries within the same day are
      // no-ops via dedupe so we don't spam the prospect.
      dedupeKeyFn: (i) => `${i.trial_id}:${new Date().toISOString().slice(0, 10)}`,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(input: CloserAgentInput, ctx: AgentContext): Promise<CloserAgentOutput> {
    const db = getDb();

    const trial = (await db.select().from(trials).where(eq(trials.id, input.trial_id)).limit(1))[0];
    if (!trial) {
      throw new Error(`trial ${input.trial_id} not found`);
    }
    const site = (await db.select().from(sites).where(eq(sites.id, trial.siteId)).limit(1))[0];
    if (!site) {
      throw new Error(`site ${trial.siteId} not found for trial ${trial.id}`);
    }
    const prospect = trial.prospectId
      ? (await db.select().from(prospects).where(eq(prospects.id, trial.prospectId)).limit(1))[0]
      : undefined;
    if (!prospect) {
      throw new Error(`trial ${trial.id} has no associated prospect`);
    }

    // 1. Compute metrics across the trial window.
    const since = trial.startedAt;
    const until = trial.endedAt ?? new Date();
    const metrics = await callMetricsForTrial(trial.siteId, since, until);
    ctx.log.info({ trialId: trial.id, ...metrics }, 'closer: metrics computed');

    // 2. Recommend a monthly rent. Tenant revenue estimate is the trial's
    //    revenue × 4.3 (avg weeks per month) when est_revenue_usd is on the
    //    calls table; falls back to a niche-based default when there's
    //    nothing to anchor on.
    const projectedMonthlyRevenue =
      metrics.est_revenue_usd > 0 ? metrics.est_revenue_usd * 4.3 : 2000;
    const monthlyRent =
      input.monthly_rent_usd_override ?? recommendedMonthlyRent(projectedMonthlyRevenue);

    // Persist the quoted rent on the trial row for audit + dashboard view.
    await db
      .update(trials)
      .set({
        quotedRentUsd: monthlyRent.toFixed(2),
        callsCount: metrics.calls_count,
        wonCount: metrics.won_count,
        estRevenueUsd: metrics.est_revenue_usd.toFixed(2),
      })
      .where(eq(trials.id, trial.id));

    // 3. Stripe Checkout link. Subscription metadata carries trial_id +
    //    site_id + prospect_id so the webhook (Phase 6.6) can wire the
    //    successful checkout back to the right rows.

    // ── Approval gate: subscription_checkout ────────────────────────────────
    // Pull the prospect score from scoringMetadata for the matcher.
    const prospectScore =
      prospect.scoringMetadata !== null &&
      typeof prospect.scoringMetadata === 'object' &&
      'score' in (prospect.scoringMetadata as Record<string, unknown>)
        ? Number((prospect.scoringMetadata as Record<string, unknown>).score)
        : 0;

    const checkoutApprovalPayload = {
      kind: 'subscription_checkout' as const,
      trial_id: trial.id,
      prospect_id: prospect.id,
      site_id: site.id,
      monthly_rent_usd: monthlyRent,
      prospect_score: prospectScore,
    };

    const existingCheckoutApproval = await db
      .select({ id: agentApprovals.id })
      .from(agentApprovals)
      .where(
        and(
          eq(agentApprovals.kind, 'subscription_checkout'),
          sql`${agentApprovals.payload}->>'trial_id' = ${trial.id}`,
          eq(agentApprovals.status, 'pending'),
        ),
      )
      .limit(1);

    if (existingCheckoutApproval.length > 0) {
      ctx.log.info(
        { trialId: trial.id, approvalId: existingCheckoutApproval[0]!.id },
        'subscription_checkout_blocked: pending approval already exists',
      );
      return {
        trial_id: trial.id,
        outcome: 'skipped',
        monthly_rent_usd: monthlyRent,
        message: `Awaiting operator approval for checkout (id: ${existingCheckoutApproval[0]!.id})`,
      };
    }

    let checkoutApprovalStatus = 'pending';
    let checkoutRuleMatched: string | undefined;
    try {
      const autoResult = await checkAutoApprove('subscription_checkout', checkoutApprovalPayload, db);
      if (autoResult.matched) {
        checkoutApprovalStatus = 'auto_approved';
        checkoutRuleMatched = autoResult.ruleId;
      }
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'closer: auto-approve check failed, defaulting to pending',
      );
    }

    const [checkoutApprovalRow] = await db
      .insert(agentApprovals)
      .values({
        agentRunId: ctx.runId,
        kind: 'subscription_checkout',
        payload: checkoutApprovalPayload as object,
        status: checkoutApprovalStatus,
        decidedBy: checkoutApprovalStatus === 'auto_approved'
          ? `auto-rule:${checkoutRuleMatched ?? 'unknown'}`
          : null,
        decidedAt: checkoutApprovalStatus === 'auto_approved' ? new Date() : null,
        ruleMatched: checkoutRuleMatched ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: agentApprovals.id });

    if (checkoutApprovalStatus !== 'auto_approved') {
      ctx.log.info(
        { trialId: trial.id, approvalId: checkoutApprovalRow!.id },
        'subscription_checkout_blocked: awaiting operator approval',
      );
      return {
        trial_id: trial.id,
        outcome: 'skipped',
        monthly_rent_usd: monthlyRent,
        message: `Awaiting operator approval for Stripe checkout (id: ${checkoutApprovalRow!.id})`,
      };
    }
    // ── End approval gate ────────────────────────────────────────────────────

    const operatorBase = (process.env.OPERATOR_PUBLIC_URL ?? 'https://leadlandlord-operator.vercel.app').replace(
      /\/$/,
      '',
    );
    const checkout = await createCheckoutLink({
      siteId: site.id,
      tenantBusinessName: prospect.businessName,
      tenantEmail: prospect.email ?? undefined,
      tenantPhone: prospect.phone ?? undefined,
      monthlyRentUsd: monthlyRent,
      productName: `${cap(site.niche)} calls in ${site.city}, ${site.state}`,
      successUrl: `${operatorBase}/operator/sites/${site.id}?checkout=success`,
      cancelUrl: `${operatorBase}/operator/sites/${site.id}?checkout=cancelled`,
      metadata: {
        trial_id: trial.id,
        prospect_id: prospect.id,
        site_id: site.id,
      },
    });
    ctx.log.info(
      { trialId: trial.id, sessionId: checkout.sessionId, monthlyRent },
      'closer: stripe checkout link created',
    );

    // 4. SMS the link with context.
    const from = process.env.TWILIO_FROM_NUMBER;
    if (from && prospect.phone) {
      const smsBody = renderSms(prospect, site, metrics, monthlyRent, checkout.url);
      try {
        await sendSms({ to: prospect.phone, from, body: smsBody });
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err, prospectId: prospect.id },
          'closer: SMS send failed (continuing to voice call)',
        );
      }
    } else {
      ctx.log.warn(
        { hasFrom: !!from, hasProspectPhone: !!prospect.phone },
        'closer: SMS skipped (missing creds or prospect phone)',
      );
    }

    // 5. Voice call via ElevenLabs Conversational AI. Best-effort —
    //    ElevenLabs creds may be missing in local dev; the SMS is the
    //    primary conversion vehicle.
    let voiceConversationId: string | undefined;
    if (!input.skip_voice && prospect.phone) {
      try {
        const res = await startOutboundCall({
          toNumber: prospect.phone,
          dynamicVariables: {
            first_name: firstNameOf(prospect.contactName),
            business_name: prospect.businessName,
            niche: site.niche,
            city: site.city,
            state: site.state,
            calls_count: String(metrics.calls_count),
            won_count: String(metrics.won_count),
            est_revenue_usd: metrics.est_revenue_usd.toFixed(0),
            monthly_rent_usd: monthlyRent.toFixed(0),
            tracking_number: site.trackingNumber ?? '',
          },
          firstMessage: `Hey ${firstNameOf(prospect.contactName)}, this is LeadLandlord — calling about your trial week of ${site.niche} calls. Got a quick minute?`,
        });
        voiceConversationId = res.conversation_id;
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err, prospectId: prospect.id },
          'closer: voice call failed (SMS still went out)',
        );
      }
    }

    return {
      trial_id: trial.id,
      outcome: 'follow_up',
      monthly_rent_usd: monthlyRent,
      stripe_checkout_url: checkout.url,
      voice_conversation_id: voiceConversationId,
      message: `Quoted $${monthlyRent.toFixed(0)}/mo for ${metrics.calls_count} calls + $${metrics.est_revenue_usd.toFixed(0)} est trial revenue. Awaiting Stripe checkout.`,
    };
  }
}

interface TrialMetrics {
  calls_count: number;
  won_count: number;
  quoted_count: number;
  lost_count: number;
  est_revenue_usd: number;
}

async function callMetricsForTrial(
  siteId: string,
  since: Date,
  until: Date,
): Promise<TrialMetrics> {
  const db = getDb();
  const rows = await db
    .select({
      classification: calls.classification,
      estRevenueUsd: calls.estRevenueUsd,
    })
    .from(calls)
    .where(
      and(
        eq(calls.siteId, siteId),
        gte(calls.startedAt, since),
        lte(calls.startedAt, until),
      ),
    );

  let won = 0;
  let quoted = 0;
  let lost = 0;
  let revenue = 0;
  for (const r of rows) {
    if (r.classification === 'won') won++;
    else if (r.classification === 'quoted') quoted++;
    else if (r.classification === 'lost') lost++;
    if (r.estRevenueUsd) revenue += Number.parseFloat(r.estRevenueUsd);
  }
  return {
    calls_count: rows.length,
    won_count: won,
    quoted_count: quoted,
    lost_count: lost,
    est_revenue_usd: Number.isFinite(revenue) ? revenue : 0,
  };
}

function renderSms(
  prospect: Prospect,
  site: Site,
  metrics: TrialMetrics,
  monthlyRent: number,
  checkoutUrl: string,
): string {
  const firstName = firstNameOf(prospect.contactName);
  if (metrics.calls_count === 0) {
    return `Hey ${firstName}, your trial week of ${site.niche} calls in ${site.city} just wrapped — quiet week unfortunately. If you want to give it another go for $${monthlyRent.toFixed(0)}/mo: ${checkoutUrl}. Reply STOP to opt out.`;
  }
  return [
    `Hey ${firstName}, your trial week of ${site.niche} calls in ${site.city} just wrapped:`,
    `- ${metrics.calls_count} calls received${metrics.won_count > 0 ? ` (${metrics.won_count} booked)` : ''}`,
    metrics.est_revenue_usd > 0 ? `- ~$${metrics.est_revenue_usd.toFixed(0)} estimated trial value` : '',
    `Want to keep the calls coming? $${monthlyRent.toFixed(0)}/mo — set up here:`,
    checkoutUrl,
    '',
    'Reply STOP to opt out.',
  ]
    .filter(Boolean)
    .join('\n');
}

function firstNameOf(full: string | null | undefined): string {
  if (!full) return 'there';
  return full.trim().split(/\s+/)[0] ?? 'there';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Suppress unused — Trial type kept for future queries that filter by status.
const _unused: Trial | undefined = undefined;
void _unused;
