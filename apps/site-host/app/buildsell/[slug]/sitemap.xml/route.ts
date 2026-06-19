import { notFound } from 'next/navigation';
import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';

export const dynamic = 'force-dynamic';

const XML_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
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
    notFound();
  }

  const base = await currentRequestBaseUrl();
  const pageUrl = `${base}/buildsell/${slug}`;
  const mdUrl = `${base}/buildsell/${slug}/index.md`;
  const lastmod = site.generatedAt
    ? new Date(site.generatedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${escapeXml(pageUrl)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${escapeXml(mdUrl)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
</urlset>`;

  return new Response(xml, { headers: XML_HEADERS });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
