import type { SchemaTypeDefinition } from 'sanity';
import { site } from './site';
import { page } from './page';
import { theme } from './theme';
import { siteDomain } from './site-domain';

export { site, page, theme, siteDomain };

export const schemaTypes: SchemaTypeDefinition[] = [site, page, theme, siteDomain];
