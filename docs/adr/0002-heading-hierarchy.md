# ADR 0002 — Heading hierarchy: promote sr-only home H1

**Date:** 2026-05-11  
**Status:** Accepted

---

## Context

All four variant home-page components follow the same pattern today:

```tsx
<h1 className="sr-only">{literalH1}</h1>   // screen-reader only
…
<h2 id="hero-h1" className="[variant]-h1">  // visually prominent but semantically H2
```

Classic: lines 49, 73 — `Classic.tsx`  
Modern: lines 51, 117 — `Modern.tsx`  
Bright: lines 92, 148 — `Bright.tsx`  
Premium: lines 59, 102 — `Premium.tsx`

The hero element carries the main keyword phrase but is typed `<h2>`. The actual `<h1>` is invisible. This is a crawlability and ranking signal gap: Google's quality rater guidelines treat the visible heading hierarchy as a trust indicator, and the `<h2>` with `.classic-h1` / `.premium-h1` CSS class names is not a substitute for correct semantics.

Sub-pages (`app/services/[slug]`, `app/service-areas/[slug]`, `app/blog/[slug]`, etc.) already render a visible `<h1>`. The gap is home pages only.

## Decision

On the home page of every variant:

1. Remove the `<h1 className="sr-only">` element.
2. Promote the hero heading from `<h2>` → `<h1>`. Retain its existing `id`, className, and content unchanged.
3. All other section headings stay `<h2>`. One `<h1>` per page; no exceptions.

Per-variant specifics:

| Variant | Current hero element | After change |
|---------|---------------------|--------------|
| Classic | `<h2 id="hero-h1" className="classic-h1">` (line 73) | `<h1 id="hero-h1" className="classic-h1">` |
| Modern  | `<h2 id="hero-h1" className="modern-h1">` (line 117) | `<h1 id="hero-h1" className="modern-h1">` |
| Bright  | `<h2 id="hero-h1" className="bright-h1">` (line 148) | `<h1 id="hero-h1" className="bright-h1">` |
| Premium | `<h2 id="hero-h1" className="premium-h1">` (line 102) | `<h1 id="hero-h1" className="premium-h1">` |

The `aria-labelledby="hero-h1"` on the wrapping `<section>` is retained; the `id` moves from the `<h2>` to the `<h1>` — no accessibility regression.

The existing eyebrow `<p>` elements above the hero headings (`classic-eyebrow`, `modern-eyebrow`, `bright-eyebrow`, `premium-hero-eyebrow`) are **not changed** — they are already `<p>` tags, which is correct. No new markup is added; this is a tag-name change only.

## Consequences

- **Zero visual change.** The CSS class names that drive size and weight stay identical. The heading level change is semantic only.
- **One `<h1>` per page invariant.** Sub-pages already have a visible `<h1>` in their page components; this change does not affect them.
- **`aria-labelledby` still valid.** The `id="hero-h1"` attribute moves to the `<h1>` — the section's landmark label is preserved.
- **Phase 5 QA gate.** Screenshot diff must confirm no visual change. The render-when-present snapshot test (ADR 0003) covers the home-page baseline.

**Files to touch (Phase 2f):**
- `apps/site-host/components/variants/Classic.tsx` — lines 49, 73–77
- `apps/site-host/components/variants/Modern.tsx` — lines 51, 117–119
- `apps/site-host/components/variants/Bright.tsx` — lines 92, 148–150
- `apps/site-host/components/variants/Premium.tsx` — lines 59, 102–106
