import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { drawingToSvg, escapeXml, labelSize } from './svg';
import { layoutTree } from './tree';
import type { LaidNode, TreeInput } from './tree';

const leaf = (id: string, width = 1): TreeInput => ({ id, width });
const SMALL: TreeInput = {
  id: 'root',
  children: [
    { id: 'A', children: [leaf('a1'), leaf('a2')] },
    { id: 'B', children: [leaf('b1')] },
  ],
};

const xs = (nodes: readonly LaidNode[]) => {
  const left = Math.min(...nodes.filter((n) => n.level === 2).map((n) => n.x));
  return Object.fromEntries(nodes.map((n) => [n.id, n.x - left]));
};

function overlaps(nodes: readonly LaidNode[]): boolean {
  for (const a of nodes)
    for (const b of nodes)
      if (a !== b && a.level === b.level && Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-9) return true;
  return false;
}

const mirror = (t: TreeInput): TreeInput => ({ ...t, children: [...(t.children ?? [])].reverse().map(mirror) });

describe('tidy tree layout', () => {
  it('places the hand-worked tree exactly', () => {
    const laid = layoutTree(SMALL, { gap: 0 });
    expect(xs(laid.nodes)).toEqual({ a1: 0, a2: 1, b1: 2, A: 0.5, B: 2, root: 1.25 });
    expect(overlaps(laid.nodes)).toBe(false);
  });

  it('draws a mirror-image tree as the mirror image', () => {
    const lopsided: TreeInput = {
      id: 'r',
      children: [
        { id: 'p', children: [leaf('p1'), leaf('p2'), { id: 'p3', children: [leaf('q1'), leaf('q2', 3)] }] },
        leaf('s'),
        leaf('t'),
        { id: 'u', children: [leaf('u1'), leaf('u2'), leaf('u3'), leaf('u4')] },
      ],
    };
    const a = layoutTree(lopsided, { gap: 0.5 });
    const b = layoutTree(mirror(lopsided), { gap: 0.5 });
    const bx = new Map(b.nodes.map((n) => [n.id, n.x]));
    for (const n of a.nodes) expect(n.x).toBeCloseTo(-(bx.get(n.id) ?? NaN), 12);
    expect(overlaps(a.nodes)).toBe(false);
  });

  it('centers each parent over its first and last children and spreads small subtrees between big ones', () => {
    const laid = layoutTree(
      {
        id: 'r',
        children: [
          { id: 'x', children: [leaf('x1'), leaf('x2'), leaf('x3')] },
          leaf('m'),
          { id: 'y', children: [leaf('y1'), leaf('y2'), leaf('y3')] },
        ],
      },
      { gap: 0 },
    );
    const at = xs(laid.nodes);
    expect(at.x).toBeCloseTo((at.x1 + at.x3) / 2, 12);
    expect(at.r).toBeCloseTo((at.x + at.y) / 2, 12);
    expect(at.m - at.x).toBeCloseTo(at.y - at.m, 12);
  });
});

describe('tree orientations and drawing', () => {
  it('uses fixed depths, turns sideways and wraps around a circle', () => {
    const dendrogram: TreeInput = {
      id: 'r',
      depth: 0,
      children: [
        { id: 'a', depth: 3 },
        { id: 'b', depth: 3 },
      ],
    };
    const right = layoutTree(dendrogram, { orientation: 'right', edges: 'elbow', gap: 0 });
    const a = right.nodes.find((n) => n.id === 'a');
    expect(a?.x).toBe(3);
    expect(right.edges[0].points).toHaveLength(3);
    const radial = layoutTree(
      { id: 'c', children: [leaf('1'), leaf('2'), leaf('3'), leaf('4')] },
      { orientation: 'radial' },
    );
    for (const n of radial.nodes.slice(1)) expect(Math.hypot(n.x, n.y)).toBeCloseTo(1.5, 12);
  });

  it('refuses repeated ids', () => {
    expect(() => layoutTree({ id: 'a', children: [leaf('a')] })).toThrow(SubjectError);
  });

  it('writes escaped, self-contained SVG', () => {
    const laid = layoutTree({ id: 'r', label: 'x < y & "z"', children: [leaf('k')] });
    const svg = drawingToSvg(laid, { title: 'A <tree>' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('x &lt; y &amp; &quot;z&quot;');
    expect(svg).toContain('<title>A &lt;tree&gt;</title>');
    expect(svg).not.toContain('<script');
    expect(escapeXml("'")).toBe('&#39;');
    expect(labelSize('abcd', 10, 0)).toEqual({ width: 24, height: 12.5 });
  });
});
