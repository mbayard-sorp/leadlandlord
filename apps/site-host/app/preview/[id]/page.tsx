import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchBuildSellSiteById } from '@/lib/sanity';
import { BuildSellHome } from '@/components/buildsell/BuildSellHome';
import { ALL_BS_FONTS } from '@/lib/buildsell-fonts';

export const dynamic = 'force-dynamic';

// Defense layer 1: generateMetadata ALWAYS returns noindex, unconditionally,
// even when the fetch fails or the id is missing.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // We intentionally do not surface the Sanity doc title here — noindex is
  // the only thing that matters for this route, regardless of fetch outcome.
  void params; // awaited in page body; generateMetadata keeps it simple
  return {
    robots: { index: false, follow: false },
  };
}

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t: saveToken } = await searchParams;

  // Defense layer 2: inline meta tag rendered in JSX as a third barrier
  // against indexing, applied regardless of whether the doc is found.
  const noindexMeta = (
    <meta name="robots" content="noindex,nofollow" />
  );

  let site;
  try {
    site = await fetchBuildSellSiteById(id);
  } catch {
    // Fetch error — still render noindex, fail closed
    return (
      <html lang="en">
        <head>{noindexMeta}</head>
        <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', color: '#1a1a1a' }}>
          <p>Draft preview temporarily unavailable.</p>
        </body>
      </html>
    );
  }

  if (!site) {
    notFound();
  }

  const fontVars = ALL_BS_FONTS.map((f) => f.variable).join(' ');

  return (
    <div className={fontVars}>
      {/* Defense layer 2: explicit meta in rendered JSX output */}
      {noindexMeta}
      <BuildSellHome site={site} draft={true} saveToken={saveToken} />
    </div>
  );
}
