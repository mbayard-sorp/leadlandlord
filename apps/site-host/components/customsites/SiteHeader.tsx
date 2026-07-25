import Image from 'next/image';
import type { CustomSite, CustomSiteNavLink } from '@/lib/customsites-sanity';
import { NavLink, MobileDrawer } from './NavClient';

interface Props {
  site: CustomSite;
}

/** Structural default used only until `csSite.navigation` is authored in
 * Studio — mirrors BuildSellHome's nav fallback pattern so the header never
 * renders empty. Generic chrome labels, not fabricated business content. */
const DEFAULT_NAV: CustomSiteNavLink[] = [
  { label: 'Home', href: '/' },
  { label: "Mike's Story", href: '/mikes-story' },
  { label: 'ADR Services', href: '/adr-services' },
  { label: 'Construction Industry', href: '/construction-industry' },
  { label: 'Publications', href: '/publications' },
  { label: 'Contact', href: '/contact' },
];

export function SiteHeader({ site }: Props) {
  const links = site.navigation && site.navigation.length > 0 ? site.navigation : DEFAULT_NAV;

  return (
    <header className="cs-header">
      <div className="cs-container cs-header-inner">
        <a href="/" className="cs-brand">
          {site.logoUrl ? (
            <span className="cs-header-logo">
              <Image src={site.logoUrl} alt={site.name} fill sizes="200px" priority style={{ objectFit: 'contain', objectPosition: 'left center' }} />
            </span>
          ) : (
            <>
              <span className="cs-brand-name">Michael J. Bayard</span>
              <span className="cs-brand-sub">Construction ADR</span>
            </>
          )}
        </a>

        <nav className="cs-nav cs-nav-desktop" aria-label="Primary">
          <ul className="cs-nav-links">
            {links.map((link) => {
              const hasChildren = Boolean(link.children && link.children.length > 0);
              return (
                <li key={`${link.label}-${link.href}`} className={hasChildren ? 'cs-nav-item--dropdown' : undefined}>
                  <NavLink href={link.href ?? '#'} className="cs-nav-link">
                    {link.label}
                    {hasChildren ? <span className="cs-nav-caret" aria-hidden="true" /> : null}
                  </NavLink>
                  {hasChildren ? (
                    <ul className="cs-nav-dropdown">
                      {link.children!.map((child) => (
                        <li key={`${child.label}-${child.href}`}>
                          <a href={child.href ?? '#'}>{child.label}</a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>

        {site.phone ? (
          <a href={`tel:${site.phone}`} className="cs-btn cs-btn-primary cs-header-phone" aria-label={`Call ${site.phone}`}>
            Call {site.phone}
          </a>
        ) : null}

        <MobileDrawer links={links} phone={site.phone} />
      </div>
    </header>
  );
}
