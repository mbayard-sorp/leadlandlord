import { buildsellObjectTypes } from './objects';
import { buildsellSectionTypes } from './sections';
import { buildsellTheme } from './theme';
import { bsReview } from './review';
import { buildsellSite } from './buildsell-site';

export * from './objects';
export * from './sections';
export { buildsellTheme } from './theme';
export { BUILDSELL_PRESETS, BUILDSELL_PRESET_NAMES, presetByName } from './presets';
export type { BuildsellPreset } from './presets';
export { bsReview } from './review';
export { buildsellSite } from './buildsell-site';

// bsFaqItem must be registered before bsFaqSection (which has an array of it).
import { bsFaqItem } from './sections';

/** All Build & Sell schema types, ready to spread into `schemaTypes`. */
export const buildsellSchemaTypes = [
  ...buildsellObjectTypes,
  buildsellTheme,
  bsFaqItem,
  ...buildsellSectionTypes,
  bsReview,
  buildsellSite,
];
