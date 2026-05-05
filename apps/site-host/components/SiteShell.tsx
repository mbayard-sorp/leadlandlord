import type { ReactNode } from 'react';
import { telHref } from '../lib/content';

interface Props {
  children: ReactNode;
  businessName: string;
  niche: string;
  city: string;
  state: string;
  /** Tracking number resolved by the parent server component (Postgres). */
  phone: string;
}

/**
 * Theme-driven minimal page shell for /about and /contact.
 * Variant home pages have their own bespoke headers; this shell is for the
 * 2 secondary pages that don't get a variant treatment.
 *
 * All colors / fonts / radii come from the theme's CSS vars
 * (defined in styles/themes/{variant}.css).
 */
export function SiteShell({ children, businessName, niche, city, state, phone }: Props) {
  return (
    <div className="site-page">
      <header className="site-page-header">
        <a href="/" className="site-page-brand">
          {businessName}
        </a>
        <nav className="site-page-nav">
          <a href="/about/">About</a>
          <a href="/contact/">Contact</a>
          <a href={telHref(phone)} className="site-page-phone num">
            ☎ {phone}
          </a>
        </nav>
      </header>
      <main className="site-page-main prose-site">{children}</main>
      <footer className="site-page-footer">
        <p>
          <strong>{businessName}</strong> — {niche} in {city}, {state}. Call {phone} or use the
          form on any page to request a quote.
        </p>
        <p className="site-page-disclaimer">
          This site connects callers with a partnered local provider. Phone numbers are answered
          during business hours.
        </p>
      </footer>
    </div>
  );
}
