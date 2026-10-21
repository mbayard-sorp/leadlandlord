import Image from 'next/image';
import type { CsAppCtaBlock } from '@/lib/customsites-sanity';
import { StoreBadge } from './StoreBadge';

interface Props {
  block: CsAppCtaBlock;
  /** csSite.logo — the mark set above the heading when Show Mark is on. */
  logoUrl?: string | null;
  siteName?: string | null;
}

/**
 * The closing band: mark, one line, the store call to action, the qualifier.
 * Graphite by default, which is where the accent flips to Cobalt Bright with
 * graphite ink on top (the contrast decision in cueduo.css).
 *
 * `band: 'prompter'` is the same band on prompter black. With a `countdown` it
 * opens on a record-start motif (take label, one giant digit, REC row) in
 * place of the logo mark. The digit is decoration: the take label and the
 * heading carry the meaning, so it is hidden from assistive tech.
 */
export function AppCtaBlock({ block, logoUrl, siteName }: Props) {
  const graphite = block.band !== 'porcelain';
  const prompter = block.band === 'prompter';
  const cd = block.countdown;
  const hasCountdown = Boolean(cd && (cd.eyebrow || cd.digit || cd.recLabel || cd.timecode));

  return (
    <section
      className={`cs-section cs-appcta${graphite ? ' cs-section--navy' : ''}${prompter ? ' cs-appcta--prompter' : ''}`}
      id="get"
    >
      <div className="cs-container">
        {hasCountdown && cd ? (
          <>
            {cd.eyebrow ? <span className="cs-appcta-eyebrow">{cd.eyebrow}</span> : null}
            {cd.digit ? (
              <div className="cs-appcta-digit" aria-hidden="true">
                {cd.digit}
              </div>
            ) : null}
            {cd.recLabel || cd.timecode ? (
              <div className="cs-appcta-rec">
                <span className="cs-rec-dot" aria-hidden="true" />
                {cd.recLabel ?? 'REC'}
                {cd.timecode ? <span className="cs-appcta-time">{cd.timecode}</span> : null}
              </div>
            ) : null}
          </>
        ) : null}
        {block.showMark !== false && logoUrl && !hasCountdown ? (
          <Image
            className="cs-appcta-mark"
            src={logoUrl}
            alt={siteName ?? ''}
            width={34}
            height={34}
          />
        ) : null}
        <h2 className="cs-appcta-heading">{block.heading}</h2>
        {block.body ? <p className="cs-appcta-body">{block.body}</p> : null}
        <div className="cs-appcta-actions">
          <StoreBadge state={block.storeState} label={block.storeLabel} href={block.storeHref} placement="band" />
        </div>
        {block.qualifier ? <p className="cs-appcta-note">{block.qualifier}</p> : null}
      </div>
    </section>
  );
}
