import { defineType, defineField } from 'sanity';
import { BUILDSELL_PRESETS, type BuildsellPreset } from './presets';

/**
 * Per-site palette + layout for a Build & Sell spec site. NOT a shared theme
 * document (R&R uses `theme` docs) — this is an inline object on each
 * `buildsellSite`, so every business recolors independently.
 *
 * The named `preset` is authoritative for COLORS at render time (resolved
 * against BUILDSELL_PRESETS in apps/site-host/lib/buildsell-theme.ts). The 8
 * per-doc hex color fields were removed 2026-06-19 — colors are now 100%
 * preset-driven (all live docs already use a known preset). `layoutVariant` +
 * fonts stay independent per-doc fields.
 *
 * The preset table itself lives in ./presets (sanity-free) so site-host and
 * packages/agents can import it without pulling the Studio bundle.
 */

// Re-exported for back-compat — consumers historically imported these from here.
export { BUILDSELL_PRESETS };
export type { BuildsellPreset };

const PRESET_NAMES = BUILDSELL_PRESETS.map((p) => ({ title: p.name, value: p.name }));
const seed = BUILDSELL_PRESETS[0]!;

export const buildsellTheme = defineType({
  name: 'buildsellTheme',
  title: 'Theme',
  type: 'object',
  fields: [
    defineField({
      name: 'layoutVariant',
      title: 'Layout Variant',
      type: 'string',
      options: {
        layout: 'radio',
        list: [
          { title: 'Split', value: 'split' },
          { title: 'Bold', value: 'bold' },
          { title: 'Trust', value: 'trust' },
        ],
      },
      initialValue: seed.layoutVariant,
    }),
    defineField({
      name: 'preset',
      title: 'Preset',
      type: 'string',
      description: 'Authoritative for colors at render time (resolved against BUILDSELL_PRESETS). The per-doc hex color fields were removed 2026-06-19 — colors are 100% preset-driven.',
      options: { list: PRESET_NAMES },
      initialValue: seed.name,
    }),
    defineField({
      name: 'fontHeading',
      title: 'Heading Font',
      type: 'string',
      initialValue: seed.fontHeading,
      // options.list is a non-validated hint for the Studio dropdown — the enum is NOT closed.
      // New fonts can be added here without schema changes; the renderer must handle unknowns gracefully.
      options: {
        list: [
          { title: 'Poppins', value: 'Poppins' },
          { title: 'Sora', value: 'Sora' },
          { title: 'Space Grotesk', value: 'Space Grotesk' },
          { title: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
          { title: 'Fraunces', value: 'Fraunces' },
          { title: 'Manrope', value: 'Manrope' },
          { title: 'Inter', value: 'Inter' },
        ],
      },
    }),
    defineField({
      name: 'fontBody',
      title: 'Body Font',
      type: 'string',
      initialValue: seed.fontBody,
      // Same non-validated list. Enum is NOT closed — add new fonts without schema changes.
      options: {
        list: [
          { title: 'Inter', value: 'Inter' },
          { title: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
          { title: 'Space Grotesk', value: 'Space Grotesk' },
          { title: 'Poppins', value: 'Poppins' },
          { title: 'Sora', value: 'Sora' },
          { title: 'Manrope', value: 'Manrope' },
          { title: 'Fraunces', value: 'Fraunces' },
        ],
      },
    }),
  ],
});
