import { notFound } from 'next/navigation';
import { fetchCorporatePage, fetchCorporateSite } from '../../lib/sanity';
import { CorporatePageBody } from '../../components/corporate/CorporatePageBody';

/**
 * Shared helper for the static leaf routes under /leadslandlord/*. Each leaf
 * is a one-liner that calls renderCorporateKind('services') etc.
 */
export async function renderCorporateKind(kind: string) {
  const [site, page] = await Promise.all([fetchCorporateSite(), fetchCorporatePage(kind)]);
  if (!site || !page) notFound();
  return <CorporatePageBody site={site} page={page} />;
}

export async function corporateKindMetadata(kind: string, canonical: string) {
  const page = await fetchCorporatePage(kind);
  if (!page) return {};
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical },
  };
}
