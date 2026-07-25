import Image from 'next/image';
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

/** Navy interior-page band: eyebrow + Spectral H1 + optional breadcrumb trail. */
export function PageHeader({ eyebrow, title, breadcrumbs, bannerImageUrl, bannerImageAlt, bannerReverse }: Props) {
  const hasBanner = Boolean(bannerImageUrl);

  const hasCrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);

  const bandClass = hasBanner
    ? `cs-page-header cs-page-header--banner${bannerReverse ? ' cs-page-header--banner-reverse' : ''}`
    : 'cs-page-header';

  return (
    <>
      <div className={bandClass}>
        {hasBanner ? (
          <div className="cs-page-header-bg">
            <Image
              src={bannerImageUrl!}
              alt={bannerImageAlt ?? ''}
              fill
              priority
              sizes="100vw"
              style={{ objectFit: 'cover', objectPosition: bannerReverse ? 'left top' : 'right top' }}
            />
          </div>
        ) : null}
        <div className="cs-container cs-page-header-inner">
          {eyebrow ? <span className="cs-eyebrow cs-eyebrow--inverse">{eyebrow}</span> : null}
          <h1>{title}</h1>
        </div>
      </div>
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
