import type { SchemaTypeDefinition } from 'sanity';
import { site } from './site';
import { page } from './page';
import { theme } from './theme';
import { siteDomain } from './site-domain';
import { corporateSite } from './corporate-site';
import { corporatePage } from './corporate-page';
import { keywordCluster } from './keyword-cluster';

export { site, page, theme, siteDomain, corporateSite, corporatePage, keywordCluster };

export const schemaTypes: SchemaTypeDefinition[] = [
  site,
  page,
  theme,
  siteDomain,
  corporateSite,
  corporatePage,
  keywordCluster,
];
