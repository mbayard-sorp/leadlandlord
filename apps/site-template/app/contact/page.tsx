import { loadBundle, trackingNumber, telHref } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';
import { LeadForm } from '../../components/shared/LeadForm';

export default function Contact() {
  const bundle = loadBundle();
  const phone = trackingNumber();
  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
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
        />
      </div>
    </SiteShell>
  );
}

export function generateMetadata() {
  const bundle = loadBundle();
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
