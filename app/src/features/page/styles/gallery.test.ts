// The style gallery's data (text DESIGN.md 4.3): every style in gallery order, with its label, where it comes
// from, and its look. Hidden styles stay out unless asked for.
import { describe, expect, it } from 'vitest';
import { galleryEntries, lookSummary } from './gallery';
import { APP_STYLES } from './sets';

describe('the style gallery', () => {
  it('lists the app styles in their order, with user styles after them by label', () => {
    const entries = galleryEntries({
      app: APP_STYLES,
      notebook: { 'u-zeta': { label: 'Zeta' }, 'u-alpha': { label: 'Alpha' } },
    });
    const names = entries.map((entry) => entry.name);
    expect(names.slice(0, 3)).toEqual(['title', 'subtitle', 'h1']);
    expect(names.indexOf('u-alpha')).toBeLessThan(names.indexOf('u-zeta'));
    // Headings 7 to 9 are hidden in the app's set.
    expect(names).not.toContain('h7');
    expect(galleryEntries({ app: APP_STYLES, notebook: {} }, { includeHidden: true }).map((e) => e.name)).toContain(
      'h7',
    );
  });

  it('says where each style comes from and gives its label and look', () => {
    const entries = galleryEntries({
      app: APP_STYLES,
      notebook: { h2: { sizePt: 16 }, 'u-lab': { label: 'Lab notes', basedOn: 'h2' } },
      page: { h1: { sizePt: 30 } },
    });
    const by = (name: string) => entries.find((entry) => entry.name === name);
    expect(by('h1')?.source).toBe('page');
    expect(by('h2')?.source).toBe('notebook');
    expect(by('h3')?.source).toBe('app');
    expect(by('u-lab')?.label).toBe('Lab notes');
    expect(by('u-lab')?.look.sizePt).toBe(16);
    expect(by('quote2')?.label).toBe('Intense quote');
    expect(lookSummary({ font: 'Georgia', sizePt: 16, weight: 700, italic: true })).toBe(
      'Georgia, 16 pt, bold, italic',
    );
  });
});
