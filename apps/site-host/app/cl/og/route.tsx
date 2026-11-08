import { ImageResponse } from 'next/og';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';

/**
 * Generated OG image fallback for cuelit.app (Custom Sites site #3). Used via
 * csOgFallbackImage() only when csSite.ogImage (and any per-page override) is
 * unset — an explicit upload always wins. Same must-not-throw contract as
 * app/cadr/og/route.tsx and app/aa/og/route.tsx: every failure path falls
 * through to a plain card rather than a 500 that breaks link previews.
 *
 * Cream, ink and one lit thing, per the Cuelit brand guide: the lens mark,
 * the name and the promise. Satori has no Fraunces here (no font fetch on
 * this must-not-throw path), so the name is set in the default sans; an
 * uploaded csSite.ogImage built from the wordmark files always wins.
 */
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors styles/customsites/cuelit.css's --cs-* tokens. ImageResponse/Satori
// can't read CSS custom properties, so these are copied literals. Keep them
// in sync with cuelit.css if the palette ever changes.
const CREAM = '#FFF8E7';
const INK = '#1E1B1A';
const MUTED = '#6E655E';
const LIT = '#FF6A3D';
const GLASS = '#0B0F14';
const ELEMENT = '#3A4357';

function blankCard(): ImageResponse {
  return new ImageResponse(<div style={{ width: WIDTH, height: HEIGHT, display: 'flex', background: CREAM }} />, {
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
            background: CREAM,
            fontFamily: 'sans-serif',
            padding: '0 88px',
          }}
        >
          {/* The full lens mark, guide proportions on a 1024 grid. */}
          <svg width={88} height={88} viewBox="0 0 1024 1024" style={{ marginBottom: 44 }}>
            <circle cx="512" cy="512" r="330" fill={LIT} />
            <circle cx="512" cy="512" r="226" fill={GLASS} />
            <circle cx="512" cy="512" r="130" fill={ELEMENT} />
            <circle cx="512" cy="512" r="60" fill={GLASS} />
            <circle cx="446" cy="440" r="42" fill="#FFFFFF" />
          </svg>

          <div
            style={{
              display: 'flex',
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-2px',
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
