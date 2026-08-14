import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePracticeAreaCards } from '@/lib/customsites-sanity';
import { csSitePaths } from '@/lib/customsites-registry';

export default async function AlignedAdvisorsNotFound() {
  const site = await resolveCurrentCustomSite();
  const areas = site ? await fetchCustomSitePracticeAreaCards(site.siteKey) : [];
  const { servicesPath } = csSitePaths(site?.siteKey);

  return (
    <div className="cs-container cs-404">
      <span className="cs-404-code">404 — Page not found</span>
      <h1>That page isn&rsquo;t on the books.</h1>
      <p className="cs-lead">The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.</p>
      <p>
        <a href="/" className="cs-btn cs-btn-primary">
          Back to Home
        </a>
      </p>

      {areas.length > 0 ? (
        <div style={{ marginTop: 'var(--cs-space-5)' }}>
          <h2>Our Services</h2>
          <ul className="cs-related-list" style={{ marginTop: 'var(--cs-space-3)' }}>
            {areas.map((area) => (
              <li key={area._id}>
                <a href={`/${servicesPath}/${area.slug}`} className="cs-link">
                  {area.title}
                  <span className="cs-link-arrow" aria-hidden="true">
                    →
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
