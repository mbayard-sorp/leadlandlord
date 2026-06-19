import { Icon } from '../Icon';
import type { BuildSellSection } from '@/lib/sanity';

interface ServicesBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * Services grid layout per variant:
 * - split: 3-column grid, standard cards
 * - bold:  2-column big cards (more visual weight)
 * - trust: compact single-column list (emphasis on clarity/trust)
 */
export function ServicesBlock({ section, layoutVariant }: ServicesBlockProps) {
  const services = section.services ?? [];
  const isBold = layoutVariant === 'bold';
  const isTrust = layoutVariant === 'trust';

  return (
    <section className="bs-section bs-section-alt bs-reveal" id="services">
      <div className="bs-container">
        {section.heading && (
          <h2 className="bs-section-title">{section.heading}</h2>
        )}
        {section.subhead && (
          <p className="bs-section-intro">{section.subhead}</p>
        )}

        {/* trust: compact list */}
        {isTrust && (
          <div className="bs-services-compact">
            {services.map((svc, i) => (
              <div key={i} className="bs-services-compact-row">
                {svc.icon && (
                  <div className="bs-icon-box bs-icon-box--sm" aria-hidden="true">
                    <Icon name={svc.icon} size={18} />
                  </div>
                )}
                <div>
                  <h3 className="bs-services-compact-title">
                    {svc.link ? (
                      <a href={svc.link} className="bs-link">{svc.title}</a>
                    ) : svc.title}
                  </h3>
                  {svc.description && (
                    <p className="bs-services-compact-desc">{svc.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* bold: 2-column big cards */}
        {isBold && (
          <div className="bs-services-bold">
            {services.map((svc, i) => (
              <div key={i} className="bs-card bs-services-bold-card">
                {svc.icon && (
                  <div className="bs-icon-box bs-icon-box--lg" aria-hidden="true">
                    <Icon name={svc.icon} size={28} />
                  </div>
                )}
                <h3 className="bs-services-bold-title">
                  {svc.link ? (
                    <a href={svc.link} className="bs-link">{svc.title}</a>
                  ) : svc.title}
                </h3>
                {svc.description && (
                  <p className="bs-services-bold-desc">{svc.description}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* split (default): 3-column grid */}
        {!isBold && !isTrust && (
          <div className="bs-grid-3">
            {services.map((svc, i) => (
              <div key={i} className="bs-card">
                {svc.icon && (
                  <div className="bs-icon-box" aria-hidden="true">
                    <Icon name={svc.icon} size={22} />
                  </div>
                )}
                <h3 className="bs-services-title">
                  {svc.link ? (
                    <a href={svc.link} className="bs-link">{svc.title}</a>
                  ) : svc.title}
                </h3>
                {svc.description && (
                  <p className="bs-services-desc">{svc.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
