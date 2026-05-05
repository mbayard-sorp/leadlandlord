import type { SchemaTypeDefinition } from 'sanity';
import { site } from './site.js';
import { page } from './page.js';
import { theme } from './theme.js';
import { siteDomain } from './site-domain.js';

export { site, page, theme, siteDomain };

export const schemaTypes: SchemaTypeDefinition[] = [site, page, theme, siteDomain];
