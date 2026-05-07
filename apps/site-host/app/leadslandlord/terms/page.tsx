import { notFound } from 'next/navigation';
import { fetchCorporatePage, fetchCorporateSite } from '../../../lib/sanity';
import { CorporatePageBody } from '../../../components/corporate/CorporatePageBody';

/**
 * /terms — appends the SMS disclosure (STOP / HELP / msg & data rates) from
 * corporateSite. Required verbatim for Twilio A2P 10DLC review.
 */
export default async function CorporateTerms() {
  const [site, page] = await Promise.all([fetchCorporateSite(), fetchCorporatePage('terms')]);
  if (!site || !page) notFound();
  return (
    <>
      <CorporatePageBody site={site} page={page} />
      {site.smsDisclosure ? (
        <section className="corp-sms-disclosure">
          <h2>SMS Terms</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{site.smsDisclosure}</p>
        </section>
      ) : null}
    </>
  );
}

export async function generateMetadata() {
  const page = await fetchCorporatePage('terms');
  if (!page) return {};
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: '/terms' },
  };
}
