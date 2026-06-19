import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildSellToMarkdown } from '@/lib/buildsell-markdown';

export const dynamic = 'force-dynamic';

const MD_HEADERS = {
  'Content-Type': 'text/markdown; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'X-Robots-Tag': 'noindex',
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const site = await fetchBuildSellSiteBySlug(slug);

  // fetchBuildSellSiteBySlug already filters draftMode==false.
  // Additionally gate on robotsDisallow to match aggregate sitemap logic.
  if (!site || site.robotsDisallow) {
    return new Response('', { status: 404 });
  }

  const base = await currentRequestBaseUrl();
  const canonicalUrl = `${base}/buildsell/${slug}`;

  const markdown = buildSellToMarkdown(site, canonicalUrl);
  return new Response(markdown, { headers: MD_HEADERS });
}
