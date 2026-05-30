import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb, sites, niches, agentEvents, networks, siteNetworkMemberships } from '@leadlandlord/db';
import { imagen, klaviyo } from '@leadlandlord/integrations';
import {
  createWriteClient,
  siteDocId,
  uploadHeroImage,
} from '@leadlandlord/integrations/sanity';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngine } from '../content-engine/index';
import { generateLongformBody } from '../content-engine/index';
import { KeywordPlanner } from '../keyword-planner/index';
import { ComplianceGuard } from '../compliance-guard/index';
import { CompetitorAnalyzer } from '../competitor-analyzer/index';
import type { CompetitorBrief } from '../competitor-analyzer/schema';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { SiteBuilderInput, SiteBuilderOutput } from './schema';
import { ensureSiteDocStub, writeSiteToSanity, patchLongformInSanity } from './persist-sanity';
import { loadKeywordClustersForSite, type KeywordClusterInput } from './read-clusters';
import { pickTheme } from './pick-theme';
import { pickPaletteForSite } from './pick-palette';

export type SiteBuilderProgressEvent =
  | { step: 'site_row_ready'; site_id: string }
  | { step: 'keywords_planning_started' }
  | { step: 'keywords_planned'; clusters: number; total_volume: number }
  | { step: 'content_started' }
  | { step: 'content_generated'; pages: number }
  | { step: 'tracking_provisioned'; number: string; provider: string }
  | { step: 'klaviyo_list_ready'; list_id: string | null }
  | { step: 'network_joined'; network_slug: string }
  | { step: 'sanity_publish_started' }
  | { step: 'sanity_pages_written'; pages: number }
  | { step: 'sanity_site_doc_written'; site_doc_id: string; theme: string; color_palette: string }
  | { step: 'hero_image_started' }
  | { step: 'hero_image_done'; url: string | null }
  | { step: 'competitor_analysis_started' }
  | { step: 'competitor_analysis_done'; competitors: number }
  | { step: 'longform_started' }
  | { step: 'longform_done'; chars: number }
  | { step: 'site_ready'; site_doc_id: string };

export class SiteBuilder extends BaseAgent<typeof SiteBuilderInput, typeof SiteBuilderOutput> {
  private readonly contentEngine = new ContentEngine();
  private readonly keywordPlanner = new KeywordPlanner();
  private readonly competitorAnalyzer = new CompetitorAnalyzer();

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

    // Long-form-only backfill: regenerate just the keyword-rich home intro and
    // patch it onto the existing site doc. No keyword planning, content
    // generation, compliance gate, hero image, or page writes — and the manual
    // video fields are left untouched.
    if (input.longform_only) {
      return this.runLongformOnly(input, ctx);
    }

    // 1. Insert/find site row.
    ctx.progress({ step: 1, total: 8, label: 'preparing site record' });
    const siteId = await this.upsertSite(input);
    ctx.log.info({ siteId }, 'site row ready');
    this.emit({ step: 'site_row_ready', site_id: siteId });

    const siteRow = (
      await db.select({ siteMode: sites.siteMode }).from(sites).where(eq(sites.id, siteId)).limit(1)
    )[0];
    const siteMode = siteRow?.siteMode ?? 'thin';

    // Resolve the build epoch — the stable anchor for expensive sub-agent
    // dedupe keys. Set once on first build (COALESCE keeps any existing value
    // so a reaper retry reuses the same epoch → cache hit). An explicit
    // refresh (force_content_refresh) or a re-target (skip_keyword_planning
    // regenerates content against existing clusters) bumps it so content is
    // regenerated rather than served from the prior cached run.
    const wantsFreshContent =
      input.force_content_refresh === true || (input.skip_keyword_planning ?? false);
    const newEpoch = randomUUID();
    const [epochRow] = await db
      .update(sites)
      .set({
        status: 'building',
        updatedAt: new Date(),
        buildEpoch: wantsFreshContent
          ? newEpoch
          : sql`COALESCE(${sites.buildEpoch}, ${newEpoch})`,
      })
      .where(eq(sites.id, siteId))
      .returning({ buildEpoch: sites.buildEpoch });
    const buildEpoch = epochRow?.buildEpoch ?? newEpoch;

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
      ctx.progress({ step: 2, total: 8, label: 'planning keyword clusters' });
      this.emit({ step: 'keywords_planning_started' });
      const planResult = await this.keywordPlanner.run(
        {
          site_id: siteId,
          niche: input.niche,
          city: input.city,
          state: input.state.toUpperCase(),
          site_mode: siteMode,
        },
        { siteId, parentRunId: ctx.runId, dedupeKey: `kp:${siteId}:${buildEpoch}` },
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

    // 2b. Competitor analysis -- non-fatal. A failure here must never abort
    // the build; missing competitive intelligence is far preferable to a
    // site that never deploys.
    let competitorBrief: CompetitorBrief | undefined;
    this.emit({ step: 'competitor_analysis_started' });
    try {
      const brief = await this.competitorAnalyzer.run(
        {
          site_id: siteId,
          niche: input.niche,
          city: input.city,
          state: input.state.toUpperCase(),
          niche_id: input.niche_id,
        },
        { siteId, parentRunId: ctx.runId, dedupeKey: `ca:${siteId}:${buildEpoch}` },
      );
      competitorBrief = brief;
      // Persist the brief so operators can inspect it without re-running the agent.
      await db
        .update(sites)
        .set({ competitorBrief: brief as unknown as Record<string, unknown> })
        .where(eq(sites.id, siteId));
      ctx.log.info(
        { competitors: brief.competitors.length },
        'competitor brief persisted',
      );
      this.emit({ step: 'competitor_analysis_done', competitors: brief.competitors.length });
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'competitor-analyzer failed -- proceeding without brief',
      );
      this.emit({ step: 'competitor_analysis_done', competitors: 0 });
    }

    // 3. Generate content bundle.
    ctx.progress({ step: 3, total: 8, label: 'generating site content' });
    this.emit({ step: 'content_started' });
    // Theme drives which niche overlay the content engine loads, so it must be
    // resolved BEFORE generation — a later theme swap only re-skins CSS, it
    // does not regenerate copy. Prefer the niche's category (e.g. legal →
    // counsel) when the specific niche string isn't in the theme map, so legal
    // sites always get the compliance-constrained counsel overlay.
    let category: string | null = null;
    if (input.niche_id) {
      const [nicheRow] = await db
        .select({ category: niches.category })
        .from(niches)
        .where(eq(niches.id, input.niche_id))
        .limit(1);
      category = nicheRow?.category ?? null;
    }
    const theme = pickTheme(input.niche, category);
    ctx.log.info({ niche: input.niche, category, theme }, 'theme resolved for content engine');
    const bundle = await this.contentEngine.run(
      {
        site_id: siteId,
        niche: input.niche,
        city: input.city,
        state: input.state.toUpperCase(),
        fast_mode: input.fast_mode ?? false,
        keyword_clusters: clusters,
        theme,
        site_mode: siteMode,
        competitor_brief: competitorBrief,
      },
      { siteId, parentRunId: ctx.runId, dedupeKey: `ce:${siteId}:${buildEpoch}` },
    );
    ctx.log.info(
      { pages: countPages(bundle) },
      'content bundle generated',
    );
    this.emit({ step: 'content_generated', pages: countPages(bundle) });

    // Tracking-number provisioning is intentionally NOT part of the build path.
    // It's a paid Twilio call with its own failure modes (and would otherwise
    // run upstream of the Sanity write, so a telephony hiccup could block
    // publishing fully-generated content). Operators assign a number manually
    // from the site detail page; the TrackingSetup agent remains available for
    // that out-of-band flow.

    // 3b. Provision a Klaviyo list for this site (idempotent — skips when one
    //     is already saved on the row, or when Klaviyo creds aren't set).
    const klaviyoListId = await this.ensureKlaviyoList(siteId, bundle, ctx);
    this.emit({ step: 'klaviyo_list_ready', list_id: klaviyoListId ?? null });

    // 4. Persist content to Sanity. Single transactional createOrReplace —
    //    deterministic doc IDs make it idempotent across re-runs. Replaces
    //    the legacy materialize → vercel project create → env-var sync chain
    //    (no per-tenant Vercel project anymore — all rendering goes through
    //    the shared `leadlandlord-sites` project).
    ctx.progress({ step: 5, total: 8, label: 'publishing pages to Sanity' });

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
            { siteId, parentRunId: ctx.runId, dedupeKey: `cg:${siteId}:${buildEpoch}:${page.slug}` },
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
    const persisted = await writeSiteToSanity(siteId, bundle, {
      colorPalette: pickPaletteForSite(siteId),
    });
    ctx.log.info(
      { pages: persisted.pagesWritten, txId: persisted.transactionId },
      'site + pages written to sanity',
    );
    this.emit({ step: 'sanity_pages_written', pages: persisted.pagesWritten });
    this.emit({
      step: 'sanity_site_doc_written',
      site_doc_id: persisted.siteDocId,
      theme: bundle.variant,
      color_palette: persisted.colorPalette,
    });

    // 6.5. Join the default network (idempotent). Looks up the 'default' network
    //     seeded in migration 0021 and upserts a membership row. ON CONFLICT DO
    //     NOTHING handles the unique-on-siteId index gracefully.
    ctx.progress({ step: 6, total: 8, label: 'joining site network' });
    try {
      const [defaultNetwork] = await db
        .select({ id: networks.id, slug: networks.slug })
        .from(networks)
        .where(eq(networks.slug, 'default'))
        .limit(1);

      if (defaultNetwork) {
        await db
          .insert(siteNetworkMemberships)
          .values({ siteId, networkId: defaultNetwork.id })
          .onConflictDoNothing();
        ctx.log.info({ siteId, networkId: defaultNetwork.id }, 'site joined default network');
        this.emit({ step: 'network_joined', network_slug: defaultNetwork.slug });
      } else {
        ctx.log.warn({ siteId }, 'default network not found — skipping network join');
      }
    } catch (err) {
      // Non-fatal: network joining must not block site delivery.
      ctx.log.warn(
        { err: err instanceof Error ? err.message : err },
        'network join failed — proceeding without it',
      );
    }

    // 7. Hero image — generate buffer, upload to Sanity assets, patch the
    //    site doc to reference the new asset. Failures here are non-fatal:
    //    variants render their placeholder background when no hero is set.
    let heroUrl: string | null = null;
    if (bundle.hero_image_prompt) {
      ctx.progress({ step: 7, total: 8, label: 'generating hero image' });
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
        color_palette: persisted.colorPalette,
      },
    });

    ctx.progress({ step: 8, total: 8, label: 'finalizing site' });
    this.emit({ step: 'site_ready', site_doc_id: persisted.siteDocId });

    return {
      site_id: siteId,
      sanity_site_doc_id: persisted.siteDocId,
      pages_written: persisted.pagesWritten,
      theme: bundle.variant,
      color_palette: persisted.colorPalette,
      hero_image_url: heroUrl,
      tracking_number: null,
      tracking_provider: null,
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

  /**
   * Regenerate only the long-form home intro for an existing site and patch it
   * onto the Sanity site doc. Cheap (single ~3K-token call) and surgical — it
   * never touches page docs, tracking, hero, or the manual video fields.
   */
  private async runLongformOnly(
    input: SiteBuilderInput,
    ctx: AgentContext,
  ): Promise<SiteBuilderOutput> {
    const siteId = input.site_id;
    if (!siteId) throw new Error('site-builder: longform_only requires site_id');
    const db = getDb();

    // Resolve the niche category so the long-form generation loads the same
    // niche overlay the full build would (e.g. legal → counsel).
    let category: string | null = null;
    if (input.niche_id) {
      const [nicheRow] = await db
        .select({ category: niches.category })
        .from(niches)
        .where(eq(niches.id, input.niche_id))
        .limit(1);
      category = nicheRow?.category ?? null;
    }
    const theme = pickTheme(input.niche, category);

    ctx.progress({ step: 1, total: 2, label: 'loading keyword clusters' });
    const clusters = await loadKeywordClustersForSite(siteId);

    ctx.progress({ step: 2, total: 2, label: 'generating long-form intro' });
    this.emit({ step: 'longform_started' });
    const result = await generateLongformBody({
      niche: input.niche,
      city: input.city,
      state: input.state.toUpperCase(),
      theme,
      keyword_clusters: clusters,
    });
    ctx.recordUsage({
      model: result.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_read_input_tokens: result.usage.cache_read_input_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
      cost_usd: result.cost_usd,
    });

    await patchLongformInSanity(siteId, result.longform_body, result.generated_at);
    ctx.log.info({ siteId, chars: result.longform_body.length }, 'long-form intro patched');
    this.emit({ step: 'longform_done', chars: result.longform_body.length });

    const row = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
    const { theme: resolvedTheme, palette } = await readSiteThemePalette(siteId);

    return {
      site_id: siteId,
      sanity_site_doc_id: siteDocId(siteId),
      pages_written: 0,
      theme: resolvedTheme,
      color_palette: palette,
      hero_image_url: null,
      tracking_number: row?.trackingNumber ?? null,
      tracking_provider: (row?.trackingProvider as 'twilio' | 'mock' | null) ?? null,
      deployed_at: (row?.deployedAt ?? new Date()).toISOString(),
    };
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

type ThemeName = 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';
const THEME_NAMES: readonly ThemeName[] = ['classic', 'modern', 'premium', 'bright', 'haul', 'counsel'];
const PALETTES = ['default', 'alt1', 'alt2'] as const;

/**
 * Read the active theme name + color palette off the Sanity site doc (theme is
 * a deref). Used by the long-form-only path to shape its output without
 * re-running theme/palette selection. Defaults to classic/default.
 */
async function readSiteThemePalette(
  siteId: string,
): Promise<{ theme: ThemeName; palette: (typeof PALETTES)[number] }> {
  try {
    const doc = await createWriteClient().fetch<{ theme: string | null; palette: string | null } | null>(
      `*[_id == $id][0]{ "theme": theme->name, "palette": colorPalette }`,
      { id: siteDocId(siteId) },
    );
    const theme = THEME_NAMES.includes(doc?.theme as ThemeName) ? (doc!.theme as ThemeName) : 'classic';
    const palette = (PALETTES as readonly string[]).includes(doc?.palette ?? '')
      ? (doc!.palette as (typeof PALETTES)[number])
      : 'default';
    return { theme, palette };
  } catch {
    return { theme: 'classic', palette: 'default' };
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
