import { notFound } from 'next/navigation';
import { loadBundle } from '../../../lib/content';
import { SiteShell } from '../../../components/SiteShell';
import { PageBody } from '../../../components/PageBody';

interface Params {
  params: Promise<{ slug: string }>;
}

export default async function ServicePage({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.services.find((s) => slugFromUrl(s.slug) === slug);
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
  return bundle.services.map((s) => ({ slug: slugFromUrl(s.slug) }));
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const bundle = loadBundle();
  const page = bundle.services.find((s) => slugFromUrl(s.slug) === slug);
  if (!page) return {};
  return { title: page.title, description: page.meta_description };
}

function slugFromUrl(url: string): string {
  return url.replace(/^\/services\//, '').replace(/\/$/, '');
}
