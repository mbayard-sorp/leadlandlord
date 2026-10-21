import Image from 'next/image';
import { csImageUrl, type CsPrompterBandBlock } from '@/lib/customsites-sanity';
import { hotspotPosition } from './hotspot';

interface Props {
  block: CsPrompterBandBlock;
}

/**
 * The brand's signature surface: near-black, white Semibold script, with the
 * line being read at full strength and its neighbours at 35%.
 *
 * Static by design. There is no scroll animation and no client JS, so it reads
 * identically with JavaScript disabled and under prefers-reduced-motion — the
 * point of the section is what the prompter looks like, not that it moves.
 *
 * With a photo the band becomes two columns, the photo card beside a lens
 * graphic and the line. Without one it is the single-column line.
 */
export function PrompterBandBlock({ block }: Props) {
  const notes = block.notes ?? [];
  const hasImage = Boolean(block.imageUrl);

  const line = (
    <p className="cs-prompter-line">
      {block.pastLine ? <span className="cs-prompter-past">{block.pastLine} </span> : null}
      {block.currentLine}
      {block.nextLine ? <span className="cs-prompter-next"> {block.nextLine}</span> : null}
    </p>
  );
  const notesRow =
    notes.length > 0 ? (
      <div className="cs-prompter-notes">
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    ) : null;

  if (hasImage) {
    return (
      <section className="cs-prompter-band cs-prompter-band--media" aria-label="What the prompter looks like">
        <div className="cs-prompter-glow" aria-hidden="true" />
        <div className="cs-container">
          {block.eyebrow ? (
            <p className="cs-eyebrow cs-eyebrow--ruled">
              <span className="cs-rule" aria-hidden="true" />
              {block.eyebrow}
            </p>
          ) : null}
          <div className="cs-prompter-media-grid">
            <div className="cs-prompter-photo">
              <Image
                src={csImageUrl(block.imageUrl, { w: 1100 })!}
                alt={block.imageAlt ?? ''}
                fill
                sizes="(max-width: 899px) 100vw, 560px"
                style={{ objectFit: 'cover', objectPosition: hotspotPosition(block.imageHotspot) }}
              />
              {block.imageCaption ? (
                <>
                  <span className="cs-prompter-photo-fade" aria-hidden="true" />
                  <p className="cs-prompter-photo-caption">{block.imageCaption}</p>
                </>
              ) : null}
            </div>
            <div className="cs-prompter-side">
              {block.lensLabel ? (
                <div className="cs-prompter-lens">
                  <span className="cs-lens-graphic" aria-hidden="true" />
                  <span className="cs-prompter-lens-label">{block.lensLabel}</span>
                </div>
              ) : null}
              {line}
            </div>
          </div>
          {notesRow}
        </div>
      </section>
    );
  }

  return (
    <section className="cs-prompter-band" aria-label="What the prompter looks like">
      <div className="cs-container">
        {block.eyebrow ? (
          <p className="cs-eyebrow cs-eyebrow--ruled">
            <span className="cs-rule" aria-hidden="true" />
            {block.eyebrow}
          </p>
        ) : null}
        {line}
        {notesRow}
      </div>
    </section>
  );
}
