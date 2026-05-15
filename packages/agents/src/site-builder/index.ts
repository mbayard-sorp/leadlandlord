import { eq } from 'drizzle-orm';
import { getDb, sites, agentEvents } from '@leadlandlord/db';
import { imagen, klaviyo } from '@leadlandlord/integrations';
import {
  createWriteClient,
  siteDocId,
  uploadHeroImage,
} from '@leadlandlord/integrations/sanity';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngine } from '../content-engine/index';
import { TrackingSetup } from '../tracking-setup/index';
import { KeywordPlanner } from '../keyword-planner/index';
import { ComplianceGuard } from '../compliance-guard/index';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { SiteBuilderInput, SiteBuilderOutput } from './schema';
import { ensureSiteDocStub, writeSiteToSanity } from './persist-sanity';
import { loadKeywordClustersForSite, type KeywordClusterInput } from './read-clusters';
import { pickThemeForNiche } from './pick-theme';

export type SiteBuilderProgressEvent =
  | { step: 'site_row_ready'; site_id: string }
  | { step: 'keywords_planning_started' }
  | { step: 'keywords_planned'; clusters: number; total_volume: number }
  | { step: 'content_started' }
  | { step: 'content_generated'; pages: number }
  | { step: 'tracking_provisioned'; number: string; provider: string }
  | { step: 'klaviyo_list_ready'; list_id: string | null }
  | { step: 'sanity_publish_started' }
  | { step: 'sanity_pages_written'; pages: number }
  | { step: 'sanity_site_doc_written'; site_doc_id: string; theme: string }
  | { step: 'hero_image_started' }
  | { step: 'hero_image_done'; url: string | null }
  | { step: 'site_ready'; site_doc_id: string };

export class SiteBuilder extends BaseAgent<typeof SiteBuilderInput, typeof SiteBuilderOutput> {
  private readonly contentEngine = new ContentEngine();
  private readonly trackingSetup = new TrackingSetup();
  private readonly keywordPlanner = new KeywordPlanner();

  /**
   * Optional progress callback invoked at each step. Used by /operator/build
   * to stream live updates over Server-Sent Events. Errors thrown by the
   * callback are swallowed — progress reporting must never break the build.
   */
  constructor(private onProgress?: (event: SiteBuilderProgressEvent) => void) {
    super({
      name: 'site-builder',
      inputSchema: SiteBuilderInput,
      outputSchema: SiteBuilderOutput,
      dedupeKeyFn: (i) => `${slug(i.niche)}:${slug(i.city)}:${i.state.toUpperCase()}`,
      defaultDailyCapUsd: 15,
    });
  }

  private emit(event: SiteBuilderProgressEvent): void {
    if (!this.onProgress) return;
    try {
      this.onProgress(event);
    } catch {
      // never let a misbehaving callback break the build
    }
  }

  protected async execute(input: SiteBuilderInput, ctx: AgentContext): Promise<SiteBuilderOutput> {
    const db = getDb();

    // 1. Insert/find site row.
    ctx.progress({ step: 1, total: 7, label: 'preparing site record' });
    const siteId = await this.upsertSite(input);
    ctx.log.info({ siteId }, 'site row ready');
    this.emit({ step: 'site_row_ready', site_id: siteId });

    const siteRow = (
      await db.select({ siteMode: sites.siteMode }).from(sites).where(eq(sites.id, siteId)).limit(1)
    )[0];
    const siteMode = siteRow?.siteMode ?? 'thin';

    await db
      .update(sites)
      .set({ status: 'building', updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    // 1b. Create a minimal Sanity site stub so keyword-planner's cluster
    //     docs (which carry a `site` reference) don't fail with "non-existent
    //     document" errors. The full createOrReplace at step 4 overwrites
    //     this stub with the populated version. Idempotent on re-runs.
    await ensureSiteDocStub(siteId, {
      niche: input.niche,
      city: input.city,
      state: input.state,
    });

    // 2. Plan keyword clusters from DataForSEO. Skipped on re-target so the
    //    operator can refresh content without re-paying for keyword research.
    let clusters: KeywordClusterInput[] = [];
    let skipPlanner = input.skip_keyword_planning ?? false;
    // Auto-skip when clusters already exist for this site. Belt-and-suspenders
    // guard against the cluster.ready cascade: if a prior site-builder run
    // already populated clusters in Sanity, a re-dispatched run (e.g. cron
    // claiming a stale cluster.ready event) will skip planner, breaking the
    // loop even if sub-emit suppression fails. Hit 2026-05-08: keyword-planner
    // emitted cluster.ready despite being a sub-agent, fired 4 cascading
    // site-builder runs before manual halt.
    if (!skipPlanner) {
      const existing = await loadKeywordClustersForSite(siteId);
      if (existing.length > 0) {
        ctx.log.info(
          { existingClusters: existing.length },
          'site already has clusters, skipping keyword-planner (loop guard)',
        );
        skipPlanner = true;
      }
    }
    if (!skipPlanner) {
      ctx.progress({ step: 2, total: 7, label: 'planning keyword clusters' });
      this.emit({ step: 'keywords_planning_started' });
      const planResult = await this.keywordPlanner.run(
        {
          site_id: siteId,
          niche: input.niche,
          city: input.city,
          state: input.state.toUpperCase(),
          site_mode: siteMode,
        },
        { siteId, parentRunId: ctx.runId, dedupeKey: `${ctx.runId}:keyword-planner` },
      );
      ctx.log.info(
        { clusters: planResult.clusters_persisted, totalVolume: planResult.total_volume },
        'keyword clusters planned',
      );
      this.emit({
        step: 'keywords_planned',
        clusters: planResult.clusters_persisted,
        total_volume: planResult.total_volume,
      });
    }
    // Always read clusters from Sanity (whether we just wrote them or
    // they're being reused for a re-target). Empty list is acceptable for
    // backwards-compat — Content Engine handles missing clusters gracefully.
    clusters = await loadKeywordClustersForSite(siteId);
    ctx.log.info({ clusters: clusters.length }, 'clusters loaded for content engine');

    // 3. Generate content bundle.
    ctx.progress({ step: 3, total: 7, label: 'generating site content' });
    this.emit({ step: 'content_started' });
    const bundle = await this.contentEngine.run(
      {
        site_id: siteId,
        niche: input.niche,
        city: input.city,
        state: input.state.toUpperCase(),
        fast_mode: input.fast_mode ?? false,
        keyword_clusters: clusters,
        theme: pickThemeForNiche(input.niche),
        site_mode: siteMode,
      },
      { siteId, parentRunId: ctx.runId, dedupeKey: `${ctx.runId}:content-engine` },
    );
    ctx.log.info(
      { pages: countPages(bundle) },
      'content bundle generated',
    );
    this.emit({ step: 'content_generated', pages: countPages(bundle) });

    // 3. Provision tracking number (mocked when MOCK_TELEPHONY=true).
    ctx.progress({ step: 4, total: 7, label: 'provisioning tracking number' });
    const tracking = await this.trackingSetup.run(
      { site_id: siteId },
      { siteId, parentRunId: ctx.runId, dedupeKey: `${ctx.runId}:tracking-setup` },
    );
    this.emit({
      step: 'tracking_provisioned',
      number: tracking.number,
      provider: tracking.provider,
    });

    // 3b. Provision a Klaviyo list for this site (idempotent — skips when one
    //     is already saved on the row, or when Klaviyo creds aren't set).
    const klaviyoListId = await this.ensureKlaviyoList(siteId, bundle, ctx);
    this.emit({ step: 'klaviyo_list_ready', list_id: klaviyoListId ?? null });

    // 4. Persist content to Sanity. Single transactional createOrReplace —
    //    deterministic doc IDs make it idempotent across re-runs. Replaces
    //    the legacy materialize → vercel project create → env-var sync chain
    //    (no per-tenant Vercel project anymore — all rendering goes through
    //    the shared `leadlandlord-sites` project).
    ctx.progress({ step: 5, total: 7, label: 'publishing pages to Sanity' });

    // 4a. Compliance gate. Run compliance-guard on every page's MDX before we
    //     publish to Sanity. Any blocker → emit `site.compliance.failed` and
    //     throw an IntegrationError so the agent_runs row fails (no publish).
    //     Soft override via COMPLIANCE_GATE_DISABLED=true for dev only.
    if (process.env.COMPLIANCE_GATE_DISABLED === 'true') {
      ctx.log.warn(
        { siteId },
        'COMPLIANCE_GATE_DISABLED=true — skipping site_publish compliance check',
      );
    } else {
      const guard = new ComplianceGuard();
      const allPages = [
        bundle.home,
        ...bundle.services,
        ...bundle.service_areas,
        bundle.about,
        bundle.contact,
        ...bundle.blog_posts,
        ...bundle.info_pages,
      ];
      const failures: Array<{ slug: string; rule: string; message: string; details?: string[] }> = [];
      for (const page of allPages) {
        try {
          const result = await guard.run(
            { scope: 'site_publish', text: page.mdx, metadata: { slug: page.slug, kind: page.kind } },
            { siteId, parentRunId: ctx.runId, dedupeKey: `${ctx.runId}:compliance-guard:${page.slug}` },
          );
          if (!result.ok) {
            for (const v of result.violations) {
              if (v.severity === 'blocker') {
                failures.push({ slug: page.slug, rule: v.rule, message: v.message, details: v.details });
              }
            }
          }
        } catch (err) {
          // Compliance guard failure should not be silently swallowed — but
          // also shouldn't crash the build over a guard internal error. Log
          // + treat as a warning, not a blocker. Operator can re-run.
          ctx.log.warn(
            { slug: page.slug, err: err instanceof Error ? err.message : err },
            'compliance-guard internal error on page — proceeding (no blocker)',
          );
        }
      }
      if (failures.length > 0) {
        ctx.log.error({ siteId, failures }, 'compliance gate blocked publish');
        await ctx.emitNextStepEvent({
          type: 'site.compliance.failed',
          targetAgent: 'operator',
          payload: { site_id: siteId, failures },
        });
        throw new IntegrationError(
          'compliance-guard',
          `compliance gate blocked publish: ${failures.length} blocker(s) across ${
            new Set(failures.map((f) => f.slug)).size
          } page(s)`,
        );
      }
    }

    this.emit({ step: 'sanity_publish_started' });
    const persisted = await writeSiteToSanity(siteId, bundle);
    ctx.log.info(
      { pages: persisted.pagesWritten, txId: persisted.transactionId },
      'site + pages written to sanity',
    );
    this.emit({ step: 'sanity_pages_written', pages: persisted.pagesWritten });
    this.emit({
      step: 'sanity_site_doc_written',
      site_doc_id: persisted.siteDocId,
      theme: bundle.variant,
    });

    // 5. Hero image — generate buffer, upload to Sanity assets, patch the
    //    site doc to reference the new asset. Failures here are non-fatal:
    //    variants render their placeholder background when no hero is set.
    let heroUrl: string | null = null;
    if (bundle.hero_image_prompt) {
      ctx.progress({ step: 6, total: 7, label: 'generating hero image' });
      this.emit({ step: 'hero_image_started' });
      try {
        const img = await imagen.generateHeroImageBuffer(bundle.hero_image_prompt);
        if (img) {
          const uploaded = await uploadHeroImage(siteId, img.buffer);
          await createWriteClient()
            .patch(siteDocId(siteId))
            .set({
              heroImage: {
                _type: 'image',
                asset: { _type: 'reference', _ref: uploaded.assetId },
              },
            })
            .commit({ visibility: 'sync' });
          heroUrl = uploaded.url;
          ctx.log.info(
            { assetId: uploaded.assetId, size: uploaded.size, model: img.model, provider: img.provider },
            'hero image uploaded to sanity',
          );
        }
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : err },
          'hero image generation/upload failed — proceeding without it',
        );
      }
      this.emit({ step: 'hero_image_done', url: heroUrl });
    }

    const deployedAt = new Date();

    // 6. Update site row. NOTE: we keep the legacy `vercelProjectId` /
    //    `vercelProjectName` columns nullable + leave them unset — every site
    //    now renders out of the shared `leadlandlord-sites` project, so per-
    //    tenant Vercel project IDs aren't a thing anymore. The columns stay
    //    on the schema for backward compat with rows from before the pivot.
    await db
      .update(sites)
      .set({
        status: 'warming',
        trackingNumber: tracking.number,
        trackingProvider: tracking.provider,
        deployedAt,
        updatedAt: deployedAt,
      })
      .where(eq(sites.id, siteId));

    // 7. Emit event so downstream agents (SEO Operator, Backlink Builder)
    //    wake up. Helper auto-suppresses when site-builder is itself running
    //    as a sub-agent (e.g. via a future portfolio-level orchestrator) —
    //    same cascade-prevention as keyword-planner's cluster.ready emit.
    await ctx.emitNextStepEvent({
      type: 'site.deployed',
      targetAgent: 'seo-operator',
      payload: {
        site_id: siteId,
        sanity_site_doc_id: persisted.siteDocId,
        theme: bundle.variant,
      },
    });

    ctx.progress({ step: 7, total: 7, label: 'finalizing site' });
    this.emit({ step: 'site_ready', site_doc_id: persisted.siteDocId });

    return {
      site_id: siteId,
      sanity_site_doc_id: persisted.siteDocId,
      pages_written: persisted.pagesWritten,
      theme: bundle.variant,
      hero_image_url: heroUrl,
      tracking_number: tracking.number,
      tracking_provider: tracking.provider,
      deployed_at: deployedAt.toISOString(),
    };
  }

  /**
   * Idempotently ensure a Klaviyo list exists for this site and the row's
   * `klaviyoListId` is set. Returns the list ID, or undefined when Klaviyo
   * isn't configured (sites without a list ID just skip the subscribe step in
   * /api/lead — the lead row still gets written + operator still notified).
   */
  private async ensureKlaviyoList(
    siteId: string,
    bundle: { niche: string; city: string; state: string },
    ctx: AgentContext,
  ): Promise<string | undefined> {
    if (!process.env.KLAVIYO_PRIVATE_API_KEY) {
      ctx.log.info('klaviyo: KLAVIYO_PRIVATE_API_KEY not set — skipping list creation');
      return undefined;
    }
    const db = getDb();
    const row = (
      await db
        .select({ klaviyoListId: sites.klaviyoListId })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1)
    )[0];
    if (row?.klaviyoListId) {
      ctx.log.info({ listId: row.klaviyoListId }, 'klaviyo: list already provisioned');
      return row.klaviyoListId;
    }
    try {
      const listName = `${cap(bundle.niche)} · ${bundle.city}, ${bundle.state}`;
      const { listId } = await klaviyo.createList(listName);
      await db.update(sites).set({ klaviyoListId: listId }).where(eq(sites.id, siteId));
      ctx.log.info({ listId, listName }, 'klaviyo: list created');
      return listId;
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'klaviyo: list creation failed — proceeding without it',
      );
      return undefined;
    }
  }

  private async upsertSite(input: SiteBuilderInput): Promise<string> {
    const db = getDb();
    if (input.site_id) return input.site_id;

    const stateUpper = input.state.toUpperCase();
    const [row] = await db
      .insert(sites)
      .values({
        niche: input.niche,
        city: input.city,
        state: stateUpper,
        nicheId: input.niche_id ?? null,
        status: 'queued',
      })
      .onConflictDoUpdate({
        target: [sites.niche, sites.city, sites.state],
        set: {
          updatedAt: new Date(),
          ...(input.niche_id ? { nicheId: input.niche_id } : {}),
        },
      })
      .returning({ id: sites.id });
    return row!.id;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function countPages(bundle: { services: unknown[]; service_areas: unknown[]; blog_posts: unknown[]; info_pages: unknown[] }) {
  return 3 + bundle.services.length + bundle.service_areas.length + bundle.blog_posts.length + bundle.info_pages.length;
}

export { SiteBuilderInput, SiteBuilderOutput } from './schema';
export { writeSiteToSanity } from './persist-sanity';
