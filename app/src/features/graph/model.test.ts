import { describe, expect, it } from 'vitest';
import type { LinkGraphData, PageFact } from '../../services/search/types';
import { limitNodes, layoutGraph } from './layout';
import { NO_FILTER, drawn, passes, unlinked } from './model';

const page = (id: string, section = 's1') => ({ page: id, title: id.toUpperCase(), notebook: 'n1', section });
const data: LinkGraphData = {
  pages: [page('a'), page('b'), page('c', 's2'), page('d')],
  edges: [
    { from: 'a', to: 'b', count: 2, ambiguous: false },
    { from: 'b', to: 'a', count: 1, ambiguous: false },
    { from: 'b', to: 'c', count: 1, ambiguous: false },
  ],
  orphans: ['d'],
  broken: 0,
};
const fact = (id: string, tags: string[], section = 's1', status?: string): PageFact => ({
  page: id,
  notebook: 'n1',
  section,
  title: id,
  created: 0,
  modified: 0,
  tags,
  hasProperties: status !== undefined,
  properties: status ? { fields: [{ id: 'f', name: 'Status', type: 'choice', value: status }] } : undefined,
});
const facts = new Map([
  ['a', fact('a', ['school/bio'], 's1', 'Open')],
  ['b', fact('b', ['school'], 's1', 'Done')],
  ['c', fact('c', [], 's2')],
  ['d', fact('d', [])],
]);

describe('graph model', () => {
  it('draws one line for each pair of pages, whichever way the links run', () => {
    const shown = drawn(data, facts, NO_FILTER, null);
    expect(shown.pages).toHaveLength(4);
    expect(shown.edges).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(unlinked(shown).map((p) => p.page)).toEqual(['d']);
  });

  it('filters by tag, section, and property, and drops lines to hidden pages', () => {
    const byTag = drawn(data, facts, { ...NO_FILTER, tag: 'school' }, null);
    expect(byTag.pages.map((p) => p.page)).toEqual(['a', 'b']);
    expect(byTag.edges).toEqual([[0, 1]]);
    expect(byTag.hidden).toBe(2);
    expect(drawn(data, facts, { ...NO_FILTER, section: 's2' }, null).pages.map((p) => p.page)).toEqual(['c']);
    const open = drawn(data, facts, { ...NO_FILTER, property: 'Status', propertyValue: 'open' }, null);
    expect(open.pages.map((p) => p.page)).toEqual(['a']);
    expect(passes(undefined, NO_FILTER)).toBe(true);
    expect(passes(undefined, { ...NO_FILTER, tag: 'x' })).toBe(false);
  });

  it('limits to a neighborhood', () => {
    const near = drawn(data, facts, NO_FILTER, new Set(['b', 'c']));
    expect(near.edges).toEqual([[0, 1]]);
  });

  it('lays nodes out inside the box, the same way every time', () => {
    const first = layoutGraph(4, [[0, 1], [1, 2]], 600, 400);
    const second = layoutGraph(4, [[0, 1], [1, 2]], 600, 400);
    expect(first).toEqual(second);
    for (const { x, y } of first) {
      expect(x).toBeGreaterThanOrEqual(12);
      expect(x).toBeLessThanOrEqual(588);
      expect(y).toBeGreaterThanOrEqual(12);
      expect(y).toBeLessThanOrEqual(388);
    }
    expect(layoutGraph(1, [], 600, 400)).toEqual([{ x: 300, y: 200 }]);
  });

  it('keeps the best connected pages when there are too many', () => {
    const edges: [number, number][] = [[3, 4], [3, 5], [3, 6], [4, 5]];
    expect(limitNodes(8, edges, 3)).toEqual([3, 4, 5]);
    expect(limitNodes(2, edges, 3)).toEqual([0, 1]);
  });
});
