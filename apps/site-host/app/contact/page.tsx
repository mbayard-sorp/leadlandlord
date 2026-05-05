import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../lib/site-context';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { telHref } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';
import { LeadForm } from '../../components/shared/LeadForm';

export default async function Contact() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const phone = await getTrackingNumber(site.siteId);
  const bundle = sanityToBundle(site);
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      phone={phone}
    >
      <PageBody page={bundle.contact} />
      <div className="site-contact-cta">
        <h2>
          Call now: <a href={telHref(phone)}>{phone}</a>
        </h2>
        <p>Or send us a quick message — we typically respond within an hour during business hours.</p>
        <LeadForm
          variant={bundle.variant}
          heading="Get in touch"
          submit="Send →"
          source="contact"
          siteId={site.siteId}
          siteSlug={site.slug}
        />
      </div>
    </SiteShell>
  );
}

export async function generateMetadata() {
  const site = await resolveCurrentSite();
  if (!site) return { robots: { index: false, follow: false } };
  const bundle = sanityToBundle(site);
  return {
    title: bundle.contact.title,
    description: bundle.contact.meta_description,
    alternates: { canonical: '/contact/' },
    openGraph: {
      title: bundle.contact.title,
      description: bundle.contact.meta_description,
      type: 'website',
      url: '/contact/',
    },
  };
}
