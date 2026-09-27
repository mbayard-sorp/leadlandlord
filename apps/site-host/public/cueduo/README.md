# CueDuo public assets

## `app-store-badge.svg` (required before the store CTA goes live)

`components/customsites/blocks/StoreBadge.tsx` renders `/cueduo/app-store-badge.svg`
whenever a `csAppHeroBlock` or `csAppCtaBlock` has `storeState: 'live'`.

The file is **not** committed, and must not be redrawn or recoloured. Download
the official "Download on the App Store" badge from Apple's marketing resources
and drop the unmodified SVG in beside this README.

Apple's guidelines that the site depends on:

- do not recolour, rotate, animate, add effects to, or redraw the badge;
- keep clear space around it equal to a quarter of its height;
- never render it below 40px tall (the site uses 180x60, and 160x54 in the footer);
- the badge is the only permitted "download" treatment. No home-made buttons.

While `storeState` is `soon` nothing here is used: the CTA is a plain ink pill
that is deliberately not a link.
