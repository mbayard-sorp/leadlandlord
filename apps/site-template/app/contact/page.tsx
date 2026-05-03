import { loadBundle, trackingNumber } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';

export default function Contact() {
  const bundle = loadBundle();
  const phone = trackingNumber();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      navServices={bundle.services.map((s) => ({ slug: s.slug, title: s.title }))}
      navAreas={bundle.service_areas.map((a) => ({ slug: a.slug, title: a.title }))}
    >
      <PageBody page={bundle.contact} />
      <div className="mt-8 p-6 rounded-lg bg-slate-50 border border-slate-200">
        <h2 className="!mt-0">Call now: {phone}</h2>
        <p>
          Or send us a quick message. We typically respond within an hour during business
          hours.
        </p>
      </div>
    </SiteShell>
  );
}

export function generateMetadata() {
  const bundle = loadBundle();
  return {
    title: bundle.contact.title,
    description: bundle.contact.meta_description,
  };
}
