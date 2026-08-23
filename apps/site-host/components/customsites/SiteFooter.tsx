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

/** The machine sitemap — the one utility link every site has by construction. */
const SITEMAP_HREF = '/sitemap.xml';

/**
 * The bottom utility bar's legal links, derived from the site's own data:
 * every `footerNav` entry the header nav doesn't already carry — the editorial
 * extras, which in practice are the legal pages. Their slugs are per-site
 * (site #1 has /disclaimer + /privacy-policy, site #2 has /privacy + /terms +
 * /disclosures), so a hardcoded pair 404s on every site but the one it was
 * written for. The sitemap is rendered separately from SITEMAP_HREF, so a
 * footerNav sitemap entry drops out here instead of rendering twice.
 */
function legalLinksFor(site: CustomSite): CustomSiteNavLink[] {
  const navHrefs = new Set((site.navigation ?? []).map((link) => link.href));
  // No header nav means nothing to subtract and every footerNav entry is a
  // Quick Link — leave the bar to the sitemap rather than guess at legal pages.
  if (navHrefs.size === 0) return [];
  return (site.footerNav ?? []).filter(
    (link) => link.href && !navHrefs.has(link.href) && !link.href.startsWith('/sitemap'),
  );
}

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
  // Whatever the utility bar renders is stripped from Quick Links so no
  // destination shows up in both places.
  const legalLinks = legalLinksFor(site);
  const utilityHrefs = new Set<string>([SITEMAP_HREF, ...legalLinks.map((link) => link.href ?? '')]);
  const links = source.filter((link) => !utilityHrefs.has(link.href ?? ''));
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
          <li><a href={SITEMAP_HREF}>Sitemap</a></li>
          {legalLinks.map((link) => (
            <li key={`${link.label}-${link.href}`}>
              <a href={link.href ?? '#'}>{link.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
