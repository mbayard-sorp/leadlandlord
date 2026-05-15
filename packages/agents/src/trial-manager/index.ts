import { z } from 'zod';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import {
  getDb,
  sites,
  prospects,
  trials,
  calls,
  agentApprovals,
  type Trial,
  type Site,
  type Prospect,
} from '@leadlandlord/db';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { BaseAgent, type AgentContext } from '../base';
import { checkAutoApprove } from '../approval-engine';

/**
 * Trial Manager — orchestrates the trial-week cycle for a single site:
 *
 *   start        → flip site.forwardingNumber to the prospect's phone, create
 *                  trials row, set started_at = now. Inbound voice webhook
 *                  already reads forwardingNumber per-call so no Twilio API
 *                  call is strictly required, but we update it here to keep
 *                  tenant numbers fresh in the dashboard.
 *
 *   send_digest  → SMS the prospect a snapshot of today's calls + classifications
 *                  ("3 calls today, 1 booked, 2 quoted"). Operator gets a copy too.
 *
 *   end          → close the trials row, restore forwarding to the operator's
 *                  number, set decision based on call outcomes (pending if
 *                  manual review needed), and emit trial.ended event so
 *                  Closer Agent can pick up.
 *
 * No `route_call` or `classify_call` — those are handled inline by the
 * Twilio webhooks (apps/operator/app/api/webhooks/twilio/{voice,transcription})
 * which read site.forwardingNumber + run CallClassifier directly. Keeping
 * Trial Manager focused on the start/digest/end lifecycle.
 */

export const TrialManagerInput = z.object({
  action: z.enum(['start', 'send_digest', 'end']),
  /** trial_id — required for send_digest + end. */
  trial_id: z.string().uuid().optional(),
  /** Required for `start`: which prospect just accepted. */
  prospect_id: z.string().uuid().optional(),
  /** Optional override: trial duration in days. Defaults to 7. */
  duration_days: z.number().int().min(1).max(30).default(7),
});
export type TrialManagerInput = z.infer<typeof TrialManagerInput>;

export const TrialManagerOutput = z.object({
  trial_id: z.string().uuid(),
  action: z.enum(['start', 'send_digest', 'end']),
  ok: z.boolean(),
  message: z.string().optional(),
  metrics: z
    .object({
      calls_count: z.number().int().nonnegative().default(0),
      won_count: z.number().int().nonnegative().default(0),
      quoted_count: z.number().int().nonnegative().default(0),
      lost_count: z.number().int().nonnegative().default(0),
      est_revenue_usd: z.number().nonnegative().default(0),
    })
    .optional(),
});
export type TrialManagerOutput = z.infer<typeof TrialManagerOutput>;

export class TrialManager extends BaseAgent<typeof TrialManagerInput, typeof TrialManagerOutput> {
  constructor() {
    super({
      name: 'trial-manager',
      inputSchema: TrialManagerInput,
      outputSchema: TrialManagerOutput,
      // 'start' deduped by prospect_id (one trial per prospect per minute)
      // 'end' deduped by trial_id+date (idempotent end-of-day cron)
      // 'send_digest' deduped by trial_id+date (one digest per day)
      dedupeKeyFn: (i) => {
        const today = new Date().toISOString().slice(0, 10);
        if (i.action === 'start') return `start:${i.prospect_id}:${today}`;
        return `${i.action}:${i.trial_id}:${today}`;
      },
      defaultDailyCapUsd: 2,
    });
  }

  protected async execute(
    input: TrialManagerInput,
    ctx: AgentContext,
  ): Promise<TrialManagerOutput> {
    switch (input.action) {
      case 'start':
        return this.startTrial(input, ctx);
      case 'send_digest':
        return this.sendDigest(input, ctx);
      case 'end':
        return this.endTrial(input, ctx);
    }
  }

  /**
   * Spin up a trial: create the trials row, flip forwarding to the prospect.
   *
   * The Twilio voice webhook (`/api/webhooks/twilio/voice`) reads
   * `sites.forwarding_number` per-call, so updating that field is enough —
   * no Twilio API call required. Future: also call updateNumber to refresh
   * the VoiceUrl + statusCallback in case the operator URL changed.
   */
  private async startTrial(
    input: TrialManagerInput,
    ctx: AgentContext,
  ): Promise<TrialManagerOutput> {
    if (!input.prospect_id) {
      return missingTrialId(input, "start requires 'prospect_id'");
    }
    const db = getDb();

    const prospect = (
      await db.select().from(prospects).where(eq(prospects.id, input.prospect_id)).limit(1)
    )[0];
    if (!prospect) {
      return { trial_id: input.prospect_id, action: 'start', ok: false, message: 'prospect not found' };
    }
    if (!prospect.phone) {
      return {
        trial_id: input.prospect_id,
        action: 'start',
        ok: false,
        message: 'prospect has no phone — cannot forward calls',
      };
    }

    const site = (await db.select().from(sites).where(eq(sites.id, prospect.siteId)).limit(1))[0];
    if (!site) {
      return {
        trial_id: input.prospect_id,
        action: 'start',
        ok: false,
        message: 'site not found',
      };
    }

    // ── Approval gate: trial_provisioning ───────────────────────────────────
    // Idempotency: if a pending approval already exists for this prospect_id,
    // return without re-queuing.
    const approvalPayload = {
      kind: 'trial_provisioning' as const,
      prospect_id: prospect.id,
      site_id: site.id,
      forwarding_to: prospect.phone,
      duration_days: input.duration_days,
    };

    const existingProvisionApproval = await db
      .select({ id: agentApprovals.id })
      .from(agentApprovals)
      .where(
        and(
          eq(agentApprovals.kind, 'trial_provisioning'),
          sql`${agentApprovals.payload}->>'prospect_id' = ${prospect.id}`,
          eq(agentApprovals.status, 'pending'),
        ),
      )
      .limit(1);

    if (existingProvisionApproval.length > 0) {
      ctx.log.info(
        { prospectId: prospect.id, approvalId: existingProvisionApproval[0]!.id },
        'trial_provisioning_blocked: pending approval already exists',
      );
      return {
        trial_id: prospect.id,
        action: 'start',
        ok: false,
        message: `Awaiting operator approval for trial provisioning (id: ${existingProvisionApproval[0]!.id})`,
      };
    }

    let provisionApprovalStatus = 'pending';
    let provisionRuleMatched: string | undefined;
    try {
      const autoResult = await checkAutoApprove('trial_provisioning', approvalPayload, db);
      if (autoResult.matched) {
        provisionApprovalStatus = 'auto_approved';
        provisionRuleMatched = autoResult.ruleId;
      }
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'trial-manager: auto-approve check failed, defaulting to pending',
      );
    }

    const [provisionApprovalRow] = await db
      .insert(agentApprovals)
      .values({
        agentRunId: ctx.runId,
        kind: 'trial_provisioning',
        payload: approvalPayload as object,
        status: provisionApprovalStatus,
        decidedBy: provisionApprovalStatus === 'auto_approved'
          ? `auto-rule:${provisionRuleMatched ?? 'unknown'}`
          : null,
        decidedAt: provisionApprovalStatus === 'auto_approved' ? new Date() : null,
        ruleMatched: provisionRuleMatched ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: agentApprovals.id });

    if (provisionApprovalStatus !== 'auto_approved') {
      ctx.log.info(
        { prospectId: prospect.id, approvalId: provisionApprovalRow!.id },
        'trial_provisioning_blocked: awaiting operator approval',
      );
      return {
        trial_id: prospect.id,
        action: 'start',
        ok: false,
        message: `Awaiting operator approval for trial provisioning (id: ${provisionApprovalRow!.id})`,
      };
    }
    // ── End approval gate ────────────────────────────────────────────────────

    // Flip forwarding to the prospect's phone for the trial week.
    await db
      .update(sites)
      .set({
        forwardingNumber: prospect.phone,
        recordingEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id));

    // Move prospect to accepted_trial.
    await db.update(prospects).set({ status: 'accepted_trial' }).where(eq(prospects.id, prospect.id));

    // Create the trial row.
    const [created] = await db
      .insert(trials)
      .values({
        siteId: site.id,
        prospectId: prospect.id,
        startedAt: new Date(),
        decision: 'pending',
      })
      .returning();
    if (!created) {
      return {
        trial_id: input.prospect_id,
        action: 'start',
        ok: false,
        message: 'trials row insert returned nothing',
      };
    }

    ctx.log.info(
      {
        trialId: created.id,
        siteId: site.id,
        prospectId: prospect.id,
        forwardingNumber: prospect.phone,
      },
      'trial started — forwarding flipped',
    );

    // Welcome SMS to the prospect.
    await this.welcomeProspect(prospect, site, input.duration_days, ctx);

    return {
      trial_id: created.id,
      action: 'start',
      ok: true,
      message: `Trial started for ${prospect.businessName}; forwarding ${site.trackingNumber} → ${prospect.phone} for ${input.duration_days} days`,
    };
  }

  /**
   * Daily digest SMS to the prospect: how many calls came in, classification
   * breakdown, est. revenue. Operator gets a copy via OPERATOR_PHONE_NUMBER.
   */
  private async sendDigest(
    input: TrialManagerInput,
    ctx: AgentContext,
  ): Promise<TrialManagerOutput> {
    if (!input.trial_id) return missingTrialId(input, "send_digest requires 'trial_id'");
    const db = getDb();
    const trial = (await db.select().from(trials).where(eq(trials.id, input.trial_id)).limit(1))[0];
    if (!trial) {
      return { trial_id: input.trial_id, action: 'send_digest', ok: false, message: 'trial not found' };
    }
    const prospect = trial.prospectId
      ? (await db.select().from(prospects).where(eq(prospects.id, trial.prospectId)).limit(1))[0]
      : undefined;
    const site = (await db.select().from(sites).where(eq(sites.id, trial.siteId)).limit(1))[0];
    if (!site) {
      return {
        trial_id: trial.id,
        action: 'send_digest',
        ok: false,
        message: 'site not found',
      };
    }

    const since = startOfTodayUtc();
    const metrics = await callMetrics(trial.siteId, since, new Date());

    const message = renderDigest(site, metrics);

    const from = process.env.TWILIO_FROM_NUMBER;
    let sent = false;
    if (from && prospect?.phone) {
      try {
        await sendSms({ to: prospect.phone, from, body: message });
        sent = true;
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err, prospectId: prospect.id },
          'digest SMS to prospect failed',
        );
      }
    }
    if (from && process.env.OPERATOR_PHONE_NUMBER) {
      try {
        await sendSms({
          to: process.env.OPERATOR_PHONE_NUMBER,
          from,
          body: `[copy] ${message}`,
        });
      } catch {
        // operator copy is best-effort
      }
    }

    ctx.log.info(
      { trialId: trial.id, ...metrics, sent },
      'digest dispatched',
    );

    return {
      trial_id: trial.id,
      action: 'send_digest',
      ok: true,
      message: sent ? `Digest sent to ${prospect?.phone ?? '(no recipient)'}` : 'Digest skipped (missing creds)',
      metrics,
    };
  }

  /**
   * Close out the trial — restore forwarding to operator phone, mark the
   * trials row as ended, and snapshot the metrics so Closer Agent can pick
   * up the conversation with real numbers.
   *
   * Decision is left as 'pending' here — Closer Agent's job to set it after
   * the close call. Setting it to 'won' or 'lost' early would prematurely
   * lock in the outcome.
   */
  private async endTrial(input: TrialManagerInput, ctx: AgentContext): Promise<TrialManagerOutput> {
    if (!input.trial_id) return missingTrialId(input, "end requires 'trial_id'");
    const db = getDb();
    const trial = (await db.select().from(trials).where(eq(trials.id, input.trial_id)).limit(1))[0];
    if (!trial) {
      return { trial_id: input.trial_id, action: 'end', ok: false, message: 'trial not found' };
    }
    if (trial.endedAt) {
      return {
        trial_id: trial.id,
        action: 'end',
        ok: true,
        message: 'trial already ended',
      };
    }

    const site = (await db.select().from(sites).where(eq(sites.id, trial.siteId)).limit(1))[0];
    if (!site) {
      return { trial_id: trial.id, action: 'end', ok: false, message: 'site not found' };
    }

    const metrics = await callMetrics(trial.siteId, trial.startedAt, new Date());

    // Restore forwarding to the operator phone so calls don't keep going to
    // a non-paying tenant. If no OPERATOR_PHONE_NUMBER is set, leave the
    // field as-is and let the operator clean up manually.
    const operatorPhone = process.env.OPERATOR_PHONE_NUMBER;
    if (operatorPhone) {
      await db
        .update(sites)
        .set({ forwardingNumber: operatorPhone, updatedAt: new Date() })
        .where(eq(sites.id, site.id));
    }

    await db
      .update(trials)
      .set({
        endedAt: new Date(),
        callsCount: metrics.calls_count,
        wonCount: metrics.won_count,
        estRevenueUsd: metrics.est_revenue_usd.toFixed(2),
      })
      .where(eq(trials.id, trial.id));

    ctx.log.info(
      { trialId: trial.id, siteId: site.id, ...metrics },
      'trial ended — forwarding restored',
    );

    return {
      trial_id: trial.id,
      action: 'end',
      ok: true,
      message: `Trial ended; ${metrics.calls_count} calls, ${metrics.won_count} won, est $${metrics.est_revenue_usd.toFixed(2)}`,
      metrics,
    };
  }

  private async welcomeProspect(
    prospect: Prospect,
    site: Site,
    durationDays: number,
    ctx: AgentContext,
  ): Promise<void> {
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!from || !prospect.phone) return;
    const body = `Welcome ${firstNameOf(prospect.contactName)} — your free week of ${site.niche} calls in ${site.city} starts now. Calls to ${site.trackingNumber ?? 'our number'} will forward to ${prospect.phone} for the next ${durationDays} days. We'll text a daily summary. Reply STOP to opt out.`;
    try {
      await sendSms({ to: prospect.phone, from, body });
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err, prospectId: prospect.id },
        'welcome SMS failed (trial still started)',
      );
    }
  }
}

interface TrialMetrics {
  calls_count: number;
  won_count: number;
  quoted_count: number;
  lost_count: number;
  est_revenue_usd: number;
}

/**
 * Aggregate call metrics for a site over a time window. Uses the calls
 * table's classification + estRevenueUsd which CallClassifier populates.
 */
async function callMetrics(siteId: string, since: Date, until: Date): Promise<TrialMetrics> {
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

function renderDigest(site: Site, m: TrialMetrics): string {
  if (m.calls_count === 0) {
    return `${site.niche} trial — ${site.city}: no calls yet today. Quiet days happen, peak hours are 9-11am + 2-4pm. Reply STOP to end.`;
  }
  const parts = [
    `${site.niche} trial — ${site.city}: ${m.calls_count} call${m.calls_count === 1 ? '' : 's'} today.`,
  ];
  if (m.won_count > 0) parts.push(`${m.won_count} booked.`);
  if (m.quoted_count > 0) parts.push(`${m.quoted_count} quoted.`);
  if (m.lost_count > 0) parts.push(`${m.lost_count} lost.`);
  if (m.est_revenue_usd > 0) parts.push(`Est value: $${m.est_revenue_usd.toFixed(0)}.`);
  parts.push('Reply STOP to end.');
  return parts.join(' ');
}

function firstNameOf(full: string | null | undefined): string {
  if (!full) return 'there';
  return full.trim().split(/\s+/)[0] ?? 'there';
}

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function missingTrialId(input: TrialManagerInput, message: string): TrialManagerOutput {
  return {
    trial_id: input.trial_id ?? '00000000-0000-0000-0000-000000000000',
    action: input.action,
    ok: false,
    message,
  };
}

// Suppress unused — reserved for SQL fragment composition in later digest filters.
void sql;
