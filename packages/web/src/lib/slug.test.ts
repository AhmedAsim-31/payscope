import { describe, expect, it } from 'vitest';
import { suggestSlug } from './slug';

describe('suggestSlug', () => {
  it.each([
    ['Acme Payments', 'acme-payments'],
    ['  Acme   &  Co.  ', 'acme-co'],
    ['Café Déjà Vu', 'cafe-deja-vu'],
    ['---', ''],
    ['', ''],
  ])('%j -> %j', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });

  it('caps length at 48 without a trailing hyphen', () => {
    const slug = suggestSlug(`${'a'.repeat(47)} b`);
    expect(slug).toBe('a'.repeat(47));
    expect(suggestSlug('word '.repeat(30)).length).toBeLessThanOrEqual(48);
  });
});
