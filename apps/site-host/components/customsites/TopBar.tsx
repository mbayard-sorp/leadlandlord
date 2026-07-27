import type { CustomSite } from '@/lib/customsites-sanity';

interface Props {
  site: CustomSite;
}

/** Slim navy utility bar above the header: phone / email / tagline. */
export function TopBar({ site }: Props) {
  if (!site.phone && !site.email && !site.tagline) return null;
  return (
    <div className="cs-topbar">
      <div className="cs-container cs-topbar-inner">
        <div className="cs-topbar-contact">
          {site.phone ? (
            <a href={`tel:${site.phone}`} aria-label={`Call ${site.phone}`}>
              {site.phone}
            </a>
          ) : null}
          {site.email ? (
            <a href={`mailto:${site.email}`} className="cs-topbar-email">
              {site.email}
            </a>
          ) : null}
        </div>
        {site.tagline ? <span className="cs-topbar-tagline">&ldquo;{site.tagline}&rdquo;</span> : null}
      </div>
    </div>
  );
}
