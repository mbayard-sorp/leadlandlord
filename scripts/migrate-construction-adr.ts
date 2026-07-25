#!/usr/bin/env -S tsx
/**
 * WordPress-to-Sanity migration for the first Custom Sites tenant
 * (constructionadrservices.com, ADR 0033).
 *
 * Parses the WXR export, converts ACF-structured pages and classic
 * content:encoded HTML into csSite / csPage / csPracticeArea /
 * csPublication / csAttorney / csTestimonial / csBadge documents with
 * deterministic ids, uploads referenced media to Sanity, and writes
 * everything via createOrReplace (idempotent by construction).
 *
 * Usage:
 *   pnpm tsx scripts/migrate-construction-adr.ts --dataset development --dry-run
 *   pnpm tsx scripts/migrate-construction-adr.ts --dataset development
 *   pnpm tsx scripts/migrate-construction-adr.ts --dataset production
 *
 * Flags:
 *   --file <path>     WXR export path (defaults to the Downloads export)
 *   --dataset <name>  development | production (required)
 *   --dry-run         Parse + transform + validate only. Zero network calls:
 *                     asset uploads are skipped (placeholder refs emitted) and
 *                     the transformed docs are written as JSON to --out.
 *   --out <dir>       Dry-run output directory (default: <os tmpdir>/migrate-construction-adr-dry-run)
 *
 * Env: SANITY_PROJECT_ID + SANITY_API_TOKEN from .env.local (walked up from
 * this file, so it works inside git worktrees). Dataset always comes from
 * --dataset, never from env.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, extname, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });
const envFile = findEnvFile(__dirname, '.env');
if (envFile) loadEnv({ path: envFile, override: true });

import { XMLParser } from 'fast-xml-parser';
import { Schema } from '@sanity/schema';
import { htmlToBlocks, type DeserializerRule } from '@portabletext/block-tools';
import { JSDOM } from 'jsdom';
// Subpath imports only: the package's root index pulls in the customsites
// schema types, which import the full `sanity` Studio package and cannot be
// loaded under plain tsx. client.ts and ids.ts are dependency-light.
import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import {
  csSiteDocId,
  csPageDocId,
  csPracticeAreaDocId,
  csPublicationDocId,
  csAttorneyDocId,
  csTestimonialDocId,
  csBadgeDocId,
} from '@leadlandlord/sanity-schema/ids';
import type { SanityClient } from '@sanity/client';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_WXR = '/Users/mikebayard/Downloads/michaeljbayardconstructionadr.WordPress.2026-07-21.xml';

const { values: args } = parseArgs({
  options: {
    file: { type: 'string', default: DEFAULT_WXR },
    dataset: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const dataset = args.dataset;
if (dataset !== 'development' && dataset !== 'production') {
  console.error('Usage: migrate-construction-adr.ts --dataset development|production [--file <wxr>] [--dry-run] [--out <dir>]');
  process.exit(1);
}
const dryRun = Boolean(args['dry-run']);
const wxrPath = args.file as string;
const outDir = (args.out as string | undefined) ?? join(tmpdir(), 'migrate-construction-adr-dry-run');

if (!existsSync(wxrPath)) {
  console.error(`WXR file not found: ${wxrPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Site constants (verified against the WXR + design package)
// ---------------------------------------------------------------------------

const SITE_KEY = 'constructionadr';
const SITE_NAME = 'Michael J. Bayard Construction ADR';
const LOGO_HEADER_URL = 'https://constructionadrservices.com/wp-content/uploads/2023/11/logo.png';
const LOGO_FOOTER_URL = 'https://constructionadrservices.com/wp-content/uploads/2023/11/logo-2.png';
/** Theme banner behind interior page headers. Also an ACF options value. */
const INTERIOR_BANNER_URL = 'https://constructionadrservices.com/wp-content/uploads/2023/12/5.png';
const SITE_ID = csSiteDocId(SITE_KEY);
const ATTORNEY_SLUG = 'michael-j-bayard';
const ATTORNEY_ID = csAttorneyDocId(SITE_KEY, ATTORNEY_SLUG);
const LEGACY_HOSTS = new Set(['constructionadrservices.com', 'www.constructionadrservices.com']);

const siteRef = { _type: 'reference' as const, _ref: SITE_ID };

// Known badge attachments on the homepage badge_list repeater, in list order.
// Names verified against attachment filenames (badge-lexisnexis-logo.png,
// badge-Best-Lawyers.png, badge-avvo-white-logo.png, badge-super-lawyers-gry.png).
const BADGES: Array<{ wpId: string; key: string; name: string; filenameToken: string }> = [
  { wpId: '105', key: 'lexisnexis', name: 'LexisNexis', filenameToken: 'lexisnexis' },
  { wpId: '104', key: 'best-lawyers', name: 'Best Lawyers', filenameToken: 'best-lawyers' },
  { wpId: '103', key: 'avvo', name: 'Avvo', filenameToken: 'avvo' },
  { wpId: '106', key: 'super-lawyers', name: 'Super Lawyers', filenameToken: 'super-lawyers' },
];

// ---------------------------------------------------------------------------
// WXR parsing
// ---------------------------------------------------------------------------

interface WxrItem {
  id: string;
  title: string;
  link: string;
  slug: string;
  type: string;
  status: string;
  dateGmt: string;
  dateLocal: string;
  modifiedGmt: string;
  menuOrder: number;
  content: string;
  attachmentUrl?: string;
  meta: Record<string, string>;
  categories: Array<{ domain: string; nicename: string }>;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) {
    return textOf((v as Record<string, unknown>)['#text']);
  }
  return '';
}

function parseWxr(path: string): WxrItem[] {
  const xml = readFileSync(path, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  });
  const doc = parser.parse(xml);
  const rawItems = asArray(doc?.rss?.channel?.item);
  return rawItems.map((it: Record<string, unknown>) => {
    const meta: Record<string, string> = {};
    for (const pm of asArray(it['wp:postmeta'] as Record<string, unknown> | Record<string, unknown>[])) {
      const k = textOf(pm['wp:meta_key']);
      if (k) meta[k] = textOf(pm['wp:meta_value']);
    }
    const categories = asArray(it.category as unknown)
      .map((c: unknown) => {
        const o = c as Record<string, unknown>;
        return { domain: textOf(o?.['@_domain']), nicename: textOf(o?.['@_nicename']) };
      })
      .filter((c) => c.domain);
    return {
      id: textOf(it['wp:post_id']).trim(),
      title: textOf(it.title).trim(),
      link: textOf(it.link).trim(),
      slug: textOf(it['wp:post_name']).trim(),
      type: textOf(it['wp:post_type']).trim(),
      status: textOf(it['wp:status']).trim(),
      dateGmt: textOf(it['wp:post_date_gmt']).trim(),
      dateLocal: textOf(it['wp:post_date']).trim(),
      modifiedGmt: textOf(it['wp:post_modified_gmt']).trim(),
      menuOrder: Number(textOf(it['wp:menu_order']).trim() || '0'),
      content: textOf(it['content:encoded']),
      attachmentUrl: textOf(it['wp:attachment_url']).trim() || undefined,
      meta,
      categories,
    };
  });
}

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

/** Collapse newlines and runs of whitespace into single spaces. */
function collapse(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Strip literal <br> variants from a string (WP practice-area titles). */
function stripBr(s: string): string {
  return collapse(s.replace(/<br\s*\/?\s*>/gi, ' '));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML fragment to plain text (testimonial quotes). Keeps paragraph breaks. */
/**
 * Some WP testimonials have quote marks typed into the body and some do not.
 * The rendered design supplies its own, so strip any wrapping pair to keep the
 * set consistent and avoid doubled quotes.
 */
function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['‘', '’'],
    ["'", "'"],
  ];
  for (const [open, close] of pairs) {
    if (trimmed.length > 1 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }
  return trimmed;
}

function htmlToPlainText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
}

/** Sanitize an ISO datetime from WXR "YYYY-MM-DD HH:MM:SS" values. */
function isoFromWp(gmt: string | undefined, localFallback?: string): string | undefined {
  const pick = gmt && !gmt.startsWith('0000') ? gmt : localFallback;
  if (!pick || pick.startsWith('0000')) return undefined;
  const iso = `${pick.trim().replace(' ', 'T')}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/**
 * Resolve Yoast title template tokens. Empty/absent input returns undefined.
 * The site-host layout appends "| <site name>" via its title template, so a
 * trailing site-name suffix is stripped here to avoid doubled branding. A
 * title that is only the site name (the WP homepage) resolves to undefined so
 * the route-level fallback applies.
 */
function resolveYoastTitle(raw: string | undefined, docTitle: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const resolved = raw
    .replace(/%%title%%/g, docTitle)
    .replace(/%%page%%/g, '')
    .replace(/%%sitename%%/g, SITE_NAME)
    .replace(/%%sep%%/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = resolved.replace(new RegExp(`\\s*\\|\\s*${SITE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim();
  return stripped || undefined;
}

function buildSeo(item: WxrItem, docTitle: string): Record<string, unknown> | undefined {
  const metaTitle = resolveYoastTitle(item.meta['_yoast_wpseo_title'], docTitle);
  const metaDescription = item.meta['_yoast_wpseo_metadesc']?.trim() || undefined;
  if (!metaTitle && !metaDescription) return undefined;
  const seo: Record<string, unknown> = { _type: 'csSeo' };
  if (metaTitle) seo.metaTitle = metaTitle;
  if (metaDescription) seo.metaDescription = decodeEntities(metaDescription);
  return seo;
}

function pathOf(link: string, opts: { keepTrailingSlash?: boolean } = {}): string {
  try {
    const u = new URL(link);
    let p = u.pathname || '/';
    if (!opts.keepTrailingSlash && p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  } catch {
    return link;
  }
}

// ---------------------------------------------------------------------------
// Attachments + asset uploads
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif']);

interface Attachment {
  wpId: string;
  url: string;
  alt?: string;
  title: string;
  filename: string;
  ext: string;
  kind: 'image' | 'file';
}

function buildAttachmentMap(items: WxrItem[]): { byId: Map<string, Attachment>; byUrl: Map<string, Attachment> } {
  const byId = new Map<string, Attachment>();
  const byUrl = new Map<string, Attachment>();
  for (const it of items) {
    if (it.type !== 'attachment' || !it.attachmentUrl) continue;
    const filename = basename(new URL(it.attachmentUrl).pathname);
    const ext = extname(filename).replace('.', '').toLowerCase();
    const att: Attachment = {
      wpId: it.id,
      url: it.attachmentUrl,
      alt: it.meta['_wp_attachment_image_alt']?.trim() || undefined,
      title: it.title,
      filename,
      ext,
      kind: IMAGE_EXTS.has(ext) ? 'image' : 'file',
    };
    byId.set(it.id, att);
    byUrl.set(att.url, att);
  }
  return { byId, byUrl };
}

interface UploadedAsset {
  ref: string;
  url: string; // public asset URL (placeholder in dry-run)
}

interface ManifestEntry {
  wpId?: string;
  sourceUrl: string;
  filename: string;
  kind: 'image' | 'file';
  usedBy: string[];
}

/**
 * Downloads each referenced attachment once and uploads it to Sanity,
 * caching by source URL. In dry-run mode nothing touches the network:
 * deterministic placeholder refs are returned and a manifest of what WOULD
 * upload is collected instead.
 */
class AssetUploader {
  private cache = new Map<string, Promise<UploadedAsset>>();
  readonly manifest = new Map<string, ManifestEntry>();
  readonly failures: Array<{ sourceUrl: string; error: string }> = [];

  constructor(
    private client: SanityClient | null,
    private dry: boolean,
  ) {}

  upload(kind: 'image' | 'file', sourceUrl: string, filename: string, usedBy: string, wpId?: string): Promise<UploadedAsset> {
    const entry = this.manifest.get(sourceUrl);
    if (entry) {
      if (!entry.usedBy.includes(usedBy)) entry.usedBy.push(usedBy);
    } else {
      this.manifest.set(sourceUrl, { wpId, sourceUrl, filename, kind, usedBy: [usedBy] });
    }
    let p = this.cache.get(sourceUrl);
    if (!p) {
      p = this.doUpload(kind, sourceUrl, filename, wpId);
      this.cache.set(sourceUrl, p);
    }
    return p;
  }

  private async doUpload(kind: 'image' | 'file', sourceUrl: string, filename: string, wpId?: string): Promise<UploadedAsset> {
    if (this.dry || !this.client) {
      const token = wpId ?? filename.replace(/[^a-zA-Z0-9-]/g, '-');
      return { ref: `dryrun-${kind}-${token}`, url: `dryrun://${kind}/${filename}` };
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const asset = await this.client.assets.upload(kind, buf, { filename });
        return { ref: asset._id, url: asset.url };
      } catch (err) {
        if (attempt === 2) {
          const msg = err instanceof Error ? err.message : String(err);
          this.failures.push({ sourceUrl, error: msg });
          throw new Error(`Asset upload failed for ${sourceUrl}: ${msg}`);
        }
      }
    }
    throw new Error('unreachable');
  }
}

function imageValue(asset: UploadedAsset, alt?: string): Record<string, unknown> {
  const v: Record<string, unknown> = { _type: 'image', asset: { _type: 'reference', _ref: asset.ref } };
  if (alt) v.alt = alt;
  return v;
}

function fileValue(asset: UploadedAsset): Record<string, unknown> {
  return { _type: 'file', asset: { _type: 'reference', _ref: asset.ref } };
}

// ---------------------------------------------------------------------------
// HTML -> Portable Text
// ---------------------------------------------------------------------------

// csBody's block member, mirrored from
// packages/sanity-schema/src/types/customsites/objects.ts. Duplicated here as
// plain schema objects because the source module imports the full `sanity`
// Studio package, which cannot load under tsx. The image member is handled by
// a custom deserializer rule instead of a schema member (a bare
// @sanity/schema compile has no sanity.imageHotspot built-in).
const compiledSchema = Schema.compile({
  name: 'customsites-migration',
  types: [
    {
      name: 'csBody',
      type: 'array',
      of: [
        {
          type: 'block',
          styles: [
            { title: 'Normal', value: 'normal' },
            { title: 'Heading 2', value: 'h2' },
            { title: 'Heading 3', value: 'h3' },
            { title: 'Heading 4', value: 'h4' },
            { title: 'Quote', value: 'blockquote' },
          ],
          lists: [
            { title: 'Bullet', value: 'bullet' },
            { title: 'Number', value: 'number' },
          ],
          marks: {
            decorators: [
              { title: 'Bold', value: 'strong' },
              { title: 'Italic', value: 'em' },
            ],
            annotations: [{ name: 'link', type: 'object', title: 'Link', fields: [{ name: 'href', type: 'url' }] }],
          },
        },
      ],
    },
    { name: 'csBodyHost', type: 'document', fields: [{ name: 'body', type: 'csBody' }] },
  ],
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const csBodyType = (compiledSchema.get('csBodyHost') as any).fields.find((f: any) => f.name === 'body').type;

const BLOCK_TAG = 'h[1-6]|ul|ol|blockquote|table|pre|figure|div|p';

/**
 * wpautop-lite: classic WordPress content:encoded separates paragraphs with
 * blank lines and leaves block tags inline. Normalize into real HTML so
 * htmlToBlocks sees proper paragraph boundaries.
 */
function wpHtmlNormalize(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n');
  // Gutenberg block comments and stray HTML comments
  s = s.replace(/<!--\s*\/?wp:[^>]*-->/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // Give block-level tags their own paragraph boundaries
  s = s.replace(new RegExp(`<(?:${BLOCK_TAG})(?:\\s[^>]*)?>`, 'gi'), (m) => `\n\n${m}`);
  s = s.replace(new RegExp(`</(?:${BLOCK_TAG})>`, 'gi'), (m) => `${m}\n\n`);
  const chunks = s.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  return chunks
    .map((c) => {
      if (new RegExp(`^<(?:${BLOCK_TAG}|img)`, 'i').test(c)) return c;
      return `<p>${c.replace(/\n+/g, ' ')}</p>`;
    })
    .join('\n');
}

interface PtContext {
  attachmentsByUrl: Map<string, Attachment>;
  uploader: AssetUploader;
  /** source URL -> uploaded asset, pre-resolved before conversion */
  resolvedAssets: Map<string, UploadedAsset>;
  warnings: string[];
}

/** Pre-scan HTML for asset references (img src, wp-content hrefs) so uploads
 *  can be resolved before the synchronous htmlToBlocks pass. */
function collectHtmlAssetRefs(html: string): { images: string[]; files: string[] } {
  const images: string[] = [];
  const files: string[] = [];
  for (const m of html.matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)) images.push(m[1]!);
  for (const m of html.matchAll(/href="([^"]*\/wp-content\/uploads\/[^"]+)"/gi)) {
    const url = m[1]!;
    const ext = extname(new URL(url, 'https://constructionadrservices.com').pathname).replace('.', '').toLowerCase();
    if (!IMAGE_EXTS.has(ext)) files.push(url);
  }
  return { images, files };
}

function isLegacyHost(href: string): boolean {
  try {
    return LEGACY_HOSTS.has(new URL(href).hostname);
  } catch {
    return false;
  }
}

/** Rewrite a link href per migration rules. */
function rewriteHref(href: string, ctx: PtContext): string {
  if (!/^https?:\/\//i.test(href)) return href;
  if (!isLegacyHost(href)) return href;
  if (href.includes('/wp-content/uploads/')) {
    const resolved = ctx.resolvedAssets.get(href);
    if (resolved) return resolved.url;
    ctx.warnings.push(`Unresolved wp-content link left absolute: ${href}`);
    return href;
  }
  return pathOf(href, { keepTrailingSlash: false });
}

function htmlToPortableText(rawHtml: string, ctx: PtContext, docLabel: string): Array<Record<string, unknown>> {
  const html = wpHtmlNormalize(rawHtml);
  if (!html.trim()) return [];

  const imgRule: DeserializerRule = {
    deserialize(el, _next, createBlock) {
      if (el.nodeType !== 1) return undefined;
      const e = el as Element;
      if (e.tagName?.toLowerCase() !== 'img') return undefined;
      const src = e.getAttribute('src') ?? '';
      const resolved = ctx.resolvedAssets.get(src);
      if (!resolved) {
        ctx.warnings.push(`${docLabel}: <img> with unresolved src dropped: ${src}`);
        return createBlock({ _type: '__drop__' });
      }
      const att = ctx.attachmentsByUrl.get(src);
      const alt = att?.alt ?? e.getAttribute('alt') ?? undefined;
      const img: { _type: string; [k: string]: unknown } = { _type: 'image', asset: { _type: 'reference', _ref: resolved.ref } };
      if (alt) img.alt = alt;
      return createBlock(img);
    },
  };

  const blocks = htmlToBlocks(decodeEntities(html), csBodyType, {
    parseHtml: (h) => new JSDOM(h).window.document,
    rules: [imgRule],
  }) as Array<Record<string, unknown>>;

  const kept = blocks.filter((b) => b._type !== '__drop__');
  for (const b of kept) {
    const markDefs = b.markDefs as Array<Record<string, unknown>> | undefined;
    if (!markDefs) continue;
    for (const md of markDefs) {
      if (md._type === 'link' && typeof md.href === 'string') {
        md.href = rewriteHref(md.href, ctx);
      }
    }
  }
  return kept;
}

function ptPlainText(blocks: Array<Record<string, unknown>>): string {
  return blocks
    .filter((b) => b._type === 'block')
    .map((b) => ((b.children as Array<Record<string, unknown>>) ?? []).map((c) => c.text ?? '').join(''))
    .join('\n')
    .trim();
}

function excerptFrom(text: string, maxWords = 30): string | undefined {
  const words = collapse(text).split(' ').filter(Boolean);
  if (words.length === 0) return undefined;
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Parsing WXR: ${wxrPath}`);
  const items = parseWxr(wxrPath);
  const published = items.filter((it) => it.status === 'publish' || it.type === 'attachment' || it.type === 'nav_menu_item');

  const pages = published.filter((it) => it.type === 'page');
  const posts = published.filter((it) => it.type === 'post');
  const practiceAreas = published.filter((it) => it.type === 'practice-areas');
  const testimonials = published.filter((it) => it.type === 'testimonials');
  const navItems = published.filter((it) => it.type === 'nav_menu_item');
  const { byId: attById, byUrl: attByUrl } = buildAttachmentMap(items);

  console.log(
    `Found: ${pages.length} pages, ${posts.length} posts, ${practiceAreas.length} practice areas, ` +
      `${testimonials.length} testimonials, ${attById.size} attachments, ${navItems.length} nav items`,
  );

  const warnings: string[] = [];
  const client = dryRun ? null : createWriteClient({ dataset });
  const uploader = new AssetUploader(client, dryRun);
  const resolvedAssets = new Map<string, UploadedAsset>();
  const ptCtx: PtContext = { attachmentsByUrl: attByUrl, uploader, resolvedAssets, warnings };

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byWpId = new Map(published.map((p) => [p.id, p]));

  // -------------------------------------------------------------------------
  // Phase 1: collect every referenced asset, then resolve uploads up front so
  // document building can stay synchronous.
  // -------------------------------------------------------------------------

  interface AssetRequest {
    kind: 'image' | 'file';
    url: string;
    filename: string;
    usedBy: string;
    wpId?: string;
  }
  const requests = new Map<string, AssetRequest>();

  function requestAttachment(wpId: string | undefined, usedBy: string, expectKind?: 'image' | 'file'): Attachment | undefined {
    if (!wpId || !wpId.trim()) return undefined;
    const att = attById.get(wpId.trim());
    if (!att) {
      warnings.push(`${usedBy}: attachment ${wpId} not found in WXR`);
      return undefined;
    }
    if (expectKind && att.kind !== expectKind) {
      warnings.push(`${usedBy}: attachment ${wpId} (${att.filename}) is ${att.kind}, expected ${expectKind}`);
    }
    const existing = requests.get(att.url);
    if (existing) {
      existing.usedBy += `, ${usedBy}`;
    } else {
      requests.set(att.url, { kind: att.kind, url: att.url, filename: att.filename, usedBy, wpId: att.wpId });
    }
    return att;
  }

  function requestUrl(url: string, kind: 'image' | 'file', usedBy: string): void {
    const att = attByUrl.get(url);
    if (att) {
      requestAttachment(att.wpId, usedBy);
      return;
    }
    if (!requests.has(url)) {
      const filename = basename(new URL(url, 'https://constructionadrservices.com').pathname);
      requests.set(url, { kind, url, filename, usedBy });
    }
  }

  const home = pageById.get('6');
  const mikesStory = pageById.get('8');
  const adrServices = pageById.get('10');
  if (!home || !mikesStory || !adrServices) {
    console.error('WXR is missing one of the core pages (home=6, mikes-story=8, adr-services=10). Aborting.');
    process.exit(1);
  }

  // Brand logos. These live in the ACF options page, which WXR does not
  // export, so they are pulled straight from the theme upload URLs. logo.png
  // is the dark-on-light header mark; logo-2.png is the white footer mark.
  requestUrl(LOGO_HEADER_URL, 'image', 'site header logo');
  requestUrl(LOGO_FOOTER_URL, 'image', 'site footer logo');
  requestUrl(INTERIOR_BANNER_URL, 'image', 'interior page banner');

  // Hero background: home page thumbnail (attachment 189)
  requestAttachment(home.meta['_thumbnail_id'], 'home hero background', 'image');
  // Attorney portrait: mikes-story thumbnail 167 (atty-mike-new.jpg, the
  // portrait) over banner_image 191 (a 6.png banner graphic).
  requestAttachment(mikesStory.meta['_thumbnail_id'], 'attorney photo', 'image');
  // vCard file
  requestAttachment(mikesStory.meta['vcard'], 'attorney vCard', 'file');
  // Badges
  for (const b of BADGES) requestAttachment(b.wpId, `badge ${b.name}`, 'image');
  // Practice area thumbnails
  for (const pa of practiceAreas) requestAttachment(pa.meta['_thumbnail_id'], `practice area ${pa.slug}`, 'image');
  // Per-page header banners (ACF banner_image). Pages without one fall back to
  // the site default banner at render time.
  for (const p of pages) requestAttachment(p.meta['banner_image'], `page ${p.slug} banner`, 'image');
  // Publication featured images + PDFs
  for (const post of posts) {
    requestAttachment(post.meta['_thumbnail_id'], `publication ${post.slug}`, 'image');
    const linkOrPdf = post.meta['link_or_pdf']?.trim();
    if (linkOrPdf && linkOrPdf.includes('/wp-content/uploads/') && isLegacyHost(linkOrPdf)) {
      requestUrl(linkOrPdf, 'file', `publication ${post.slug} pdf`);
    }
  }
  // Body-embedded assets (imgs, wp-content hrefs) across all rich content
  const richSources: Array<{ label: string; html: string }> = [
    ...pages.map((p) => ({ label: `page ${p.slug}`, html: p.content })),
    ...posts.map((p) => ({ label: `post ${p.slug}`, html: p.content })),
    ...practiceAreas.map((p) => ({ label: `practice area ${p.slug}`, html: p.content })),
    { label: 'home about_text_block', html: home.meta['about_text_block'] ?? '' },
    { label: 'adr-services bottom_text_content', html: adrServices.meta['bottom_text_content'] ?? '' },
  ];
  for (let i = 0; i < 5; i++) {
    richSources.push({
      label: `attorney bio section ${i}`,
      html: mikesStory.meta[`attorney_info_background_${i}_bg_content_list`] ?? '',
    });
  }
  for (const src of richSources) {
    const refs = collectHtmlAssetRefs(src.html);
    for (const url of refs.images) requestUrl(url, 'image', `${src.label} body image`);
    for (const url of refs.files) requestUrl(url, 'file', `${src.label} body link`);
  }

  console.log(`\nResolving ${requests.size} referenced assets${dryRun ? ' (dry-run: placeholder refs, no downloads)' : ''}...`);
  for (const req of requests.values()) {
    try {
      const asset = await uploader.upload(req.kind, req.url, req.filename, req.usedBy, req.wpId);
      resolvedAssets.set(req.url, asset);
    } catch {
      // failure already recorded on uploader.failures; doc fields referencing
      // it will be omitted below.
    }
  }

  function assetFor(att: Attachment | undefined): UploadedAsset | undefined {
    if (!att) return undefined;
    return resolvedAssets.get(att.url);
  }

  // -------------------------------------------------------------------------
  // Phase 2: transform to documents
  // -------------------------------------------------------------------------

  const docs: Array<Record<string, unknown>> = [];

  // --- Navigation from nav_menu_items -------------------------------------
  const mainMenu = navItems
    .filter((n) => n.categories.some((c) => c.domain === 'nav_menu' && c.nicename === 'main-menu'))
    .sort((a, b) => a.menuOrder - b.menuOrder);

  function navTargetHref(n: WxrItem): { label: string; href: string } | undefined {
    const objectId = n.meta['_menu_item_object_id'];
    const target = objectId ? byWpId.get(objectId) : undefined;
    if (!target) {
      warnings.push(`nav item ${n.id}: target ${objectId} not found`);
      return undefined;
    }
    const label = target.type === 'practice-areas' ? stripBr(target.title) : decodeEntities(target.title);
    const href = target.id === '6' ? '/' : pathOf(target.link);
    return { label, href };
  }

  const navigation: Array<Record<string, unknown>> = [];
  for (const n of mainMenu) {
    if (n.meta['_menu_item_menu_item_parent'] !== '0') continue;
    const t = navTargetHref(n);
    if (!t) continue;
    const children = mainMenu
      .filter((c) => c.meta['_menu_item_menu_item_parent'] === n.id)
      .map((c) => navTargetHref(c))
      .filter((c): c is { label: string; href: string } => Boolean(c))
      .map((c) => ({ _type: 'csNavChildLink', _key: `nav-child-${c.href.split('/').pop()}`, label: c.label, href: c.href }));
    const link: Record<string, unknown> = {
      _type: 'csNavLink',
      _key: `nav-${t.href === '/' ? 'home' : t.href.split('/').pop()}`,
      label: t.label,
      href: t.href,
    };
    if (children.length > 0) link.children = children;
    navigation.push(link);
  }

  const footerNav = [
    { key: 'about', label: 'About Us', href: '/mikes-story' },
    { key: 'practice-areas', label: 'Practice Areas', href: '/adr-services' },
    { key: 'publications', label: 'Publications', href: '/publications' },
    { key: 'contact', label: 'Contact Us', href: '/contact' },
    { key: 'sitemap', label: 'Sitemap', href: '/sitemap' },
    { key: 'disclaimer', label: 'Disclaimer', href: '/disclaimer' },
    { key: 'privacy-policy', label: 'Privacy Policy', href: '/privacy-policy' },
  ].map((l) => ({ _type: 'csNavLink', _key: `footer-${l.key}`, label: l.label, href: l.href }));

  // --- csSite ---------------------------------------------------------------
  docs.push({
    _id: SITE_ID,
    _type: 'csSite',
    siteKey: SITE_KEY,
    name: SITE_NAME,
    customDomain: 'constructionadrservices.com',
    tagline: 'Smart Solutions in Conflict Resolution',
    phone: '(213) 383-9399',
    email: 'michaeljbayard@yahoo.com',
    address: {
      _type: 'csAddress',
      street: '611 Wilshire Boulevard',
      unit: '9th Floor',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90017',
    },
    ...(resolvedAssets.get(LOGO_HEADER_URL)
      ? { logo: imageValue(resolvedAssets.get(LOGO_HEADER_URL)!, SITE_NAME) }
      : {}),
    ...(resolvedAssets.get(LOGO_FOOTER_URL)
      ? { footerLogo: imageValue(resolvedAssets.get(LOGO_FOOTER_URL)!, SITE_NAME) }
      : {}),
    ...(resolvedAssets.get(INTERIOR_BANNER_URL)
      ? { bannerImage: imageValue(resolvedAssets.get(INTERIOR_BANNER_URL)!, '') }
      : {}),
    navigation,
    footerNav,
    leadRecipients: ['michaeljbayard@yahoo.com', 'mikebayard@me.com'],
    gtmContainerId: 'GTM-52GK4MXZ',
    organizationType: 'LegalService',
    robotsDisallow: true,
    sameAs: [],
    redirects: [],
  });

  // --- csAttorney -----------------------------------------------------------
  const attorneyPhotoAtt = attById.get(mikesStory.meta['_thumbnail_id']?.trim() ?? '');
  const attorneyPhoto = assetFor(attorneyPhotoAtt);
  const vcardAtt = attById.get(mikesStory.meta['vcard']?.trim() ?? '');
  const vcardAsset = assetFor(vcardAtt);

  const bioSections: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 5; i++) {
    const heading = collapse(mikesStory.meta[`attorney_info_background_${i}_heading_title`]);
    const contentHtml = mikesStory.meta[`attorney_info_background_${i}_bg_content_list`] ?? '';
    if (!heading && !contentHtml.trim()) continue;
    bioSections.push({
      _type: 'csBioSection',
      _key: `bio-section-${i}`,
      heading,
      content: htmlToPortableText(contentHtml, ptCtx, `attorney bio "${heading}"`),
    });
  }

  const attorneyDoc: Record<string, unknown> = {
    _id: ATTORNEY_ID,
    _type: 'csAttorney',
    site: siteRef,
    name: collapse(mikesStory.meta['attorney_name']) || 'Michael J. Bayard',
    slug: { _type: 'slug', current: ATTORNEY_SLUG },
    jobTitle: collapse(mikesStory.meta['banner_description']),
    bio: htmlToPortableText(mikesStory.content, ptCtx, 'attorney bio intro'),
    bioSections,
    email: 'michaeljbayard@yahoo.com',
    phone: '(213) 383-9399',
    sameAs: [],
  };
  if (attorneyPhoto) attorneyDoc.photo = imageValue(attorneyPhoto, attorneyPhotoAtt?.alt);
  if (vcardAsset) attorneyDoc.vCard = fileValue(vcardAsset);
  docs.push(attorneyDoc);

  // --- csTestimonial x4 -----------------------------------------------------
  const testimonialRefs: Array<Record<string, unknown>> = [];
  testimonials
    .sort((a, b) => Number(a.id) - Number(b.id))
    .forEach((t, i) => {
      const rawTitle = decodeEntities(t.title);
      let author = rawTitle;
      let role = 'Attorney';
      const clientMatch = rawTitle.match(/^(.*?),\s*Client$/i);
      if (clientMatch) {
        author = clientMatch[1]!.trim();
        role = 'Client';
      }
      const id = csTestimonialDocId(SITE_KEY, t.slug);
      docs.push({
        _id: id,
        _type: 'csTestimonial',
        site: siteRef,
        quote: stripWrappingQuotes(htmlToPlainText(t.content)),
        author,
        role,
        order: i + 1,
        featured: true,
      });
      testimonialRefs.push({ _type: 'reference', _ref: id, _key: `testimonial-${t.slug}` });
    });

  // --- csBadge x4 -----------------------------------------------------------
  const badgeRefs: Array<Record<string, unknown>> = [];
  BADGES.forEach((b, i) => {
    const att = attById.get(b.wpId);
    if (!att) {
      warnings.push(`badge ${b.name}: attachment ${b.wpId} missing, badge skipped`);
      return;
    }
    if (!att.filename.toLowerCase().includes(b.filenameToken)) {
      warnings.push(`badge ${b.name}: filename ${att.filename} does not contain "${b.filenameToken}" - verify mapping`);
    }
    const asset = assetFor(att);
    if (!asset) {
      warnings.push(`badge ${b.name}: asset upload failed, badge skipped`);
      return;
    }
    const id = csBadgeDocId(SITE_KEY, b.key);
    docs.push({
      _id: id,
      _type: 'csBadge',
      site: siteRef,
      name: b.name,
      image: imageValue(asset, att.alt ?? b.name),
      order: i + 1,
    });
    badgeRefs.push({ _type: 'reference', _ref: id, _key: `badge-${b.key}` });
  });

  // --- csPracticeArea x6 ----------------------------------------------------
  // Order comes from the main-menu dropdown under ADR Services.
  const practiceOrder = new Map<string, number>();
  mainMenu
    .filter((n) => n.meta['_menu_item_object'] === 'practice-areas')
    .forEach((n, i) => practiceOrder.set(n.meta['_menu_item_object_id'] ?? '', i + 1));

  for (const pa of practiceAreas) {
    const title = stripBr(decodeEntities(pa.title));
    const body = htmlToPortableText(pa.content, ptCtx, `practice area ${pa.slug}`);
    const thumbAtt = attById.get(pa.meta['_thumbnail_id']?.trim() ?? '');
    const thumbAsset = assetFor(thumbAtt);
    const doc: Record<string, unknown> = {
      _id: csPracticeAreaDocId(SITE_KEY, pa.slug),
      _type: 'csPracticeArea',
      site: siteRef,
      title,
      slug: { _type: 'slug', current: pa.slug },
      excerpt: excerptFrom(ptPlainText(body).split('\n')[0] ?? ''),
      body,
      faqs: [],
      order: practiceOrder.get(pa.id) ?? 99,
      publishedAt: isoFromWp(pa.dateGmt, pa.dateLocal),
      modifiedAt: isoFromWp(pa.modifiedGmt, pa.dateLocal),
    };
    if (thumbAsset) {
      doc.heroImage = imageValue(thumbAsset, thumbAtt?.alt ?? title);
      // Same source art doubles as the option-card image in csPracticeGridBlock.
      doc.cardImage = imageValue(thumbAsset, thumbAtt?.alt ?? title);
    }
    const seo = buildSeo(pa, title);
    if (seo) doc.seo = seo;
    if (!practiceOrder.has(pa.id)) warnings.push(`practice area ${pa.slug}: not in nav menu, order defaulted to 99`);
    docs.push(doc);
  }

  // --- csPublication x57 ----------------------------------------------------
  const KIND_BY_CATEGORY: Record<string, string> = {
    publication: 'publication',
    presentation: 'presentation',
    uncategorized: 'article',
  };

  for (const post of posts) {
    const title = decodeEntities(post.title);
    const catNames = post.categories.filter((c) => c.domain === 'category').map((c) => c.nicename);
    const kind = catNames.map((c) => KIND_BY_CATEGORY[c]).find(Boolean) ?? 'article';
    if (catNames.length > 0 && !catNames.some((c) => c in KIND_BY_CATEGORY)) {
      warnings.push(`post ${post.slug}: unmapped categories [${catNames.join(', ')}], kind defaulted to article`);
    }
    const body = htmlToPortableText(post.content, ptCtx, `post ${post.slug}`);
    const metadesc = post.meta['_yoast_wpseo_metadesc']?.trim();
    const excerpt = excerptFrom(ptPlainText(body)) ?? (metadesc ? decodeEntities(metadesc) : undefined);

    const doc: Record<string, unknown> = {
      _id: csPublicationDocId(SITE_KEY, post.slug),
      _type: 'csPublication',
      site: siteRef,
      title,
      slug: { _type: 'slug', current: post.slug },
      kind,
      publishedAt: isoFromWp(post.dateGmt, post.dateLocal),
      modifiedAt: isoFromWp(post.modifiedGmt, post.dateLocal),
      author: { _type: 'reference', _ref: ATTORNEY_ID },
      wpId: Number(post.id),
      legacyPath: pathOf(post.link, { keepTrailingSlash: true }),
    };
    if (body.length > 0) doc.body = body;
    if (excerpt) doc.excerpt = excerpt;

    const externalEvent = post.meta['name_of_event']?.trim();
    const externalDate = post.meta['date_of_publication']?.trim();
    const coAuthors = post.meta['author']?.trim();
    if (externalEvent) doc.externalEvent = decodeEntities(externalEvent);
    if (externalDate) doc.externalDate = externalDate;
    if (coAuthors) doc.coAuthors = decodeEntities(coAuthors);

    const linkOrPdf = post.meta['link_or_pdf']?.trim();
    if (linkOrPdf && linkOrPdf.includes('/wp-content/uploads/') && isLegacyHost(linkOrPdf)) {
      const pdfAsset = resolvedAssets.get(linkOrPdf);
      if (pdfAsset) doc.pdf = fileValue(pdfAsset);
      else warnings.push(`post ${post.slug}: pdf upload unresolved (${linkOrPdf})`);
    } else if (linkOrPdf) {
      warnings.push(`post ${post.slug}: link_or_pdf is not a wp-content URL, left unmigrated: ${linkOrPdf}`);
    }

    const thumbAtt = attById.get(post.meta['_thumbnail_id']?.trim() ?? '');
    const thumbAsset = assetFor(thumbAtt);
    if (thumbAsset) doc.featuredImage = imageValue(thumbAsset, thumbAtt?.alt ?? title);

    const seo = buildSeo(post, title);
    if (seo) doc.seo = seo;
    docs.push(doc);
  }

  // --- csPage x9 ------------------------------------------------------------
  function pageDoc(item: WxrItem, slugOverride: string | undefined, pageBuilder: Array<Record<string, unknown>>): Record<string, unknown> {
    const slug = slugOverride ?? item.slug;
    const title = decodeEntities(item.title);
    const doc: Record<string, unknown> = {
      _id: csPageDocId(SITE_KEY, slug),
      _type: 'csPage',
      site: siteRef,
      title,
      slug: { _type: 'slug', current: slug },
      pageBuilder,
      publishedAt: isoFromWp(item.dateGmt, item.dateLocal),
      modifiedAt: isoFromWp(item.modifiedGmt, item.dateLocal),
    };
    const bannerAsset = assetFor(attById.get((item.meta['banner_image'] ?? '').trim()));
    if (bannerAsset) doc.bannerImage = imageValue(bannerAsset, `${title} header banner`);
    const seo = buildSeo(item, title);
    if (seo) doc.seo = seo;
    return doc;
  }

  // Home
  const heroBgAtt = attById.get(home.meta['_thumbnail_id']?.trim() ?? '');
  const heroBgAsset = assetFor(heroBgAtt);
  const pubHeadingMatch = (home.meta['publicaion_text_block'] ?? '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const homeBlocks: Array<Record<string, unknown>> = [
    {
      _type: 'csHeroBlock',
      _key: 'home-hero',
      eyebrow: 'Michael J. Bayard',
      heading: 'Practice Limited to Construction Disputes',
      subheading: 'Mediator, Arbitrator, Judicial Reference, Discovery Referee, ADR Advocacy Consultant.',
      ctaLabel: 'Talk to an Expert',
      ctaHref: '/contact',
      ...(heroBgAsset
        ? { backgroundImage: imageValue(heroBgAsset, 'Michael J. Bayard seated in his Los Angeles office') }
        : {}),
    },
    {
      _type: 'csIntroBlock',
      _key: 'home-intro',
      eyebrow: collapse(home.meta['top_border_text']),
      heading: collapse(home.meta['heading_text']),
      body: htmlToPortableText(home.meta['about_text_block'] ?? '', ptCtx, 'home intro'),
      ctaLabel: 'About the Firm',
      ctaHref: '/mikes-story',
    },
    { _type: 'csPracticeGridBlock', _key: 'home-practice-grid', mode: 'all', eyebrow: 'Our Expertise', heading: 'Practice Areas' },
    { _type: 'csAttorneyBlock', _key: 'home-attorney', attorney: { _type: 'reference', _ref: ATTORNEY_ID } },
    { _type: 'csTestimonialsBlock', _key: 'home-testimonials', items: testimonialRefs, autoRotate: true },
    { _type: 'csBadgeRowBlock', _key: 'home-badges', badges: badgeRefs },
    {
      _type: 'csPublicationsBlock',
      _key: 'home-publications',
      heading: pubHeadingMatch ? collapse(decodeEntities(pubHeadingMatch[1]!)) : 'Publications',
      limit: 3,
      ctaLabel: 'View All Publications',
      ctaHref: '/publications',
    },
    {
      _type: 'csContactCtaBlock',
      _key: 'home-contact-cta',
      eyebrow: 'Get Your Free Case Review',
      heading: 'Let Us Help You',
      showForm: true,
    },
  ];
  docs.push(pageDoc(home, 'home', homeBlocks));

  // Mike's Story: the bio content lives on the csAttorney doc; the page renders
  // the full attorney profile, then the rotating pull-quote and lead form to
  // match the live page's closing sections.
  docs.push(
    pageDoc(mikesStory, undefined, [
      { _type: 'csAttorneyBlock', _key: 'mikes-story-attorney', attorney: { _type: 'reference', _ref: ATTORNEY_ID }, showFullProfile: true },
      { _type: 'csTestimonialsBlock', _key: 'mikes-story-testimonials', items: testimonialRefs, autoRotate: true },
      {
        _type: 'csContactCtaBlock',
        _key: 'mikes-story-contact-cta',
        eyebrow: 'Get Your Free Case Review',
        heading: 'Let Us Help You',
        showForm: true,
      },
    ]),
  );

  // ADR Services: "Our Expertise" intro (page body) above the full practice
  // grid, then the ACF bottom_text_content as a closing note with a top rule.
  const adrServicesBlocks: Array<Record<string, unknown>> = [
    {
      _type: 'csIntroBlock',
      _key: 'adr-services-intro',
      heading: 'Our Expertise',
      body: htmlToPortableText(adrServices.content, ptCtx, 'adr-services intro'),
      layout: 'stacked',
    },
    { _type: 'csPracticeGridBlock', _key: 'adr-services-grid', mode: 'all' },
  ];
  const adrBottomText = (adrServices.meta['bottom_text_content'] ?? '').trim();
  if (adrBottomText) {
    adrServicesBlocks.push({
      _type: 'csIntroBlock',
      _key: 'adr-services-bottom',
      body: htmlToPortableText(adrBottomText, ptCtx, 'adr-services bottom'),
      layout: 'stacked',
      topRule: true,
    });
  }
  adrServicesBlocks.push(
    {
      _type: 'csTestimonialsBlock',
      _key: 'adr-services-testimonials',
      items: testimonialRefs,
      autoRotate: true,
    },
    {
      _type: 'csContactCtaBlock',
      _key: 'adr-services-contact-cta',
      eyebrow: 'Get Your Free Case Review',
      heading: 'Let Us Help You',
      showForm: true,
    },
  );
  docs.push(pageDoc(adrServices, undefined, adrServicesBlocks));

  // Publications index: the /publications route builds its own list from the
  // csPublication docs, so the page doc only carries the header banner.
  const publicationsPage = pageById.get('14');
  if (publicationsPage) {
    docs.push(pageDoc(publicationsPage, undefined, []));
  }

  // Construction Industry: WP body is placeholder copy ("Content coming
  // soon!"), so drop it and run the articles list here instead.
  const constructionIndustry = pageById.get('12');
  if (constructionIndustry) {
    docs.push(
      pageDoc(constructionIndustry, undefined, [
        { _type: 'csPublicationsBlock', _key: 'construction-industry-publications', heading: 'Publications' },
        { _type: 'csTestimonialsBlock', _key: 'construction-industry-testimonials', items: testimonialRefs, autoRotate: true },
        {
          _type: 'csContactCtaBlock',
          _key: 'construction-industry-cta',
          eyebrow: 'Get Your Free Case Review',
          heading: 'Let Us Help You',
          showForm: true,
        },
      ]),
    );
  }

  // Plain rich-text pages. `withClosing` appends the shared testimonials
  // carousel + "Let Us Help You" lead form (as on Home / ADR Services).
  const richTextPages: Array<{ wpId: string; withClosing?: boolean }> = [
    { wpId: '16', withClosing: true }, // contact
    { wpId: '19' }, // disclaimer
    { wpId: '3' }, // privacy-policy
    { wpId: '21' }, // sitemap
  ];
  for (const { wpId, withClosing } of richTextPages) {
    const item = pageById.get(wpId);
    if (!item) {
      warnings.push(`page ${wpId} missing from WXR`);
      continue;
    }
    const body = htmlToPortableText(item.content, ptCtx, `page ${item.slug}`);
    const blocks: Array<Record<string, unknown>> = [];
    if (body.length > 0) blocks.push({ _type: 'csRichTextBlock', _key: `${item.slug}-body`, content: body });
    else warnings.push(`page ${item.slug}: empty content:encoded, no rich text block emitted`);
    if (withClosing) {
      blocks.push(
        { _type: 'csTestimonialsBlock', _key: `${item.slug}-testimonials`, items: testimonialRefs, autoRotate: true },
        {
          _type: 'csContactCtaBlock',
          _key: `${item.slug}-cta`,
          eyebrow: 'Get Your Free Case Review',
          heading: 'Let Us Help You',
          showForm: true,
        },
      );
    }
    docs.push(pageDoc(item, undefined, blocks));
  }

  // -------------------------------------------------------------------------
  // Phase 3: validation
  // -------------------------------------------------------------------------

  const REQUIRED_FIELDS: Record<string, string[]> = {
    csSite: ['siteKey', 'name'],
    csPage: ['site', 'title', 'slug'],
    csPracticeArea: ['site', 'title', 'slug'],
    csPublication: ['site', 'title', 'slug', 'publishedAt'],
    csAttorney: ['site', 'name', 'slug'],
    csTestimonial: ['site', 'quote'],
    csBadge: ['site', 'name', 'image'],
  };

  const errors: string[] = [];
  const slugsByType = new Map<string, Map<string, string>>();
  for (const doc of docs) {
    const type = doc._type as string;
    const id = doc._id as string;
    for (const f of REQUIRED_FIELDS[type] ?? []) {
      const v = doc[f];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && f !== 'pageBuilder' && v.length === 0)) {
        errors.push(`${id}: missing required field "${f}"`);
      }
    }
    if (type !== 'csSite' && (doc.site as Record<string, unknown> | undefined)?._ref !== SITE_ID) {
      errors.push(`${id}: site ref missing or wrong`);
    }
    const slug = (doc.slug as Record<string, string> | undefined)?.current;
    if (slug) {
      const seen = slugsByType.get(type) ?? new Map<string, string>();
      if (seen.has(slug)) errors.push(`${id}: duplicate slug "${slug}" (also ${seen.get(slug)})`);
      seen.set(slug, id);
      slugsByType.set(type, seen);
    }
    for (const f of ['publishedAt', 'modifiedAt']) {
      const v = doc[f];
      if (v !== undefined && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
        errors.push(`${id}: ${f} is not a valid ISO datetime (${String(v)})`);
      }
    }
  }

  // Summary table
  const byType = new Map<string, string[]>();
  for (const doc of docs) {
    const list = byType.get(doc._type as string) ?? [];
    list.push(doc._id as string);
    byType.set(doc._type as string, list);
  }
  console.log('\n=== Document summary ===');
  for (const [type, ids] of [...byType.entries()].sort()) {
    console.log(`\n${type} (${ids.length}):`);
    for (const id of ids) console.log(`  ${id}`);
  }

  const manifest = [...uploader.manifest.values()];
  const imgCount = manifest.filter((m) => m.kind === 'image').length;
  const fileCount = manifest.filter((m) => m.kind === 'file').length;
  console.log(`\n=== Asset manifest ===`);
  console.log(`${manifest.length} unique assets referenced (${imgCount} images, ${fileCount} files)`);
  if (dryRun) console.log('(dry-run: nothing downloaded or uploaded)');

  if (warnings.length > 0) {
    console.log(`\n=== Warnings (${warnings.length}) ===`);
    for (const w of warnings) console.log(`  WARN ${w}`);
  }
  if (uploader.failures.length > 0) {
    console.log(`\n=== Asset failures (${uploader.failures.length}) ===`);
    for (const f of uploader.failures) console.log(`  FAIL ${f.sourceUrl}: ${f.error}`);
  }
  if (errors.length > 0) {
    console.log(`\n=== Validation errors (${errors.length}) ===`);
    for (const e of errors) console.log(`  ERROR ${e}`);
    console.error('\nValidation failed; aborting before any write.');
    process.exit(1);
  }
  console.log('\nValidation passed: all required fields present, slugs unique, dates valid.');

  // -------------------------------------------------------------------------
  // Dry run: dump documents + manifest and stop
  // -------------------------------------------------------------------------

  if (dryRun) {
    mkdirSync(outDir, { recursive: true });
    for (const doc of docs) {
      writeFileSync(join(outDir, `${doc._id as string}.json`), JSON.stringify(doc, null, 2));
    }
    writeFileSync(join(outDir, '_asset-manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(
      join(outDir, '_summary.json'),
      JSON.stringify(
        {
          dataset,
          docCounts: Object.fromEntries([...byType.entries()].map(([t, ids]) => [t, ids.length])),
          assetCounts: { total: manifest.length, images: imgCount, files: fileCount },
          warnings,
        },
        null,
        2,
      ),
    );
    console.log(`\nDry run complete. ${docs.length} docs + asset manifest written to ${outDir}`);
    console.log('No network calls were made. Re-run without --dry-run to migrate.');
    return;
  }

  // -------------------------------------------------------------------------
  // Write mode: createOrReplace in dependency-ordered transaction chunks so
  // strong references always point at documents that already exist (or exist
  // within the same transaction).
  // -------------------------------------------------------------------------

  const writeClient = client!;
  const ORDER: Record<string, number> = {
    csSite: 0,
    csAttorney: 1,
    csTestimonial: 1,
    csBadge: 1,
    csPracticeArea: 1,
    csPage: 2,
    csPublication: 2,
  };
  const ordered = [...docs].sort((a, b) => (ORDER[a._type as string] ?? 9) - (ORDER[b._type as string] ?? 9));

  const CHUNK = 25;
  // Chunk boundaries must not split a dependency tier, so chunk per tier.
  const tiers = new Map<number, Array<Record<string, unknown>>>();
  for (const doc of ordered) {
    const tier = ORDER[doc._type as string] ?? 9;
    const list = tiers.get(tier) ?? [];
    list.push(doc);
    tiers.set(tier, list);
  }
  let written = 0;
  for (const tier of [...tiers.keys()].sort()) {
    const tierDocs = tiers.get(tier)!;
    for (let i = 0; i < tierDocs.length; i += CHUNK) {
      const chunk = tierDocs.slice(i, i + CHUNK);
      const tx = writeClient.transaction();
      for (const doc of chunk) tx.createOrReplace(doc as { _id: string; _type: string });
      await tx.commit();
      written += chunk.length;
      console.log(`Committed ${written}/${docs.length} documents...`);
    }
  }

  console.log(`\nMigration complete: ${docs.length} documents written to dataset "${dataset}".`);
  if (uploader.failures.length > 0) {
    console.log(`NOTE: ${uploader.failures.length} asset uploads failed (listed above); affected fields were omitted.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
