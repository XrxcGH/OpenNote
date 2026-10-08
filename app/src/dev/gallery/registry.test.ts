import { describe, expect, it } from 'vitest';
import { collectEntries, defineGallery, groupEntries } from './registry';
import type { GalleryEntry } from './registry';

const entry = (id: string, group: string, title: string): GalleryEntry => ({ id, group, title, render: () => null });

describe('collecting entries', () => {
  it('joins every module and sorts by group, then title', () => {
    const entries = collectEntries({
      './entries/b.gallery.tsx': { default: defineGallery([entry('b.one', 'Menus', 'Context menu')]) },
      './entries/a.gallery.tsx': {
        default: defineGallery([entry('a.two', 'Buttons', 'Quiet'), entry('a.one', 'Buttons', 'Primary')]),
      },
    });
    expect(entries.map((e) => e.id)).toEqual(['a.one', 'a.two', 'b.one']);
  });

  it('is empty with no modules, which is how a new package starts', () => {
    expect(collectEntries({})).toEqual([]);
  });

  it('refuses two entries with the same id, since the id names a picture and a link', () => {
    expect(() =>
      collectEntries({
        './entries/a.gallery.tsx': { default: [entry('same.id', 'A', 'One')] },
        './entries/b.gallery.tsx': { default: [entry('same.id', 'B', 'Two')] },
      }),
    ).toThrow(/unique: same\.id/);
  });

  it('refuses an id that is not lowercase words joined by dots', () => {
    for (const bad of ['Upper.case', 'has space', 'trailing.', '.leading', 'a..b', '1starts']) {
      expect(() => collectEntries({ './x.gallery.tsx': { default: [entry(bad, 'A', 'One')] } })).toThrow(
        /lowercase words/,
      );
    }
  });
});

describe('grouping', () => {
  it('lists the entries under their group, in order', () => {
    const entries = collectEntries({
      './x.gallery.tsx': {
        default: [entry('a.one', 'Buttons', 'B'), entry('a.two', 'Buttons', 'A'), entry('c.one', 'Fields', 'C')],
      },
    });
    expect(groupEntries(entries).map((g) => [g.group, g.entries.map((e) => e.title)])).toEqual([
      ['Buttons', ['A', 'B']],
      ['Fields', ['C']],
    ]);
  });
});
