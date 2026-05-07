import { notFound } from 'next/navigation';
import { fetchCorporatePage, fetchCorporateSite } from '../../../lib/sanity';
import { CorporatePageBody } from '../../../components/corporate/CorporatePageBody';

/**
 * /privacy — appends the SMS disclosure block from corporateSite. The
 * disclosure text is required verbatim by Twilio A2P 10DLC reviewers, so it's
 * managed in Sanity rather than embedded in code.
 */
export default async function CorporatePrivacy() {
  const [site, page] = await Promise.all([fetchCorporateSite(), fetchCorporatePage('privacy')]);
  if (!site || !page) notFound();
  return (
    <>
      <CorporatePageBody site={site} page={page} />
      {site.smsDisclosure ? (
        <section className="corp-sms-disclosure">
          <h2>SMS &amp; Messaging</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{site.smsDisclosure}</p>
        </section>
      ) : null}
    </>
  );
}

export async function generateMetadata() {
  const page = await fetchCorporatePage('privacy');
  if (!page) return {};
  return {
    title: page.title,
    description: page.metaDescription ?? undefined,
    alternates: { canonical: '/privacy' },
  };
}
