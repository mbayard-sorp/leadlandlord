import type { SchemaTypeDefinition } from 'sanity';
import { site } from './site';
import { page } from './page';
import { theme } from './theme';
import { siteDomain } from './site-domain';
import { corporateSite } from './corporate-site';
import { corporatePage } from './corporate-page';
import { keywordCluster } from './keyword-cluster';
import { review } from './review';
import { buildsellSchemaTypes } from './buildsell';
import { customSitesSchemaTypes } from './customsites';

export { site, page, theme, siteDomain, corporateSite, corporatePage, keywordCluster, review };
export * from './buildsell';
export * from './customsites';

export const schemaTypes: SchemaTypeDefinition[] = [
  site,
  page,
  theme,
  siteDomain,
  corporateSite,
  corporatePage,
  keywordCluster,
  review,
  // Build & Sell (B&S) — every type is bs-prefixed; cannot collide with R&R above.
  ...(buildsellSchemaTypes as SchemaTypeDefinition[]),
  // Custom Sites (CS) — every type is cs-prefixed; cannot collide with R&R/B&S above.
  ...(customSitesSchemaTypes as SchemaTypeDefinition[]),
];
