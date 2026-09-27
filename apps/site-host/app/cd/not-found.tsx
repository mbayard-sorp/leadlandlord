import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { csSitePaths } from '@/lib/customsites-registry';

/** 404 in the brand's register: short, no blame, no exclamation mark. */
export default async function CueDuoNotFound() {
  const site = await resolveCurrentCustomSite();
  const { servicesPath } = csSitePaths(site?.siteKey);

  return (
    <section className="cs-section cs-appcta cs-section--navy">
      <div className="cs-container">
        <h1 className="cs-appcta-heading">That page isn&rsquo;t here.</h1>
        <p className="cs-appcta-body">It may have moved, or the link may have a typo in it.</p>
        <div className="cs-appcta-actions">
          <a href="/" className="cs-btn cs-btn-primary">
            Back to the start
          </a>
          <a href={`/${servicesPath}`} className="cs-underline-link">
            See what it does
          </a>
        </div>
      </div>
    </section>
  );
}
