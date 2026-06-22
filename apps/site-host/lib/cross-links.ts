import { cache } from 'react';
import { getDb, crossSiteLinks, eq, and, isCrossLinkPaused } from '@leadlandlord/db';

/**
 * Render-time cross-link injection.
 *
 * network-linker records cross-site links as `cross_site_links` rows but never
 * touches the Sanity source MDX. site-host injects those links into the page
 * body at render time: it matches the stored source sentence (`matchContext`)
 * in the live MDX and swaps in the rewritten sentence (`injectedMarkdown`, which
 * contains the inline link). The Sanity source is never mutated, so the network
 * kill switch (or flipping a row to status!='active') makes a link vanish on the
 * next render — fully reversible, zero writes.
 *
 * Injection is identical for every request (no user-agent branching) so we never
 * serve different HTML to crawlers vs. users — i.e. this is not cloaking.
 */

export interface InjectableCrossLink {
  matchContext: string;
  injectedMarkdown: string;
  anchorText: string;
  targetUrl: string;
}

/**
 * Active, injectable cross-links for a single source page. Returns [] when the
 * network cross-link kill switch is engaged. Wrapped in React.cache so the
 * layout/page/metadata passes within one request share a single query.
 */
export const getActiveCrossLinksForPage = cache(
  async (sourcePageId: string): Promise<InjectableCrossLink[]> => {
    if (!sourcePageId) return [];
    if (await isCrossLinkPaused()) return [];

    const db = getDb();
    const rows = await db
      .select({
        matchContext: crossSiteLinks.matchContext,
        injectedMarkdown: crossSiteLinks.injectedMarkdown,
        anchorText: crossSiteLinks.anchorText,
        targetUrl: crossSiteLinks.targetUrl,
      })
      .from(crossSiteLinks)
      .where(
        and(
          eq(crossSiteLinks.sourcePageId, sourcePageId),
          eq(crossSiteLinks.status, 'active'),
        ),
      );

    return rows.flatMap((r) =>
      r.matchContext && r.injectedMarkdown
        ? [
            {
              matchContext: r.matchContext,
              injectedMarkdown: r.injectedMarkdown,
              anchorText: r.anchorText,
              targetUrl: r.targetUrl,
            },
          ]
        : [],
    );
  },
);

/**
 * Inject cross-links into raw markdown. For each link, find the FIRST occurrence
 * of its `matchContext` (the verbatim source sentence) and replace it with
 * `injectedMarkdown` (the same sentence carrying the inline link). If the
 * context is no longer present (content drifted) the link is skipped — never
 * appended in an unnatural spot. Pure + deterministic; operates on markdown
 * before HTML conversion so every renderer benefits.
 */
export function injectCrossLinks(
  markdown: string,
  links: InjectableCrossLink[],
): string {
  if (!markdown || links.length === 0) return markdown;

  let out = markdown;
  for (const link of links) {
    const ctx = link.matchContext;
    if (!ctx) continue;
    // Idempotency: if the rewritten sentence (or the link URL) is already
    // present, the link was injected earlier in this pass — skip.
    if (out.includes(link.injectedMarkdown) || out.includes(`(${link.targetUrl})`)) {
      continue;
    }
    const idx = out.indexOf(ctx);
    if (idx === -1) continue; // context drifted — skip rather than misplace.
    out = out.slice(0, idx) + link.injectedMarkdown + out.slice(idx + ctx.length);
  }
  return out;
}

/**
 * Convenience: fetch + inject in one call for a given source page.
 */
export async function withInjectedCrossLinks(
  sourcePageId: string,
  markdown: string,
): Promise<string> {
  const links = await getActiveCrossLinksForPage(sourcePageId);
  return injectCrossLinks(markdown, links);
}
