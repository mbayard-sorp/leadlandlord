import type { BuildSellSection } from '@/lib/sanity';
import { Icon } from '../Icon';
import { googleMapsUrl } from '@/lib/google-maps-url';

interface FooterBlockProps {
  section: BuildSellSection;
  businessName: string;
  placeId?: string | null;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * Map social platform names to lucide icon names.
 * Falls back to 'external-link' for unknown platforms.
 */
const SOCIAL_ICON_MAP: Record<string, string> = {
  facebook:   'facebook',
  instagram:  'instagram',
  twitter:    'twitter',
  x:          'twitter',
  linkedin:   'linkedin',
  youtube:    'youtube',
  tiktok:     'music-2',
  pinterest:  'pinterest',
  nextdoor:   'map-pin',
  yelp:       'star',
};

function socialIconName(platform: string | null | undefined): string {
  if (!platform) return 'external-link';
  return SOCIAL_ICON_MAP[platform.toLowerCase()] ?? 'external-link';
}

/**
 * Footer block — same structure across all variants.
 * layoutVariant is accepted for future variant-specific tweaks but the footer
 * is largely identical in content; variant differences are handled via CSS.
 * Social links use lucide icons (server-rendered via Icon.tsx — no CDN call).
 * legalLinks are rendered inline next to the copyright line.
 */
export function FooterBlock({ section, businessName, placeId, layoutVariant: _layoutVariant }: FooterBlockProps) {
  const year = new Date().getFullYear();
  const mapsUrl = googleMapsUrl(businessName, placeId);

  return (
    <footer className="bs-footer bs-reveal">
      <div className="bs-container">
        {(section.columns && section.columns.length > 0) ? (
          <div className="bs-footer-grid">
            {/* Brand column */}
            <div>
              <p className="bs-footer-brand">
              <span className="bs-footer-brand-mark" aria-hidden="true">{businessName.charAt(0)}</span>
              {businessName}
            </p>
              {section.tagline && (
                <p className="bs-footer-tagline">{section.tagline}</p>
              )}
              {section.social && section.social.length > 0 && (
                <div className="bs-social-links" aria-label="Social media links">
                  {section.social.map((link, i) => (
                    <a
                      key={i}
                      href={link.href ?? '#'}
                      aria-label={link.platform ?? 'Social link'}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <Icon name={socialIconName(link.platform)} size={16} />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {section.columns.map((col, i) => (
              <div key={i}>
                {col.heading && (
                  <p className="bs-footer-heading">{col.heading}</p>
                )}
                {col.links && col.links.length > 0 && (
                  <ul className="bs-footer-links">
                    {col.links.map((link, j) => (
                      <li key={j}>
                        <a href={link.href ?? '#'}>{link.label}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Minimal footer when no columns configured */
          <div className="bs-footer-minimal">
            <p className="bs-footer-brand">
              <span className="bs-footer-brand-mark" aria-hidden="true">{businessName.charAt(0)}</span>
              {businessName}
            </p>
            {section.tagline && (
              <p className="bs-footer-tagline">{section.tagline}</p>
            )}
            {section.social && section.social.length > 0 && (
              <div className="bs-social-links" aria-label="Social media links">
                {section.social.map((link, i) => (
                  <a
                    key={i}
                    href={link.href ?? '#'}
                    aria-label={link.platform ?? 'Social link'}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Icon name={socialIconName(link.platform)} size={16} />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bs-footer-legal">
          <p style={{ margin: 0 }}>
            {section.legal ?? `© ${year} ${businessName}. All rights reserved.`}
          </p>

          {/* Legal links (privacy, terms, etc.) */}
          {section.legalLinks && section.legalLinks.length > 0 && (
            <nav className="bs-footer-legal-links" aria-label="Legal links">
              {section.legalLinks.map((link, i) => (
                <a key={i} href={link.href ?? '#'}>{link.label}</a>
              ))}
            </nav>
          )}

          {mapsUrl && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bs-footer-maps-link"
              >
                View on Google Maps
              </a>
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
