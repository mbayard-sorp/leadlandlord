import { loadBundle } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';

export default function About() {
  const bundle = loadBundle();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
    >
      <PageBody page={bundle.about} />
    </SiteShell>
  );
}

export function generateMetadata() {
  const bundle = loadBundle();
  return {
    title: bundle.about.title,
    description: bundle.about.meta_description,
    alternates: { canonical: '/about/' },
    openGraph: {
      title: bundle.about.title,
      description: bundle.about.meta_description,
      type: 'website',
      url: '/about/',
    },
  };
}
