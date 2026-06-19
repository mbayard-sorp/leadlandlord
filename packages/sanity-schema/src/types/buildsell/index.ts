import { buildsellObjectTypes } from './objects';
import { buildsellSectionTypes } from './sections';
import { buildsellTheme, BUILDSELL_PRESETS } from './theme';
import { bsReview } from './review';
import { buildsellSite } from './buildsell-site';

export * from './objects';
export * from './sections';
export { buildsellTheme, BUILDSELL_PRESETS } from './theme';
export type { BuildsellPreset } from './theme';
export { bsReview } from './review';
export { buildsellSite } from './buildsell-site';

/** All Build & Sell schema types, ready to spread into `schemaTypes`. */
export const buildsellSchemaTypes = [
  ...buildsellObjectTypes,
  buildsellTheme,
  ...buildsellSectionTypes,
  bsReview,
  buildsellSite,
];
