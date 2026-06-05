# Core Web Vitals — Site Template Spec Audit

**Date:** 2026-06-05
**Scope:** `apps/site-host` template source — the 6 variant components (`classic`, `modern`, `premium`, `bright`, `haul`, `counsel`), the shared root layout, font loader, image config, and shared components.
**Goal:** Validate that every template *ships the specifications required to earn* good Core Web Vitals (LCP, CLS, INP) in Google Search Console / CrUX — independent of which tenant deploys it.

This is a **source-level** audit. It is complementary to the existing runtime `lighthouse-audit` agent ([`packages/agents/src/lighthouse-audit/index.ts`](packages/agents/src/lighthouse-audit/index.ts)), which scores *deployed* sites via PageSpeed Insights. Runtime audits tell you a live site scored badly; this audit tells you whether the template *could* score well before a site is ever built.

> CrUX / Search Console CWV is **field data**, weighted to mobile, and LCP includes TTFB. A template can be locally "perfect" in Lighthouse lab mode and still fail field CWV if TTFB or font/image delivery regresses under real conditions. The gaps below are ordered by field-CWV impact.

---

## 1. Scorecard — per-variant LCP/CLS/INP specs

Legend: ✅ spec present · ⚠️ present but suboptimal · ❌ missing

| Spec (the thing that earns the vital) | Classic | Modern | Premium | Bright | Haul | Counsel |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **LCP** hero via `next/image` (not raw `<img>`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **LCP** hero `priority` + `fetchPriority="high"` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **LCP** responsive `sizes` matches rendered box | ✅ | ✅ | ⚠️ `100vw` | ⚠️ `280px` | ✅ | ✅ |
| **CLS** hero container has reserved space (min-height / aspect) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **CLS** logo has explicit `width`/`height` | ✅ 28 | ✅ 30 | ✅ 32 | ✅ 44 | ✅ 44 | ✅ 44 |
| **CLS** below-fold images dimensioned | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **INP** no heavy client JS in variant | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Per-variant LCP image refs:** Classic [`Classic.tsx:131`](apps/site-host/components/variants/Classic.tsx#L131), Modern [`Modern.tsx:121`](apps/site-host/components/variants/Modern.tsx#L121), Premium [`Premium.tsx:98`](apps/site-host/components/variants/Premium.tsx#L98), Bright [`Bright.tsx:194`](apps/site-host/components/variants/Bright.tsx#L194), Haul [`Haul.tsx:173`](apps/site-host/components/variants/Haul.tsx#L173), Counsel [`Counsel.tsx:132`](apps/site-host/components/variants/Counsel.tsx#L132).

**Takeaway:** Per-variant LCP/CLS/INP fundamentals are **solid and consistent**. Every template gets the hero priority hint, dimensioned media, and reserved layout space right. The real exposure is at the **global / shared layer**, where every variant inherits the same defects.

---

## 2. Global findings (apply to ALL variants)

### G1 — All 11 font families load + preload on every page  🔴 HIGH
[`lib/fonts.ts:108`](apps/site-host/lib/fonts.ts#L108) joins all 11 `next/font` variables into `allFontVars`, and [`app/layout.tsx:72`](apps/site-host/app/layout.tsx#L72) attaches the whole string to `<html className={allFontVars}>`.

`next/font` treats a font as "used" when its variable class is mounted, so it emits a `<link rel="preload" as="font">` for **all 11 families on every page** — even though a given site renders exactly one variant needing **2–3** families. That's ~8 extra preloaded font files competing for bandwidth against the LCP image on first paint, plus extra `@font-face` CSS.

- **Vital hit:** LCP (preload contention), FCP, transfer size on mobile.
- **Why it exists:** convenience — one root class lets every `themes/*.css` reference `--font-display` / `--font-body` without per-variant wiring.

### G2 — Pages render fully dynamic (per-request SSR)  🟠 MEDIUM
No page exports `revalidate`/ISR; only [`sitemap.ts:57`](apps/site-host/app/sitemap.ts#L57) and `llms.txt` do. [`next.config.ts:62`](apps/site-host/next.config.ts#L62) documents that Cache Components is intentionally **off** because the layout reads `headers()` at the top for per-host routing, so every page is dynamic. Sanity + tracking-number reads are wrapped in `unstable_cacheTag`/`cacheLife`, which softens it — **but the page shell itself is computed per request.**

- **Vital hit:** TTFB → folds directly into field LCP. A cold/uncached request pushes LCP out regardless of how optimized the image is.
- **Note:** This is a known, deliberate Phase-B tradeoff (Track C / Phase 7 is slated to revisit Cache Components). Flagging it because field CWV cannot be fully "delivered" by the template until TTFB is bounded. Verify cache-hit rates in prod before treating it as solved.

### G3 — AVIF not enabled in image optimizer  🟠 MEDIUM
[`next.config.ts:54`](apps/site-host/next.config.ts#L54) sets `remotePatterns` but no `images.formats`. Next defaults to WebP only; AVIF is opt-in. Hero images are the LCP element on every variant — AVIF typically cuts hero bytes 20–40% vs WebP.

- **Vital hit:** LCP byte size on every page.
- **Cost:** AVIF encode is more CPU on the optimizer (first-request latency); mitigated by Vercel's image cache after first hit.

### G4 — No preconnect to the true LCP fetch origin  🟡 LOW
[`app/layout.tsx:74`](apps/site-host/app/layout.tsx#L74) preconnects `cdn.sanity.io`. But hero images go through `next/image`, so the **browser** fetches the LCP image same-origin from `/_next/image` — the Sanity preconnect does **not** accelerate it (it only helps the favicon, which references Sanity directly, and the optimizer's server-side origin fetch). The `priority` preload already covers the LCP image, so impact is small, but the hint is misallocated and worth correcting/documenting.

### G5 — No `viewport` export / `theme-color`  🟡 LOW
No `generateViewport`/`viewport` export and no `<meta name="theme-color">` anywhere ([`app/layout.tsx`](apps/site-host/app/layout.tsx)). Next supplies a default responsive viewport, so this is **not** a core-vital failure — it's a Lighthouse best-practices/PWA-polish and mobile-chrome UX gap.

### G6 — Global CSS bundle ships all 6 variants' styles on every page  🟡 LOW
`app/globals.css` imports all 6 theme + 6 variant CSS files into one render-blocking bundle (~31KB gz). Each page uses one variant. Render-blocking CSS delays FCP/LCP slightly. Low priority given the absolute size, but it compounds with G1.

---

## 3. Corrections to common assumptions (verified NOT gaps)

- **`StickyMobileBar` is not a CLS risk.** It's a pure server component rendered in the initial HTML and is `position: fixed` (out of normal flow), so it cannot shift content. [`StickyMobileBar.tsx:27`](apps/site-host/components/shared/StickyMobileBar.tsx#L27).
- **Fonts already use `display: swap`** on all 11 families — no FOIT. `next/font` also applies size-adjust fallback metrics automatically, keeping font-swap CLS low. [`lib/fonts.ts`](apps/site-host/lib/fonts.ts).
- **Below-the-fold media is dimensioned and lazy** across all variants (gallery, secondary images, video `loading="lazy"` + `aspect-ratio` box) — no below-fold CLS.
- **GA4 loads `afterInteractive`** and CWV reporting uses `sendBeacon` — neither blocks INP. [`app/layout.tsx:84`](apps/site-host/app/layout.tsx#L84).
- **First-party field telemetry already exists** via `WebVitalsReporter` → `/api/cwv`, so you can measure the impact of any fix against real CrUX-style data. [`app/layout.tsx:98`](apps/site-host/app/layout.tsx#L98).

---

## 4. Gap ledger — ranked by value

Value = field-CWV impact × breadth (all sites) ÷ effort.

| # | Gap | Vital | Impact | Effort | Value |
|---|---|---|:--:|:--:|:--:|
| **G1** | Load/preload only the active variant's fonts | LCP/FCP | High | M | **Highest** |
| **G3** | Enable AVIF (`images.formats`) | LCP | Med-High | XS | **High** |
| **G2** | Bound TTFB (cache-hit verification / Cache Components in Track C) | LCP(TTFB) | High | L | High (already roadmapped) |
| **G6** | Split CSS so a page ships only its variant | FCP/LCP | Low-Med | M | Medium |
| **G4** | Fix/relocate preconnect to real LCP origin | LCP | Low | XS | Low |
| **G5** | Add `viewport` export + `theme-color` | (best-practices) | Low | XS | Low |
| **—** | Premium `sizes="100vw"` / Bright `sizes="280px"` review | LCP | Low | XS | Low |

### Quick wins (XS effort, ship today)
- **G3:** add `images.formats: ['image/avif', 'image/webp']` to [`next.config.ts:54`](apps/site-host/next.config.ts#L54).
- **G5:** add a `viewport` export with `themeColor` keyed off the active palette.
- **G4:** drop the Sanity preconnect from the critical path (or move to where it helps — favicon), since `priority` already preloads the hero.

### Highest-value project (M effort)
- **G1:** make font loading variant-aware. Either gate the `className` on `<html>` to only the active theme's font variables, or set `preload: false` on non-default families and `preload: true` only on the resolved variant's fonts. Removes ~8 competing font preloads per page across the entire fleet. Validate the win against `/api/cwv` LCP before/after.

### Strategic (L effort, already on the roadmap)
- **G2:** the per-request dynamic render is the ceiling on field LCP. Track C / Phase 7's Cache Components work is the right home; this audit just confirms it's the dominant remaining lever once G1/G3 land.

---

## 5. Suggested next step

If you want this enforced over time rather than as a one-shot doc, the natural follow-up is a **template-spec auditor** (static check over the variant source, matching the `content-data-auditor` / `geo-aeo-auditor` pattern in `packages/agents/src/`) that fails CI when a variant drops `priority`, an image loses its dimensions, a raw `<img>` is introduced, or a new font is added without variant-gating. That keeps the per-variant scorecard in §1 green permanently.
