// Mind map trees: outline to map and back, and the edits that keyboard and pen building use.
import { describe, expect, it } from 'vitest';
import {
  addChild,
  addSibling,
  countNodes,
  find,
  newNode,
  outlineList,
  parseOutline,
  readMap,
  removeNode,
  setText,
  toOutline,
  toggleFold,
  visibleRows,
} from './tree';
import type { MapNode } from './tree';

const sample = (): MapNode => parseOutline('- Plants\n  - Roots\n  - Leaves\n    - Veins\n- Fungi')!;

describe('outline to map', () => {
  it('reads indented bullets into branches, with a main idea over several top lines', () => {
    const map = parseOutline('- Plants\n  - Roots\n  - Leaves\n    - Veins\n- Fungi', 'Biology')!;
    expect(map.text).toBe('Biology');
    expect(map.children.map((child) => child.text)).toEqual(['Plants', 'Fungi']);
    expect(map.children[0].children[1].children[0].text).toBe('Veins');
    expect(parseOutline('Only line')!.text).toBe('Only line');
    expect(parseOutline('  \n')).toBeNull();
  });
  it('reads tabs, four-space indents, and numbered lists', () => {
    expect(parseOutline('Root\n\tA\n\t\tB')!.children[0].children[0].text).toBe('B');
    expect(parseOutline('Root\n    A\n        B')!.children[0].children[0].text).toBe('B');
    expect(parseOutline('1. One\n2. Two', 'T')!.children.map((c) => c.text)).toEqual(['One', 'Two']);
  });
});

describe('map to outline', () => {
  it('writes a nested list and the same list as HTML', () => {
    const map = parseOutline('Root\n  A\n    B\n  C')!;
    expect(toOutline(map)).toBe('- Root\n  - A\n    - B\n  - C');
    expect(outlineList(map)).toBe(
      '<ul><li><p>Root</p><ul><li><p>A</p><ul><li><p>B</p></li></ul></li><li><p>C</p></li></ul></li></ul>',
    );
    expect(outlineList(newNode('a < b'))).toContain('a &lt; b');
  });
});

describe('building a map', () => {
  it('adds a child with Tab and a sibling with Enter', () => {
    const map = sample();
    const leaves = map.children[0].children[1];
    const withChild = addChild(map, leaves.id);
    expect(find(withChild.root, leaves.id)!.children).toHaveLength(2);
    const withSibling = addSibling(map, leaves.id);
    expect(find(withSibling.root, map.children[0].id)!.children).toHaveLength(3);
    expect(find(withSibling.root, map.children[0].id)!.children[2].id).toBe(withSibling.added);
    // The main idea has no sibling, so it gets a branch instead.
    expect(addSibling(sample(), sample().id).root.children.length).toBeGreaterThanOrEqual(2);
  });
  it('edits text, folds branches, and removes a branch with what is under it', () => {
    const map = sample();
    const leaves = map.children[0].children[1];
    expect(setText(map, leaves.id, 'Foliage').children[0].children[1].text).toBe('Foliage');
    const folded = toggleFold(map, leaves.id);
    expect(visibleRows(folded).map((row) => row.node.text)).not.toContain('Veins');
    expect(visibleRows(toggleFold(folded, leaves.id)).map((row) => row.node.text)).toContain('Veins');
    const removed = removeNode(map, leaves.id);
    expect(countNodes(removed.root)).toBe(countNodes(map) - 2);
    expect(removeNode(map, map.id).root).toBe(map);
  });
  it('keeps unchanged parts and reads only well-formed data', () => {
    const map = sample();
    expect(setText(map, 'missing', 'x')).toBe(map);
    expect(
      readMap({
        root: {
          id: 'a',
          text: 'Main',
          children: [
            { id: 'b', text: 5 },
            { id: 'c', text: 'Kept', children: [] },
          ],
        },
      }).children.map((c) => c.id),
    ).toEqual(['c']);
    expect(readMap({}, 'Main idea').text).toBe('Main idea');
  });
});
