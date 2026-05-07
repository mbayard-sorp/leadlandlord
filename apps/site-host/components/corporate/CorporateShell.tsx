import type { ReactNode } from 'react';
import type { CorporateSite } from '../../lib/sanity';

interface Props {
  site: CorporateSite;
  children: ReactNode;
}

/**
 * Top-level layout for the leadslandlord.com marketing site. Header nav and
 * footer come from the corporateSite Sanity doc so the operator can edit
 * without a redeploy. Distinct from SiteShell (per-tenant) — the corporate
 * site has no niche/city/phone treatment.
 */
export function CorporateShell({ site, children }: Props) {
  const navItems = site.navItems ?? [];
  const footerLinks = site.footerLinks ?? [];
  const cta = site.primaryCta;
  const legal = site.legalEntity;

  return (
    <div className="corp-page">
      <header className="corp-header">
        <a href="/" className="corp-brand">
          {site.brandName}
        </a>
        <nav className="corp-nav">
          {navItems.map((item) => (
            <a key={`${item.label}-${item.href}`} href={item.href}>
              {item.label}
            </a>
          ))}
          {cta?.label && cta.href ? (
            <a href={cta.href} className="corp-cta-button">
              {cta.label}
            </a>
          ) : null}
        </nav>
      </header>

      <main className="corp-main">{children}</main>

      <footer className="corp-footer">
        <div className="corp-footer-cols">
          <div className="corp-footer-col">
            <p className="corp-footer-brand">
              <strong>{site.brandName}</strong>
              {site.tagline ? <span> — {site.tagline}</span> : null}
            </p>
            {legal?.name ? (
              <p className="corp-footer-legal">
                {legal.dba ? `${legal.name} dba ${legal.dba}` : legal.name}
                {legal.address ? (
                  <>
                    <br />
                    {legal.address}
                  </>
                ) : null}
                {legal.supportEmail ? (
                  <>
                    <br />
                    <a href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="corp-footer-col">
            <ul className="corp-footer-links">
              {footerLinks.map((item) => (
                <li key={`${item.label}-${item.href}`}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="corp-footer-fineprint">
          © {new Date().getFullYear()} {legal?.name ?? site.brandName}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
