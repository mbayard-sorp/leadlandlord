import { defineType, defineField } from 'sanity';

/**
 * Per-site palette + layout for a Build & Sell spec site. NOT a shared theme
 * document (R&R uses `theme` docs) — this is an inline object on each
 * `buildsellSite`, so every business recolors independently.
 *
 * The 8 colors map 1:1 to CSS custom properties (`--bs-primary`, …) on the
 * site-host root. `layoutVariant` switches between three layout treatments of
 * identical content (reduces cross-site footprint similarity).
 */

export interface BuildsellPreset {
  name: string;
  layoutVariant: 'split' | 'bold' | 'trust';
  primary: string;
  primaryDark: string;
  accent: string;
  onPrimary: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  fontHeading: string;
  fontBody: string;
}

/** 12 named presets seeded from the claude.ai/design palette set. */
export const BUILDSELL_PRESETS: BuildsellPreset[] = [
  { name: 'Aqua Slate', layoutVariant: 'split', primary: '#0e7490', primaryDark: '#155e75', accent: '#f59e0b', onPrimary: '#ffffff', bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', fontHeading: 'Poppins', fontBody: 'Inter' },
  { name: 'Forest Trust', layoutVariant: 'trust', primary: '#15803d', primaryDark: '#166534', accent: '#ca8a04', onPrimary: '#ffffff', bg: '#f7faf7', surface: '#ffffff', text: '#14201a', muted: '#5b6b60', fontHeading: 'Sora', fontBody: 'Inter' },
  { name: 'Midnight Bold', layoutVariant: 'bold', primary: '#4f46e5', primaryDark: '#3730a3', accent: '#f43f5e', onPrimary: '#ffffff', bg: '#0b1020', surface: '#161d33', text: '#f1f5f9', muted: '#94a3b8', fontHeading: 'Space Grotesk', fontBody: 'Inter' },
  { name: 'Sunset Clay', layoutVariant: 'split', primary: '#c2410c', primaryDark: '#9a3412', accent: '#0891b2', onPrimary: '#ffffff', bg: '#fff8f4', surface: '#ffffff', text: '#1c1917', muted: '#78716c', fontHeading: 'Fraunces', fontBody: 'Inter' },
  { name: 'Royal Navy', layoutVariant: 'trust', primary: '#1d4ed8', primaryDark: '#1e3a8a', accent: '#eab308', onPrimary: '#ffffff', bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', fontHeading: 'Manrope', fontBody: 'Inter' },
  { name: 'Crimson Pro', layoutVariant: 'bold', primary: '#be123c', primaryDark: '#9f1239', accent: '#0d9488', onPrimary: '#ffffff', bg: '#fff7f8', surface: '#ffffff', text: '#1a1115', muted: '#7c6068', fontHeading: 'Sora', fontBody: 'Inter' },
  { name: 'Emerald Frost', layoutVariant: 'split', primary: '#059669', primaryDark: '#047857', accent: '#7c3aed', onPrimary: '#ffffff', bg: '#f6fdfa', surface: '#ffffff', text: '#0c1f18', muted: '#5b7268', fontHeading: 'Poppins', fontBody: 'Inter' },
  { name: 'Graphite Amber', layoutVariant: 'bold', primary: '#334155', primaryDark: '#1e293b', accent: '#f59e0b', onPrimary: '#ffffff', bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', fontHeading: 'Space Grotesk', fontBody: 'Inter' },
  { name: 'Coastal Teal', layoutVariant: 'trust', primary: '#0d9488', primaryDark: '#0f766e', accent: '#f97316', onPrimary: '#ffffff', bg: '#f5fbfb', surface: '#ffffff', text: '#0d1b1a', muted: '#5a6f6d', fontHeading: 'Manrope', fontBody: 'Inter' },
  { name: 'Violet Studio', layoutVariant: 'split', primary: '#7c3aed', primaryDark: '#6d28d9', accent: '#10b981', onPrimary: '#ffffff', bg: '#faf8ff', surface: '#ffffff', text: '#1a1430', muted: '#6b6486', fontHeading: 'Fraunces', fontBody: 'Inter' },
  { name: 'Brick Trust', layoutVariant: 'trust', primary: '#b45309', primaryDark: '#92400e', accent: '#0e7490', onPrimary: '#ffffff', bg: '#fdfaf6', surface: '#ffffff', text: '#1f1812', muted: '#766656', fontHeading: 'Sora', fontBody: 'Inter' },
  { name: 'Steel Sky', layoutVariant: 'bold', primary: '#0284c7', primaryDark: '#0369a1', accent: '#f43f5e', onPrimary: '#ffffff', bg: '#f6fafd', surface: '#ffffff', text: '#0c1a26', muted: '#5c6f7d', fontHeading: 'Space Grotesk', fontBody: 'Inter' },
];

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
    defineField({ name: 'fontHeading', title: 'Heading Font', type: 'string', initialValue: seed.fontHeading }),
    defineField({ name: 'fontBody', title: 'Body Font', type: 'string', initialValue: seed.fontBody }),
  ],
});
