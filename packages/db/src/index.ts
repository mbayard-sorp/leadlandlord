export * from './schema';
export * from './client';
export * from './queue';
export * from './suppression';
export * from './system-state';
export * from './email-throttle';

// Re-export drizzle helpers so consumers use the SAME drizzle-orm copy that
// the schema's PgColumn types are typed against. pnpm's peer-dep resolution
// otherwise installs two structurally-identical drizzle-orm copies for
// different peer contexts (operator app vs @leadlandlord/db), and TypeScript
// rejects mixing types across the two copies — see "Types have separate
// declarations of a private property 'shouldInlineParams'" build errors.
export { eq, and, or, not, sql, desc, asc, gt, gte, lt, lte, ne, isNull, isNotNull, inArray, notInArray, like, ilike, between } from 'drizzle-orm';
