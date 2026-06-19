import { defineType, defineField } from 'sanity';
import { BUILDSELL_PRESETS, type BuildsellPreset } from './presets';

/**
 * Per-site palette + layout for a Build & Sell spec site. NOT a shared theme
 * document (R&R uses `theme` docs) — this is an inline object on each
 * `buildsellSite`, so every business recolors independently.
 *
 * The named `preset` is authoritative for COLORS at render time (resolved
 * against BUILDSELL_PRESETS in apps/site-host/lib/buildsell-theme.ts). The 8
 * per-doc hex fields below are a legacy fallback for docs whose preset name
 * predates the table. `layoutVariant` + fonts stay independent per-doc fields.
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
      options: { list: PRESET_NAMES },
      initialValue: seed.name,
    }),
    defineField({ name: 'primary', title: 'Primary', type: 'color', initialValue: { hex: seed.primary } as never }),
    defineField({ name: 'primaryDark', title: 'Primary Dark', type: 'color', initialValue: { hex: seed.primaryDark } as never }),
    defineField({ name: 'accent', title: 'Accent', type: 'color', initialValue: { hex: seed.accent } as never }),
    defineField({ name: 'onPrimary', title: 'On Primary', type: 'color', initialValue: { hex: seed.onPrimary } as never }),
    defineField({ name: 'bg', title: 'Background', type: 'color', initialValue: { hex: seed.bg } as never }),
    defineField({ name: 'surface', title: 'Surface', type: 'color', initialValue: { hex: seed.surface } as never }),
    defineField({ name: 'text', title: 'Text', type: 'color', initialValue: { hex: seed.text } as never }),
    defineField({ name: 'muted', title: 'Muted', type: 'color', initialValue: { hex: seed.muted } as never }),
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
