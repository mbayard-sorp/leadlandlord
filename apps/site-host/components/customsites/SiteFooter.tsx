import Image from 'next/image';
import type { CustomSite, CustomSiteNavLink } from '@/lib/customsites-sanity';
import { StoreBadge } from './blocks/StoreBadge';

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

/**
 * Product-site footer: brand column, one column per authored `footerColumns`
 * entry, and an app column. Only used when `footerColumns` is non-empty; the
 * flat three-column footer below stays the fallback for every other site.
 */
function ColumnFooter({ site }: Props) {
  const columns = site.footerColumns ?? [];
  const mark = site.footerLogoUrl ?? site.logoUrl;
  return (
    <footer className="cs-footer cs-footer--columns">
      <div className="cs-container cs-footer-cols">
        <div className="cs-footer-brand">
          <div className="cs-footer-brand-lockup">
            {mark ? (
              <span className="cs-footer-mark">
                <Image src={mark} alt="" fill sizes="24px" style={{ objectFit: 'contain' }} />
              </span>
            ) : null}
            <span className="cs-footer-brand-name">{site.name}</span>
          </div>
          {site.tagline ? <p className="cs-footer-tagline">{site.tagline}</p> : null}
        </div>

        {columns.map((col) => (
          <nav key={col._key} className="cs-footer-col" aria-label={col.title}>
            <span className="cs-footer-col-title">{col.title}</span>
            {(col.links ?? []).map((link) => (
              <a key={`${link.label}-${link.href}`} href={link.href ?? '#'}>
                {link.label}
              </a>
            ))}
          </nav>
        ))}

        <div className="cs-footer-col cs-footer-app">
          {site.footerAppLabel ? <span className="cs-footer-col-title">{site.footerAppLabel}</span> : null}
          <StoreBadge state={site.storeState ?? 'soon'} href={site.storeHref} label="Coming to the App Store" placement="footer" />
          {site.email ? <a href={`mailto:${site.email}`}>{site.email}</a> : null}
        </div>
      </div>

      <div className="cs-container cs-footer-bar">
        <span>&copy; {new Date().getFullYear()} {site.name}</span>
        {site.footerLegal ? <span className="cs-footer-bar-legal">{site.footerLegal}</span> : null}
      </div>
    </footer>
  );
}

export function SiteFooter({ site }: Props) {
  if (site.footerColumns && site.footerColumns.length > 0) return <ColumnFooter site={site} />;

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
