import { Icon } from '../Icon';
import type { BuildSellSection } from '@/lib/sanity';

interface ServicesBlockProps {
  section: BuildSellSection;
}

export function ServicesBlock({ section }: ServicesBlockProps) {
  const services = section.services ?? [];

  return (
    <section className="bs-section bs-section-alt" id="services">
      <div className="bs-container">
        <h2 className="bs-section-title">{section.heading ?? 'Our Services'}</h2>

        <div className="bs-grid-3">
          {services.map((svc, i) => (
            <div key={i} className="bs-card">
              {svc.icon && (
                <div className="bs-icon-box">
                  <Icon name={svc.icon} size={22} />
                </div>
              )}
              <h3
                style={{
                  fontFamily: 'var(--bs-font-heading)',
                  fontWeight: 700,
                  fontSize: '1.1rem',
                  margin: '0 0 0.5rem',
                }}
              >
                {svc.title}
              </h3>
              {svc.description && (
                <p style={{ color: 'var(--bs-muted)', fontSize: '0.95rem', margin: 0 }}>
                  {svc.description}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
