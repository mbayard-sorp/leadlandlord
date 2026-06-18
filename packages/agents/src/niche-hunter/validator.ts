import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import {
  getDb,
  niches,
  nicheCandidates,
  getSystemState,
  eq,
  and,
  inArray,
  asc,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import {
  DEFAULT_RENTABILITY_CPC_CEILING,
  DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
} from './lead-benchmarks';
import { validateNicheCore } from './validate';
import { selectValidationSet } from './selection';

/**
 * Niche Validator — phase 2 of the deterministic scout/validate engine.
 *
 * Operator picks N from a scout run; this agent runs the full DataForSEO
 * trio (city-scoped) + contractor count on those N, with ~25% of slots
 * reserved for never-surfaced trades (exploration quota), re-ranks by
 * validated expected value, and lands rows in `niches` as decision='pending'
 * for the existing human approve -> site-builder flow (unchanged, human-only
 * per ADR 0019).
 *
 * Claude's only role in the whole engine is one annotation call here over
 * the selected N (seasonality flag, licensing concern, one-line caution).
 */

export const NicheValidatorInput = z.object({
  scout_run_id: z.string().uuid(),
  count: z.number().int().min(1).max(50),
  /** Explicit override of count-based selection. */
  candidate_ids: z.array(z.string().uuid()).optional(),
  exploration_quota: z.number().min(0).max(1).default(0.25),
});
export type NicheValidatorInput = z.infer<typeof NicheValidatorInput>;

export const NicheValidatorOutput = z.object({
  validated: z.number(),
  failed: z.number(),
  novel_validated: z.number(),
  promoted_niche_ids: z.array(z.string().uuid()),
  total_cost_usd: z.number(),
});
export type NicheValidatorOutput = z.infer<typeof NicheValidatorOutput>;

const ANNOTATION_TOOL_NAME = 'submit_niche_annotations';

const ANNOTATION_SCHEMA = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          niche_id: { type: 'string', description: 'The niche id exactly as given in the list.' },
          seasonality: {
            type: ['string', 'null'],
            description: 'One short phrase on demand seasonality, or null if unremarkable.',
          },
          licensing_concern: {
            type: ['string', 'null'],
            description: 'One short phrase if the trade needs licensing the tenant must bring, else null.',
          },
          caution: {
            type: ['string', 'null'],
            description: 'One-line caution the operator should know before approving, else null.',
          },
        },
        required: ['niche_id'],
      },
    },
  },
  required: ['annotations'],
} as const;

interface NicheAnnotation {
  niche_id: string;
  seasonality?: string | null;
  licensing_concern?: string | null;
  caution?: string | null;
}

export class NicheValidator extends BaseAgent<typeof NicheValidatorInput, typeof NicheValidatorOutput> {
  constructor() {
    super({
      name: 'niche-validator',
      inputSchema: NicheValidatorInput,
      outputSchema: NicheValidatorOutput,
      defaultDailyCapUsd: 15,
      dedupeKeyFn: (input) => {
        const selector = input.candidate_ids?.length
          ? createHash('sha256').update([...input.candidate_ids].sort().join(',')).digest('hex').slice(0, 16)
          : String(input.count);
        return `niche-validator:${input.scout_run_id}:${selector}`;
      },
    });
  }

  protected async execute(input: NicheValidatorInput, ctx: AgentContext): Promise<NicheValidatorOutput> {
    const db = getDb();
    const sys = await getSystemState();
    const coreOpts = {
      cpcCeiling:
        sys.rentabilityCpcCeiling != null
          ? parseFloat(sys.rentabilityCpcCeiling)
          : DEFAULT_RENTABILITY_CPC_CEILING,
      leadPriceCeiling:
        sys.rentabilityLeadPriceCeiling != null
          ? parseFloat(sys.rentabilityLeadPriceCeiling)
          : DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
      ctrAtRank: sys.scoutCtrAtRank != null ? parseFloat(sys.scoutCtrAtRank) : undefined,
      callRate: sys.scoutCallRate != null ? parseFloat(sys.scoutCallRate) : undefined,
    };

    let totalCost = 0;
    const recordCost = (usd: number) => {
      if (usd <= 0) return;
      totalCost += usd;
      ctx.recordUsage({ model: 'dataforseo', input_tokens: 0, output_tokens: 0, cost_usd: usd });
    };

    // 1. Load + select candidates.
    const rows = await db
      .select()
      .from(nicheCandidates)
      .where(eq(nicheCandidates.scoutRunId, input.scout_run_id))
      .orderBy(asc(nicheCandidates.rank));
    if (rows.length === 0) {
      throw new Error(`niche-validator: scout run ${input.scout_run_id} has no candidates`);
    }

    let selected: typeof rows;
    if (input.candidate_ids?.length) {
      const wanted = new Set(input.candidate_ids);
      selected = rows.filter((r) => wanted.has(r.id));
    } else {
      // Idempotent re-run: already-validated candidates don't consume slots.
      const eligible = rows.filter((r) => r.status !== 'validated');
      const surfacedTrades = new Set(
        rows.filter((r) => !r.isNovelTrade).map((r) => r.trade.toLowerCase()),
      );
      selected = selectValidationSet(eligible, input.count, surfacedTrades, input.exploration_quota);
    }
    const skipValidated = selected.filter((r) => r.status === 'validated');
    selected = selected.filter((r) => r.status !== 'validated');
    if (skipValidated.length > 0) {
      ctx.log.info({ skipped: skipValidated.length }, 'niche-validator: skipping already-validated candidates');
    }

    // 2. Validate each candidate sequentially (DFS rate limits; clear progress).
    let validated = 0;
    let failed = 0;
    let novelValidated = 0;
    const promoted: string[] = [];
    const validatedForAnnotation: Array<{ nicheId: string; trade: string; city: string; state: string }> = [];

    for (let i = 0; i < selected.length; i++) {
      const cand = selected[i]!;
      ctx.progress({
        step: i + 1,
        total: selected.length,
        label: `validating ${i + 1}/${selected.length}: ${cand.trade} — ${cand.city}, ${cand.state}`,
      });

      try {
        await db
          .update(nicheCandidates)
          .set({ status: 'queued' })
          .where(eq(nicheCandidates.id, cand.id));

        // Upsert the niches row (the operator decision pipeline).
        const inserted = await db
          .insert(niches)
          .values({
            niche: cand.trade,
            city: cand.city,
            state: cand.state,
            category: cand.category,
            estSearchVolume:
              cand.estCityVolume != null ? Math.round(parseFloat(cand.estCityVolume)) : null,
            estMonthlyValueUsd: cand.estMonthlyValueUsd,
            rationale: `Scouted at rank ${cand.rank}: est $${parseFloat(cand.estMonthlyValueUsd).toFixed(0)}/mo (${cand.dataConfidence}${cand.isNovelTrade ? ', novel trade' : ''}).`,
            scoutWinnability: cand.winnability,
            scoutClusterDifficulty: cand.clusterDifficulty,
          })
          .onConflictDoNothing({ target: [niches.niche, niches.city, niches.state] })
          .returning({ id: niches.id });

        let nicheId: string;
        if (inserted.length > 0) {
          nicheId = inserted[0]!.id;
        } else {
          const [existing] = await db
            .select({ id: niches.id })
            .from(niches)
            .where(
              and(eq(niches.niche, cand.trade), eq(niches.city, cand.city), eq(niches.state, cand.state)),
            )
            .limit(1);
          if (!existing) throw new Error('could not resolve existing niches row after conflict');
          nicheId = existing.id;
        }

        const result = await validateNicheCore(nicheId, { ...coreOpts, recordCost });
        if (!result.ok) throw new Error(result.message);

        await db
          .update(nicheCandidates)
          .set({
            status: 'validated',
            nicheId,
            validatedValueUsd:
              result.validatedMonthlyValueUsd != null
                ? result.validatedMonthlyValueUsd.toFixed(2)
                : null,
          })
          .where(eq(nicheCandidates.id, cand.id));

        validated++;
        if (cand.isNovelTrade) novelValidated++;
        promoted.push(nicheId);
        validatedForAnnotation.push({ nicheId, trade: cand.trade, city: cand.city, state: cand.state });
      } catch (err) {
        failed++;
        ctx.log.warn(
          { candidate_id: cand.id, trade: cand.trade, city: cand.city, err: err instanceof Error ? err.message : err },
          'niche-validator: candidate validation failed, continuing',
        );
        try {
          await db
            .update(nicheCandidates)
            .set({ status: 'validation_failed' })
            .where(eq(nicheCandidates.id, cand.id));
        } catch {
          // Status write is best-effort on the failure path.
        }
      }
    }

    // 3. One Claude annotation pass over the validated set (pennies).
    if (validatedForAnnotation.length > 0) {
      try {
        await this.annotate(validatedForAnnotation, ctx);
      } catch (err) {
        // Annotations are advisory — never fail the run over them.
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err },
          'niche-validator: annotation pass failed, leaving annotations null',
        );
      }
    }

    return {
      validated,
      failed,
      novel_validated: novelValidated,
      promoted_niche_ids: promoted,
      total_cost_usd: Number(totalCost.toFixed(4)),
    };
  }

  private async annotate(
    items: Array<{ nicheId: string; trade: string; city: string; state: string }>,
    ctx: AgentContext,
  ): Promise<void> {
    const client = getAnthropicClient();
    const model = process.env.NICHE_HUNTER_MODEL ?? 'claude-sonnet-4-6';

    const list = items
      .map((i) => `- id=${i.nicheId} ${i.trade} in ${i.city}, ${i.state}`)
      .join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 250 + items.length * 120,
      system:
        'You annotate validated rank-and-rent niche candidates for an operator review queue. For each niche, flag seasonality (one short phrase, null if year-round), any licensing the renting contractor must bring (null if none), and a one-line caution worth knowing before approving (null if none). Be terse and concrete.',
      tools: [
        {
          name: ANNOTATION_TOOL_NAME,
          description: 'Submit one annotation per niche.',
          input_schema: ANNOTATION_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: ANNOTATION_TOOL_NAME },
      messages: [{ role: 'user', content: `Annotate these validated niches:\n\n${list}` }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') return;
    const out = toolUse.input as { annotations?: NicheAnnotation[] };
    const annotations = out.annotations ?? [];
    const validIds = new Set(items.map((i) => i.nicheId));

    const db = getDb();
    for (const a of annotations) {
      if (!a.niche_id || !validIds.has(a.niche_id)) continue;
      await db
        .update(niches)
        .set({
          annotations: {
            seasonality: a.seasonality ?? null,
            licensing_concern: a.licensing_concern ?? null,
            caution: a.caution ?? null,
          },
        })
        .where(eq(niches.id, a.niche_id));
    }
  }
}
