import { Icon } from '../Icon';
import type { BuildSellSection } from '@/lib/sanity';

interface ProcessBlockProps {
  section: BuildSellSection;
}

export function ProcessBlock({ section }: ProcessBlockProps) {
  const steps = section.steps ?? [];

  return (
    <section className="bs-section bs-section-alt" id="how-it-works">
      <div className="bs-container">
        <h2 className="bs-section-title">{section.heading ?? 'How It Works'}</h2>

        <div className="bs-steps">
          {steps.map((step, i) => (
            <div key={i} className="bs-step">
              <div className="bs-step-num" aria-hidden="true">
                {step.icon ? <Icon name={step.icon} size={18} /> : String(i + 1)}
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: 'var(--bs-font-heading)',
                    fontWeight: 700,
                    fontSize: '1.05rem',
                    margin: '0 0 0.35rem',
                  }}
                >
                  {step.title}
                </h3>
                {step.description && (
                  <p style={{ color: 'var(--bs-muted)', margin: 0, lineHeight: 1.6 }}>
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
