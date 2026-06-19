import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchBuildSellSiteBySlug } from '@/lib/sanity';
import { currentRequestBaseUrl } from '@/lib/seo-meta';
import { BuildSellHome } from '@/components/buildsell/BuildSellHome';
import { BuildSellLocalBusinessJsonLd } from '@/components/buildsell/BuildSellLocalBusinessJsonLd';
import { ALL_BS_FONTS } from '@/lib/buildsell-fonts';

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
  const canonicalPath = `/buildsell/${slug}`;
  const title = site.seo?.metaTitle ?? site.businessName;
  const description = site.seo?.metaDescription ?? undefined;

  return {
    metadataBase: new URL(base),
    title,
    description,
    robots: site.robotsDisallow
      ? { index: false, follow: false }
      : { index: true, follow: true },
    alternates: {
      canonical: canonicalPath,
      types: {
        'text/markdown': `/buildsell/${slug}/index.md`,
      },
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonicalPath,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
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

  const base = await currentRequestBaseUrl();
  const pageUrl = `${base}/buildsell/${slug}`;

  const fontVars = ALL_BS_FONTS.map((f) => f.variable).join(' ');

  return (
    <div className={fontVars}>
      <BuildSellLocalBusinessJsonLd site={site} url={pageUrl} />
      <BuildSellHome site={site} draft={false} />
    </div>
  );
}
