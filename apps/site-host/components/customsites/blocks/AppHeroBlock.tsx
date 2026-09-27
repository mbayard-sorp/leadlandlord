import Image from 'next/image';
import { csImageUrl, type CsAppHeroBlock, type CsFoldPreview } from '@/lib/customsites-sanity';
import { StoreBadge } from './StoreBadge';

interface Props {
  block: CsAppHeroBlock;
}

/** True when the fold preview carries enough copy to be worth drawing. */
function foldHasContent(preview?: CsFoldPreview | null): boolean {
  if (!preview) return false;
  return Boolean(
    preview.currentLine ||
      preview.pastLine ||
      preview.innerHeading ||
      (preview.checklist && preview.checklist.length > 0),
  );
}

/**
 * Hero for an app marketing site: promise, store call to action, qualifier,
 * and the device beside it.
 *
 * The device column has three states, in order of preference:
 *  1. an uploaded render (`device`) — what ships once the 3/4 render exists;
 *  2. the built-in fold preview, drawn from `foldPreview` strings;
 *  3. nothing, and the text column takes the full width.
 *
 * The fold preview is a stylised illustration built from authored copy, not a
 * screenshot and not invented app UI: the panes mirror the real prompter and
 * preflight screens. It is static markup with no client JS.
 */
export function AppHeroBlock({ block }: Props) {
  const showMedia = Boolean(block.deviceUrl) || foldHasContent(block.foldPreview);

  const device = block.deviceUrl ? (
    <figure className="cs-apphero-device">
      <Image
        src={csImageUrl(block.deviceUrl, { w: 1200 })}
        alt={block.deviceAlt ?? ''}
        width={1200}
        height={900}
        priority
        sizes="(max-width: 899px) 100vw, 46vw"
      />
      {block.deviceCaption ? <figcaption className="cs-device-caption">{block.deviceCaption}</figcaption> : null}
    </figure>
  ) : (
    <FoldPreview preview={block.foldPreview} caption={block.deviceCaption} />
  );

  return (
    <section className="cs-section cs-apphero">
      <div className="cs-container">
        <div className={`cs-apphero-grid${showMedia ? '' : ' cs-apphero-grid--solo'}`}>
          <div className="cs-apphero-copy">
            {block.eyebrow ? (
              <p className="cs-eyebrow cs-eyebrow--ruled">
                <span className="cs-rule" aria-hidden="true" />
                {block.eyebrow}
              </p>
            ) : null}
            <h1 className="cs-apphero-heading">{block.heading}</h1>
            {block.subheading ? <p className="cs-lead cs-apphero-sub">{block.subheading}</p> : null}
            <div className="cs-apphero-actions">
              <StoreBadge
                state={block.storeState}
                label={block.storeLabel}
                href={block.storeHref}
                placement="hero"
              />
              {block.secondaryLabel && block.secondaryHref ? (
                <a className="cs-underline-link" href={block.secondaryHref}>
                  {block.secondaryLabel}
                </a>
              ) : null}
            </div>
            {block.qualifier ? <p className="cs-apphero-note">{block.qualifier}</p> : null}
          </div>
          {showMedia ? <div className="cs-apphero-media">{device}</div> : null}
        </div>
      </div>
    </section>
  );
}

function FoldPreview({ preview, caption }: { preview?: CsFoldPreview | null; caption?: string | null }) {
  if (!foldHasContent(preview) || !preview) return null;
  const checklist = preview.checklist ?? [];
  const hasOuter = Boolean(preview.currentLine || preview.pastLine);
  const hasInner = Boolean(preview.innerHeading || checklist.length > 0);

  return (
    <figure className="cs-fold">
      {/* Decorative: every string in here is also stated in the copy column or
          is app chrome, so a screen reader gains nothing from reading it. */}
      <div className="cs-fold-body" aria-hidden="true">
        {hasOuter ? (
          <div className="cs-fold-pane cs-fold-pane--outer">
            <div className="cs-fold-rec">
              <span className="cs-rec-dot" />
              {preview.recordLabel ?? 'REC'}
              {preview.timecode ? <span className="cs-fold-time">{preview.timecode}</span> : null}
            </div>
            <p className="cs-fold-script">
              {preview.pastLine ? <span className="cs-prompter-past">{preview.pastLine} </span> : null}
              {preview.currentLine}
            </p>
            {preview.lensNote ? (
              <p className="cs-fold-lens">
                <span className="cs-fold-lens-ring" />
                {preview.lensNote}
              </p>
            ) : null}
          </div>
        ) : null}
        {hasInner ? (
          <div className="cs-fold-pane cs-fold-pane--inner">
            {preview.innerEyebrow ? <p className="cs-fold-eyebrow">{preview.innerEyebrow}</p> : null}
            {preview.innerHeading ? <p className="cs-fold-heading">{preview.innerHeading}</p> : null}
            {checklist.length > 0 ? (
              <ul className="cs-fold-list">
                {checklist.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {preview.primaryLabel || preview.secondaryLabel ? (
              <p className="cs-fold-actions">
                {preview.primaryLabel ? <span className="cs-fold-primary">{preview.primaryLabel}</span> : null}
                {preview.secondaryLabel ? <span className="cs-fold-secondary">{preview.secondaryLabel}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <figcaption className="cs-device-caption">
        {caption ?? 'An illustration of the two screens. Not a screenshot.'}
      </figcaption>
    </figure>
  );
}
