import type { Bundle, Page } from './content';
import { pageHref } from './content';

/**
 * Convert MDX body to plain markdown:
 * - strip import/export lines
 * - strip JSX component tags (keep inner text of simple inline components)
 * - keep headings, lists, links, inline formatting
 */
function cleanMdx(mdx: string): string {
  return mdx
    // strip frontmatter
    .replace(/^---[\s\S]*?---\n?/, '')
    // strip import/export statements
    .replace(/^(import|export)\s+.*$/gm, '')
    // strip self-closing JSX components: <ComponentName ... />
    .replace(/<[A-Z][a-zA-Z]*[^>]*\/>/g, '')
    // strip opening/closing JSX component tags, keep content between them
    .replace(/<([A-Z][a-zA-Z]*)[^>]*>([\s\S]*?)<\/\1>/g, '$2')
    // strip remaining self-closing HTML-like tags from component remnants
    .replace(/<[A-Z][a-zA-Z]*[^>]*>/g, '')
    .replace(/<\/[A-Z][a-zA-Z]*>/g, '')
    // collapse 3+ blank lines to 2
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Serialize a Page to a plain-markdown string for LLM/AI crawlers.
 */
export function pageToMarkdown(page: Page, bundle: Bundle, canonicalUrl: string): string {
  const parts: string[] = [];

  parts.push(`# ${page.title}`);

  if (page.meta_description) {
    parts.push(`> ${page.meta_description}`);
  }

  const where = [bundle.city, bundle.state].filter(Boolean).join(', ');
  const identity = [bundle.business_name, bundle.niche, where]
    .filter(Boolean)
    .join(' | ');
  if (identity) {
    parts.push(identity);
  }

  const body = cleanMdx(page.mdx);
  if (body) {
    parts.push(body);
  }

  if (page.faqs && page.faqs.length > 0) {
    parts.push('## Frequently asked questions');
    for (const { q, a } of page.faqs) {
      parts.push(`### ${q}\n\n${a}`);
    }
  }

  const footerLines: string[] = [`Canonical URL: ${canonicalUrl}`];
  if (bundle.license_number) {
    footerLines.push(`License: ${bundle.license_number}`);
  }
  if (bundle.certifications.length > 0) {
    const certs = bundle.certifications.map((c) => c.name).join(', ');
    footerLines.push(`Certifications: ${certs}`);
  }
  if (page.date_modified) {
    footerLines.push(`Last modified: ${page.date_modified}`);
  }

  parts.push(`---\n${footerLines.join('\n')}`);

  return parts.join('\n\n');
}

export interface SiteMarkdownPath {
  htmlPath: string;
  mdPath: string;
  title: string;
  description: string;
}

/**
 * Returns all {htmlPath, mdPath, title, description} pairs for a bundle.
 * Used by llms.txt and llms-full.txt to enumerate all pages.
 */
export function siteMarkdownPaths(bundle: Bundle): SiteMarkdownPath[] {
  const paths: SiteMarkdownPath[] = [];

  const addPage = (page: Page) => {
    const htmlPath = pageHref(page);
    const mdPath = htmlPath === '/' ? '/index.md' : `${htmlPath}.md`;
    paths.push({
      htmlPath,
      mdPath,
      title: page.title,
      description: page.meta_description,
    });
  };

  addPage(bundle.home);
  for (const p of bundle.services) addPage(p);
  for (const p of bundle.service_areas) addPage(p);
  for (const p of bundle.blog_posts) addPage(p);
  for (const p of bundle.info_pages) addPage(p);
  for (const p of bundle.faq_pages) addPage(p);
  addPage(bundle.about);
  addPage(bundle.contact);

  return paths;
}
