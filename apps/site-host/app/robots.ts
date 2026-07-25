import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';
import { resolveCurrentBuildSellSite } from '../lib/buildsell-context';
import { resolveCurrentCustomSite } from '../lib/custom-site-context';
import { fetchCorporateSite } from '../lib/sanity';

/**
 * Per-host /robots.txt. Block all crawlers when the site doc has
 * robotsDisallow=true (default during warming).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  // Corporate marketing site (leadslandlord.com). Unlike warming tenant sites,
  // it should be crawlable by default — only block when explicitly disallowed.
  // Custom Sites (ADR 0033 D6) default to blocked (robotsDisallow: true in the
  // schema) until an operator explicitly flips it at DNS cutover.
  // No R&R site on this host may still be a B&S custom domain (see
  // resolveCurrentBuildSellSite) — falls back to its robotsDisallow flag,
  // defaulting to blocked (true) when neither resolves.
  const blockAll =
    h.get('x-site-mode') === 'corporate'
      ? ((await fetchCorporateSite())?.robotsDisallow ?? false)
      : h.get('x-site-mode') === 'custom'
        ? ((await resolveCurrentCustomSite())?.robotsDisallow ?? true)
        : ((await resolveCurrentSite())?.robotsDisallow ??
            (await resolveCurrentBuildSellSite())?.robotsDisallow ??
            true);
  const aiCrawlers = ['GPTBot', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended'];

  return {
    rules: blockAll
      ? [{ userAgent: '*', disallow: '/' }]
      : [
          { userAgent: '*', allow: '/', disallow: ['/api/', '/_next/static/chunks/'] },
          ...aiCrawlers.map((userAgent) => ({ userAgent, allow: '/' })),
        ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
