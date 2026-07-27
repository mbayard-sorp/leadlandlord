import { ImageResponse } from 'next/og';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { fetchCustomSiteOgAttorney, csImageUrl } from '@/lib/customsites-sanity';

/**
 * Generated OG image fallback for constructionadrservices.com (ADR 0033).
 * Used by generateMetadata() across app/cadr/* only when csSite.ogImage (and
 * the per-page ogImage override) is unset — an explicit upload always wins,
 * this route never overrides one. Resolves the site per-request the same way
 * every other /cadr route does (resolveCurrentCustomSite reads the
 * `x-cs-site` header proxy.ts sets, with the `?cs=`/`ll_cs` dev fallback) —
 * nothing here is hardcoded to a single client.
 *
 * A file-convention `opengraph-image.tsx` was tried first but its output
 * gets appended alongside the `openGraph.images` array every leaf route
 * already sets via buildPageMetadata(), producing two competing og:image
 * tags. An explicit route referenced by URL from generateMetadata avoids
 * that collision.
 *
 * MUST NOT throw: a 500 here would break link-preview generation for the
 * whole page, not just drop the image. Every failure path (site not
 * resolved, attorney fetch fails, portrait fetch fails) falls through to a
 * plain navy card instead.
 */
export const runtime = 'nodejs';

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors styles/customsites/adr.css's --cs-* tokens (ImageResponse/Satori
// can't read CSS custom properties, so these are copied literals — keep in
// sync with adr.css if the palette ever changes).
const NAVY = '#1C3A5E';
const INK = '#13263C';
const PAPER = '#F7F4EF';
const BRASS = '#A9793B';
const BRASS_LIGHT = '#D3A55F';

const BACKGROUND = `linear-gradient(135deg, ${NAVY} 0%, ${INK} 100%)`;

// Source portrait is 445x593 (aspect ~0.75) — scale to this height and derive
// width from the same ratio so the face is never cropped or stretched.
const PORTRAIT_HEIGHT = 560;
const PORTRAIT_WIDTH = Math.round(PORTRAIT_HEIGHT * (445 / 593));

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
                lineHeight: 1.18,
                color: PAPER,
              }}
            >
              {site.name}
            </div>
            <div style={{ display: 'flex', width: 64, height: 4, background: BRASS, margin: '28px 0' }} />
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
                  borderRadius: 14,
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
