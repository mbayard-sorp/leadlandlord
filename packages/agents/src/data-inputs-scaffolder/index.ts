/**
 * Data Inputs Scaffolder — auto-populates empty siteOriginalDataInputs fields
 * so the non-commodity content pipeline (content-data-auditor →
 * local-content-writer) has grounded inputs without the operator hand-typing
 * JSON per site.
 *
 * What it fills (EMPTY fields only — operator data always wins; see plan.ts):
 *  - caseStudyInputs / firsthandInputs: LLM-generated ILLUSTRATIVE composite
 *    scenarios, grounded in the niche-knowledge overlay (real trade technique,
 *    common problems). Every seed is tagged { illustrative: true, source } and
 *    the writer renders them with composite framing + a disclosure line —
 *    the same rules the job-story pipeline already follows.
 *  - proprietaryFacts: DB-derived facts only (service area, trade, live tenant
 *    business name). No invented hours/certifications/guarantees.
 *  - expertiseProfile: team-level attribution (never an invented person).
 *
 * What it NEVER fills: contrarianTakes — a contrarian claim needs a human
 * willing to stand behind it (schema contract: "Never auto-generated").
 *
 * Publishing still flows through the normal gates: the auditor only writes
 * pending content_ideas; nothing goes live without idea approval.
 */
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, ne } from 'drizzle-orm';
import { getDb, sites, tenants, siteOriginalDataInputs } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { BaseAgent, type AgentContext } from '../base';
import { loadNicheKnowledge } from '../shared/niche-knowledge';
import { resolveSiteThemeKey } from '../shared/site-theme';
import {
  planFill,
  planIsEmpty,
  buildBaselineFacts,
  buildExpertiseProfile,
  tagIllustrative,
  type ExistingInputsView,
} from './plan';

export const DataInputsScaffolderInput = z.object({
  siteId: z.string().uuid(),
});
export type DataInputsScaffolderInput = z.infer<typeof DataInputsScaffolderInput>;

export const DataInputsScaffolderOutput = z.object({
  siteId: z.string().uuid(),
  /** Column names that were filled this run. */
  filled: z.array(z.string()),
  /** Column names skipped because operator/scaffolder data already exists. */
  skipped: z.array(z.string()),
});
export type DataInputsScaffolderOutput = z.infer<typeof DataInputsScaffolderOutput>;

const SEED_TOOL_NAME = 'submit_illustrative_seeds';

const SEED_TOOL_SCHEMA = {
  type: 'object',
  required: ['caseStudies', 'firsthandNotes'],
  properties: {
    caseStudies: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['problem', 'solution', 'outcome', 'jobType'],
        properties: {
          problem: { type: 'string', description: 'The presenting problem — a genuine, common scenario for this trade. No named people or businesses.' },
          solution: { type: 'string', description: 'The factually-accurate fix, using correct trade technique and terminology.' },
          outcome: { type: 'string', description: 'Realistic qualitative outcome. NO invented numbers, prices, or timelines.' },
          jobType: { type: 'string', description: 'Short job-type label, e.g. "emergency repair", "seasonal maintenance".' },
        },
      },
    },
    firsthandNotes: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        required: ['subject', 'experience', 'verdict'],
        properties: {
          subject: { type: 'string', description: 'A method/approach/material comparison pros in this trade genuinely weigh (never a specific brand review).' },
          experience: { type: 'string', description: 'What crews commonly observe in the field about this subject. General trade knowledge only — no invented tests or statistics.' },
          verdict: { type: 'string', description: 'The practical takeaway a homeowner should hear.' },
        },
      },
    },
  },
} as const;

interface GeneratedSeeds {
  caseStudies: Array<Record<string, unknown>>;
  firsthandNotes: Array<Record<string, unknown>>;
}

export class DataInputsScaffolder extends BaseAgent<
  typeof DataInputsScaffolderInput,
  typeof DataInputsScaffolderOutput
> {
  constructor() {
    super({
      name: 'data-inputs-scaffolder',
      inputSchema: DataInputsScaffolderInput,
      outputSchema: DataInputsScaffolderOutput,
      defaultDailyCapUsd: 2,
      // One fill pass per site per month; an already-full row is a cheap no-op
      // anyway, this just collapses queue-level duplicates.
      dedupeKeyFn: (input) => `data-inputs-scaffolder:${input.siteId}:${isoMonth(new Date())}`,
    });
  }

  protected async execute(
    input: DataInputsScaffolderInput,
    ctx: AgentContext,
  ): Promise<DataInputsScaffolderOutput> {
    const db = getDb();

    ctx.progress({ step: 1, total: 4, label: 'loading site + existing inputs' });
    const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
    if (!site) throw new Error(`data-inputs-scaffolder: site not found: ${input.siteId}`);

    const [row] = await db
      .select()
      .from(siteOriginalDataInputs)
      .where(eq(siteOriginalDataInputs.siteId, input.siteId))
      .limit(1);

    const existing: ExistingInputsView | null = row
      ? {
          caseStudyInputs: row.caseStudyInputs ?? [],
          firsthandInputs: row.firsthandInputs ?? [],
          contrarianTakes: row.contrarianTakes ?? [],
          proprietaryFacts: row.proprietaryFacts ?? {},
          expertiseProfile: row.expertiseProfile ?? null,
        }
      : null;

    const plan = planFill(existing);
    const allFields = ['caseStudyInputs', 'firsthandInputs', 'proprietaryFacts', 'expertiseProfile'];
    if (planIsEmpty(plan)) {
      ctx.log.info({ siteId: input.siteId }, 'data-inputs-scaffolder: nothing to fill');
      return { siteId: input.siteId, filled: [], skipped: allFields };
    }

    // Live tenant (if any) grounds operatedBy + team attribution.
    const [tenant] = await db
      .select({ businessName: tenants.businessName })
      .from(tenants)
      .where(and(eq(tenants.siteId, input.siteId), ne(tenants.status, 'churned')))
      .limit(1);

    const factsInput = {
      niche: site.niche,
      city: site.city,
      state: site.state,
      tenantBusinessName: tenant?.businessName ?? null,
    };

    ctx.progress({ step: 2, total: 4, label: 'generating illustrative seeds' });
    let seeds: GeneratedSeeds | null = null;
    if (plan.needCaseStudies || plan.needFirsthand) {
      seeds = await this.generateSeeds(site.niche, site.city, site.state, input.siteId, ctx);
    }

    ctx.progress({ step: 3, total: 4, label: 'writing filled fields' });
    const filled: string[] = [];
    const set: Record<string, unknown> = {};
    if (plan.needCaseStudies && seeds && seeds.caseStudies.length > 0) {
      set.caseStudyInputs = tagIllustrative(
        seeds.caseStudies.map((s) => ({ ...s, city: site.city })),
      );
      filled.push('caseStudyInputs');
    }
    if (plan.needFirsthand && seeds && seeds.firsthandNotes.length > 0) {
      set.firsthandInputs = tagIllustrative(seeds.firsthandNotes);
      filled.push('firsthandInputs');
    }
    if (plan.needFacts) {
      set.proprietaryFacts = buildBaselineFacts(factsInput);
      filled.push('proprietaryFacts');
    }
    if (plan.needExpertise) {
      set.expertiseProfile = buildExpertiseProfile(factsInput);
      filled.push('expertiseProfile');
    }

    if (filled.length > 0) {
      const now = new Date();
      await db
        .insert(siteOriginalDataInputs)
        .values({
          siteId: input.siteId,
          caseStudyInputs: (set.caseStudyInputs as Array<Record<string, unknown>>) ?? [],
          firsthandInputs: (set.firsthandInputs as Array<Record<string, unknown>>) ?? [],
          // NEVER scaffolded — stays empty until a human writes one.
          contrarianTakes: [],
          proprietaryFacts: (set.proprietaryFacts as Record<string, unknown>) ?? {},
          expertiseProfile: (set.expertiseProfile as Record<string, unknown>) ?? null,
          updatedBy: 'data-inputs-scaffolder',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: siteOriginalDataInputs.siteId,
          // Only the fields planned as empty — operator data is never clobbered.
          set: { ...set, updatedBy: 'data-inputs-scaffolder', updatedAt: now },
        });
    }

    ctx.progress({ step: 4, total: 4, label: 'chaining content-data-auditor' });
    if (filled.length > 0) {
      // Freshly-grounded site → let the auditor propose the non-commodity pages
      // (its output is pending recommendations/ideas; approval gate unchanged).
      await ctx.emitNextStepEvent({
        type: 'data-inputs.scaffolded',
        targetAgent: 'content-data-auditor',
        payload: { mode: 'review', siteId: input.siteId, site_id: input.siteId },
      });
    }

    ctx.log.info({ siteId: input.siteId, filled }, 'data-inputs-scaffolder: done');
    return {
      siteId: input.siteId,
      filled,
      skipped: allFields.filter((f) => !filled.includes(f)),
    };
  }

  /**
   * One tool-use call generating both seed kinds. Grounded in the site's
   * niche-knowledge overlay so problems/fixes are genuine trade scenarios.
   */
  private async generateSeeds(
    niche: string,
    city: string,
    state: string,
    siteId: string,
    ctx: AgentContext,
  ): Promise<GeneratedSeeds> {
    if (process.env.MOCK_AI === '1') {
      return mockSeeds(niche, city);
    }

    let nicheKnowledge: string | null = null;
    try {
      const themeKey = await resolveSiteThemeKey(siteId);
      nicheKnowledge = loadNicheKnowledge(themeKey);
    } catch {
      // Overlay is a quality booster, not a requirement.
    }

    const client = getAnthropicClient();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const system = [
      `You generate ILLUSTRATIVE seed scenarios for a local ${niche} business content pipeline. These are composite, typical-job scenarios — NOT claims about real clients.`,
      `Factual integrity is non-negotiable: every problem and fix must be a genuine, common scenario for this trade, with correct technique and terminology. Never invent statistics, prices, timelines, brand reviews, awards, named people, or named businesses.`,
      `Firsthand notes compare methods/approaches/materials pros genuinely weigh — general trade knowledge, never a specific product test you can't have run.`,
    ].join('\n');

    const userPrompt = [
      `Generate illustrative seed scenarios for a ${niche} business serving ${city}, ${state}.`,
      ...(nicheKnowledge
        ? [``, `Niche knowledge — keep problems, fixes, and terminology consistent with this:`, nicheKnowledge]
        : []),
      ``,
      `Call ${SEED_TOOL_NAME} exactly once with 3-4 case-study scenarios and 2-3 firsthand notes.`,
    ].join('\n');

    const resp = await client.messages.create({
      model,
      max_tokens: 3000,
      temperature: 0.7,
      system,
      tools: [
        {
          name: SEED_TOOL_NAME,
          description: 'Submit the generated illustrative seeds.',
          input_schema: SEED_TOOL_SCHEMA as never,
        },
      ],
      tool_choice: { type: 'tool', name: SEED_TOOL_NAME },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = resp.usage;
    ctx.recordUsage({
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: estimateCostUsd(model, {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      }),
    });

    const toolUse = resp.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SEED_TOOL_NAME,
    );
    if (!toolUse) {
      throw new Error(
        `data-inputs-scaffolder: model did not invoke ${SEED_TOOL_NAME} (stop_reason=${resp.stop_reason})`,
      );
    }
    const out = toolUse.input as Record<string, unknown>;
    return {
      caseStudies: asObjectArray(out.caseStudies),
      firsthandNotes: asObjectArray(out.firsthandNotes),
    };
  }
}

function asObjectArray(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
  );
}

/** Deterministic seeds for MOCK_AI test runs. */
function mockSeeds(niche: string, city: string): GeneratedSeeds {
  return {
    caseStudies: [
      {
        problem: `A recurring ${niche} issue that a ${city} homeowner had patched twice before.`,
        solution: `Diagnosed the underlying cause and applied the standard permanent fix for this trade.`,
        outcome: `The issue stopped recurring and the homeowner knew what to watch for.`,
        jobType: 'repair',
      },
      {
        problem: `Seasonal ${niche} wear-and-tear caught during a routine visit.`,
        solution: `Completed the preventive maintenance steps standard for this trade.`,
        outcome: `Avoided an emergency call later in the season.`,
        jobType: 'maintenance',
      },
      {
        problem: `An urgent after-hours ${niche} failure.`,
        solution: `Stabilized the immediate problem, then scheduled the full repair.`,
        outcome: `Damage was contained and the permanent fix followed.`,
        jobType: 'emergency',
      },
    ],
    firsthandNotes: [
      {
        subject: `Repair-versus-replace decisions in ${niche} work`,
        experience: `Crews weigh remaining service life against repair cost on nearly every job.`,
        verdict: `Ask for both quotes — the honest answer depends on age and condition.`,
      },
      {
        subject: `Preventive maintenance timing for ${niche}`,
        experience: `Most emergency calls trace back to skipped seasonal checks.`,
        verdict: `A yearly inspection is cheaper than any emergency visit.`,
      },
    ],
  };
}

/** ISO month key, e.g. "2026-07" — one scaffold pass per site per month. */
export function isoMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
