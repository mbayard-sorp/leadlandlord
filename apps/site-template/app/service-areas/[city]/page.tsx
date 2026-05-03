import { notFound } from 'next/navigation';
import { loadBundle } from '../../../lib/content';
import { SiteShell } from '../../../components/SiteShell';
import { PageBody } from '../../../components/PageBody';

interface Params {
  params: Promise<{ city: string }>;
}

export default async function ServiceAreaPage({ params }: Params) {
  const { city } = await params;
  const bundle = loadBundle();
  const page = bundle.service_areas.find((a) => slugFromUrl(a.slug) === city);
  if (!page) notFound();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      navServices={bundle.services.map((s) => ({ slug: s.slug, title: s.title }))}
      navAreas={bundle.service_areas.map((a) => ({ slug: a.slug, title: a.title }))}
    >
      <PageBody page={page} />
    </SiteShell>
  );
}

export async function generateStaticParams() {
  const bundle = loadBundle();
  return bundle.service_areas.map((a) => ({ city: slugFromUrl(a.slug) }));
}

export async function generateMetadata({ params }: Params) {
  const { city } = await params;
  const bundle = loadBundle();
  const page = bundle.service_areas.find((a) => slugFromUrl(a.slug) === city);
  if (!page) return {};
  return { title: page.title, description: page.meta_description };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/service-areas\//, '').replace(/\/$/, '');
}
