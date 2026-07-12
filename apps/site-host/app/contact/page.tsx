import { notFound } from 'next/navigation';
import { resolveCurrentSite } from '../../lib/site-context';
import { buildPageMetadata, breadcrumbsJsonLd } from '../../lib/seo-meta';
import { sanityToBundle } from '../../lib/theme-bundle';
import { getTrackingNumber } from '../../lib/tracking';
import { substituteBundlePhone } from '../../lib/phone';
import { telHref, pageH1 } from '../../lib/content';
import { SiteShell } from '../../components/SiteShell';
import { PageBody } from '../../components/PageBody';
import { LeadForm } from '../../components/shared/LeadForm';
import { Breadcrumbs } from '../../components/shared/Breadcrumbs';

export default async function Contact() {
  const site = await resolveCurrentSite();
  if (!site) notFound();
  const phone = await getTrackingNumber(site.siteId);
  const bundle = substituteBundlePhone(sanityToBundle(site), phone);

  const breadcrumb = await breadcrumbsJsonLd([
    { name: bundle.business_name, path: '/' },
    { name: 'Contact', path: '/contact' },
  ]);

  return (
    <SiteShell
      businessName={bundle.business_name}
      niche={bundle.niche}
      city={bundle.city}
      state={bundle.state}
      phone={phone}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <Breadcrumbs items={[
        { name: bundle.business_name, url: '/' },
        { name: 'Contact', url: '/contact' },
      ]} />
      <h1 className="info-page-h1">{pageH1(bundle.contact)}</h1>
      <PageBody phone={phone} page={{ ...bundle.contact, mdx: bundle.contact.mdx.replace(/^\s*#\s+[^\n]+\n+/, '') }} />
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
  return buildPageMetadata({
    title: bundle.contact.title,
    description: bundle.contact.meta_description,
    path: '/contact',
    image: bundle.hero_image_url,
    siteName: bundle.business_name,
    mdPath: '/contact.md',
  });
}
