import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { BuildSellHome } from '@/components/buildsell/BuildSellHome';

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

  return {
    title: site.seo?.metaTitle ?? site.businessName,
    description: site.seo?.metaDescription ?? undefined,
    robots: { index: true, follow: true },
  };
}

export default async function BuildSellPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await fetchBuildSellSiteBySlug(slug);

  if (!site) notFound();

  return <BuildSellHome site={site} draft={false} />;
}
