import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { getDb, sites, contentIdeas, siteOriginalDataInputs, siteNetworkMetrics } from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { draftInfoPage, type GroundedFactsInput, type AuthorProfileInput } from '../shared/author-info-page';
import { loadNicheKnowledge } from '../shared/niche-knowledge';
import { resolveSiteThemeKey } from '../shared/site-theme';
import { isStoryArchetype } from '../local-content-scout';
import { MIN_SAMPLE } from '../content-data-auditor/templates';
import { persistInfoPage } from './persist-info-page';

const LocalContentWriterInput = z.object({
  idea_id: z.string().uuid(),
});
type LocalContentWriterInput = z.infer<typeof LocalContentWriterInput>;

const LocalContentWriterOutput = z.object({
  pageDocId: z.string(),
  slug: z.string(),
});
type LocalContentWriterOutput = z.infer<typeof LocalContentWriterOutput>;

export { LocalContentWriterInput, LocalContentWriterOutput };

function toSlug(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Idea statuses the writer is allowed to process.
const ALLOWED_STATUSES = new Set(['approved', 'auto_approved']);

/**
 * The four non-commodity archetypes proposed by content-data-auditor. Drafting
 * one of these WITHOUT grounded facts is exactly the fabrication the auditor's
 * anti-fabrication contract forbids, so the writer hard-fails when the seeds /
 * metric it needs are missing (dead-letter beats a fabricated case study).
 */
const ORIGINAL_ARCHETYPE_SEED_FIELD: Record<string, 'caseStudyInputs' | 'firsthandInputs' | 'contrarianTakes'> = {
  case_study: 'caseStudyInputs',
  firsthand_review: 'firsthandInputs',
  contrarian: 'contrarianTakes',
};

function isOriginalArchetype(a: string | null | undefined): boolean {
  return !!a && (a === 'data_study' || a in ORIGINAL_ARCHETYPE_SEED_FIELD);
}

/** True when any seed is scaffolder-generated rather than operator-vouched. */
function anySeedIllustrative(seeds: Array<Record<string, unknown>>): boolean {
  return seeds.some((s) => s.illustrative === true);
}

export class LocalContentWriter extends BaseAgent<typeof LocalContentWriterInput, typeof LocalContentWriterOutput> {
  constructor() {
    super({
      name: 'local-content-writer',
      inputSchema: LocalContentWriterInput,
      outputSchema: LocalContentWriterOutput,
      defaultDailyCapUsd: 3,
      // Collapse duplicate manual + auto-approval events for the same idea into
      // one run. Without this, a content.idea.approved event plus a human
      // approval event both trigger writer runs for the same ideaId.
      dedupeKeyFn: (i) => `writer:idea:${i.idea_id}`,
    });
  }

  protected async execute(input: LocalContentWriterInput, ctx: AgentContext): Promise<LocalContentWriterOutput> {
    const db = getDb();

    ctx.progress({ step: 1, total: 3, label: 'loading idea' });
    const [idea] = await db
      .select()
      .from(contentIdeas)
      .where(eq(contentIdeas.id, input.idea_id))
      .limit(1);
    if (!idea) throw new Error(`local-content-writer: idea not found: ${input.idea_id}`);

    if (!ALLOWED_STATUSES.has(idea.status)) {
      throw new Error(
        `local-content-writer: idea ${input.idea_id} has status '${idea.status}' — must be approved or auto_approved`,
      );
    }

    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, idea.siteId))
      .limit(1);
    if (!site) throw new Error(`local-content-writer: site not found: ${idea.siteId}`);

    const story = isStoryArchetype(idea.archetype);
    const original = isOriginalArchetype(idea.archetype);

    // For job stories, resolve the site theme and load the niche-knowledge
    // block so the narrative's problem/fix stays factually accurate.
    let themeKey: 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel' | undefined;
    let nicheKnowledge: string | null = null;
    if (story) {
      themeKey = await resolveSiteThemeKey(idea.siteId);
      nicheKnowledge = loadNicheKnowledge(themeKey);
    }

    // Proprietary inputs: grounded facts for original_* archetypes (hard
    // requirement — see ORIGINAL_ARCHETYPE_SEED_FIELD), author attribution for
    // every draft when an expertise profile exists.
    const [dataRow] = await db
      .select()
      .from(siteOriginalDataInputs)
      .where(eq(siteOriginalDataInputs.siteId, idea.siteId))
      .limit(1);

    const authorProfile = extractAuthorProfile(dataRow?.expertiseProfile ?? null);
    let groundedFacts: GroundedFactsInput | null = null;
    if (original) {
      groundedFacts = await loadGroundedFacts(idea.siteId, idea.archetype, dataRow ?? null);
      if (!groundedFacts) {
        throw new Error(
          `local-content-writer: idea ${input.idea_id} has original archetype '${idea.archetype}' but no grounded seeds/metric exist for site ${idea.siteId} — refusing to draft ungrounded original content`,
        );
      }
    }

    ctx.progress({ step: 2, total: 3, label: 'drafting content' });
    const drafted = await draftInfoPage({
      siteId: idea.siteId,
      proposedSlug: toSlug(idea.topic),
      proposedTitle: idea.topic,
      intent: story ? 'story' : 'info',
      niche: site.niche,
      city: site.city,
      state: site.state,
      ctx,
      themeKey,
      archetype: idea.archetype ?? undefined,
      voiceSeed: idea.voiceSeed ?? undefined,
      storyScaffold: story ? idea.storyScaffold : null,
      nicheKnowledge,
      groundedFacts,
      authorProfile,
      // Job stories, cost_guide/comparison, and original_* run a bit longer.
      lengthTarget:
        story || original || idea.archetype === 'cost_guide' || idea.archetype === 'comparison'
          ? 1100
          : 900,
    });

    // Optional compliance check: lazy-import so the test surface stays light.
    // Failures are logged but do not block publishing.
    try {
      const { ComplianceGuard } = await import('../compliance-guard/index');
      const guard = new ComplianceGuard();
      const result = await guard.run(
        { scope: 'site_content', content: drafted.mdx, siteId: idea.siteId },
        { parentRunId: ctx.runId },
      );
      if (!result.ok) {
        ctx.log.warn({ blockers: result.violations?.filter((v: { severity?: string }) => v.severity === 'blocker') }, 'local-content-writer: compliance blocker — aborting');
        throw new Error('local-content-writer: compliance guard blocked the page');
      }
    } catch (err) {
      // ComplianceGuard run errors are non-fatal (guard is best-effort here).
      // Re-throw only if it's our own blocker signal above.
      if (err instanceof Error && err.message.includes('compliance guard blocked')) throw err;
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'local-content-writer: compliance check error, proceeding');
    }

    ctx.progress({ step: 3, total: 3, label: 'persisting to Sanity' });
    const slug = toSlug(idea.topic);
    const { pageDocId, slug: persistedSlug } = await persistInfoPage(idea.siteId, slug, drafted);

    // Stamp the idea row as published.
    await db
      .update(contentIdeas)
      .set({
        status: 'published',
        publishedPageDocId: pageDocId,
        publishedAt: new Date(),
        writerRunId: ctx.runId,
      })
      .where(eq(contentIdeas.id, input.idea_id));

    ctx.log.info({ pageDocId, slug: persistedSlug }, 'local-content-writer: page published');
    return { pageDocId, slug: persistedSlug };
  }
}

/** Map expertiseProfile jsonb → the drafting byline shape (strings only). */
function extractAuthorProfile(profile: Record<string, unknown> | null): AuthorProfileInput | null {
  if (!profile) return null;
  const authorName = typeof profile.authorName === 'string' ? profile.authorName.trim() : '';
  if (!authorName) return null;
  return {
    authorName,
    authorTitle: typeof profile.authorTitle === 'string' ? profile.authorTitle : undefined,
    authorBio: typeof profile.authorBio === 'string' ? profile.authorBio : undefined,
  };
}

/**
 * Load the verbatim grounded facts an original_* archetype may cite. Mirrors
 * content-data-auditor's gap detection: seed archetypes read the matching
 * siteOriginalDataInputs column; data_study reads the highest-sampleSize
 * qualifying siteNetworkMetrics row (>= MIN_SAMPLE). Returns null when the
 * required grounding is absent — the caller refuses to draft.
 */
async function loadGroundedFacts(
  siteId: string,
  archetype: string | null,
  dataRow: { caseStudyInputs?: unknown; firsthandInputs?: unknown; contrarianTakes?: unknown } | null,
): Promise<GroundedFactsInput | null> {
  if (!archetype) return null;

  if (archetype === 'data_study') {
    const db = getDb();
    const rows = await db
      .select({
        metricKind: siteNetworkMetrics.metricKind,
        value: siteNetworkMetrics.value,
        sampleSize: siteNetworkMetrics.sampleSize,
      })
      .from(siteNetworkMetrics)
      .where(eq(siteNetworkMetrics.siteId, siteId))
      .orderBy(desc(siteNetworkMetrics.computedAt));
    // Latest row per metricKind, then the most defensible qualifying metric.
    const seen = new Set<string>();
    let best: { metricKind: string; value: Record<string, unknown>; sampleSize: number } | null = null;
    for (const r of rows) {
      if (seen.has(r.metricKind)) continue;
      seen.add(r.metricKind);
      if (r.sampleSize >= MIN_SAMPLE && (!best || r.sampleSize > best.sampleSize)) {
        best = { metricKind: r.metricKind, value: r.value, sampleSize: r.sampleSize };
      }
    }
    if (!best) return null;
    return { source: 'siteNetworkMetrics', metric: best, illustrative: false };
  }

  const field = ORIGINAL_ARCHETYPE_SEED_FIELD[archetype];
  if (!field) return null;
  const seeds = Array.isArray(dataRow?.[field])
    ? (dataRow![field] as Array<Record<string, unknown>>)
    : [];
  if (seeds.length === 0) return null;
  return { source: field, seeds, illustrative: anySeedIllustrative(seeds) };
}
