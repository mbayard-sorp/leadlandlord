import type { CsRequirementsBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsRequirementsBlock;
}

/**
 * The compatibility rail: device, system, storage, languages. A definition
 * list because that is what it is, and because it reads correctly to a screen
 * reader without any ARIA.
 */
export function RequirementsBlock({ block }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="cs-section cs-section--tight">
      <div className="cs-container">
        {block.heading ? <h2 className="cs-requirements-heading">{block.heading}</h2> : null}
        <dl className="cs-requirements">
          {items.map((item) => (
            <div key={item._key}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
