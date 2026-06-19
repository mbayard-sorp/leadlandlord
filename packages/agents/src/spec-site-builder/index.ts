import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
import { uploadHeroImage } from '@leadlandlord/integrations/sanity';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BudgetExceededError } from '@leadlandlord/shared/errors';
import { BaseAgent, type AgentContext } from '../base';
import {
  SpecSiteBuilderInput,
  SpecSiteBuilderOutput,
  SpecSiteContent,
  type SpecSiteContent as SpecSiteContentType,
} from './schema';
import { writeBuildSellToSanity } from './persist-sanity';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

const SUBMIT_TOOL = 'submit_spec_site';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * spec-site-builder — builds a watermarked draft spec site for Build & Sell.
 *
 * Cost discipline: BaseAgent only gates a per-DAY cap. This agent additionally
 * enforces a per-BUILD ceiling (BUILDSELL_PER_RUN_CAP_USD, default $0.50) by
 * tallying spend in `track()` and checking BEFORE the expensive Imagen call.
 * Imagen is the big lever and is non-fatal, so a cap-skip degrades to a
 * placeholder hero rather than failing the build.
 *
 * Fully separate queue lane: dispatched on targetAgent:'spec-site-builder'.
 */
export class SpecSiteBuilder extends BaseAgent<typeof SpecSiteBuilderInput, typeof SpecSiteBuilderOutput> {
  private spentThisRun = 0;

  constructor() {
    super({
      name: 'spec-site-builder',
      inputSchema: SpecSiteBuilderInput,
      outputSchema: SpecSiteBuilderOutput,
      dedupeKeyFn: (i) => `bs:${i.buildsell_site_id}:${i.build_epoch}`,
      defaultDailyCapUsd: 5,
    });
  }

  private get perRunCap(): number {
    return Number(process.env.BUILDSELL_PER_RUN_CAP_USD ?? '0.50');
  }

  /** Record usage up to BaseAgent AND tally per-run spend for the mid-run cap. */
  private track(ctx: AgentContext, usage: { model: string; input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; cost_usd: number }): void {
    ctx.recordUsage(usage);
    this.spentThisRun += usage.cost_usd;
  }

  private assertUnderCap(): void {
    if (this.spentThisRun > this.perRunCap) {
      throw new BudgetExceededError('spec-site-builder', this.perRunCap);
    }
  }

  protected async execute(
    input: { buildsell_site_id: string; build_epoch: string },
    ctx: AgentContext,
  ): Promise<SpecSiteBuilderOutput> {
    this.spentThisRun = 0;
    const db = getDb();

    const [site] = await db
      .select()
      .from(buildsellSites)
      .where(eq(buildsellSites.id, input.buildsell_site_id))
      .limit(1);
    if (!site) throw new Error(`buildsell_sites row not found: ${input.buildsell_site_id}`);

    await db
      .update(buildsellSites)
      .set({ status: 'building', lastBuildError: null, updatedAt: new Date() })
      .where(eq(buildsellSites.id, site.id));
    ctx.progress({ label: `Generating spec site for ${site.businessName}` });

    // ── Step 1 (cheap): Claude generates the structured site content ──
    const content = await this.generateContent(site, ctx);
    this.assertUnderCap();

    // ── Step 2 (expensive, gated): Imagen hero — non-fatal ──
    let heroImageAssetId: string | null = null;
    if (this.spentThisRun <= this.perRunCap) {
      try {
        ctx.progress({ label: 'Generating hero image' });
        const hero = await generateHeroImageBuffer(content.hero.imagePrompt, { aspectRatio: '16:9' });
        if (hero) {
          if (hero.costUsd) this.spentThisRun += hero.costUsd;
          const uploaded = await uploadHeroImage(site.id, hero.buffer, `bs-hero-${site.id}.jpg`, hero.contentType);
          heroImageAssetId = uploaded.assetId;
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site hero image failed (non-fatal)');
      }
    } else {
      ctx.log.info({ spent: this.spentThisRun, cap: this.perRunCap }, 'skipping hero image — per-run cap reached');
    }

    // ── Step 3: persist watermarked draft to Sanity ──
    const slug = `${slugify(site.businessName)}-${slugify(site.city)}-${site.state.toLowerCase()}-${site.id.slice(0, 6)}`;
    const generatedAt = new Date().toISOString();
    ctx.progress({ label: 'Writing draft to Sanity' });
    const written = await writeBuildSellToSanity({
      buildsellSiteId: site.id,
      businessName: site.businessName,
      trade: site.trade,
      city: site.city,
      state: site.state,
      ownerEmail: site.ownerEmail,
      slug,
      content,
      heroImageAssetId,
      generatedAt,
    });

    // ── Step 4: finalize Postgres row ──
    await db
      .update(buildsellSites)
      .set({ status: 'draft', slug, themePreset: content.theme.preset, updatedAt: new Date() })
      .where(eq(buildsellSites.id, site.id));

    ctx.log.info(
      { siteId: site.id, docId: written.docId, slug, costUsd: this.spentThisRun, hero: !!heroImageAssetId },
      'spec-site-builder draft complete',
    );

    return {
      buildsell_site_id: site.id,
      doc_id: written.docId,
      slug,
      sections: written.sectionCount,
      hero_image: !!heroImageAssetId,
      cost_usd: Number(this.spentThisRun.toFixed(4)),
    };
  }

  private async generateContent(
    site: { businessName: string; trade: string; city: string; state: string },
    ctx: AgentContext,
  ): Promise<SpecSiteContentType> {
    if (process.env.MOCK_AI === 'true') {
      return mockContent(site);
    }

    const client = getAnthropicClient();
    const model = process.env.SPEC_SITE_BUILDER_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const userPrompt = [
      `Business name: ${site.businessName}`,
      `Trade / category: ${site.trade}`,
      `City: ${site.city}`,
      `State: ${site.state}`,
      '',
      `Call ${SUBMIT_TOOL} exactly once with the complete spec site. Remember: name + category + city only; reviews are original representative testimonials, never verbatim Google reviews.`,
    ].join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0.7,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: SUBMIT_TOOL,
          description: 'Submit the complete spec site content.',
          input_schema: zodToJsonSchema(SpecSiteContent, { target: 'openApi3' }) as never,
        },
      ],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    this.track(ctx, { model, ...usage, cost_usd: estimateCostUsd(model, usage) });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== SUBMIT_TOOL) {
      throw new Error('spec-site-builder: Claude did not return tool_use');
    }
    return SpecSiteContent.parse(toolUse.input);
  }
}

/** Deterministic mock content for MOCK_AI/test paths — no network. */
function mockContent(site: { businessName: string; trade: string; city: string; state: string }): SpecSiteContentType {
  const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const trade = cap(site.trade);
  return {
    seo: {
      metaTitle: `${site.businessName} — ${trade} in ${site.city}, ${site.state}`,
      metaDescription: `${site.businessName} provides trusted ${site.trade} services in ${site.city}, ${site.state}. Free quotes, fast response, friendly local pros.`,
    },
    navigation: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Reviews', href: '#reviews' },
      { label: 'Contact', href: '#contact' },
    ],
    theme: {
      preset: 'Aqua Slate',
      layoutVariant: 'split',
      primary: '#0e7490',
      primaryDark: '#155e75',
      accent: '#f59e0b',
      onPrimary: '#ffffff',
      bg: '#f8fafc',
      surface: '#ffffff',
      text: '#0f172a',
      muted: '#64748b',
      fontHeading: 'Poppins',
      fontBody: 'Inter',
    },
    hero: {
      eyebrow: `${site.city}'s trusted ${site.trade} pros`,
      headline: `Reliable ${trade} You Can Count On`,
      highlight: 'Count On',
      subhead: `Fast, friendly, upfront ${site.trade} service for ${site.city} and the surrounding area.`,
      badges: [
        { icon: 'shield-check', label: 'Licensed & Insured' },
        { icon: 'star', label: 'Top Rated' },
        { icon: 'clock', label: 'Fast Response' },
      ],
      primaryCta: { label: 'Get a Free Quote', href: '#contact', style: 'primary' },
      secondaryCta: { label: 'Call Now', href: 'tel:', style: 'secondary' },
      imagePrompt: `Professional ${site.trade} crew at work in ${site.city}, bright daylight, photographic, no text`,
    },
    services: [
      { icon: 'wrench', title: 'Repairs', description: `Fast, dependable ${site.trade} repairs done right the first time.` },
      { icon: 'hammer', title: 'Installation', description: `Clean, code-compliant ${site.trade} installations.` },
      { icon: 'clock', title: 'Maintenance', description: 'Routine maintenance to keep things running smoothly.' },
      { icon: 'phone', title: 'Emergency Service', description: 'Available when you need us most.' },
    ],
    about: {
      heading: `Your Local ${trade} Experts`,
      body: `${site.businessName} is a locally trusted ${site.trade} provider serving ${site.city}, ${site.state}. We pride ourselves on honest work, fair pricing, and treating every customer like a neighbor.`,
      stats: [
        { value: '10+', label: 'Years serving the area' },
        { value: '1,000+', label: 'Jobs completed' },
      ],
    },
    process: {
      heading: 'How It Works',
      steps: [
        { icon: 'phone', title: 'Get in Touch', description: 'Call or request a free quote online.' },
        { icon: 'calendar', title: 'Schedule', description: 'We find a time that works for you.' },
        { icon: 'check', title: 'Done Right', description: 'Quality work, guaranteed.' },
      ],
    },
    reviews: [
      { author: 'Maria G.', rating: 5, text: 'Showed up on time and did a fantastic job. Highly recommend!' },
      { author: 'James T.', rating: 5, text: 'Fair pricing and great communication throughout. Will use again.' },
      { author: 'Priya S.', rating: 4, text: 'Professional and friendly. Very happy with the work.' },
    ],
    contact: {
      heading: 'Get Your Free Quote',
      subhead: `Reach out and we'll get back to you fast.`,
      hours: 'Mon–Sat 7am–6pm',
      serviceArea: `${site.city} and surrounding areas`,
    },
    footer: {
      tagline: `${site.businessName} — quality ${site.trade} you can trust.`,
      legal: `© ${new Date().getFullYear()} ${site.businessName}. All rights reserved.`,
    },
  };
}
