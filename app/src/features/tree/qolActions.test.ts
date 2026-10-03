import { describe, expect, it } from 'vitest';
import type { NodeId, NodeSummary } from '../../services/notes';
import { sortedIds } from './qolActions';

function page(value: string, title: string, extra: Partial<NodeSummary> = {}): NodeSummary {
  return {
    id: value as NodeId,
    kind: 'page',
    parentId: 's1' as NodeId,
    title,
    color: null,
    pageLevel: 0,
    childCount: 0,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
    readOnly: false,
    ...extra,
  };
}

describe('sorting', () => {
  const pages = [
    page('a', 'Lab 10', { created: '2026-03-01T00:00:00Z', modified: '2026-03-05T00:00:00Z' }),
    page('b', 'Lab 2', { created: '2026-01-01T00:00:00Z', modified: '2026-04-01T00:00:00Z' }),
    page('c', 'apple', { created: '2026-02-01T00:00:00Z', modified: '2026-02-01T00:00:00Z' }),
  ];

  it('sorts titles with numbers in order and ignores case', () => {
    expect(sortedIds(pages, 'title')).toEqual(['c', 'b', 'a']);
  });

  it('sorts dates newest first', () => {
    expect(sortedIds(pages, 'created')).toEqual(['a', 'c', 'b']);
    expect(sortedIds(pages, 'modified')).toEqual(['b', 'a', 'c']);
  });

  it('keeps pinned pages above the rest and ties in their order', () => {
    const pinned = [page('x', 'Zebra', { pinned: true }), ...pages, page('y', 'apple')];
    expect(sortedIds(pinned, 'title')).toEqual(['x', 'c', 'y', 'b', 'a']);
  });
});
