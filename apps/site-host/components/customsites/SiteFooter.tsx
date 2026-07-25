import Image from 'next/image';
import type { CustomSite, CustomSiteNavLink } from '@/lib/customsites-sanity';

interface Props {
  site: CustomSite;
}

/** Structural default, same rationale as SiteHeader's DEFAULT_NAV. */
const DEFAULT_FOOTER_LINKS: CustomSiteNavLink[] = [
  { label: 'About Us', href: '/mikes-story' },
  { label: 'Practice Areas', href: '/adr-services' },
  { label: 'Publications', href: '/publications' },
  { label: 'Contact Us', href: '/contact' },
];

export function SiteFooter({ site }: Props) {
  const links = site.footerNav && site.footerNav.length > 0 ? site.footerNav : DEFAULT_FOOTER_LINKS;
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
