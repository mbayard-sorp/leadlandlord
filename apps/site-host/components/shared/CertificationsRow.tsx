import type { Bundle, Variant } from '../../lib/content';

interface Props {
  bundle: Bundle;
  variant: Variant;
}

/**
 * Badge-style row of professional certifications.
 * Renders nothing when `bundle.certifications` is empty — ADR 0003.
 */
export function CertificationsRow({ bundle, variant }: Props) {
  if (bundle.certifications.length === 0) return null;

  return (
    <div className={`certifications-row certifications-row-${variant}`} aria-label="Certifications">
      {bundle.certifications.map((cert) => (
        <div key={`${cert.name}-${cert.issuer ?? ''}`} className="certifications-badge">
          <span className="certifications-name">{cert.name}</span>
          {cert.issuer && (
            <span className="certifications-issuer">{cert.issuer}</span>
          )}
          {cert.year && (
            <span className="certifications-year">{cert.year}</span>
          )}
        </div>
      ))}
    </div>
  );
}
