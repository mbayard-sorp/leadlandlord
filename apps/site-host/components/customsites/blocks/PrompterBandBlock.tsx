import type { CsPrompterBandBlock } from '@/lib/customsites-sanity';

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
 */
export function PrompterBandBlock({ block }: Props) {
  const notes = block.notes ?? [];

  return (
    <section className="cs-prompter-band" aria-label="What the prompter looks like">
      <div className="cs-container">
        {block.eyebrow ? (
          <p className="cs-eyebrow cs-eyebrow--ruled">
            <span className="cs-rule" aria-hidden="true" />
            {block.eyebrow}
          </p>
        ) : null}
        <p className="cs-prompter-line">
          {block.pastLine ? <span className="cs-prompter-past">{block.pastLine} </span> : null}
          {block.currentLine}
          {block.nextLine ? <span className="cs-prompter-next"> {block.nextLine}</span> : null}
        </p>
        {notes.length > 0 ? (
          <div className="cs-prompter-notes">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
