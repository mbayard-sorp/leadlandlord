import { notFound } from 'next/navigation';
import { fetchCorporatePage, fetchCorporateSite } from '../../lib/sanity';
import { CorporatePageBody } from '../../components/corporate/CorporatePageBody';

export default async function CorporateHome() {
  const [site, page] = await Promise.all([fetchCorporateSite(), fetchCorporatePage('home')]);
  if (!site || !page) notFound();
  return <CorporatePageBody site={site} page={page} />;
}

export async function generateMetadata() {
  const page = await fetchCorporatePage('home');
  if (!page) return {};
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: '/' },
  };
}
