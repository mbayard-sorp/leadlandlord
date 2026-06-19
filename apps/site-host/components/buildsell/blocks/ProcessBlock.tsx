import { Icon } from '../Icon';
import type { BuildSellSection } from '@/lib/sanity';

interface ProcessBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * Process block layout per variant:
 * - split: horizontal 4-up row (step num + content side by side in a grid row)
 * - bold:  vertical timeline with connector line
 * - trust: centered card column
 */
export function ProcessBlock({ section, layoutVariant }: ProcessBlockProps) {
  const steps = section.steps ?? [];
  const isBold = layoutVariant === 'bold';
  const isTrust = layoutVariant === 'trust';

  return (
    <section className="bs-section bs-section-alt bs-reveal" id="how-it-works">
      <div className="bs-container">
        {section.heading && (
          <h2 className="bs-section-title">{section.heading}</h2>
        )}

        {/* bold: vertical timeline */}
        {isBold && (
          <div className="bs-process-timeline">
            {steps.map((step, i) => (
              <div key={i} className="bs-process-timeline-item">
                <div className="bs-process-timeline-rail" aria-hidden="true">
                  <div className="bs-step-num">
                    {step.icon ? <Icon name={step.icon} size={18} /> : String(i + 1)}
                  </div>
                  {i < steps.length - 1 && <div className="bs-process-timeline-connector" />}
                </div>
                <div className="bs-process-timeline-content">
                  <h3 className="bs-process-step-title">{step.title}</h3>
                  {step.description && (
                    <p className="bs-process-step-desc">{step.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* trust: centered card column */}
        {isTrust && (
          <div className="bs-process-centered">
            {steps.map((step, i) => (
              <div key={i} className="bs-card bs-process-centered-card">
                <div className="bs-step-num" aria-hidden="true">
                  {step.icon ? <Icon name={step.icon} size={18} /> : String(i + 1)}
                </div>
                <div>
                  <h3 className="bs-process-step-title">{step.title}</h3>
                  {step.description && (
                    <p className="bs-process-step-desc">{step.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* split (default): horizontal 4-up row */}
        {!isBold && !isTrust && (
          <div className="bs-process-horizontal">
            {steps.map((step, i) => (
              <div key={i} className="bs-process-horizontal-item">
                <div className="bs-step-num" aria-hidden="true">
                  {step.icon ? <Icon name={step.icon} size={18} /> : String(i + 1)}
                </div>
                <h3 className="bs-process-step-title">{step.title}</h3>
                {step.description && (
                  <p className="bs-process-step-desc">{step.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
