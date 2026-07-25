import type { CsRichTextBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';

interface Props {
  block: CsRichTextBlock;
}

export function RichTextBlock({ block }: Props) {
  if (!block.content || block.content.length === 0) return null;
  return (
    <section className="cs-section">
      <div className="cs-container" style={{ maxWidth: 760 }}>
        <Prose value={block.content} />
      </div>
    </section>
  );
}
