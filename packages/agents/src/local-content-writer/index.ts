import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, sites, contentIdeas } from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { draftInfoPage } from '../shared/author-info-page';
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

    ctx.progress({ step: 2, total: 3, label: 'drafting content' });
    const drafted = await draftInfoPage({
      siteId: idea.siteId,
      proposedSlug: toSlug(idea.topic),
      proposedTitle: idea.topic,
      intent: 'info',
      niche: site.niche,
      city: site.city,
      state: site.state,
      ctx,
      archetype: idea.archetype ?? undefined,
      voiceSeed: idea.voiceSeed ?? undefined,
      // Map archetype to a length target: cost_guide and comparison are longer.
      lengthTarget: idea.archetype === 'cost_guide' || idea.archetype === 'comparison' ? 1200 : 900,
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
