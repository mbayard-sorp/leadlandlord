import { loadBundle } from '../lib/content';
import { SiteShell } from '../components/SiteShell';
import { PageBody } from '../components/PageBody';

export default function Home() {
  const bundle = loadBundle();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      navServices={bundle.services.map((s) => ({ slug: s.slug, title: s.title }))}
      navAreas={bundle.service_areas.map((a) => ({ slug: a.slug, title: a.title }))}
    >
      <PageBody page={bundle.home} />
    </SiteShell>
  );
}

export function generateMetadata() {
  const bundle = loadBundle();
  return {
    title: bundle.home.title,
    description: bundle.home.meta_description,
  };
}
