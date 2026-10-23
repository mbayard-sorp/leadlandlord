import Image from 'next/image';
import {
  csImageUrl,
  type CsDeviceShowcaseBlock,
  type CsShowcaseEditor,
  type CsShowcaseTake,
} from '@/lib/customsites-sanity';
import { hotspotPosition } from './hotspot';

interface Props {
  block: CsDeviceShowcaseBlock;
}

/**
 * Copy beside one app screen, alternating sides down the page. The device
 * frame is drawn in CSS so the uploaded screen stays a clean 1:1 export with
 * no shadow or bezel baked in.
 *
 * With no screen uploaded the media column is dropped entirely and the copy
 * takes the full width. That is deliberate: a placeholder tile would imply the
 * screenshot exists, and there is no honest stand-in for a real app frame.
 *
 * `visual` picks what sits beside the copy: the uploaded screen (default), a
 * grid of take cards, or the "Edit take" mock panel. The last two are drawn
 * from authored strings and photos, so they stay illustrations, not captures.
 */
export function DeviceShowcaseBlock({ block }: Props) {
  const graphite = block.band === 'graphite';
  const sideClass = block.side === 'left' ? ' cs-showcase--left' : '';
  const visual = block.visual ?? 'screen';
  const takes = block.takes ?? [];
  const editor = block.editor ?? null;
  const hasScreen = Boolean(block.screenUrl);
  const hasMedia =
    visual === 'takes' ? takes.length > 0 : visual === 'editor' ? hasEditor(editor) : hasScreen;

  return (
    <section className={`cs-section cs-showcase${sideClass}${graphite ? ' cs-section--navy' : ''}`}>
      <div className="cs-container">
        <div className={`cs-showcase-grid${hasMedia ? '' : ' cs-showcase-grid--solo'}`}>
          <div className="cs-showcase-copy">
            {block.eyebrow ? (
              <p className={`cs-eyebrow${graphite ? ' cs-eyebrow--inverse' : ' cs-eyebrow--quiet'}`}>{block.eyebrow}</p>
            ) : null}
            <h2>{block.heading}</h2>
            {block.body ? <p>{block.body}</p> : null}
            {block.ctaLabel && block.ctaHref ? (
              <a className="cs-underline-link cs-underline-link--accent" href={block.ctaHref}>
                {block.ctaLabel}
              </a>
            ) : null}
          </div>
          {visual === 'takes' && takes.length > 0 ? (
            // One labelled image to assistive tech, like the editor panel: the
            // tile labels and lengths are app chrome, not content to read out.
            <div
              className="cs-showcase-media cs-showcase-media--takes"
              role="img"
              aria-label={block.caption ?? `A library of ${takes.length} recorded takes`}
            >
              <ul className="cs-takes">
                {takes.map((take) => (
                  <TakeCard key={take._key} take={take} />
                ))}
              </ul>
            </div>
          ) : null}
          {visual === 'editor' && editor && hasEditor(editor) ? (
            <EditorPanel editor={editor} caption={block.caption} />
          ) : null}
          {visual === 'screen' && hasScreen && block.screenUrl ? (
            <figure className="cs-showcase-media">
              <div className="cs-device">
                <Image
                  className="cs-device-screen"
                  src={csImageUrl(block.screenUrl, { w: 960 })}
                  alt={block.screenAlt ?? ''}
                  width={480}
                  height={678}
                  sizes="(max-width: 899px) 100vw, 480px"
                />
              </div>
              {block.caption ? <figcaption className="cs-device-caption">{block.caption}</figcaption> : null}
            </figure>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function hasEditor(editor?: CsShowcaseEditor | null): editor is CsShowcaseEditor {
  return Boolean(editor && (editor.title || editor.imageUrl || (editor.tracks && editor.tracks.length > 0)));
}

/** One take card. A plain card carries its label top and its length bottom; a
 *  photo card swaps the label for the flag pill ("Latest") since the picture
 *  already says which take it is. */
function TakeCard({ take }: { take: CsShowcaseTake }) {
  if (take.imageUrl) {
    return (
      <li className="cs-take cs-take--photo">
        <Image
          src={csImageUrl(take.imageUrl, { w: 400 })!}
          alt={take.imageAlt ?? take.label}
          fill
          sizes="(max-width: 639px) 22vw, 110px"
          style={{ objectFit: 'cover', objectPosition: hotspotPosition(take.imageHotspot) }}
        />
        <span className="cs-take-fade" aria-hidden="true" />
        {take.flag ? <span className="cs-take-flag">{take.flag}</span> : null}
        <span className="cs-take-duration">{take.duration}</span>
      </li>
    );
  }
  return (
    <li className="cs-take">
      <span className="cs-take-label">{take.label}</span>
      <span className="cs-take-duration">{take.duration}</span>
    </li>
  );
}

/**
 * The "Edit take" mock: a title row, the preview frame with its trim range,
 * the timeline (the clip being edited, then the title and photo tracks) and
 * the tool row. One labelled image to assistive tech, since every string in it
 * is app chrome.
 */
function EditorPanel({ editor, caption }: { editor: CsShowcaseEditor; caption?: string | null }) {
  const position = hotspotPosition(editor.imageHotspot);
  const tracks = editor.tracks ?? [];
  const tools = editor.tools ?? [];
  const imageStyle = { objectFit: 'cover' as const, objectPosition: position };
  return (
    <figure className="cs-showcase-media cs-showcase-media--editor">
      <div className="cs-editor" role="img" aria-label={editor.imageAlt ?? editor.title ?? undefined}>
        <div className="cs-editor-panel">
          <div className="cs-editor-head">
            {editor.title}
            {editor.timecode ? <span className="cs-editor-timecode">{editor.timecode}</span> : null}
          </div>
          <div className="cs-editor-preview">
            {editor.imageUrl ? (
              <Image
                src={csImageUrl(editor.imageUrl, { w: 960 })!}
                alt=""
                fill
                sizes="(max-width: 899px) 90vw, 440px"
                style={imageStyle}
              />
            ) : null}
            {editor.range ? <span className="cs-editor-range">{editor.range}</span> : null}
          </div>
          <div className="cs-editor-timeline">
            <div className="cs-editor-clip">
              {editor.imageUrl ? (
                <Image
                  src={csImageUrl(editor.imageUrl, { w: 480 })!}
                  alt=""
                  fill
                  sizes="260px"
                  style={imageStyle}
                />
              ) : null}
              {editor.clipLabel ? <span className="cs-editor-clip-label">{editor.clipLabel}</span> : null}
            </div>
            {tracks.map((track) => (
              <div key={track} className="cs-editor-track">
                {track}
              </div>
            ))}
          </div>
          {tools.length > 0 || editor.doneLabel ? (
            <div className="cs-editor-tools">
              {tools.map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
              {editor.doneLabel ? <span className="cs-editor-done">{editor.doneLabel}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {caption ? <figcaption className="cs-device-caption">{caption}</figcaption> : null}
    </figure>
  );
}
