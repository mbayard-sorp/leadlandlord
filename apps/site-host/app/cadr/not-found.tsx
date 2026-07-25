import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSitePracticeAreaCards } from '@/lib/customsites-sanity';

export default async function CustomSiteNotFound() {
  const site = await resolveCurrentCustomSite();
  const areas = site ? await fetchCustomSitePracticeAreaCards(site.siteKey) : [];

  return (
    <div className="cs-section cs-notfound">
      <div className="cs-container">
        <span className="cs-eyebrow">404</span>
        <h1>Page Not Found</h1>
        <p className="cs-lead" style={{ margin: '16px auto', maxWidth: 480 }}>
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
        </p>
        <p>
          <a href="/" className="cs-btn cs-btn-primary">
            Back to Home
          </a>
        </p>

        {areas.length > 0 ? (
          <div style={{ marginTop: 48 }}>
            <h2>Practice Areas</h2>
            <ul className="cs-related-list" style={{ marginTop: 16, justifyItems: 'center' }}>
              {areas.map((area) => (
                <li key={area._id}>
                  <a href={`/practice-areas/${area.slug}`} className="cs-link">
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
    </div>
  );
}
