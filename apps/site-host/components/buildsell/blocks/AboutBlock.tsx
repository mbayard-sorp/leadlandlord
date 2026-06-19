import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';

interface AboutBlockProps {
  section: BuildSellSection;
}

export function AboutBlock({ section }: AboutBlockProps) {
  const stats = section.stats ?? [];

  return (
    <section className="bs-section" id="about">
      <div className="bs-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: section.imageUrl ? '1fr 1fr' : '1fr',
            gap: 'clamp(2rem, 5vw, 5rem)',
            alignItems: 'center',
          }}
        >
          {/* Text side */}
          <div>
            <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
            {section.body && (
              <p style={{ color: 'var(--bs-muted)', lineHeight: 1.7, marginBottom: '2rem' }}>
                {section.body}
              </p>
            )}

            {stats.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, 1fr)`,
                  gap: '1.5rem',
                }}
              >
                {stats.map((stat, i) => (
                  <div key={i} className="bs-stat">
                    <span className="bs-stat-value">{stat.value}</span>
                    <span className="bs-stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Image side */}
          {section.imageUrl && (
            <div
              style={{
                borderRadius: 'var(--bs-radius-card)',
                overflow: 'hidden',
                aspectRatio: '4 / 3',
                position: 'relative',
                boxShadow: 'var(--bs-shadow-lg)',
              }}
            >
              <Image
                src={section.imageUrl}
                alt={section.heading ?? 'About our team'}
                fill
                sizes="(max-width: 767px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
