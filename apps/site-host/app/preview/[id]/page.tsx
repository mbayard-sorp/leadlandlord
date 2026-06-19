import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchBuildSellSitePreview } from '@/lib/sanity';
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

const VALID_LAYOUTS = ['split', 'bold', 'trust'] as const;

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; layout?: string; preset?: string; fh?: string; fb?: string }>;
}) {
  // `id` is the path segment — either a Postgres UUID (legacy links) or the
  // human-readable slug. fetchBuildSellSitePreview resolves either form.
  const { id } = await params;
  const { t: saveToken, layout, preset, fh, fb } = await searchParams;

  // Defense layer 2: inline meta tag rendered in JSX as a third barrier
  // against indexing, applied regardless of whether the doc is found.
  const noindexMeta = (
    <meta name="robots" content="noindex,nofollow" />
  );

  let site;
  try {
    site = await fetchBuildSellSitePreview(id);
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

  // Draft-only theme overrides from the preview theme bar. The per-variant block
  // STRUCTURE (hero/contact arrangement) is server-rendered from site.theme and
  // can't change via client-side CSS alone, so the bar's layout toggle pushes the
  // selection here as a query param to force a server re-render. preset/fonts ride
  // along so an in-progress color/font preview survives the layout round-trip
  // without flashing back to the saved values.
  const layoutOverride = VALID_LAYOUTS.includes(layout as (typeof VALID_LAYOUTS)[number])
    ? (layout as (typeof VALID_LAYOUTS)[number])
    : undefined;
  const effectiveSite =
    layoutOverride || preset || fh || fb
      ? {
          ...site,
          theme: {
            ...site.theme,
            ...(layoutOverride ? { layoutVariant: layoutOverride } : {}),
            ...(preset ? { preset } : {}),
            ...(fh ? { fontHeading: fh } : {}),
            ...(fb ? { fontBody: fb } : {}),
          },
        }
      : site;

  const fontVars = ALL_BS_FONTS.map((f) => f.variable).join(' ');

  return (
    <div className={fontVars}>
      {/* Defense layer 2: explicit meta in rendered JSX output */}
      {noindexMeta}
      <BuildSellHome site={effectiveSite} draft={true} saveToken={saveToken} />
    </div>
  );
}
