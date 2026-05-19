/**
 * wave-launcher/index.ts
 *
 * Orchestrates wave state progression through the 7-stage pipeline:
 *   draft → launching → aging → linking → backlinking → monitoring → completed
 *
 * All state transitions are gated by agentApprovals dual-write.
 * Cross-site link counts come from crossSiteLinks (source IN wave.siteIds, status='live').
 * Indexation checks use checkIndexationStatus from google-search-console.
 *
 * Recommended auto-approve rules (add via DB, not in code):
 *   { kind: 'wave_state_transition', matcher: { 'evidence.toState': { $eq: 'aging' } }, autoApprove: true }
 *     — building completed is mechanical, safe to auto-approve.
 *   { kind: 'wave_state_transition', matcher: { 'evidence.toState': { $eq: 'monitoring' }, 'evidence.skipBacklinks': { $eq: true } }, autoApprove: true }
 *     — until backlink agents land, auto-advance through backlinking.
 */

import { z } from 'zod';
import { eq, and, inArray, count, sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import {
  getDb,
  waves,
  sites,
  crossSiteLinks,
  agentApprovals,
  type WaveTransition,
} from '@leadlandlord/db';
import { checkAutoApprove } from '../approval-engine';
import { checkIndexationStatus } from '@leadlandlord/integrations/google-search-console';
import { evaluateTransition, type WaveStateName } from './state-machine';

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

export const WaveLauncherInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('start'),
    name: z.string().min(1),
    niche: z.string().min(1),
    siteIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    mode: z.literal('progress'),
    waveId: z.string().uuid(),
  }),
  z.object({
    mode: z.literal('complete'),
    waveId: z.string().uuid(),
  }),
]);
export type WaveLauncherInput = z.infer<typeof WaveLauncherInput>;

export const WaveLauncherOutput = z.object({
  waveId: z.string().uuid(),
  mode: z.enum(['start', 'progress', 'complete']),
  previousState: z.string().optional(),
  currentState: z.string(),
  transitioned: z.boolean(),
  blockers: z.array(z.string()),
  approvalId: z.string().uuid().optional(),
  approvalStatus: z.string().optional(),
});
export type WaveLauncherOutput = z.infer<typeof WaveLauncherOutput>;

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class WaveLauncher extends BaseAgent<
  typeof WaveLauncherInput,
  typeof WaveLauncherOutput
> {
  constructor() {
    super({
      name: 'wave-launcher',
      inputSchema: WaveLauncherInput,
      outputSchema: WaveLauncherOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (input) => {
        if (input.mode === 'start') return undefined;
        return `wave-launcher:${input.mode}:${input.waveId}`;
      },
    });
  }

  protected async execute(
    input: WaveLauncherInput,
    ctx: AgentContext,
  ): Promise<WaveLauncherOutput> {
    if (input.mode === 'start') return this.handleStart(input, ctx);
    if (input.mode === 'progress') return this.handleProgress(input, ctx);
    return this.handleComplete(input, ctx);
  }

  // ── mode='start' ────────────────────────────────────────────────────────────

  private async handleStart(
    input: Extract<WaveLauncherInput, { mode: 'start' }>,
    ctx: AgentContext,
  ): Promise<WaveLauncherOutput> {
    const db = getDb();

    const now = new Date();
    const initialTransition: WaveTransition = {
      from: 'null',
      to: 'draft',
      at: now.toISOString(),
      evidence: JSON.stringify({}),
    };

    const [row] = await db
      .insert(waves)
      .values({
        name: input.name,
        niche: input.niche,
        siteIds: input.siteIds,
        state: 'draft',
        transitions: [initialTransition],
      })
      .returning({ id: waves.id });

    const waveId = row!.id;
    ctx.log.info({ waveId, name: input.name, niche: input.niche }, 'wave created');

    return {
      waveId,
      mode: 'start',
      currentState: 'draft',
      transitioned: true,
      blockers: [],
    };
  }

  // ── mode='progress' ─────────────────────────────────────────────────────────

  private async handleProgress(
    input: Extract<WaveLauncherInput, { mode: 'progress' }>,
    ctx: AgentContext,
  ): Promise<WaveLauncherOutput> {
    const db = getDb();
    const { waveId } = input;

    const waveRows = await db
      .select()
      .from(waves)
      .where(eq(waves.id, waveId))
      .limit(1);

    const wave = waveRows[0];
    if (!wave) throw new Error(`wave not found: ${waveId}`);

    const previousState = wave.state as WaveStateName;
    ctx.log.info({ waveId, state: previousState }, 'evaluating wave transition');
    ctx.progress({ label: `evaluating wave ${waveId} in state ${previousState}` });

    const signals = await this.gatherSignals(wave, ctx);
    const evaluation = evaluateTransition(previousState, signals);

    if (evaluation.toState === null) {
      ctx.log.info({ waveId, blockers: evaluation.blockers }, 'wave_no_transition');
      return {
        waveId,
        mode: 'progress',
        previousState,
        currentState: previousState,
        transitioned: false,
        blockers: evaluation.blockers,
      };
    }

    return this.applyTransition({
      waveId,
      wave,
      previousState,
      toState: evaluation.toState,
      evidence: evaluation.evidence,
      ctx,
      db,
    });
  }

  // ── mode='complete' ──────────────────────────────────────────────────────────

  private async handleComplete(
    input: Extract<WaveLauncherInput, { mode: 'complete' }>,
    ctx: AgentContext,
  ): Promise<WaveLauncherOutput> {
    const db = getDb();
    const { waveId } = input;

    const waveRows = await db
      .select()
      .from(waves)
      .where(eq(waves.id, waveId))
      .limit(1);

    const wave = waveRows[0];
    if (!wave) throw new Error(`wave not found: ${waveId}`);

    const previousState = wave.state as WaveStateName;

    return this.applyTransition({
      waveId,
      wave,
      previousState,
      toState: 'completed',
      evidence: { manual: true },
      ctx,
      db,
    });
  }

  // ── Shared transition writer ─────────────────────────────────────────────────

  private async applyTransition(args: {
    waveId: string;
    wave: typeof waves.$inferSelect;
    previousState: WaveStateName;
    toState: WaveStateName;
    evidence: Record<string, unknown>;
    ctx: AgentContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any;
  }): Promise<WaveLauncherOutput> {
    const { waveId, wave, previousState, toState, evidence, ctx, db } = args;

    // Idempotency: check for an existing OPEN approval for this (waveId, toState).
    const existingApprovals = await db
      .select({ id: agentApprovals.id, status: agentApprovals.status })
      .from(agentApprovals)
      .where(
        and(
          eq(agentApprovals.kind, 'wave_state_transition'),
          sql`${agentApprovals.payload}->>'waveId' = ${waveId}`,
          sql`${agentApprovals.payload}->>'toState' = ${toState}`,
          eq(agentApprovals.status, 'pending'),
        ),
      )
      .limit(1);

    if (existingApprovals.length > 0) {
      ctx.log.info(
        { waveId, toState, approvalId: existingApprovals[0]!.id },
        'wave_transition_blocked: pending approval already exists',
      );
      return {
        waveId,
        mode: 'progress',
        previousState,
        currentState: previousState,
        transitioned: false,
        blockers: [`pending approval already exists for transition to ${toState}`],
        approvalId: existingApprovals[0]!.id,
        approvalStatus: 'pending',
      };
    }

    const approvalPayload = {
      waveId,
      fromState: previousState,
      toState,
      evidence,
      blockers: [],
    };

    let approvalStatus = 'pending';
    let ruleMatched: string | undefined;

    try {
      const autoResult = await checkAutoApprove('wave_state_transition', approvalPayload, db);
      if (autoResult.matched) {
        approvalStatus = 'auto_approved';
        ruleMatched = autoResult.ruleId;
      }
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'auto-approve check failed, defaulting to pending',
      );
    }

    const [approvalRow] = await db
      .insert(agentApprovals)
      .values({
        agentRunId: ctx.runId,
        kind: 'wave_state_transition',
        payload: approvalPayload as object,
        status: approvalStatus,
        decidedBy:
          approvalStatus === 'auto_approved'
            ? `auto-rule:${ruleMatched ?? 'unknown'}`
            : null,
        decidedAt: approvalStatus === 'auto_approved' ? new Date() : null,
        ruleMatched: ruleMatched ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning({ id: agentApprovals.id });

    const approvalId = approvalRow!.id;

    if (approvalStatus !== 'auto_approved') {
      ctx.log.info(
        { waveId, fromState: previousState, toState, approvalId },
        'wave_transition_blocked: pending operator approval',
      );
      return {
        waveId,
        mode: 'progress',
        previousState,
        currentState: previousState,
        transitioned: false,
        blockers: [`awaiting operator approval (id: ${approvalId})`],
        approvalId,
        approvalStatus: 'pending',
      };
    }

    // Approved — write the state transition.
    const now = new Date();
    const newTransition: WaveTransition = {
      from: previousState,
      to: toState,
      at: now.toISOString(),
      approvalId,
      evidence: JSON.stringify(evidence),
    };

    const existingTransitions: WaveTransition[] = (wave.transitions as WaveTransition[]) ?? [];

    await db
      .update(waves)
      .set({
        state: toState,
        updatedAt: now,
        agingUntil:
          toState === 'aging' ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) : wave.agingUntil,
        transitions: [...existingTransitions, newTransition],
      })
      .where(eq(waves.id, waveId));

    ctx.log.info(
      { waveId, fromState: previousState, toState, approvalId },
      'wave_transition_approved',
    );

    return {
      waveId,
      mode: 'progress',
      previousState,
      currentState: toState,
      transitioned: true,
      blockers: [],
      approvalId,
      approvalStatus: 'auto_approved',
    };
  }

  // ── Signal gathering ─────────────────────────────────────────────────────────

  private async gatherSignals(
    wave: typeof waves.$inferSelect,
    ctx: AgentContext,
  ) {
    const db = getDb();
    const siteIds = wave.siteIds as string[];
    const siteCount = siteIds.length;
    const now = new Date();

    // approvedCandidateCount: simplified — treat siteIds.length as approved count.
    // The candidate-approval linkage is a future concern; wave is only started once
    // niche candidates have been approved (upstream operator workflow).
    const approvedCandidateCount = siteCount;

    // builtSiteCount: sites with status in (warming, live, rented).
    let builtSiteCount = 0;
    if (siteIds.length > 0) {
      const builtRows = await db
        .select({ value: count() })
        .from(sites)
        .where(
          and(
            inArray(sites.id, siteIds),
            inArray(sites.status, ['warming', 'live', 'rented']),
          ),
        );
      builtSiteCount = Number(builtRows[0]?.value ?? 0);
    }

    // indexedSiteCount: call GSC for each site's root URL.
    let indexedSiteCount = 0;
    if (siteIds.length > 0) {
      const domainRows = await db
        .select({ id: sites.id, domain: sites.domain })
        .from(sites)
        .where(inArray(sites.id, siteIds));

      for (const siteRow of domainRows) {
        if (!siteRow.domain) continue;
        try {
          const results = await checkIndexationStatus(
            `sc-domain:${siteRow.domain}`,
            [`https://${siteRow.domain}/`],
            14,
          );
          if (results.some((r) => r.indexed)) indexedSiteCount++;
        } catch (err) {
          ctx.log.warn(
            { siteId: siteRow.id, domain: siteRow.domain, err: err instanceof Error ? err.message : err },
            'GSC indexation check failed, treating site as not indexed',
          );
        }
      }
    }

    // linkPlacementsPerSite: count crossSiteLinks per source site where status='live'.
    const linkPlacementsPerSite: Record<string, number> = {};
    for (const siteId of siteIds) {
      linkPlacementsPerSite[siteId] = 0;
    }

    if (siteIds.length > 0) {
      const linkRows = await db
        .select({ sourceSiteId: crossSiteLinks.sourceSiteId, value: count() })
        .from(crossSiteLinks)
        .where(
          and(
            inArray(crossSiteLinks.sourceSiteId, siteIds),
            eq(crossSiteLinks.status, 'live'),
          ),
        )
        .groupBy(crossSiteLinks.sourceSiteId);

      for (const row of linkRows) {
        linkPlacementsPerSite[row.sourceSiteId] = Number(row.value);
      }
    }

    // backlinksPerSite: zero map — no backlink tracking in scope for sprint 5.
    const backlinksPerSite: Record<string, number> = {};
    for (const siteId of siteIds) {
      backlinksPerSite[siteId] = 0;
    }

    // monitoringWeeksElapsed: derived from the most recent 'monitoring' transition entry.
    let monitoringWeeksElapsed = 0;
    const transitions = (wave.transitions as WaveTransition[]) ?? [];
    const monitoringEntry = [...transitions].reverse().find((t) => t.to === 'monitoring');
    if (monitoringEntry) {
      const enteredAt = new Date(monitoringEntry.at);
      const msElapsed = now.getTime() - enteredAt.getTime();
      monitoringWeeksElapsed = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000));
    }

    return {
      approvedCandidateCount,
      siteCount,
      builtSiteCount,
      agingUntil: wave.agingUntil,
      now,
      indexedSiteCount,
      linkPlacementsPerSite,
      backlinksPerSite,
      monitoringWeeksElapsed,
    };
  }
}
