import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildSellToLlmsTxt } from '@/lib/buildsell-markdown';

export const dynamic = 'force-dynamic';

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
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
  const pageUrl = `${base}/buildsell/${slug}`;
  const mdUrl = `${base}/buildsell/${slug}/index.md`;

  return new Response(buildSellToLlmsTxt(site, pageUrl, mdUrl), { headers: TEXT_HEADERS });
}
