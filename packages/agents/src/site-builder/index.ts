import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { getDb, sites, agentEvents } from '@leadlandlord/db';
import { vercel } from '@leadlandlord/integrations';
import { BaseAgent, type AgentContext } from '../base';
import { ContentEngine } from '../content-engine/index';
import { TrackingSetup } from '../tracking-setup/index';
import { SiteBuilderInput, SiteBuilderOutput } from './schema';
import { materializeSite } from './materialize';

export class SiteBuilder extends BaseAgent<typeof SiteBuilderInput, typeof SiteBuilderOutput> {
  private readonly contentEngine = new ContentEngine();
  private readonly trackingSetup = new TrackingSetup();

  constructor() {
    super({
      name: 'site-builder',
      inputSchema: SiteBuilderInput,
      outputSchema: SiteBuilderOutput,
      dedupeKeyFn: (i) => `${slug(i.niche)}:${slug(i.city)}:${i.state.toUpperCase()}`,
      defaultDailyCapUsd: 15,
    });
  }

  protected async execute(input: SiteBuilderInput, ctx: AgentContext): Promise<SiteBuilderOutput> {
    const db = getDb();

    // 1. Insert/find site row.
    const siteId = await this.upsertSite(input);
    ctx.log.info({ siteId }, 'site row ready');

    await db
      .update(sites)
      .set({ status: 'building', updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    // 2. Generate content bundle.
    const bundle = await this.contentEngine.run(
      {
        site_id: siteId,
        niche: input.niche,
        city: input.city,
        state: input.state.toUpperCase(),
        fast_mode: input.fast_mode ?? false,
      },
      { siteId, parentRunId: ctx.runId },
    );
    ctx.log.info(
      { pages: countPages(bundle) },
      'content bundle generated',
    );

    // 3. Provision tracking number (mocked when MOCK_TELEPHONY=true).
    const tracking = await this.trackingSetup.run(
      { site_id: siteId },
      { siteId, parentRunId: ctx.runId },
    );

    // 4. Pick a Vercel project name.
    const projectName = await vercel.projectNameFor({
      niche: input.niche,
      city: input.city,
      state: input.state,
    });
    ctx.log.info({ projectName }, 'reserved project name');

    // 5. Create the project (idempotent).
    const project = await vercel.createProject({
      name: projectName,
      framework: 'nextjs',
      envVars: {
        NEXT_PUBLIC_SITE_NAME: bundle.business_name,
        NEXT_PUBLIC_NICHE: bundle.niche,
        NEXT_PUBLIC_CITY: bundle.city,
        NEXT_PUBLIC_STATE: bundle.state,
        NEXT_PUBLIC_TRACKING_NUMBER: tracking.number,
      },
    });

    // 6. Materialize site files into a build dir.
    const buildDir = resolve(tmpdir(), `llbuild-${siteId}`);
    await materializeSite({
      buildDir,
      bundle,
      trackingNumber: tracking.number,
      vercelProjectName: projectName,
    });
    ctx.log.info({ buildDir }, 'site files materialized');

    // 7. Deploy.
    const deploy = await vercel.deployDirectory({
      projectName,
      cwd: buildDir,
    });
    ctx.log.info({ url: deploy.url, durationMs: deploy.durationMs }, 'deploy succeeded');

    const deployedAt = new Date();

    // 8. Update site row.
    await db
      .update(sites)
      .set({
        status: 'warming',
        domain: deploy.url,
        vercelProjectId: project.id,
        vercelProjectName: projectName,
        trackingNumber: tracking.number,
        trackingProvider: tracking.provider,
        deployedAt,
        updatedAt: deployedAt,
      })
      .where(eq(sites.id, siteId));

    // 9. Emit event so downstream agents (SEO Operator, Backlink Builder) can wake up.
    await db.insert(agentEvents).values({
      agent: 'site-builder',
      type: 'site.deployed',
      targetAgent: 'seo-operator',
      payload: {
        site_id: siteId,
        preview_url: deploy.url,
        vercel_project_id: project.id,
      },
    });

    return {
      site_id: siteId,
      vercel_project_id: project.id,
      vercel_project_name: projectName,
      preview_url: deploy.url,
      tracking_number: tracking.number,
      tracking_provider: tracking.provider,
      deployed_at: deployedAt.toISOString(),
      build_dir: buildDir,
    };
  }

  private async upsertSite(input: SiteBuilderInput): Promise<string> {
    const db = getDb();
    if (input.site_id) return input.site_id;

    const stateUpper = input.state.toUpperCase();
    const existing = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.niche, input.niche));
    const match = existing.find((_) => true); // narrow the OR below in a follow-up
    if (match) {
      // This is a coarse check; real dedup is enforced by the unique index on (niche, city, state).
      // We rely on the dedupe_key short-circuit in BaseAgent for true idempotency.
    }

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
        set: { updatedAt: new Date() },
      })
      .returning({ id: sites.id });
    return row!.id;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function countPages(bundle: { services: unknown[]; service_areas: unknown[]; blog_posts: unknown[] }) {
  return 3 + bundle.services.length + bundle.service_areas.length + bundle.blog_posts.length;
}

export { SiteBuilderInput, SiteBuilderOutput } from './schema';
