import type { BuildSellSection } from '@/lib/sanity';

interface FooterBlockProps {
  section: BuildSellSection;
  businessName: string;
}

export function FooterBlock({ section, businessName }: FooterBlockProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="bs-footer">
      <div className="bs-container">
        {(section.columns && section.columns.length > 0) ? (
          <div className="bs-footer-grid">
            {/* Brand column */}
            <div>
              <p
                style={{
                  fontFamily: 'var(--bs-font-heading)',
                  fontWeight: 700,
                  fontSize: '1.1rem',
                  color: 'var(--bs-bg)',
                  margin: '0 0 0.5rem',
                }}
              >
                {businessName}
              </p>
              {section.tagline && (
                <p
                  style={{
                    fontSize: '0.875rem',
                    color: 'color-mix(in srgb, var(--bs-bg) 55%, transparent)',
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {section.tagline}
                </p>
              )}
              {section.social && section.social.length > 0 && (
                <div className="bs-social-links">
                  {section.social.map((link, i) => (
                    <a
                      key={i}
                      href={link.href ?? '#'}
                      aria-label={link.platform ?? 'Social link'}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <span aria-hidden="true" style={{ fontSize: '0.85rem' }}>
                        {link.platform?.charAt(0).toUpperCase() ?? '→'}
                      </span>
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
          <div style={{ marginBottom: '2rem' }}>
            <p
              style={{
                fontFamily: 'var(--bs-font-heading)',
                fontWeight: 700,
                fontSize: '1.1rem',
                color: 'var(--bs-bg)',
                margin: '0 0 0.5rem',
              }}
            >
              {businessName}
            </p>
            {section.tagline && (
              <p
                style={{
                  fontSize: '0.875rem',
                  color: 'color-mix(in srgb, var(--bs-bg) 55%, transparent)',
                  margin: 0,
                }}
              >
                {section.tagline}
              </p>
            )}
          </div>
        )}

        <div className="bs-footer-legal">
          {section.legal ? (
            <p style={{ margin: 0 }}>{section.legal}</p>
          ) : (
            <p style={{ margin: 0 }}>
              &copy; {year} {businessName}. All rights reserved.
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
