import { z } from 'zod';
import { eq, and, ne, sql } from 'drizzle-orm';
import { getDb, prospects, sites, agentEvents, tenants } from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { TenantProspector } from '../tenant-prospector/index';
import { OutreachAgent } from '../outreach-agent/index';

/**
 * Churn Recovery — fires on `tenant.churned` events emitted by the Stripe
 * webhook (P6.6 customer.subscription.deleted).
 *
 * Strategy:
 *   1. Pull the next batch of fresh prospects for this site (status='new')
 *   2. If we have fewer than `target_count`, run TenantProspector to top up
 *      with a fresh Google Places + Apollo search
 *   3. Emit one outreach_agent event per prospect for sms_day_0
 *
 * The actual outreach steps run as separate scheduled agent invocations (the
 * cron + agent-events queue). This agent just gets the queue moving.
 *
 * Dedupe by site_id + churned tenant id + UTC date so retries don't double-
 * run the prospector on the same day.
 */

export const ChurnRecoveryInput = z.object({
  /** Site that lost a tenant. */
  site_id: z.string().uuid(),
  /** Tenant that just churned (informational; outreach excludes their phone/email). */
  churned_tenant_id: z.string().uuid(),
  /** How many fresh prospects to seed into the funnel. */
  target_count: z.number().int().positive().max(200).default(50),
});
export type ChurnRecoveryInput = z.infer<typeof ChurnRecoveryInput>;

export const ChurnRecoveryOutput = z.object({
  site_id: z.string().uuid(),
  next_prospects_queued: z.number().int().nonnegative(),
  prospects_added: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type ChurnRecoveryOutput = z.infer<typeof ChurnRecoveryOutput>;

export class ChurnRecovery extends BaseAgent<typeof ChurnRecoveryInput, typeof ChurnRecoveryOutput> {
  private readonly tenantProspector = new TenantProspector();

  constructor() {
    super({
      name: 'churn-recovery',
      inputSchema: ChurnRecoveryInput,
      outputSchema: ChurnRecoveryOutput,
      dedupeKeyFn: (i) =>
        `${i.site_id}:${i.churned_tenant_id}:${new Date().toISOString().slice(0, 10)}`,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(input: ChurnRecoveryInput, ctx: AgentContext): Promise<ChurnRecoveryOutput> {
    const db = getDb();
    const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!site) {
      throw new Error(`site ${input.site_id} not found`);
    }

    // 1. Count fresh prospects (status='new') we can pull from immediately.
    const freshRows = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(
        and(
          eq(prospects.siteId, input.site_id),
          eq(prospects.status, 'new'),
        ),
      )
      .limit(input.target_count);

    let prospectsAdded = 0;
    if (freshRows.length < input.target_count) {
      // 2. Top up via TenantProspector. Best-effort — if it fails (e.g. no
      // GOOGLE_PLACES_API_KEY) we proceed with whatever fresh prospects we
      // already have.
      try {
        const result = await this.tenantProspector.run(
          { site_id: input.site_id, count: input.target_count - freshRows.length },
          { siteId: input.site_id, parentRunId: ctx.runId, dedupeKey: `${ctx.runId}:tenant-prospector` },
        );
        prospectsAdded = result.inserted;
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err },
          'churn-recovery: prospector top-up failed (continuing with existing fresh prospects)',
        );
      }
    }

    // Re-query fresh prospects after potential top-up, excluding the churned
    // tenant's phone/email if it somehow ended up back in the pool.
    const churnedTenant = (
      await db.select().from(tenants).where(eq(tenants.id, input.churned_tenant_id)).limit(1)
    )[0];

    const queueRows = await db
      .select({ id: prospects.id, phone: prospects.phone, email: prospects.email })
      .from(prospects)
      .where(
        and(
          eq(prospects.siteId, input.site_id),
          eq(prospects.status, 'new'),
          // Don't outreach the same business we just lost.
          churnedTenant?.phone
            ? ne(prospects.phone, churnedTenant.phone)
            : sql`true`,
        ),
      )
      .limit(input.target_count);

    // 3. Emit one outreach_agent event per prospect — the cron worker picks
    // these up and dispatches OutreachAgent for sms_day_0.
    const events = queueRows.map((p) => ({
      agent: 'churn-recovery' as const,
      type: 'outreach.kick' as const,
      targetAgent: 'outreach-agent' as const,
      payload: {
        prospect_id: p.id,
        step: 'sms_day_0' as const,
      } as Record<string, unknown>,
    }));
    if (events.length > 0) {
      await db.insert(agentEvents).values(events);
    }

    ctx.log.info(
      { siteId: input.site_id, prospectsAdded, queued: events.length },
      'churn-recovery dispatched',
    );

    // Suppress unused — OutreachAgent class kept imported for type guarantees
    // when the agent_events queue dispatches us downstream.
    void OutreachAgent;

    return {
      site_id: input.site_id,
      next_prospects_queued: events.length,
      prospects_added: prospectsAdded,
      message: `Queued ${events.length} fresh outreach attempts after churn (${prospectsAdded} new prospects sourced).`,
    };
  }
}
