import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { buildBuildSellMetadata } from '@/lib/buildsell-meta';
import { BuildSellSiteView } from '@/components/buildsell/BuildSellSiteView';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await fetchBuildSellSiteBySlug(slug);

  if (!site) {
    return { robots: { index: false, follow: false } };
  }

  const base = await currentRequestBaseUrl();
  return buildBuildSellMetadata({
    site,
    base,
    canonicalPath: `/buildsell/${slug}`,
    mdPath: `/buildsell/${slug}/index.md`,
  });
}

export default async function BuildSellPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await fetchBuildSellSiteBySlug(slug);

  if (!site) notFound();

  const base = await currentRequestBaseUrl();
  const pageUrl = `${base}/buildsell/${slug}`;

  return <BuildSellSiteView site={site} pageUrl={pageUrl} base={base} />;
}
