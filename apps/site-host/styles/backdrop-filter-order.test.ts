import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Lightning CSS (Turbopack's CSS minifier, and Tailwind's optimizer) treats
// the -webkit- prefixed and unprefixed backdrop filter as one property. When
// the prefixed form comes last in a block it wins and the unprefixed
// declaration is dropped from the build, so Chrome, Edge and Firefox get no
// blur at all. Prefixed first, unprefixed last keeps both.
//
// The property name is assembled at runtime: Tailwind scans this file for
// class candidates, and the literal name would generate an unused utility.
const PROP = ['backdrop', 'filter'].join('-');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

describe(`${PROP} declaration order`, () => {
  const root = __dirname;
  const unprefixedDecl = new RegExp(`(?<![-\\w])${PROP}\\s*:`);
  const prefixedDecl = new RegExp(`-webkit-${PROP}\\s*:`);

  it.each(cssFiles(root).map((file) => [relative(root, file), file]))(
    '%s declares the -webkit- form before the unprefixed one',
    (_name, file) => {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // Declaration bodies only: the text after the last `{` of each block,
      // so an `@supports (...)` condition never reads as a declaration.
      const offenders = css
        .split('}')
        .map((block) => block.slice(block.lastIndexOf('{') + 1))
        .filter((block) => {
          const unprefixed = block.search(unprefixedDecl);
          const prefixed = block.search(prefixedDecl);
          return unprefixed !== -1 && prefixed > unprefixed;
        })
        .map((block) => block.trim().replace(/\s+/g, ' '));
      expect(offenders).toEqual([]);
    },
  );
});
