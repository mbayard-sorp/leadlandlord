import Image from 'next/image';
import type { Bundle, Variant } from '../../lib/content';

interface Props {
  bundle: Bundle;
  variant: Variant;
}

/**
 * Responsive photo gallery, capped at 8 images.
 * Uses next/image with quality={70} and explicit aspect-ratio to prevent CLS.
 * Renders nothing when `bundle.photo_gallery` is empty — ADR 0003.
 */
export function PhotoGallery({ bundle, variant }: Props) {
  if (bundle.photo_gallery.length === 0) return null;

  const photos = bundle.photo_gallery.slice(0, 8);

  return (
    <section
      className={`photo-gallery photo-gallery-${variant}`}
      aria-labelledby="gallery-heading"
    >
      <h2 id="gallery-heading" className="photo-gallery-heading">
        {variant === 'premium' ? 'Portfolio' : 'Our work'}
      </h2>
      <div className="photo-gallery-grid">
        {photos.map((photo, i) => (
          <div key={`${photo.url}-${i}`} className="photo-gallery-item">
            <Image
              src={photo.url}
              alt={photo.alt}
              fill
              quality={70}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              style={{ objectFit: 'cover' }}
            />
            {photo.caption && (
              <p className="photo-gallery-caption">{photo.caption}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
