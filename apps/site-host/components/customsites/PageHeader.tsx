import Image from 'next/image';
import { csImageUrl } from '@/lib/customsites-sanity';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';

interface Crumb {
  name: string;
  /** Site-relative path, e.g. "/publications". */
  url: string;
}

interface Props {
  eyebrow?: string | null;
  title: string;
  breadcrumbs?: Crumb[];
  /** Wide banner behind the band. Subject sits right, copy centers over the dark left. */
  bannerImageUrl?: string | null;
  bannerImageAlt?: string | null;
  /** Set when the banner's subject sits on the LEFT: anchors the photo left and
   *  flips the scrim so the dark side falls on the right. */
  bannerReverse?: boolean;
}

/**
 * Navy interior-page band: eyebrow + Spectral H1 + optional breadcrumb trail.
 *
 * Every current caller falls back to `csSite.bannerImage` (the attorney
 * portrait) whenever its own page doesn't have a distinct banner authored,
 * which means the same photo repeats across every interior page a visitor
 * lands on in a row. There's no per-page banner field to key off beyond that
 * fallback, so this component resolves the site itself (React.cache-deduped,
 * free) and compares: a `bannerImageUrl` identical to `site.bannerImageUrl`
 * is treated as "no distinct banner" and gets a flat navy field with the
 * footer's skyline lockup as a decorative motif instead of the portrait. A
 * `bannerImageUrl` that differs (a genuinely page-specific photo, if one is
 * ever authored) still gets the original photo band with Phase 1's
 * directional scrim below, untouched.
 */
export async function PageHeader({ eyebrow, title, breadcrumbs, bannerImageUrl, bannerImageAlt, bannerReverse }: Props) {
  const site = await resolveCurrentCustomSite();
  const isDistinctBanner = Boolean(bannerImageUrl) && bannerImageUrl !== site?.bannerImageUrl;
  const hasCrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);

  return (
    <>
      {isDistinctBanner ? (
        <div className={`cs-page-header cs-page-header--banner${bannerReverse ? ' cs-page-header--banner-reverse' : ''}`}>
          <div className="cs-page-header-bg">
            <Image
              src={csImageUrl(bannerImageUrl!, { w: 2048 })}
              alt={bannerImageAlt ?? ''}
              fill
              priority
              sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: bannerReverse ? 'left top' : 'right top' }}
            />
          </div>
          <div className="cs-container cs-page-header-inner">
            {eyebrow ? <span className="cs-eyebrow cs-eyebrow--inverse">{eyebrow}</span> : null}
            <h1>{title}</h1>
          </div>
        </div>
      ) : (
        <div className="cs-page-header">
          {site?.footerLogoUrl ? (
            <span className="cs-page-header-skyline" aria-hidden="true">
              <Image
                src={site.footerLogoUrl}
                alt=""
                fill
                sizes="420px"
                style={{ objectFit: 'contain', objectPosition: 'right bottom' }}
              />
            </span>
          ) : null}
          <div className="cs-container cs-page-header-inner">
            {eyebrow ? <span className="cs-eyebrow cs-eyebrow--inverse">{eyebrow}</span> : null}
            <h1>{title}</h1>
          </div>
        </div>
      )}
      {/* The trail always sits in a light bar directly below the header band,
          whether or not the band carries a banner photo. */}
      {hasCrumbs ? (
        <div className="cs-breadcrumb-bar">
          <div className="cs-container">
            <Breadcrumbs items={breadcrumbs!} />
          </div>
        </div>
      ) : null}
    </>
  );
}
