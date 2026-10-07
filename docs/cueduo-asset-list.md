# CueDuo: asset request for Design

Everything the built site asks for and does not yet have. Dimensions are what the
components actually request, not estimates: each one is traceable to a `next/image`
call or a Sanity field in `apps/site-host`.

Nothing on this list exists today. The site currently runs with a text wordmark in
the header, a CSS-drawn device illustration in the hero, and two showcase sections
that render copy at full width because they have no screen to show.

**Delivery:** everything except the App Store badge is uploaded to the matching
Sanity field in Studio (Custom Sites → CueDuo). Source files to Mike; the badge goes
into the repo by hand. Export at 2x where a pixel size is given - `next/image`
resizes down, never up.

---

## 1. Blocking: the site looks unfinished without these

| # | Asset | Size | Where it goes | Notes |
|---|---|---|---|---|
| 1 | **Logo lockup** | 140 × 28 pt (deliver SVG + 2x PNG) | `csSite.logo` | Mark plus "CueDuo" wordmark, horizontal. The header box is exactly 140 × 28 and uses `object-fit: contain`, left-aligned. Brand guide: lockup never below 96px wide, wordmark SF Pro Display Semibold at −2% tracking. The aperture must be a real cut-out so the porcelain header shows through, not a painted dot. |
| 2 | **Footer logo** | same as above | `csSite.footerLogo` | Can be the same file. If a one-ink version is wanted for the footer, supply it separately. |
| 3 | **Mark only** | square SVG, 48-unit grid | `csSite.logo` fallback / closing CTA band | The closing band renders the mark at 34 × 34 on graphite, so it needs the dark-background colourway: paper pane + Cobalt Bright pane, aperture cut to graphite. |
| 4 | **Half-open device render** | 1200 × 900, PNG on transparent | `csAppHeroBlock.device` | **The single biggest gap.** Three-quarter view, phone half open, both displays legible: outer screen showing the prompter mid-take, inner screen showing preflight. Loaded with `priority`, so it is the LCP element - keep it under ~250 KB. The prototype models the two screens separately and has nothing like this, so it has to be made (3D or photographed). Until it lands the hero falls back to a CSS illustration. |
| 5 | **Screen · library** | 480 × 678 at 2x (960 × 1356) | `csDeviceShowcaseBlock.screen`, home | Exported from the `library` screen of `CueDuo v2.dc.html`. **No bezel, no shadow, no device frame baked in** - the frame is drawn in CSS. Flat 1:1 export only. |
| 6 | **Screen · edit** | 480 × 678 at 2x | `csDeviceShowcaseBlock.screen`, home | From the `edit` screen. Sits on a graphite band, so check it still reads against `#0E1114`. |

## 2. Required before App Store submission

| # | Asset | Size | Where it goes | Notes |
|---|---|---|---|---|
| 7 | **Favicon** | 512 × 512 master | `csSite.favicon` | Sanity crops it to 32 × 32 and 180 × 180 automatically, so supply one square master that survives both. The brand guide's own check: at 16px the 6-unit aperture lands on 2px. Design flagged shipping a separate 32px PNG with the aperture nudged to 2.5px for pixel alignment - worth doing. |
| 8 | **Touch icon** | 180 × 180 | covered by #7 | Graphite tile, mark at 50% of tile width, optically centred, faint accent glow behind. Only needed separately if it should differ from the favicon crop. |
| 9 | **OG image** | 1200 × 630 | `csSite.ogImage` | Optional - there is already a generated fallback at `/cd/og` (porcelain, mark, "Look up. Say it once.", tagline). Supply a designed one only if it should beat the generated card. |
| 10 | **App Store badge** | 180 × 60 SVG | `apps/site-host/public/cueduo/app-store-badge.svg` | **Not a Design deliverable** - it is Apple's own asset, downloaded unmodified from Apple's marketing resources. Listed here so it is not forgotten. Never recoloured, redrawn, animated, or below 40px tall; clear space equal to a quarter of its height. The footer uses 160 × 54. |

## 3. Feature pages (five of them: prompter, recording, editing, library, export)

| # | Asset | Size | Where it goes | Notes |
|---|---|---|---|---|
| 11 | **Card image ×5** | 720 wide | `csPracticeArea.cardImage` | The `/features` index grid. Design's interior-pages comp shows these as screen stills on a tinted tile - one per feature. |
| 12 | **Hero image ×5** | 1200 wide, 16:9 or wider | `csPracticeArea.heroImage` | Optional. Doubles as the per-page OG image when set. Pages read fine without it. |
| 13 | **Screens for feature bodies** | 480 × 678 at 2x | `csDeviceShowcaseBlock` inside feature pages | Design's spec puts two showcases in each feature body. Source screens: `editor`, `preflight`, `recording` (outer, 380 × 800), `edit`, `library`, `share`. |

## 4. Not yet needed

Listed so Design does not produce them speculatively:

- **Photography.** The brand guide's direction is real people mid-sentence, candid, eye-level, neutral-cool grade, device in hand. No block on the site currently takes a photograph. Only commission this if a section is added that needs one.
- **Press logos, award badges, review screenshots.** No real coverage or attributed reviews exist, and this line does not ship placeholder social proof. The blocks render nothing when empty.
- **`csSite.bannerImage`.** `cueduo.css` hides `.cs-page-header-bg`, so interior page headers are deliberately typographic. Not needed unless that decision changes.

---

## Things Design should know before producing these

- **Every device screen must trace to a real frame in `CueDuo v2.dc.html`.** Nothing invented. If a screen the site needs does not exist in the prototype, say so rather than drawing new app UI - it becomes an app change, not an asset.
- **Screens export flat.** No device frame, no shadow, no rounded corners baked in. The chassis, radius and shadow are all CSS, and a baked frame will double up.
- **The aperture is always a cut-out.** Background shows through. Never a painted dot, at any size.
- **Lens left, lit pane right.** Always.
- **Record red only appears inside device screens**, as the recording dot and timer. It must never land on a porcelain surface - `#FF5257` is 2.79:1 there and fails.
- **Dark-background colourways are needed** for the mark anywhere it sits on graphite `#0E1114`: the closing CTA band and the 404.
- **Light mode only.** The site does not ship dark mode, so no dark-mode variants are needed beyond the graphite-background cases above.

## Open questions for Design

1. Should the header logo be the full lockup (mark + wordmark) or the mark alone beside live text? The 140 × 28 box assumes the full lockup; a mark-only logo wants a square box instead and a code change.
2. Is the half-open device render being made in 3D, photographed, or commissioned out? It gates the hero and has the longest lead time of anything here.
3. Does the footer want a one-ink logo variant, or the same file as the header?
