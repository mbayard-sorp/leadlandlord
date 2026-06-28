import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { eq, and, count as drizzleCount } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
import { uploadHeroImage } from '@leadlandlord/integrations/sanity';
import { generateAndUploadFavicon } from '@leadlandlord/integrations/favicon';
import { presetByName } from '@leadlandlord/sanity-schema/presets';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BudgetExceededError } from '@leadlandlord/shared/errors';
import { BaseAgent, type AgentContext } from '../base';
import {
  SpecSiteBuilderInput,
  SpecSiteBuilderOutput,
  SpecSiteContent,
  type SpecSiteContent as SpecSiteContentType,
} from './schema';
import {
  writeBuildSellToSanity,
  RebuildProtectedError,
  type ExistingDocFields,
  type MigratedOverlay,
  type CustomerLayoutOverlay,
} from './persist-sanity';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import {
  pick,
  rotationSeed,
  LAYOUT_VARIANTS,
  PRESET_ROTATION,
  FONT_HEADING_POOL,
  FONT_BODY_POOL,
  SERVICES_HEADING_PATTERNS,
  SERVICES_SUBHEAD_PATTERNS,
  REVIEWS_HEADING_PATTERNS,
  IMAGEN_HERO_OPENERS,
} from './variety-pools';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, 'system.md'), 'utf-8');

const SUBMIT_TOOL = 'submit_spec_site';

// RebuildProtectedError is defined in persist-sanity.ts and re-exported from
// there; re-exporting here keeps the public surface of index.ts unchanged.
export { RebuildProtectedError };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Parse the raw `migrated` field off an existing Sanity doc into a clean
 * MigratedOverlay (strip _type/_key, coerce types). Returns null when absent.
 */
function parseMigrated(raw: unknown): MigratedOverlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  const services = Array.isArray(r['services'])
    ? (r['services'] as Array<Record<string, unknown>>)
        .map((s) => ({ icon: String(s['icon'] ?? ''), title: String(s['title'] ?? ''), description: String(s['description'] ?? '') }))
        .filter((s) => s.title && s.icon)
    : undefined;
  const socials = Array.isArray(r['socials'])
    ? (r['socials'] as Array<Record<string, unknown>>)
        .map((s) => ({ platform: String(s['platform'] ?? ''), href: String(s['href'] ?? '') }))
        .filter((s) => s.platform && s.href)
    : undefined;
  const ugc = Array.isArray(r['ugc'])
    ? (r['ugc'] as Array<Record<string, unknown>>)
        .map((u) => ({
          platform: String(u['platform'] ?? ''),
          postUrl: str(u['postUrl']),
          caption: str(u['caption']),
          thumbnailAssetId: str(u['thumbnailAssetId']),
        }))
        .filter((u) => u.platform && (u.thumbnailAssetId || u.postUrl))
    : undefined;
  return {
    headline: str(r['headline']),
    aboutBody: str(r['aboutBody']),
    services: services && services.length > 0 ? services : undefined,
    socials: socials && socials.length > 0 ? socials : undefined,
    logoAssetId: str(r['logoAssetId']),
    heroImageAssetId: str(r['heroImageAssetId']),
    aboutImageAssetId: str(r['aboutImageAssetId']),
    ugc: ugc && ugc.length > 0 ? ugc : undefined,
    source: str(r['source']),
    migratedAt: str(r['migratedAt']),
  };
}

/**
 * Deterministic banned-phrase lint for spec site content.
 *
 * Returns a list of violations (strings describing what was found).
 * An empty array means the content passes.
 *
 * Enforced phrases / patterns:
 *  - "Our Services" (hardcoded heading)
 *  - "What Customers Say" (hardcoded heading)
 *  - "since 1995" / "since 19XX" / "since 20XX" (fake founding year)
 *  - "family owned since" (variation)
 *  - "[TESTIMONIAL" / "[YEARS" / "[LICENSE" (placeholder strings in output)
 *  - Literal phone numbers (bare US patterns)
 *  - Literal email addresses in any field
 *  - "verified google review" / "google review" (ToS risk label)
 *  - "as seen on" (unverifiable claim)
 *  - "bbb accredited" (unverifiable)
 */
const BANNED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bour services\b/i, label: 'hardcoded heading "Our Services"' },
  { pattern: /\bwhat customers say\b/i, label: 'hardcoded heading "What Customers Say"' },
  { pattern: /\bsince\s+(?:19|20)\d{2}\b/i, label: 'invented founding year "since YYYY"' },
  { pattern: /\bfamily[\s-]owned since\b/i, label: 'invented claim "family owned since"' },
  { pattern: /\[TESTIMONIAL/i, label: 'unreplaced placeholder [TESTIMONIAL...]' },
  { pattern: /\[YEARS[\s-]IN[\s-]BUSINESS\]/i, label: 'unreplaced placeholder [YEARS-IN-BUSINESS]' },
  { pattern: /\[LICENSE\s*#\]/i, label: 'unreplaced placeholder [LICENSE #]' },
  // Bare US phone patterns (operator data fills phone; model must not invent one)
  { pattern: /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])/, label: 'invented phone number literal' },
  // Email literals
  { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, label: 'invented email address literal' },
  { pattern: /\bverified\s+google\s+review\b/i, label: 'ToS-risk label "verified google review"' },
  { pattern: /\bsource[:\s]+google\b/i, label: 'ToS-risk source label "google"' },
  { pattern: /\bas\s+seen\s+on\b/i, label: 'unverifiable claim "as seen on"' },
  { pattern: /\bbbb\s+accredited\b/i, label: 'unverifiable claim "bbb accredited"' },
  { pattern: /\blicense(?:\s+#|number|no\.?)?\s*:\s*[A-Z0-9\-]{4,}/i, label: 'invented license number' },
];

/**
 * Serialize SpecSiteContent to a flat string for lint scanning.
 * We JSON-stringify to catch values in nested objects/arrays.
 */
function flattenContent(content: SpecSiteContentType): string {
  return JSON.stringify(content);
}

/**
 * Run banned-phrase lint over the content.
 * Returns array of human-readable violation strings; empty = pass.
 */
export function lintSpecSite(content: SpecSiteContentType): string[] {
  const flat = flattenContent(content);
  const violations: string[] = [];
  for (const { pattern, label } of BANNED_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(flat)) {
      violations.push(label);
    }
  }
  return violations;
}

/**
 * Post-process model output:
 *  1. Trim trailing whitespace on all string fields.
 *  2. Strip phone literals via regex (matches content-engine sanitizePhoneLiterals logic).
 *  3. Backfill `© {year}` in footer.legal if missing.
 *  4. Run banned-phrase lint and return violations.
 */
export function normalizeSpecSite(
  content: SpecSiteContentType,
  businessName: string,
): { content: SpecSiteContentType; violations: string[] } {
  // Deep-clone via JSON round-trip (content is a plain object from zod parse).
  let c: SpecSiteContentType = JSON.parse(JSON.stringify(content));

  // Backfill © year in footer.legal if missing.
  if (!c.footer.legal.includes('©')) {
    c = {
      ...c,
      footer: {
        ...c.footer,
        legal: `© ${new Date().getFullYear()} ${businessName}. All rights reserved.`,
      },
    };
  }

  // Strip phone literals from hero subhead, contact copy, about body.
  const PHONE_RE = /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d])/g;
  function stripPhone(s: string): string {
    return s.replace(PHONE_RE, '{{phone}}');
  }

  c = {
    ...c,
    hero: { ...c.hero, subhead: stripPhone(c.hero.subhead) },
    about: { ...c.about, body: stripPhone(c.about.body) },
    contact: { ...c.contact, subhead: stripPhone(c.contact.subhead) },
  };

  const violations = lintSpecSite(c);
  return { content: c, violations };
}

/**
 * spec-site-builder — builds a watermarked draft spec site for Build & Sell.
 *
 * Cost discipline: BaseAgent gates a per-DAY cap. This agent additionally
 * enforces a per-BUILD ceiling (BUILDSELL_PER_RUN_CAP_USD, default $0.50).
 *
 * Spend order: retry call -> hero image -> about image -> og image.
 * Each image checks the cap before spending; cap-skip drops og first, then
 * about, then hero (least important dropped first).
 *
 * Status guard: rebuilding a paid/live site throws RebuildProtectedError
 * unless forceRebuild is explicitly set (Phase 0 policy, ADR D4).
 *
 * Portfolio-aware rotation: layoutVariant + palette + font are seeded by the
 * count of existing buildsell_sites in the same (trade, city) so adjacent
 * market sites cycle through distinct variants (R5).
 */
/** Existing theme pulled off a Sanity buildsellSite doc, hex unpacked. */
interface ExistingTheme {
  preset?: string;
  layoutVariant?: 'split' | 'bold' | 'trust';
  fontHeading?: string;
  fontBody?: string;
  primary?: string;
  primaryDark?: string;
  accent?: string;
  onPrimary?: string;
  bg?: string;
  surface?: string;
  text?: string;
  muted?: string;
}

const LAYOUT_SET = new Set(['split', 'bold', 'trust']);

/** Unpack a Sanity `{_type:'color',hex}` object (or a plain string) to a hex string. */
function hexOf(c: unknown): string | undefined {
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && typeof (c as Record<string, unknown>)['hex'] === 'string') {
    return (c as Record<string, string>)['hex'];
  }
  return undefined;
}

/** Extract a theme object off a fetched doc, unpacking color objects → hex strings. */
function extractExistingTheme(raw: unknown): ExistingTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const lvRaw = t['layoutVariant'];
  const layoutVariant =
    typeof lvRaw === 'string' && LAYOUT_SET.has(lvRaw) ? (lvRaw as 'split' | 'bold' | 'trust') : undefined;
  return {
    preset: typeof t['preset'] === 'string' ? t['preset'] : undefined,
    layoutVariant,
    fontHeading: typeof t['fontHeading'] === 'string' ? t['fontHeading'] : undefined,
    fontBody: typeof t['fontBody'] === 'string' ? t['fontBody'] : undefined,
    primary: hexOf(t['primary']),
    primaryDark: hexOf(t['primaryDark']),
    accent: hexOf(t['accent']),
    onPrimary: hexOf(t['onPrimary']),
    bg: hexOf(t['bg']),
    surface: hexOf(t['surface']),
    text: hexOf(t['text']),
    muted: hexOf(t['muted']),
  };
}

/**
 * Final theme written to Sanity. Colors are PRESET-AUTHORITATIVE: a build pins
 * them to the canonical BUILDSELL_PRESETS palette for the rotation-assigned
 * preset name, so the stored hex always matches the named preset and switching
 * the preset in Studio recolors the site (site-host resolves colors from the
 * name). Fonts/layout come from rotation. A preserve_theme revision keeps the
 * existing design verbatim instead of re-deriving it.
 */
function resolveBuildTheme(
  modelTheme: SpecSiteContentType['theme'],
  rotation: { preset: string; layoutVariant: string; fontHeading: string; fontBody: string },
  preserve: ExistingTheme | null,
): SpecSiteContentType['theme'] {
  if (preserve) {
    return {
      preset: preserve.preset ?? modelTheme.preset,
      layoutVariant: (preserve.layoutVariant ?? modelTheme.layoutVariant),
      fontHeading: preserve.fontHeading ?? modelTheme.fontHeading,
      fontBody: preserve.fontBody ?? modelTheme.fontBody,
      primary: preserve.primary ?? modelTheme.primary,
      primaryDark: preserve.primaryDark ?? modelTheme.primaryDark,
      accent: preserve.accent ?? modelTheme.accent,
      onPrimary: preserve.onPrimary ?? modelTheme.onPrimary,
      bg: preserve.bg ?? modelTheme.bg,
      surface: preserve.surface ?? modelTheme.surface,
      text: preserve.text ?? modelTheme.text,
      muted: preserve.muted ?? modelTheme.muted,
    };
  }
  const canon = presetByName(rotation.preset);
  return {
    preset: rotation.preset,
    layoutVariant: rotation.layoutVariant as 'split' | 'bold' | 'trust',
    fontHeading: rotation.fontHeading,
    fontBody: rotation.fontBody,
    primary: canon?.primary ?? modelTheme.primary,
    primaryDark: canon?.primaryDark ?? modelTheme.primaryDark,
    accent: canon?.accent ?? modelTheme.accent,
    onPrimary: canon?.onPrimary ?? modelTheme.onPrimary,
    bg: canon?.bg ?? modelTheme.bg,
    surface: canon?.surface ?? modelTheme.surface,
    text: canon?.text ?? modelTheme.text,
    muted: canon?.muted ?? modelTheme.muted,
  };
}

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

  private track(
    ctx: AgentContext,
    usage: {
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cost_usd: number;
    },
  ): void {
    ctx.recordUsage(usage);
    this.spentThisRun += usage.cost_usd;
  }

  private underCap(): boolean {
    return this.spentThisRun <= this.perRunCap;
  }

  private assertUnderCap(): void {
    if (!this.underCap()) {
      throw new BudgetExceededError('spec-site-builder', this.perRunCap);
    }
  }

  protected async execute(
    input: SpecSiteBuilderInput,
    ctx: AgentContext,
  ): Promise<SpecSiteBuilderOutput> {
    this.spentThisRun = 0;
    const db = getDb();
    // preserve_theme is resolved after the Sanity doc fetch below; initialize
    // from the event payload now and OR in the doc-root themeLocked flag later.
    let preserveTheme = input.preserve_theme === true;
    const clarifyingPrompt = input.clarifying_prompt?.trim() || undefined;

    const [site] = await db
      .select()
      .from(buildsellSites)
      .where(eq(buildsellSites.id, input.buildsell_site_id))
      .limit(1);
    if (!site) throw new Error(`buildsell_sites row not found: ${input.buildsell_site_id}`);

    // Captured before we flip to 'building': a revise/rebuild of an invoiced
    // site must land back on 'invoiced', not silently downgrade to 'draft'.
    const priorStatus = site.status;

    // D4 status guard: refuse to rebuild paid/live sites unless explicitly forced.
    // (Reachable now that force_rebuild travels via the input schema, not a dead
    // options arg — a plain rebuild OR a revise of a sold site is blocked.)
    if ((site.status === 'paid' || site.status === 'live') && input.force_rebuild !== true) {
      throw new RebuildProtectedError(site.id, site.status);
    }

    await db
      .update(buildsellSites)
      .set({ status: 'building', lastBuildError: null, updatedAt: new Date() })
      .where(eq(buildsellSites.id, site.id));
    ctx.progress({ label: `Generating spec site for ${site.businessName}` });

    // D4 read-merge: fetch existing Sanity doc to preserve operator-owned fields.
    let existingDoc: ExistingDocFields | null = null;
    // Existing theme (hex unpacked) — used to keep the design on a preserve_theme revision.
    let existingTheme: ExistingTheme | null = null;
    try {
      const sanityClient = createWriteClient();
      const docId = buildsellSiteDocId(site.id);
      const existing = await sanityClient.getDocument(docId) as Record<string, unknown> | null | undefined;
      if (existing) {
        // Extract the bsContactSection street from the sections array.
        const sections = Array.isArray(existing['sections']) ? existing['sections'] as Array<Record<string, unknown>> : [];
        const contactSection = sections.find((s) => s['_type'] === 'bsContactSection');
        const addr = contactSection?.['address'] as Record<string, unknown> | undefined;
        existingTheme = extractExistingTheme(existing['theme']);
        // Workstream C — parse customerLayout overlay from the existing doc.
        const rawLayout = existing['customerLayout'];
        const customerLayout: CustomerLayoutOverlay | null =
          rawLayout && typeof rawLayout === 'object'
            ? {
                sectionOrder: Array.isArray((rawLayout as Record<string, unknown>)['sectionOrder'])
                  ? ((rawLayout as Record<string, unknown>)['sectionOrder'] as string[])
                  : null,
                removedKeys: Array.isArray((rawLayout as Record<string, unknown>)['removedKeys'])
                  ? ((rawLayout as Record<string, unknown>)['removedKeys'] as string[])
                  : null,
                customerOwnedKeys: Array.isArray((rawLayout as Record<string, unknown>)['customerOwnedKeys'])
                  ? ((rawLayout as Record<string, unknown>)['customerOwnedKeys'] as string[])
                  : null,
                lockedAt:
                  typeof (rawLayout as Record<string, unknown>)['lockedAt'] === 'string'
                    ? ((rawLayout as Record<string, unknown>)['lockedAt'] as string)
                    : null,
              }
            : null;
        existingDoc = {
          draftMode: typeof existing['draftMode'] === 'boolean' ? existing['draftMode'] : null,
          robotsDisallow: typeof existing['robotsDisallow'] === 'boolean' ? existing['robotsDisallow'] : null,
          purchaseUrl: typeof existing['purchaseUrl'] === 'string' ? existing['purchaseUrl'] : null,
          ownerEmail: typeof existing['ownerEmail'] === 'string' ? existing['ownerEmail'] : null,
          existingStreet: typeof addr?.['street'] === 'string' ? addr['street'] : null,
          // Preserve NAP phone on rebuild/revise when the payload carries none,
          // so createOrReplace doesn't blank a previously-set number.
          existingPhone: typeof existing['phone'] === 'string' ? existing['phone'] : null,
          migrated: parseMigrated(existing['migrated']),
          // Preserve themeLocked + buyer-confirmed theme so rebuilds never reset the design.
          themeLocked: typeof existing['themeLocked'] === 'boolean' ? existing['themeLocked'] : null,
          existingTheme: existingTheme
            ? {
                preset: existingTheme.preset,
                layoutVariant: existingTheme.layoutVariant,
                fontHeading: existingTheme.fontHeading,
                fontBody: existingTheme.fontBody,
              }
            : null,
          // Workstream C — carry customerLayout + full sections for the merge algorithm.
          customerLayout,
          existingSections: sections,
        };
      }
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'could not fetch existing Sanity doc for read-merge (non-fatal)');
    }

    // Honor doc-root themeLocked as equivalent to preserve_theme:true in the event payload.
    // A buyer confirming their theme in the preview sets this flag in Sanity;
    // any subsequent rebuild (including automated ones) must respect it without
    // needing the operator to set preserve_theme explicitly every time.
    if (existingDoc?.themeLocked === true) {
      preserveTheme = true;
    }

    // NAP from event payload (transient — never written to Postgres).
    const phone = input.phone ?? undefined;
    const addressLine = input.address_line ?? undefined;

    // Extract enrichment signals from metadata.
    const meta =
      site.metadata != null && typeof site.metadata === 'object'
        ? (site.metadata as Record<string, unknown>)
        : null;
    const rating = meta?.rating != null ? Number(meta.rating) : null;
    const userRatingCount = meta?.userRatingCount != null ? Number(meta.userRatingCount) : null;
    const primaryType = typeof meta?.primaryType === 'string' ? meta.primaryType : null;

    // Portfolio-aware rotation: count existing buildsell_sites for same (trade, city).
    const countRows = await db
      .select({ value: drizzleCount() })
      .from(buildsellSites)
      .where(
        and(
          eq(buildsellSites.trade, site.trade),
          eq(buildsellSites.city, site.city),
        ),
      );
    // The current site is already counted; subtract 1 to get the index of THIS build.
    const sameMarketCount = countRows[0]?.value ?? 0;
    const seed = rotationSeed(Math.max(0, Number(sameMarketCount) - 1));

    const rotation = {
      layoutVariant: pick(LAYOUT_VARIANTS, seed) as string,
      preset: pick(PRESET_ROTATION, seed),
      fontHeading: pick(FONT_HEADING_POOL, seed) as string,
      fontBody: pick(FONT_BODY_POOL, seed) as string,
      servicesHeading: pick(SERVICES_HEADING_PATTERNS, seed),
      servicesSubhead: pick(SERVICES_SUBHEAD_PATTERNS, seed).replace('{trade}', site.trade),
      reviewsHeading: pick(REVIEWS_HEADING_PATTERNS, seed),
      imagenOpener: pick(IMAGEN_HERO_OPENERS, seed),
    };

    // Copy-only revision: keep the existing design — feed the existing theme
    // bits as the prompt directives so the model doesn't fight the rotation.
    // (Colors/fonts/layout are also hard-overwritten post-generation below.)
    if (preserveTheme && existingTheme) {
      if (existingTheme.preset) rotation.preset = existingTheme.preset;
      if (existingTheme.layoutVariant) rotation.layoutVariant = existingTheme.layoutVariant;
      if (existingTheme.fontHeading) rotation.fontHeading = existingTheme.fontHeading;
      if (existingTheme.fontBody) rotation.fontBody = existingTheme.fontBody;
    }

    // ── Step 1: Claude generates the structured site content ──
    const content = await this.generateContent(
      { ...site, phone, addressLine, rating, userRatingCount, primaryType, rotation, clarifyingPrompt },
      ctx,
    );
    // After first generation: assertUnderCap before proceeding to images.
    this.assertUnderCap();

    // Normalize + lint.
    const { content: normalized, violations } = normalizeSpecSite(content, site.businessName);
    let finalContent = normalized;

    // One conditional retry on lint failure.
    if (violations.length > 0) {
      ctx.log.warn({ violations }, 'spec-site lint violations — retrying content generation once');
      try {
        const retried = await this.generateContent(
          { ...site, phone, addressLine, rating, userRatingCount, primaryType, rotation, clarifyingPrompt, lintViolations: violations },
          ctx,
        );
        const { content: retriedNormalized, violations: retriedViolations } = normalizeSpecSite(retried, site.businessName);
        if (retriedViolations.length < violations.length) {
          finalContent = retriedNormalized;
          ctx.log.info({ before: violations.length, after: retriedViolations.length }, 'spec-site lint improved on retry');
        } else {
          ctx.log.warn({ violations: retriedViolations }, 'spec-site lint retry did not improve — using first pass');
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site lint retry failed — using first pass');
      }
    }

    // Pin the theme: canonical preset colors for a build, or the existing
    // design for a preserve_theme revision. (Replaces any model color drift.)
    finalContent = {
      ...finalContent,
      theme: resolveBuildTheme(finalContent.theme, rotation, preserveTheme ? existingTheme : null),
    };

    // Migration overlay: when the operator approved a real hero/about photo,
    // use it verbatim and SKIP image generation (saves cost + preserves it).
    const migrated = existingDoc?.migrated ?? null;

    // ── Step 2a: Hero image (most important — skip last) ──
    let heroImageAssetId: string | null = migrated?.heroImageAssetId ?? null;
    if (!heroImageAssetId && this.underCap()) {
      try {
        ctx.progress({ label: 'Generating hero image' });
        const hero = await generateHeroImageBuffer(finalContent.hero.imagePrompt, { aspectRatio: '16:9' });
        if (hero) {
          if (hero.costUsd) this.spentThisRun += hero.costUsd;
          const uploaded = await uploadHeroImage(site.id, hero.buffer, `bs-hero-${site.id}.jpg`, hero.contentType);
          heroImageAssetId = uploaded.assetId;
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site hero image failed (non-fatal)');
      }
    } else if (heroImageAssetId) {
      ctx.log.info({ siteId: site.id }, 'spec-site using migrated hero image — skipping generation');
    } else {
      ctx.log.info({ spent: this.spentThisRun, cap: this.perRunCap }, 'skipping hero image — per-run cap reached');
    }

    // ── Step 2b: About image (skip if cap reached or migrated) ──
    let aboutImageAssetId: string | null = migrated?.aboutImageAssetId ?? null;
    if (!aboutImageAssetId && this.underCap() && finalContent.about.imagePrompt) {
      try {
        ctx.progress({ label: 'Generating about image' });
        const about = await generateHeroImageBuffer(finalContent.about.imagePrompt, { aspectRatio: '4:3' });
        if (about) {
          if (about.costUsd) this.spentThisRun += about.costUsd;
          const uploaded = await uploadHeroImage(site.id, about.buffer, `bs-about-${site.id}.jpg`, about.contentType);
          aboutImageAssetId = uploaded.assetId;
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site about image failed (non-fatal)');
      }
    }

    // ── Step 2c: OG image (dropped first if cap is tight) ──
    let ogImageAssetId: string | null = null;
    if (this.underCap() && finalContent.seo.ogImagePrompt) {
      try {
        ctx.progress({ label: 'Generating OG image' });
        const og = await generateHeroImageBuffer(finalContent.seo.ogImagePrompt, { aspectRatio: '1:1' });
        if (og) {
          if (og.costUsd) this.spentThisRun += og.costUsd;
          const uploaded = await uploadHeroImage(site.id, og.buffer, `bs-og-${site.id}.jpg`, og.contentType);
          ogImageAssetId = uploaded.assetId;
        }
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site og image failed (non-fatal)');
      }
    }

    // ── Step 2d: Trust-layout hero strip (tiles 2 & 3) ──
    // Only the Trust layout renders a 3-tile strip. Fill the extra two tiles
    // with variations of the single hero prompt so the strip isn't 2 empty
    // gradients. Skipped for other layouts and when the cap is reached.
    let heroImageBAssetId: string | null = null;
    let heroImageCAssetId: string | null = null;
    if (finalContent.theme.layoutVariant === 'trust' && heroImageAssetId) {
      const stripVariants: Array<['b' | 'c', string]> = [
        ['b', `${finalContent.hero.imagePrompt}. Alternate angle, different composition.`],
        ['c', `${finalContent.hero.imagePrompt}. Close-up detail shot.`],
      ];
      for (const [tile, prompt] of stripVariants) {
        if (!this.underCap()) break;
        try {
          ctx.progress({ label: `Generating hero strip tile ${tile.toUpperCase()}` });
          const img = await generateHeroImageBuffer(prompt, { aspectRatio: '4:3' });
          if (img) {
            if (img.costUsd) this.spentThisRun += img.costUsd;
            const uploaded = await uploadHeroImage(site.id, img.buffer, `bs-hero-${tile}-${site.id}.jpg`, img.contentType);
            if (tile === 'b') heroImageBAssetId = uploaded.assetId;
            else heroImageCAssetId = uploaded.assetId;
          }
        } catch (err) {
          ctx.log.warn({ tile, err: err instanceof Error ? err.message : err }, 'spec-site hero strip tile failed (non-fatal)');
        }
      }
    }

    // ── Step 2e: Favicon (logo when available, else initials monogram) ──
    // Prefer a migrated real logo; otherwise generate a monogram on the preset
    // primary color. Cheap (an SVG upload, no Imagen spend), so no cap gate.
    let faviconAssetId: string | null = null;
    if (migrated?.logoAssetId) {
      faviconAssetId = migrated.logoAssetId;
    } else {
      try {
        const preset = presetByName(finalContent.theme.preset);
        const bgHex = preset?.primary ?? '#0f172a';
        const fgHex = preset?.onPrimary ?? '#ffffff';
        const fav = await generateAndUploadFavicon(site.id, site.businessName, { bgHex, fgHex });
        faviconAssetId = fav.assetId;
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err }, 'spec-site favicon generation failed (non-fatal)');
      }
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
      placeId: site.placeId,
      slug,
      content: finalContent,
      heroImageAssetId,
      heroImageBAssetId,
      heroImageCAssetId,
      faviconAssetId,
      aboutImageAssetId,
      ogImageAssetId,
      addressLine,
      phone,
      rating,
      reviewCount: userRatingCount,
      purchaseUrl: site.paymentLink ?? undefined,
      existingDoc,
      generatedAt,
      // Workstream C — thread status for defense-in-depth handoff lock in persist-sanity.ts.
      siteStatus: site.status,
    });

    // ── Step 4: finalize Postgres row ──
    // Preserve 'invoiced' across a revise/rebuild; everything else lands 'draft'.
    const finalStatus = priorStatus === 'invoiced' ? 'invoiced' : 'draft';
    await db
      .update(buildsellSites)
      .set({ status: finalStatus, slug, themePreset: finalContent.theme.preset, updatedAt: new Date() })
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
    site: {
      businessName: string;
      trade: string;
      city: string;
      state: string;
      phone?: string;
      addressLine?: string;
      rating?: number | null;
      userRatingCount?: number | null;
      primaryType?: string | null;
      rotation: {
        layoutVariant: string;
        preset: string;
        fontHeading: string;
        fontBody: string;
        servicesHeading: string;
        servicesSubhead: string;
        reviewsHeading: string;
        imagenOpener: string;
      };
      clarifyingPrompt?: string;
      lintViolations?: string[];
    },
    ctx: AgentContext,
  ): Promise<SpecSiteContentType> {
    if (process.env.MOCK_AI === 'true') {
      return mockContent(site);
    }

    const client = getAnthropicClient();
    const model = process.env.SPEC_SITE_BUILDER_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

    const promptLines = [
      `Business name: ${site.businessName}`,
      `Trade / category: ${site.trade}`,
      `City: ${site.city}`,
      `State: ${site.state}`,
    ];
    if (site.rating != null && !isNaN(site.rating)) {
      promptLines.push(
        `Aggregate Google rating: ${site.rating.toFixed(1)}${
          site.userRatingCount != null && !isNaN(site.userRatingCount)
            ? ` from ${site.userRatingCount} reviews`
            : ''
        }`,
      );
    }
    if (site.primaryType) {
      promptLines.push(`Google primary category: ${site.primaryType.replace(/_/g, ' ')}`);
    }

    // Portfolio rotation hints — model must honour these exactly.
    promptLines.push('');
    promptLines.push('## Rotation directives (REQUIRED — use exactly as given)');
    promptLines.push(`theme.layoutVariant: ${site.rotation.layoutVariant}`);
    promptLines.push(`theme.preset: ${site.rotation.preset}`);
    promptLines.push(`theme.fontHeading: ${site.rotation.fontHeading}`);
    promptLines.push(`theme.fontBody: ${site.rotation.fontBody}`);
    promptLines.push(`services.heading: ${site.rotation.servicesHeading}`);
    promptLines.push(`services.subhead: ${site.rotation.servicesSubhead}`);
    promptLines.push(`reviews.heading: ${site.rotation.reviewsHeading}`);
    promptLines.push(`hero.imagePrompt opener: "${site.rotation.imagenOpener}"`);

    // Operator refinement — subordinate to every system.md rule. A correction
    // hint that clarifies what the business actually is/does; it can refine
    // wording and emphasis but NEVER licenses invented facts, fake reviews,
    // phone numbers, awards, or anything the hard rules forbid.
    if (site.clarifyingPrompt) {
      promptLines.push('');
      promptLines.push('## Operator refinement hint (subordinate to all system rules)');
      promptLines.push(
        'Apply this clarification to the copy. It cannot override the hard rules above (no invented facts, licenses, phone numbers, verbatim or fabricated reviews, award claims):',
      );
      promptLines.push(site.clarifyingPrompt);
    }

    if (site.lintViolations && site.lintViolations.length > 0) {
      promptLines.push('');
      promptLines.push('## Previous output failed lint — FIX THESE VIOLATIONS:');
      site.lintViolations.forEach((v) => promptLines.push(`- ${v}`));
    }

    promptLines.push('');
    promptLines.push(
      `Call ${SUBMIT_TOOL} exactly once with the complete spec site. Remember: name + category + city only; reviews are original representative testimonials, never verbatim Google reviews.`,
    );

    const userPrompt = promptLines.join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0.8,
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

// ── Mock content for MOCK_AI=true and test paths ────────────────────────────

/** Deterministic mock content for MOCK_AI/test paths — no network, no banned phrases. */
function mockContent(site: {
  businessName: string;
  trade: string;
  city: string;
  state: string;
  rotation?: {
    layoutVariant: string;
    preset: string;
    fontHeading: string;
    fontBody: string;
    servicesHeading: string;
    servicesSubhead: string;
    reviewsHeading: string;
  };
}): SpecSiteContentType {
  const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const trade = cap(site.trade);
  const layoutVariant = (site.rotation?.layoutVariant ?? 'split') as 'split' | 'bold' | 'trust';
  const preset = site.rotation?.preset ?? 'Aqua Slate';
  const fontHeading = site.rotation?.fontHeading ?? 'Poppins';
  const fontBody = site.rotation?.fontBody ?? 'Inter';
  const servicesHeading = site.rotation?.servicesHeading ?? 'What We Do';
  const servicesSubhead = site.rotation?.servicesSubhead ?? `Trusted ${site.trade} services for every job.`;
  const reviewsHeading = site.rotation?.reviewsHeading ?? 'What Our Customers Say';
  const year = new Date().getFullYear();

  return {
    seo: {
      metaTitle: `${site.businessName} — ${trade} in ${site.city}, ${site.state}`,
      metaDescription: `${site.businessName} provides trusted ${site.trade} services in ${site.city}, ${site.state}. Free quotes, fast response, friendly local pros.`,
      ogImagePrompt: `Professional ${site.trade} work in progress, natural light, clean workspace, ${site.city}`,
    },
    navigation: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Reviews', href: '#reviews' },
      { label: 'Contact', href: '#contact' },
    ],
    theme: {
      preset,
      layoutVariant,
      primary: '#0e7490',
      primaryDark: '#155e75',
      accent: '#f59e0b',
      onPrimary: '#ffffff',
      bg: '#f8fafc',
      surface: '#ffffff',
      text: '#0f172a',
      muted: '#64748b',
      fontHeading,
      fontBody,
    },
    hero: {
      eyebrow: `${site.city}'s trusted ${site.trade} team`,
      headline: `Reliable ${trade} for ${site.city} Homeowners`,
      highlight: `${site.city} Homeowners`,
      subhead: `Fast, professional ${site.trade} service — upfront pricing, no surprises.`,
      badges: [
        { icon: 'shield-check', label: 'Licensed & Insured' },
        { icon: 'star', label: 'Highly Rated' },
        { icon: 'clock', label: 'Fast Response' },
      ],
      primaryCta: { label: 'Get a Free Quote', href: '#contact', style: 'primary' },
      secondaryCta: { label: 'Call Us Today', href: 'tel:', style: 'secondary' },
      imagePrompt: `Skilled technician at work on a ${site.trade} job in ${site.city}, bright daylight, photographic, no text`,
    },
    services: {
      heading: servicesHeading,
      subhead: servicesSubhead,
      cards: [
        { icon: 'wrench', title: 'Repairs', description: `Fast, dependable ${site.trade} repairs completed right the first time.` },
        { icon: 'hammer', title: 'Installation', description: `Clean, code-compliant ${site.trade} installations.` },
        { icon: 'clock', title: 'Maintenance', description: 'Routine maintenance to keep everything running smoothly.' },
        { icon: 'phone', title: 'Emergency Service', description: 'Available when you need us most.' },
      ],
    },
    about: {
      heading: `Your Local ${trade} Experts`,
      body: `${site.businessName} is a locally trusted ${site.trade} provider serving ${site.city}, ${site.state}. We focus on honest work, fair pricing, and treating every customer like a neighbor.`,
      stats: [
        { value: '10+', label: 'Years serving the area' },
        { value: '1,000+', label: 'Jobs completed' },
      ],
      imagePrompt: `Professional ${site.trade} team in uniform, friendly, natural light, ${site.city}`,
    },
    process: {
      heading: 'How It Works',
      steps: [
        { icon: 'phone', title: 'Get in Touch', description: 'Call or fill out the quick quote form.' },
        { icon: 'calendar', title: 'Schedule', description: 'We find a time that fits your schedule.' },
        { icon: 'check', title: 'Done Right', description: 'Quality work, backed by our guarantee.' },
      ],
    },
    reviews: {
      heading: reviewsHeading,
      items: [
        { author: 'Maria G.', initials: 'MG', rating: 5, text: 'Showed up on time and completed the job cleanly. Highly recommend this team.', location: `${site.city}, ${site.state}` },
        { author: 'James T.', initials: 'JT', rating: 5, text: 'Transparent pricing and great communication throughout the project. Will call again.', location: `${site.city}, ${site.state}` },
        { author: 'Priya S.', initials: 'PS', rating: 4, text: 'Professional, friendly, and thorough. Very satisfied with the results.', location: `${site.city}, ${site.state}` },
      ],
    },
    contact: {
      heading: 'Get Your Free Quote',
      subhead: `Reach out and we'll respond quickly — no pressure, no obligation.`,
      hours: 'Mon–Sat 7am–6pm',
      serviceArea: `${site.city} and surrounding areas`,
      formLabels: {
        name: 'Your Name',
        phone: 'Phone Number',
        message: 'How can we help?',
        submit: 'Send My Request',
      },
    },
    footer: {
      tagline: `${site.businessName} — quality ${site.trade} you can count on.`,
      legal: `© ${year} ${site.businessName}. All rights reserved.`,
      columns: [
        {
          heading: 'Services',
          links: [
            { label: 'Repairs', href: '#services' },
            { label: 'Installation', href: '#services' },
            { label: 'Maintenance', href: '#services' },
          ],
        },
      ],
      social: [],
      legalLinks: [
        { label: 'Privacy Policy', href: '/privacy' },
      ],
    },
  };
}
