import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../../services/pages/types';
import { findMatches, planPage, replaceAt } from './plan';

const options = { matchCase: false, wholeWord: false };

function page(): PageJson {
  const stamp = '2026-01-01T00:00:00Z';
  return {
    id: 'p1',
    title: 'Notes',
    created: stamp,
    modified: stamp,
    tags: [],
    view: {},
    assets: {},
    blocks: [
      { id: 'b1', type: 'text', order: 'a', created: stamp, modified: stamp, data: { markdown: 'Cat and cat and concatenate' } },
      {
        id: 'b2',
        type: 'table',
        order: 'b',
        created: stamp,
        modified: stamp,
        data: { rows: [{ id: 'r1', cells: { c1: { markdown: 'the cat' } } }] },
      },
      { id: 'b3', type: 'image', order: 'c', created: stamp, modified: stamp, data: { alt: 'A cat on a mat' } },
    ],
  };
}

describe('replace plan', () => {
  it('finds every match, ignoring case unless asked', () => {
    expect(findMatches('Cat cat CAT', 'cat', options)).toHaveLength(3);
    expect(findMatches('Cat cat CAT', 'cat', { ...options, matchCase: true })).toEqual([{ start: 4, end: 7 }]);
  });

  it('keeps to whole words when asked', () => {
    const found = findMatches('cat concatenate cat.', 'cat', { ...options, wholeWord: true });
    expect(found).toEqual([
      { start: 0, end: 3 },
      { start: 16, end: 19 },
    ]);
  });

  it('replaces only the chosen matches', () => {
    const matches = findMatches('one two one', 'one', options);
    expect(replaceAt('one two one', [matches[1]], 'six')).toBe('one two six');
    expect(replaceAt('one two one', matches, 'six')).toBe('six two six');
  });

  it('plans text, table cells, and descriptions with their words around them', () => {
    const matches = planPage(page(), 'cat', options);
    expect(matches.map((match) => `${match.blockType}:${match.start}`)).toEqual([
      'text:0',
      'text:8',
      'text:18',
      'table:4',
      'image:2',
    ]);
    expect(matches[0].after).toBe(' and cat and concatenate');
    expect(new Set(matches.map((match) => match.id)).size).toBe(matches.length);
  });
});
