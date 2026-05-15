import type { ContentBundle } from '@leadlandlord/shared/types';

/**
 * Deterministic internal linker. Pure function — no I/O. Runs as a post-pass
 * after density-lint passes, before returning the bundle from execute().
 *
 * Injects Markdown links into page MDX bodies according to the caps defined
 * in build plan section 7.1 item 5:
 *   home:          8-12 links (to all service pages + contact)
 *   service:       4-8 links (to other services + contact + 1-2 FAQ posts)
 *   blog/FAQ:      2-4 links (to most-related service page)
 *   contact:       links back to all services
 *
 * Hard constraints:
 *   - Never link a page to itself.
 *   - Never inject inside H1/H2/H3 (skip lines starting with #).
 *   - Never inject within the first 100 words of any page.
 *   - Don't double-link the same anchor phrase to the same target on one page.
 *
 * If quota not met by natural phrase matching, appends a "Related services"
 * bullet list at the end (service/FAQ/contact pages only).
 */

interface LinkTarget {
  slug: string;
  title: string;
  kind: string;
}

/**
 * Returns a new ContentBundle with internal links injected. Does not mutate
 * the input bundle.
 */
export function injectInternalLinks(bundle: ContentBundle): ContentBundle {
  // Build link target list from the bundle
  const serviceTargets: LinkTarget[] = (bundle.services ?? []).map((p) => ({
    slug: p.slug,
    title: p.title,
    kind: 'service',
  }));
  const contactTarget: LinkTarget | null = bundle.contact
    ? { slug: bundle.contact.slug, title: bundle.contact.title, kind: 'contact' }
    : null;
  const blogTargets: LinkTarget[] = (bundle.blog_posts ?? []).map((p) => ({
    slug: p.slug,
    title: p.title,
    kind: 'blog',
  }));
  const businessName = bundle.business_name;

  return {
    ...bundle,
    home: bundle.home
      ? {
          ...bundle.home,
          mdx: linkHomePage(bundle.home.mdx, bundle.home.slug, serviceTargets, contactTarget, businessName),
        }
      : bundle.home,
    services: (bundle.services ?? []).map((page) => ({
      ...page,
      mdx: linkServicePage(
        page.mdx,
        page.slug,
        serviceTargets,
        contactTarget,
        blogTargets,
        businessName,
      ),
    })),
    blog_posts: (bundle.blog_posts ?? []).map((page) => ({
      ...page,
      mdx: linkBlogPage(page.mdx, page.slug, serviceTargets, businessName),
    })),
    contact: bundle.contact
      ? {
          ...bundle.contact,
          mdx: linkContactPage(bundle.contact.mdx, bundle.contact.slug, serviceTargets, businessName),
        }
      : bundle.contact,
  };
}

// ---------------------------------------------------------------------------
// Per-page linkers
// ---------------------------------------------------------------------------

function linkHomePage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  contact: LinkTarget | null,
  businessName: string,
): string {
  const targets = [...services, ...(contact ? [contact] : [])].filter(
    (t) => t.slug !== selfSlug,
  );
  return injectLinks(mdx, selfSlug, targets, { minLinks: 8, maxLinks: 12, businessName });
}

function linkServicePage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  contact: LinkTarget | null,
  blogs: LinkTarget[],
  businessName: string,
): string {
  const otherServices = services.filter((t) => t.slug !== selfSlug);
  const topBlogs = blogs.slice(0, 2);
  const targets = [
    ...otherServices,
    ...(contact ? [contact] : []),
    ...topBlogs,
  ];
  return injectLinks(mdx, selfSlug, targets, { minLinks: 4, maxLinks: 8, businessName });
}

function linkBlogPage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  businessName: string,
): string {
  const targets = services.filter((t) => t.slug !== selfSlug).slice(0, 1);
  return injectLinks(mdx, selfSlug, targets, { minLinks: 2, maxLinks: 4, businessName });
}

function linkContactPage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  businessName: string,
): string {
  const targets = services.filter((t) => t.slug !== selfSlug);
  return injectLinks(mdx, selfSlug, targets, { minLinks: targets.length, maxLinks: targets.length, businessName });
}

// ---------------------------------------------------------------------------
// Core injection engine
// ---------------------------------------------------------------------------

interface InjectOptions {
  minLinks: number;
  maxLinks: number;
  businessName: string;
}

function injectLinks(
  mdx: string,
  selfSlug: string,
  targets: LinkTarget[],
  opts: InjectOptions,
): string {
  if (targets.length === 0) return mdx;

  const paragraphs = mdx.split('\n\n');
  const wordsSoFar = { count: 0 };
  const usedAnchors = new Set<string>(); // anchor text → already linked
  const usedTargets = new Set<string>(); // slug → already has a link on this page
  let linksInjected = 0;

  const result = paragraphs.map((para) => {
    // Count words in this paragraph toward the 100-word skip zone
    const paraWords = extractWordCount(para);
    const wasBeforeZone = wordsSoFar.count < 100;
    wordsSoFar.count += paraWords;

    // Skip heading lines and paragraphs in the first-100-words zone
    if (isHeadingLine(para) || wasBeforeZone) return para;

    // Try to inject links for targets not yet linked
    let modified = para;
    for (const target of targets) {
      if (linksInjected >= opts.maxLinks) break;
      if (usedTargets.has(target.slug)) continue;

      const { anchor, linked } = tryInjectLink(modified, target, opts.businessName, usedAnchors);
      if (linked !== null) {
        modified = linked;
        usedAnchors.add(anchor);
        usedTargets.add(target.slug);
        linksInjected++;
      }
    }
    return modified;
  });

  let finalMdx = result.join('\n\n');

  // If quota not met, append a Related services bullet list
  if (linksInjected < opts.minLinks) {
    const remaining = targets
      .filter((t) => !usedTargets.has(t.slug))
      .slice(0, opts.maxLinks - linksInjected);
    if (remaining.length > 0) {
      const bullets = remaining
        .map((t) => `- [${anchorText(t, opts.businessName, 0)}](${t.slug})`)
        .join('\n');
      finalMdx = `${finalMdx}\n\n${bullets}`;
    }
  }

  return finalMdx;
}

/**
 * Attempt to replace a phrase in `para` with a markdown link to `target`.
 * Returns the modified paragraph and anchor text if successful, null if no
 * suitable phrase was found.
 */
function tryInjectLink(
  para: string,
  target: LinkTarget,
  businessName: string,
  usedAnchors: Set<string>,
): { anchor: string; linked: string | null } {
  // Try three anchor variants in priority order
  const variants = buildAnchorVariants(target, businessName);
  for (const anchor of variants) {
    if (usedAnchors.has(anchor)) continue;
    // Case-insensitive search; replace first occurrence only
    const idx = para.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx === -1) continue;
    // Don't inject inside an existing markdown link: check for [ before anchor
    if (para[idx - 1] === '[' || para.slice(0, idx).includes(`](${target.slug})`)) continue;

    const original = para.slice(idx, idx + anchor.length);
    const linked = `${para.slice(0, idx)}[${original}](${target.slug})${para.slice(idx + anchor.length)}`;
    return { anchor, linked };
  }
  return { anchor: '', linked: null };
}

/**
 * Three anchor variants per target:
 *   0: bare service name (e.g. "window cleaning")
 *   1: branded (e.g. "Mike's Window Cleaning's window cleaning")
 *   2: phrasal-implicit (e.g. "our window cleaning team")
 *
 * Rotate by index so repeated injection uses different patterns.
 */
function buildAnchorVariants(target: LinkTarget, businessName: string): string[] {
  const name = target.title.replace(/\s*[-–—|·].*$/, '').trim(); // strip " | City" etc.
  return [
    name,
    `${businessName}'s ${name.toLowerCase()}`,
    `our ${name.toLowerCase()}`,
  ];
}

function anchorText(target: LinkTarget, businessName: string, variant: 0 | 1 | 2): string {
  return buildAnchorVariants(target, businessName)[variant] ?? target.title;
}

function isHeadingLine(para: string): boolean {
  return /^#{1,3}\s/.test(para.trim());
}

function extractWordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}
