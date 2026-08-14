import Image from 'next/image';
import type { CustomSite, CustomSiteNavLink } from '@/lib/customsites-sanity';

interface Props {
  site: CustomSite;
}

/** Structural default, same rationale as SiteHeader's DEFAULT_NAV — labels
 * mirror the header's fallback nav so Quick Links never drifts from what the
 * header calls the same destination (e.g. "Mike's Story", not "About Us"). */
const DEFAULT_FOOTER_LINKS: CustomSiteNavLink[] = [
  { label: "Mike's Story", href: '/mikes-story' },
  { label: 'ADR Services', href: '/adr-services' },
  { label: 'Construction Industry', href: '/construction-industry' },
  { label: 'Publications', href: '/publications' },
  { label: 'Contact', href: '/contact' },
];

/** The bottom utility bar below (cs-footer-legal-links) always owns these —
 * stripped out of Quick Links so they never render in both places. */
const UTILITY_HREFS = new Set(['/sitemap.xml', '/disclaimer', '/privacy-policy']);

export function SiteFooter({ site }: Props) {
  // `navigation` is the header's own source and is what's actually correct
  // and current on the live site; `footerNav` is a separate editorial field
  // that can drift from it (stale "About Us" label, missing nav items). Prefer
  // navigation so Quick Links stays in lockstep with the header by
  // construction, falling back to footerNav, then the structural default.
  const source =
    site.navigation && site.navigation.length > 0
      ? site.navigation
      : site.footerNav && site.footerNav.length > 0
        ? site.footerNav
        : DEFAULT_FOOTER_LINKS;
  const links = source.filter((link) => !UTILITY_HREFS.has(link.href ?? ''));
  const addr = site.address;
  const hasAddress = Boolean(addr?.street || addr?.city);

  return (
    <footer className="cs-footer">
      <div className="cs-container cs-footer-grid">
        <div>
          {site.footerLogoUrl ? (
            <span className="cs-footer-logo">
              <Image
                src={site.footerLogoUrl}
                alt={site.name}
                fill
                sizes="200px"
                style={{ objectFit: 'contain', objectPosition: 'left center' }}
              />
            </span>
          ) : (
            <h3>{site.name}</h3>
          )}
          {site.tagline ? <p className="cs-footer-tagline">&ldquo;{site.tagline}&rdquo;</p> : null}
        </div>

        <div>
          <h3>Quick Links</h3>
          <ul>
            {links.map((link) => (
              <li key={`${link.label}-${link.href}`}>
                <a href={link.href ?? '#'}>{link.label}</a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Contact</h3>
          <ul>
            {hasAddress ? (
              <li>
                {addr?.street ? <>{addr.street}<br /></> : null}
                {addr?.unit ? <>{addr.unit}<br /></> : null}
                {[addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ')}
              </li>
            ) : null}
            {site.phone ? (
              <li>
                <a href={`tel:${site.phone}`}>{site.phone}</a>
              </li>
            ) : null}
            {site.email ? (
              <li>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      {site.footerDisclosure ? (
        <div className="cs-container">
          <p className="cs-footer-disclosure">{site.footerDisclosure}</p>
        </div>
      ) : null}

      <div className="cs-container cs-footer-legal">
        <span>&copy; {new Date().getFullYear()} {site.name}. All rights reserved.</span>
        <ul className="cs-footer-legal-links">
          <li><a href="/sitemap.xml">Sitemap</a></li>
          <li><a href="/disclaimer">Disclaimer</a></li>
          <li><a href="/privacy-policy">Privacy Policy</a></li>
        </ul>
      </div>
    </footer>
  );
}
