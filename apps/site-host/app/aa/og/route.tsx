import { ImageResponse } from 'next/og';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteOgAttorney, csImageUrl } from '@/lib/customsites-sanity';

/**
 * Generated OG image fallback for alignedadvisors.com (Custom Sites site #2).
 * Used via csOgFallbackImage() only when csSite.ogImage (and any per-page
 * override) is unset — an explicit upload always wins. Same must-not-throw
 * contract as app/cadr/og/route.tsx: every failure path falls through to a
 * plain navy card rather than a 500 that breaks link-preview generation.
 */
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors styles/customsites/aa.css's --cs-* tokens (ImageResponse/Satori
// can't read CSS custom properties, so these are copied literals — keep in
// sync with aa.css if the palette ever changes).
const NAVY = '#123152';
const INK = '#0A1D30';
const PAPER = '#FAF8F4';
const BRASS = '#C08A2E';
const BRASS_LIGHT = '#DDAE4F';

const BACKGROUND = `linear-gradient(135deg, ${NAVY} 0%, ${INK} 100%)`;

// Team portraits are 4:5 (1200x1500 per the asset spec) — derive width from
// the same ratio so the face is never cropped or stretched.
const PORTRAIT_HEIGHT = 540;
const PORTRAIT_WIDTH = Math.round(PORTRAIT_HEIGHT * (4 / 5));

function blankCard(): ImageResponse {
  return new ImageResponse(<div style={{ width: WIDTH, height: HEIGHT, display: 'flex', background: BACKGROUND }} />, {
    width: WIDTH,
    height: HEIGHT,
  });
}

/** Fetches the portrait and inlines it as a data URL so Satori doesn't have
 * to perform its own remote fetch mid-render (and so a failed fetch can be
 * caught here rather than throwing out of ImageResponse). */
async function fetchPortraitDataUrl(photoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(csImageUrl(photoUrl, { w: 600, q: 80 }));
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const buf = await res.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

export async function GET(): Promise<ImageResponse> {
  try {
    const site = await resolveCurrentCustomSite();
    if (!site) return blankCard();

    const attorney = await fetchCustomSiteOgAttorney(site.siteKey).catch(() => null);
    const portraitDataUrl = attorney?.photoUrl ? await fetchPortraitDataUrl(attorney.photoUrl) : null;
    const subtitle = site.tagline ?? attorney?.jobTitle ?? null;

    return new ImageResponse(
      (
        <div
          style={{
            width: WIDTH,
            height: HEIGHT,
            display: 'flex',
            alignItems: 'center',
            background: BACKGROUND,
            fontFamily: 'sans-serif',
            borderTop: `6px solid ${BRASS}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              padding: '0 40px 0 72px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 54,
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: '-1px',
                color: PAPER,
              }}
            >
              {site.name}
            </div>
            <div style={{ display: 'flex', width: 64, height: 3, background: BRASS, margin: '28px 0' }} />
            {subtitle ? (
              <div style={{ display: 'flex', fontSize: 28, fontWeight: 500, color: BRASS_LIGHT }}>{subtitle}</div>
            ) : null}
          </div>

          {portraitDataUrl ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingRight: 72,
              }}
            >
              <img
                src={portraitDataUrl}
                width={PORTRAIT_WIDTH}
                height={PORTRAIT_HEIGHT}
                style={{
                  borderRadius: 4,
                  objectFit: 'cover',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                }}
              />
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
