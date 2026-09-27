import { ImageResponse } from 'next/og';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';

/**
 * Generated OG image fallback for cueduo.com (Custom Sites site #3). Used via
 * csOgFallbackImage() only when csSite.ogImage (and any per-page override) is
 * unset — an explicit upload always wins. Same must-not-throw contract as
 * app/cadr/og/route.tsx and app/aa/og/route.tsx: every failure path falls
 * through to a plain card rather than a 500 that breaks link previews.
 *
 * Porcelain rather than the dark gradient sites #1 and #2 use, per the design:
 * the OG card is the wordmark and the promise, no device and no portrait.
 * CueDuo has no csAttorney documents, so there is no portrait branch at all.
 */
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors styles/customsites/cueduo.css's --cs-* tokens. ImageResponse/Satori
// can't read CSS custom properties, so these are copied literals — keep them
// in sync with cueduo.css if the palette ever changes.
const PORCELAIN = '#EEF0F3';
const INK = '#14171C';
const MUTED = '#5B626E';
const COBALT = '#2E5BFF';

function blankCard(): ImageResponse {
  return new ImageResponse(<div style={{ width: WIDTH, height: HEIGHT, display: 'flex', background: PORCELAIN }} />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

export async function GET(): Promise<ImageResponse> {
  try {
    const site = await resolveCurrentCustomSite();
    if (!site) return blankCard();

    const subtitle = site.tagline ?? null;

    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            background: PORCELAIN,
            fontFamily: 'sans-serif',
            padding: '0 88px',
          }}
        >
          {/* The fold mark: two panes at a hinge, aperture cut out of the left
              pane. Satori has no <mask> support, so the aperture is filled
              with the page background instead of being a true cut-out — it is
              visually identical on this fixed porcelain card. */}
          <svg width={72} height={72} viewBox="0 0 48 48" style={{ marginBottom: 44 }}>
            <path
              d="M8 12.5c0-1.6 1.2-2.9 2.8-3L22 8.4c.8-.1 1.4.5 1.4 1.3v28.6c0 .8-.6 1.4-1.4 1.3l-11.2-1.1C9.2 38.4 8 37.1 8 35.5z"
              fill={INK}
            />
            <path
              d="M40 12.5c0-1.6-1.2-2.9-2.8-3L26 8.4c-.8-.1-1.4.5-1.4 1.3v28.6c0 .8.6 1.4 1.4 1.3l11.2-1.1c1.6-.1 2.8-1.4 2.8-3z"
              fill={COBALT}
            />
            <circle cx="14.5" cy="15.5" r="3" fill={PORCELAIN} />
          </svg>

          <div
            style={{
              display: 'flex',
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: '-3px',
              color: INK,
            }}
          >
            {site.seo?.metaTitle?.includes('|') ? site.seo.metaTitle.split('|')[1]!.trim() : site.name}
          </div>

          {subtitle ? (
            <div
              style={{
                display: 'flex',
                marginTop: 28,
                fontSize: 30,
                fontWeight: 400,
                color: MUTED,
                maxWidth: 820,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      ),
      { width: WIDTH, height: HEIGHT },
    );
  } catch {
    return blankCard();
  }
}
