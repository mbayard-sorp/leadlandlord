import type { BuildSellSite } from '@/lib/sanity';
import { resolveBuildSellTheme } from '@/lib/buildsell-theme';
import { resolveBsFont } from '@/lib/buildsell-fonts';
import { googleMapsUrl } from '@/lib/google-maps-url';
import { DraftShield } from './DraftShield';
import { BuildSellMotion } from './BuildSellMotion';
import { MobileCallBar } from './MobileCallBar';
import { HeroBlock } from './blocks/HeroBlock';
import { ServicesBlock } from './blocks/ServicesBlock';
import { AboutBlock } from './blocks/AboutBlock';
import { ProcessBlock } from './blocks/ProcessBlock';
import { ReviewsBlock } from './blocks/ReviewsBlock';
import { ContactBlock } from './blocks/ContactBlock';
import { FooterBlock } from './blocks/FooterBlock';

// Import the base B&S stylesheet
import '@/styles/themes/buildsell.css';

interface BuildSellHomeProps {
  site: BuildSellSite;
  draft: boolean;
}

/**
 * Map the resolved theme (preset-authoritative colors + per-doc fonts) to CSS
 * custom properties. Font strings are resolved to var(--font-bs-*) references
 * so next/font variables (applied on the parent wrapper by the route page)
 * actually load. See lib/buildsell-theme.ts for the resolution rules.
 */
function themeVars(site: BuildSellSite): React.CSSProperties {
  const t = resolveBuildSellTheme(site.theme);
  return {
    '--bs-primary': t.primary ?? undefined,
    '--bs-primary-dark': t.primaryDark ?? undefined,
    '--bs-accent': t.accent ?? undefined,
    '--bs-on-primary': t.onPrimary ?? undefined,
    '--bs-bg': t.bg ?? undefined,
    '--bs-surface': t.surface ?? undefined,
    '--bs-text': t.text ?? undefined,
    '--bs-muted': t.muted ?? undefined,
    '--bs-font-heading': resolveBsFont(t.fontHeading),
    '--bs-font-body': resolveBsFont(t.fontBody),
  } as React.CSSProperties;
}

export function BuildSellHome({ site, draft }: BuildSellHomeProps) {
  const sections = site.sections ?? [];
  const layoutVariant = resolveBuildSellTheme(site.theme).layoutVariant;

  return (
    <div
      className="bs-root"
      data-bs-layout={layoutVariant}
      data-draft={draft ? 'true' : undefined}
      style={themeVars(site)}
    >
      {draft && <DraftShield purchaseUrl={site.purchaseUrl} />}

      {/* Client island: scroll-reveal, sticky-nav, stat counters */}
      <BuildSellMotion />

      {/* Sticky top nav — data-nav lets BuildSellMotion toggle .is-scrolled */}
      <nav className="bs-nav" data-nav aria-label="Site navigation">
        <div className="bs-container bs-nav-inner">
          <a href="#home" className="bs-nav-brand">
            {site.businessName}
          </a>

          <ul className="bs-nav-links" role="list">
            {site.navigation && site.navigation.length > 0
              ? site.navigation.map((link, i) => (
                  <li key={i}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))
              : (
                <>
                  <li><a href="#services">Services</a></li>
                  <li><a href="#about">About</a></li>
                  <li><a href="#reviews">Reviews</a></li>
                  <li><a href="#contact">Contact</a></li>
                </>
              )}
          </ul>

          <div className="bs-nav-cta-group">
            {site.phone && (
              <a
                href={`tel:${site.phone}`}
                className="bs-btn bs-btn-outline"
                aria-label={`Call ${site.phone}`}
              >
                {site.phone}
              </a>
            )}
            <a href="#contact" className="bs-btn bs-btn-primary">
              Get a Free Quote
            </a>
          </div>
        </div>
      </nav>

      {/* Render sections in Sanity order */}
      {sections.map((section) => {
        switch (section._type) {
          case 'bsHeroSection':
            return (
              <HeroBlock
                key={section._key}
                section={section}
                phone={site.phone}
                layoutVariant={layoutVariant}
                reviewCount={site.reviewCount}
                rating={site.rating}
              />
            );
          case 'bsServicesSection':
            return (
              <ServicesBlock
                key={section._key}
                section={section}
                layoutVariant={layoutVariant}
              />
            );
          case 'bsAboutSection':
            return (
              <AboutBlock
                key={section._key}
                section={section}
                layoutVariant={layoutVariant}
              />
            );
          case 'bsProcessSection':
            return (
              <ProcessBlock
                key={section._key}
                section={section}
                layoutVariant={layoutVariant}
              />
            );
          case 'bsReviewsSection':
            return (
              <ReviewsBlock
                key={section._key}
                section={section}
                layoutVariant={layoutVariant}
              />
            );
          case 'bsContactSection':
            return (
              <ContactBlock
                key={section._key}
                section={section}
                buildsellSiteId={site.buildsellSiteId}
                phone={site.phone}
                layoutVariant={layoutVariant}
              />
            );
          case 'bsFooterSection':
            return (
              <FooterBlock
                key={section._key}
                section={section}
                businessName={site.businessName}
                placeId={site.placeId}
                layoutVariant={layoutVariant}
              />
            );
          default:
            return null;
        }
      })}

      {/* Fallback contact section if no bsContactSection in Sanity doc */}
      {!sections.some((s) => s._type === 'bsContactSection') && (
        <section className="bs-section bs-section-dark" id="contact">
          <div className="bs-container" style={{ textAlign: 'center' }}>
            <h2
              className="bs-section-title"
              style={{ color: 'var(--bs-on-primary)' }}
            >
              Ready to Get Started?
            </h2>
            {site.phone && (
              <a
                href={`tel:${site.phone}`}
                className="bs-btn bs-btn-ghost bs-btn-lg"
                style={{ marginTop: '1.5rem' }}
              >
                Call {site.phone}
              </a>
            )}
          </div>
        </section>
      )}

      {/* Fallback footer if no bsFooterSection in Sanity doc */}
      {!sections.some((s) => s._type === 'bsFooterSection') && (
        <footer className="bs-footer">
          <div className="bs-container">
            <div className="bs-footer-legal">
              <p style={{ margin: 0 }}>
                &copy; {new Date().getFullYear()} {site.businessName}. All rights reserved.
              </p>
              {(() => {
                const mapsUrl = googleMapsUrl(site.businessName, site.placeId);
                return mapsUrl ? (
                  <p style={{ margin: '0.5rem 0 0' }}>
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'color-mix(in srgb, var(--bs-bg) 70%, transparent)', textDecoration: 'underline', fontSize: '0.8rem' }}
                    >
                      View on Google Maps
                    </a>
                  </p>
                ) : null;
              })()}
            </div>
          </div>
        </footer>
      )}

      {/* Sticky mobile call bar — shown only on small screens, no-op when phone absent */}
      <MobileCallBar phone={site.phone} />
    </div>
  );
}
