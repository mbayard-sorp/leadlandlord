import { describe, expect, it } from 'vitest';
import { csDedupeBrandedTitle } from './customsites-metadata';

describe('csDedupeBrandedTitle', () => {
  it('makes a title that already names the site absolute, so the template skips it', () => {
    const meta = csDedupeBrandedTitle({ title: 'Keep every take, lose none | CueDuo' }, 'CueDuo');
    expect(meta.title).toEqual({ absolute: 'Keep every take, lose none | CueDuo' });
  });

  it('leaves an unbranded title for the layout template to brand', () => {
    expect(csDedupeBrandedTitle({ title: 'Pricing' }, 'CueDuo').title).toBe('Pricing');
  });

  it('keeps the rest of the metadata untouched', () => {
    const meta = csDedupeBrandedTitle({ title: 'Support | CueDuo', description: 'Help' }, 'CueDuo');
    expect(meta.description).toBe('Help');
  });
});
