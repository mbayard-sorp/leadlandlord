import { notFound } from 'next/navigation';
import { fetchCorporatePage, fetchCorporateSite } from '../../../lib/sanity';
import { CorporatePageBody } from '../../../components/corporate/CorporatePageBody';

/**
 * /contact — for v1 we render the corporatePage body and surface the support
 * email as a large mailto: link. Lead form deferred to v2 (the corporate
 * communication agent will likely want a custom intake form anyway).
 */
export default async function CorporateContact() {
  const [site, page] = await Promise.all([fetchCorporateSite(), fetchCorporatePage('contact')]);
  if (!site || !page) notFound();
  const email = site.legalEntity?.supportEmail;
  return (
    <>
      <CorporatePageBody site={site} page={page} />
      {email ? (
        <section className="corp-contact-cta">
          <p>Get in touch:</p>
          <a href={`mailto:${email}`} className="corp-contact-email">
            {email}
          </a>
        </section>
      ) : null}
    </>
  );
}

export async function generateMetadata() {
  const page = await fetchCorporatePage('contact');
  if (!page) return {};
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: '/contact' },
  };
}
