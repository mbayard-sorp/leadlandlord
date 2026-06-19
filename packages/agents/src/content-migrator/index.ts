import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { uploadHeroImage } from '@leadlandlord/integrations/sanity';
import { scrapeSiteForMigration } from '@leadlandlord/integrations/firecrawl';
import { BaseAgent, type AgentContext } from '../base';
import {
  ContentMigratorInput,
  ContentMigratorOutput,
  MIGRATION_CRAWL_CAP_KEY,
  PENDING_MIGRATION_KEY,
  type ContentMigratorOutput as ContentMigratorOutputType,
  type MigratedAsset,
  type MigratedUgcItem,
  type MigrationSuggestions,
} from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

const SUBMIT_TOOL = 'submit_migration';

/** Max candidate images shown to the vision model (token cost guard). */
const MAX_VISION_IMAGES = 8;
/** Max images we download + upload to Sanity per run (cost + lambda-time guard). */
const MAX_UPLOADS = 9;
/** Reject image downloads larger than this (anti-abuse). */
const MAX_IMAGE_BYTES = 5_000_000;

/** Firecrawl flat cost per migration scrape (Starter tier, ~$0.005–0.01). */
const FIRECRAWL_SCRAPE_COST_USD = 0.01;

/** Structured extraction Claude returns via the submit tool. */
const MigrationExtraction = z.object({
  headline: z.string().optional(),
  aboutBody: z.string().optional(),
  services: z
    .array(z.object({ icon: z.string(), title: z.string(), description: z.string() }))
    .max(6)
    .optional(),
  socials: z.array(z.object({ platform: z.string(), href: z.string() })).optional(),
  logoUrl: z.string().optional(),
  heroImageUrl: z.string().optional(),
  aboutImageUrl: z.string().optional(),
  ugc: z
    .array(
      z.object({
        platform: z.string(),
        postUrl: z.string().optional(),
        caption: z.string().optional(),
        imageUrl: z.string().optional(),
      }),
    )
    .max(8)
    .optional(),
  nap: z.object({ phone: z.string().optional(), address: z.string().optional() }).optional(),
});
type MigrationExtraction = z.infer<typeof MigrationExtraction>;

/**
 * content-migrator — crawls a prospect's existing website and stages
 * operator-reviewable content suggestions on the draft buildsell_sites row.
 *
 * It NEVER touches the live Sanity doc. It uploads chosen images to Sanity's
 * asset store (orphan until the operator approves them) and writes the
 * suggestion blob to `metadata.pendingMigration`. The operator approves/edits
 * each item via the review queue; applyMigrationSelections then patches the doc.
 *
 * Cost discipline: BaseAgent gates a per-day cap; this agent additionally
 * enforces a per-site/day crawl cap (MIGRATION_CRAWL_CAP_PER_DAY, default 3)
 * stored in metadata, mirroring regenerateBuildSellImage's regenCap counter.
 */
export class ContentMigrator extends BaseAgent<typeof ContentMigratorInput, typeof ContentMigratorOutput> {
  constructor() {
    super({
      name: 'content-migrator',
      inputSchema: ContentMigratorInput,
      outputSchema: ContentMigratorOutput,
      dedupeKeyFn: (i) => `cm:${i.buildsell_site_id}:${i.crawl_epoch}`,
      defaultDailyCapUsd: 2,
    });
  }

  protected async execute(
    input: { buildsell_site_id: string; website_uri: string; crawl_epoch: string },
    ctx: AgentContext,
  ): Promise<ContentMigratorOutputType> {
    const db = getDb();

    const [site] = await db
      .select()
      .from(buildsellSites)
      .where(eq(buildsellSites.id, input.buildsell_site_id))
      .limit(1);
    if (!site) throw new Error(`buildsell_sites row not found: ${input.buildsell_site_id}`);

    if (!input.website_uri) {
      return { buildsell_site_id: site.id, status: 'no_website', suggestions_written: 0, images_uploaded: 0, cost_usd: 0 };
    }

    // ── Per-site/day crawl cap (read-before-spend) ──
    const meta = (site.metadata ?? {}) as Record<string, unknown>;
    const capPerDay = Number(process.env.MIGRATION_CRAWL_CAP_PER_DAY ?? '3');
    const todayUtc = new Date().toISOString().slice(0, 10);
    const capData = (meta[MIGRATION_CRAWL_CAP_KEY] ?? {}) as { date?: string; count?: number };
    const todayCount = capData.date === todayUtc ? capData.count ?? 0 : 0;
    if (todayCount >= capPerDay) {
      ctx.log.warn({ siteId: site.id, todayCount, capPerDay }, 'content-migrator daily crawl cap reached — $0');
      return { buildsell_site_id: site.id, status: 'capped', suggestions_written: 0, images_uploaded: 0, cost_usd: 0 };
    }

    ctx.progress({ label: `Crawling ${input.website_uri}` });
    const crawl = await scrapeSiteForMigration(input.website_uri);
    ctx.recordUsage({ model: 'firecrawl', input_tokens: 0, output_tokens: 0, cost_usd: FIRECRAWL_SCRAPE_COST_USD });

    if (!crawl.markdown && crawl.imageUrls.length === 0) {
      await this.incrementCrawlCap(db, site.id, meta, todayUtc, todayCount);
      return { buildsell_site_id: site.id, status: 'empty_crawl', suggestions_written: 0, images_uploaded: 0, cost_usd: 0 };
    }

    // ── Vision extraction ──
    ctx.progress({ label: 'Extracting content with Claude' });
    const extraction = await this.extract(crawl, ctx);

    // Validate that returned URLs are from the candidate set (anti-injection:
    // only download what we actually discovered, never a model-invented URL).
    const candidateImages = new Set(crawl.imageUrls);
    const candidateLinks = new Set(crawl.links);
    const safeImage = (u?: string): string | undefined => (u && candidateImages.has(u) ? u : undefined);
    const safeLink = (u?: string): string | undefined => (u && candidateLinks.has(u) ? u : undefined);

    // ── Download + upload chosen images to Sanity (bounded) ──
    const suggestions: MigrationSuggestions = {};
    let uploads = 0;

    const tryUpload = async (url: string | undefined, label: string): Promise<MigratedAsset | undefined> => {
      const safe = safeImage(url);
      if (!safe || uploads >= MAX_UPLOADS) return undefined;
      const buf = await fetchImageBuffer(safe);
      if (!buf) return undefined;
      try {
        const up = await uploadHeroImage(`bs-mig-${site.id}-${label}`, buf.buffer, `bs-mig-${site.id}-${label}.${buf.ext}`, buf.contentType);
        uploads++;
        return { assetId: up.assetId, url: up.url, sourceUrl: safe };
      } catch (err) {
        ctx.log.warn({ url: safe, err: err instanceof Error ? err.message : err }, 'content-migrator image upload failed (non-fatal)');
        return undefined;
      }
    };

    suggestions.logo = await tryUpload(extraction.logoUrl, 'logo');
    suggestions.heroImage = await tryUpload(extraction.heroImageUrl, 'hero');
    suggestions.aboutImage = await tryUpload(extraction.aboutImageUrl, 'about');

    // Copy + structured fields (no network).
    if (extraction.headline) suggestions.headline = extraction.headline.trim();
    if (extraction.aboutBody) suggestions.aboutBody = extraction.aboutBody.trim();
    if (extraction.services?.length) suggestions.services = extraction.services;
    if (extraction.socials?.length) {
      const socials = extraction.socials
        .map((s) => ({ platform: s.platform, href: safeLink(s.href) ?? s.href }))
        .filter((s) => /^https?:\/\//i.test(s.href));
      if (socials.length) suggestions.socials = socials;
    }

    // UGC gallery — upload thumbnails (counts toward MAX_UPLOADS).
    if (extraction.ugc?.length) {
      const ugc: MigratedUgcItem[] = [];
      for (const item of extraction.ugc) {
        const asset = await tryUpload(item.imageUrl, `ugc${ugc.length}`);
        const postUrl = safeLink(item.postUrl);
        if (!asset && !postUrl) continue; // nothing renderable
        ugc.push({ platform: item.platform, postUrl, caption: item.caption, asset });
      }
      if (ugc.length) suggestions.ugc = ugc;
    }

    const suggestionCount = countSuggestions(suggestions);

    // ── Persist the pending-review blob into metadata (never the live doc) ──
    const newMeta: Record<string, unknown> = {
      ...meta,
      [PENDING_MIGRATION_KEY]: {
        status: 'pending',
        createdAt: new Date().toISOString(),
        source: input.website_uri,
        suggestions,
      },
      [MIGRATION_CRAWL_CAP_KEY]: { date: todayUtc, count: todayCount + 1 },
    };
    await db.update(buildsellSites).set({ metadata: newMeta }).where(eq(buildsellSites.id, site.id));

    ctx.log.info(
      { siteId: site.id, suggestionCount, uploads, source: input.website_uri },
      'content-migrator wrote pending migration suggestions',
    );

    return {
      buildsell_site_id: site.id,
      status: 'ok',
      suggestions_written: suggestionCount,
      images_uploaded: uploads,
      cost_usd: 0, // recorded via ctx.recordUsage; BaseAgent aggregates the run total
    };
  }

  private async incrementCrawlCap(
    db: ReturnType<typeof getDb>,
    siteId: string,
    meta: Record<string, unknown>,
    todayUtc: string,
    todayCount: number,
  ): Promise<void> {
    try {
      await db
        .update(buildsellSites)
        .set({ metadata: { ...meta, [MIGRATION_CRAWL_CAP_KEY]: { date: todayUtc, count: todayCount + 1 } } })
        .where(eq(buildsellSites.id, siteId));
    } catch {
      // non-fatal
    }
  }

  private async extract(
    crawl: { markdown: string; imageUrls: string[]; links: string[] },
    ctx: AgentContext,
  ): Promise<MigrationExtraction> {
    if (process.env.MOCK_AI === 'true') {
      return mockExtraction(crawl);
    }

    const client = getAnthropicClient();
    const model = process.env.CONTENT_MIGRATOR_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const visionImages = crawl.imageUrls.slice(0, MAX_VISION_IMAGES);
    const imageList = visionImages.map((u, i) => `Image ${i + 1}: ${u}`).join('\n');
    const linkList = crawl.links.slice(0, 60).join('\n');

    // content: intro text → each candidate image (labeled) → markdown + links.
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: [
          'Crawled homepage of a prospect business. Extract migratable content.',
          '',
          '## Candidate image URLs (you may only return URLs from this list):',
          imageList || '(none)',
          '',
          'The images are shown below in order.',
        ].join('\n'),
      },
    ];
    for (let i = 0; i < visionImages.length; i++) {
      content.push({ type: 'text', text: `Image ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'url', url: visionImages[i]! } });
    }
    content.push({
      type: 'text',
      text: [
        '## Outbound links (for socials + UGC post URLs):',
        linkList || '(none)',
        '',
        '## Page content (markdown):',
        crawl.markdown.slice(0, 12000) || '(empty)',
        '',
        `Call ${SUBMIT_TOOL} exactly once.`,
      ].join('\n'),
    });

    const response = await client.messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.4,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: SUBMIT_TOOL,
          description: 'Submit the extracted migration content.',
          input_schema: zodToJsonSchema(MigrationExtraction, { target: 'openApi3' }) as never,
        },
      ],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== SUBMIT_TOOL) {
      throw new Error('content-migrator: Claude did not return tool_use');
    }
    return MigrationExtraction.parse(toolUse.input);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countSuggestions(s: MigrationSuggestions): number {
  let n = 0;
  if (s.headline) n++;
  if (s.aboutBody) n++;
  if (s.services?.length) n++;
  if (s.socials?.length) n++;
  if (s.logo) n++;
  if (s.heroImage) n++;
  if (s.aboutImage) n++;
  if (s.ugc?.length) n++;
  return n;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/**
 * Download an image URL into a Buffer with content-type + size guards.
 * Returns null on any failure (non-image, too large, network error).
 */
async function fetchImageBuffer(
  url: string,
): Promise<{ buffer: Buffer; contentType: string; ext: string } | null> {
  try {
    if (!/^https?:\/\//i.test(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const ext = EXT_BY_TYPE[contentType];
    if (!ext) return null; // not a recognized image type
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_IMAGE_BYTES) return null;
    const arr = new Uint8Array(await res.arrayBuffer());
    if (arr.byteLength > MAX_IMAGE_BYTES || arr.byteLength === 0) return null;
    return { buffer: Buffer.from(arr), contentType, ext };
  } catch {
    return null;
  }
}

/** Deterministic mock for MOCK_AI / unit tests — text-only, no network. */
function mockExtraction(crawl: { markdown: string }): MigrationExtraction {
  return {
    headline: 'Trusted Local Pros, Done Right',
    aboutBody: crawl.markdown ? 'A locally owned business serving the community with quality work and fair pricing.' : undefined,
    services: [
      { icon: 'wrench', title: 'Repairs', description: 'Fast, dependable repairs.' },
      { icon: 'hammer', title: 'Installation', description: 'Clean, code-compliant installs.' },
    ],
    socials: [],
    ugc: [],
  };
}
