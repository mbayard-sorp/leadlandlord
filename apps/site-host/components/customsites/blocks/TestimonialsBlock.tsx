import type { CsTestimonialsBlock } from '@/lib/customsites-sanity';
import { TestimonialsCarousel } from './TestimonialsCarousel';

interface Props {
  block: CsTestimonialsBlock;
}

export function TestimonialsBlock({ block }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="cs-section cs-section--navy">
      <div className="cs-container">
        <TestimonialsCarousel items={items} autoRotate={block.autoRotate} />
      </div>
    </section>
  );
}
