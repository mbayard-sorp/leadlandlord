import {
  fetchCustomSitePages,
  fetchCustomSitePracticeAreaCards,
  fetchCustomSitePracticeAreaFull,
  fetchCustomSitePublications,
  fetchCustomSitePublicationFull,
  fetchCustomSitePageBySlug,
  type CustomSite,
  type CustomSitePageFull,
  type CustomSitePracticeAreaFull,
  type CustomSitePublicationFull,
  type CsPageBuilderBlock,
  type CsPortableTextBlock,
} from './customsites-sanity';

/**
 * Portable Text -> markdown serializer for Custom Sites (ADR 0033 D3), backing
 * /md/[[...path]] and /llms-full.txt in custom mode. This is the real
 * serializer referenced by the phase-3 TODO that used to live here — Custom
 * Sites bodies are Portable Text (`csBody`), not markdown, so the `/md`
 * mirrors need an explicit walk of the block tree rather than passing text
 * straight through (contrast with R&R's markdown-native `page-markdown.ts`).
 */

// --- Portable Text block walking --------------------------------------------

interface PTSpan {
  _type: 'span';
  text: string;
  marks?: string[];
}

interface PTMarkDef {
  _key: string;
  _type: string;
  href?: string;
}

interface PTTextBlock extends CsPortableTextBlock {
  _type: 'block';
  style?: string;
  listItem?: 'bullet' | 'number';
  level?: number;
  children?: PTSpan[];
  markDefs?: PTMarkDef[];
}

function isTextBlock(block: CsPortableTextBlock): block is PTTextBlock {
  return block._type === 'block';
}

/** Applies a span's marks (bold/italic/link) to its plain text, innermost-out
 * in the order the marks array lists them. */
function spanToMarkdown(span: PTSpan, markDefs: PTMarkDef[] | undefined): string {
  let text = span.text;
  for (const mark of span.marks ?? []) {
    if (mark === 'strong') {
      text = `**${text}**`;
    } else if (mark === 'em') {
      text = `*${text}*`;
    } else {
      const def = markDefs?.find((d) => d._key === mark);
      if (def?._type === 'link' && def.href) {
        text = `[${text}](${def.href})`;
      }
    }
  }
  return text;
}

function blockText(block: PTTextBlock): string {
  return (block.children ?? []).map((span) => spanToMarkdown(span, block.markDefs)).join('');
}

/** Non-list text block (paragraph / heading / blockquote) -> a markdown line. */
function blockToLine(block: PTTextBlock): string {
  const text = blockText(block);
  switch (block.style) {
    case 'h2':
      return `## ${text}`;
    case 'h3':
      return `### ${text}`;
    case 'h4':
      return `#### ${text}`;
    case 'blockquote':
      return `> ${text}`;
    default:
      return text;
  }
}

/** A contiguous run of list-item blocks (mixed bullet/number, possibly
 * nested via `level`) -> a single markdown list, one item per line. Ordered
 * numbering restarts whenever a shallower sibling appears, per level. */
function listGroupToMarkdown(items: PTTextBlock[]): string {
  const counters: Record<number, number> = {};
  const lines = items.map((item) => {
    const level = item.level ?? 1;
    for (const lvl of Object.keys(counters).map(Number)) {
      if (lvl > level) delete counters[lvl];
    }
    const indent = '  '.repeat(Math.max(level - 1, 0));
    const text = blockText(item);
    if (item.listItem === 'number') {
      counters[level] = (counters[level] ?? 0) + 1;
      return `${indent}${counters[level]}. ${text}`;
    }
    return `${indent}- ${text}`;
  });
  return lines.join('\n');
}

function imageToMarkdown(block: CsPortableTextBlock): string {
  const alt = block.alt ?? '';
  const lines = [`![${alt}](${block.url ?? ''})`];
  if (block.caption) lines.push(`*${block.caption}*`);
  return lines.join('\n');
}

/**
 * Walks a Portable Text array (csBody) and emits clean markdown. Handles
 * headings (h2-h4), nested bullet/number lists, bold/italic marks, internal
 * and external links, blockquotes, and image members (-> `![alt](url)` +
 * optional caption). Unknown member types are skipped, not fabricated.
 */
export function portableTextToMarkdown(blocks: CsPortableTextBlock[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return '';

  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;

    if (block._type === 'image') {
      out.push(imageToMarkdown(block));
      i++;
      continue;
    }

    if (isTextBlock(block) && block.listItem) {
      const group: PTTextBlock[] = [];
      while (i < blocks.length && isTextBlock(blocks[i]!) && (blocks[i] as PTTextBlock).listItem) {
        group.push(blocks[i] as PTTextBlock);
        i++;
      }
      out.push(listGroupToMarkdown(group));
      continue;
    }

    if (isTextBlock(block)) {
      out.push(blockToLine(block));
      i++;
      continue;
    }

    // Unrecognized Portable Text member — skip rather than guess its shape.
    i++;
  }

  return out.join('\n\n');
}

// --- Doc-level serializers ---------------------------------------------------

function frontMatter(title: string, metaLines: Array<string | null | undefined>): string {
  const lines = [`# ${title}`];
  const meta = metaLines.filter((m): m is string => Boolean(m));
  if (meta.length) lines.push(meta.map((m) => `*${m}*`).join('  \n'));
  return lines.join('\n\n');
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function blockTitleLines(heading?: string | null, eyebrow?: string | null): string[] {
  const lines: string[] = [];
  if (eyebrow) lines.push(`*${eyebrow}*`);
  if (heading) lines.push(`## ${heading}`);
  return lines;
}

/** One csPage.pageBuilder member -> markdown. Every block type renders
 * something reasonable; blocks with no textual content (badges, publications
 * teasers that are rendered as a live list elsewhere) render an empty string
 * and are filtered out by the caller. */
function pageBuilderBlockToMarkdown(block: CsPageBuilderBlock): string {
  switch (block._type) {
    case 'csHeroBlock': {
      const lines = [`# ${block.heading}`];
      if (block.subheading) lines.push(block.subheading);
      return lines.join('\n\n');
    }
    case 'csIntroBlock': {
      const lines = blockTitleLines(block.heading, block.eyebrow);
      const body = portableTextToMarkdown(block.body);
      if (body) lines.push(body);
      return lines.join('\n\n');
    }
    case 'csPracticeGridBlock': {
      const lines = blockTitleLines(block.heading, block.eyebrow);
      const items = (block.areas ?? []).map((a) => `- [${a.title}](/practice-areas/${a.slug})`);
      if (items.length) lines.push(items.join('\n'));
      return lines.join('\n\n');
    }
    case 'csAttorneyBlock': {
      if (!block.attorney) return '';
      const a = block.attorney;
      const lines = [`## ${a.name}`];
      if (a.jobTitle) lines.push(a.jobTitle);
      const bio = portableTextToMarkdown(a.bio);
      if (bio) lines.push(bio);
      return lines.join('\n\n');
    }
    case 'csTestimonialsBlock': {
      const items = block.items ?? [];
      if (!items.length) return '';
      return items
        .map((t) => {
          const attribution = t.author ? `\n> — ${t.author}${t.role ? `, ${t.role}` : ''}` : '';
          return `> ${t.quote}${attribution}`;
        })
        .join('\n\n');
    }
    case 'csBadgeRowBlock':
      return '';
    case 'csPublicationsBlock':
      return blockTitleLines(block.heading, block.eyebrow).join('\n\n');
    case 'csCalloutBlock': {
      const lines: string[] = [];
      if (block.label) lines.push(`**${block.label}**`);
      if (block.quote) lines.push(`> ${block.quote}`);
      return lines.join('\n\n');
    }
    case 'csRichTextBlock':
      return portableTextToMarkdown(block.content);
    case 'csContactCtaBlock': {
      const lines = blockTitleLines(block.heading, block.eyebrow);
      if (block.body) lines.push(block.body);
      return lines.join('\n\n');
    }
    case 'csCtaBannerBlock':
      return block.heading ? `## ${block.heading}` : '';
    default:
      return '';
  }
}

export function pageBuilderToMarkdown(blocks: CsPageBuilderBlock[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks
    .map(pageBuilderBlockToMarkdown)
    .filter((s) => s.length > 0)
    .join('\n\n');
}

function pageToMarkdown(page: CustomSitePageFull): string {
  const parts = [frontMatter(page.title, [page.modifiedAt ? `Last modified: ${page.modifiedAt}` : null])];
  const body = pageBuilderToMarkdown(page.pageBuilder);
  if (body) parts.push(body);
  return parts.join('\n\n');
}

function practiceAreaToMarkdown(area: CustomSitePracticeAreaFull): string {
  const meta = area.modifiedAt
    ? `Last modified: ${area.modifiedAt}`
    : area.publishedAt
      ? `Published: ${area.publishedAt}`
      : null;
  const parts = [frontMatter(area.title, [meta])];
  if (area.excerpt) parts.push(area.excerpt);
  const body = portableTextToMarkdown(area.body);
  if (body) parts.push(body);
  if (area.faqs && area.faqs.length > 0) {
    const faqLines = area.faqs.flatMap((f) => [`**${f.question}**`, f.answer]);
    parts.push(['## Frequently Asked Questions', ...faqLines].join('\n\n'));
  }
  return parts.join('\n\n');
}

function publicationToMarkdown(pub: CustomSitePublicationFull): string {
  const metaLines: Array<string | null> = [`Kind: ${titleCase(pub.kind)}`];
  if (pub.externalEvent) {
    metaLines.push(pub.externalDate ? `${pub.externalEvent} — ${pub.externalDate}` : pub.externalEvent);
  }
  if (pub.coAuthors) metaLines.push(`Co-authors: ${pub.coAuthors}`);
  if (pub.publishedAt) metaLines.push(`Published: ${pub.publishedAt}`);

  const parts = [frontMatter(pub.title, metaLines)];
  if (pub.excerpt) parts.push(pub.excerpt);
  const body = portableTextToMarkdown(pub.body);
  if (body) parts.push(body);
  if (pub.pdfUrl) parts.push(`[Download PDF](${pub.pdfUrl})`);
  return parts.join('\n\n');
}

function titleBlock(title: string, tagline?: string | null): string {
  const lines = [`# ${title}`];
  if (tagline) lines.push(tagline);
  return lines.join('\n\n');
}

/**
 * Resolve the markdown for a single path on a Custom Site.
 *   "/"                          -> home csPage (pageBuilder), else site name + tagline
 *   "/<slug>"                    -> matching csPage (pageBuilder)
 *   "/practice-areas/<slug>"     -> matching csPracticeArea (body + FAQs)
 *   "/publications/<slug>"       -> matching csPublication (body + metadata)
 * Returns null when nothing matches (route handler 404s).
 */
export async function customSiteMarkdownForPath(site: CustomSite, path: string): Promise<string | null> {
  const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);

  if (segments.length === 0) {
    const home = await fetchCustomSitePageBySlug(site.siteKey, 'home');
    return home ? pageToMarkdown(home) : titleBlock(site.name, site.tagline);
  }

  if (segments.length === 1) {
    const page = await fetchCustomSitePageBySlug(site.siteKey, segments[0]!);
    if (page) return pageToMarkdown(page);
    const pub = await fetchCustomSitePublicationFull(site.siteKey, segments[0]!);
    return pub ? publicationToMarkdown(pub) : null;
  }

  if (segments.length === 2 && segments[0] === 'practice-areas') {
    const area = await fetchCustomSitePracticeAreaFull(site.siteKey, segments[1]!);
    return area ? practiceAreaToMarkdown(area) : null;
  }

  if (segments.length === 2 && segments[0] === 'publications') {
    const pub = await fetchCustomSitePublicationFull(site.siteKey, segments[1]!);
    return pub ? publicationToMarkdown(pub) : null;
  }

  return null;
}

/** All pages/practice-areas/publications concatenated, same shape as
 * pageToMarkdown's llms-full.txt callers. Fetches full content per doc (not
 * just the stub list) now that the real serializer exists. */
export async function customSiteFullMarkdown(site: CustomSite): Promise<string> {
  const [pageStubs, practiceAreaCards, pubStubs] = await Promise.all([
    fetchCustomSitePages(site.siteKey),
    fetchCustomSitePracticeAreaCards(site.siteKey),
    fetchCustomSitePublications(site.siteKey),
  ]);

  const [pages, practiceAreas, publications] = await Promise.all([
    Promise.all(pageStubs.map((p) => fetchCustomSitePageBySlug(site.siteKey, p.slug))),
    Promise.all(practiceAreaCards.map((p) => fetchCustomSitePracticeAreaFull(site.siteKey, p.slug))),
    Promise.all(pubStubs.map((p) => fetchCustomSitePublicationFull(site.siteKey, p.slug))),
  ]);

  const sections = [
    titleBlock(site.name, site.tagline),
    ...pages.filter((p): p is CustomSitePageFull => p !== null).map(pageToMarkdown),
    ...practiceAreas.filter((p): p is CustomSitePracticeAreaFull => p !== null).map(practiceAreaToMarkdown),
    ...publications.filter((p): p is CustomSitePublicationFull => p !== null).map(publicationToMarkdown),
  ];

  return sections.join('\n\n---\n\n') + '\n';
}
