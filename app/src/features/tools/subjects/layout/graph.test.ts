import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { layoutForce } from './force';
import type { GraphInput, PlacedNode } from './graph';
import { layoutLayered, moveWithPriority } from './layered';

const graphOf = (edges: string): GraphInput => {
  const pairs = edges.split(',').map((e) =>
    e
      .trim()
      .split('->')
      .map((s) => s.trim()),
  );
  const ids = [...new Set(pairs.flat())];
  return { nodes: ids.map((id) => ({ id })), edges: pairs.map(([from, to]) => ({ from, to })) };
};

function overlapping(nodes: readonly PlacedNode[]): boolean {
  return nodes.some((a, i) =>
    nodes.some((b, j) => j > i && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-9),
  );
}

describe('layered graph layout', () => {
  it('lays out the hand-worked diamond with a long edge', () => {
    const laid = layoutLayered(graphOf('a -> b, a -> c, b -> d, c -> d, a -> d'));
    expect(laid.layers).toEqual({ a: 0, b: 1, c: 1, d: 2 });
    expect(laid.dummies).toBe(1);
    expect(laid.crossings).toBe(0);
    expect(laid.reversed).toEqual([]);
    expect(overlapping(laid.nodes)).toBe(false);
    const long = laid.edges.find((e) => e.from === 'a' && e.to === 'd');
    expect(long?.points).toHaveLength(3);
  });

  it('removes the crossings of a twisted two-layer graph', () => {
    // Input order puts x above q and y above p, so the edges x -> p and y -> q cross until a sweep swaps them.
    const laid = layoutLayered({
      nodes: [{ id: 'x' }, { id: 'y' }, { id: 'q' }, { id: 'p' }],
      edges: [
        { from: 'x', to: 'p' },
        { from: 'y', to: 'q' },
      ],
    });
    expect(laid.crossings).toBe(0);
    const x = (id: string) => laid.nodes.find((n) => n.id === id)?.x ?? NaN;
    expect(Math.sign(x('x') - x('y'))).toBe(Math.sign(x('p') - x('q')));
  });

  it('leaves the barycenter local optimum through the transpose pass', () => {
    // a, b, c over d, e, f with a -> e, b -> d, c -> f, a -> f: the order a, c, b over e, f, d has no crossing.
    const laid = layoutLayered({
      nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })),
      edges: [
        { from: 'a', to: 'e' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'f' },
        { from: 'a', to: 'f' },
      ],
    });
    expect(laid.crossings).toBe(0);
    // Count the crossings again from the drawn x positions, independently of the layout's own count.
    const x = Object.fromEntries(laid.nodes.map((n) => [n.id, n.x]));
    const ends = laid.edges.map((e) => [x[e.from], x[e.to]]);
    let drawn = 0;
    for (let i = 0; i < ends.length; i += 1)
      for (let j = i + 1; j < ends.length; j += 1)
        if ((ends[i][0] - ends[j][0]) * (ends[i][1] - ends[j][1]) < 0) drawn += 1;
    expect(drawn).toBe(0);
  });

  it('turns an edge around to break a cycle and reports it', () => {
    const laid = layoutLayered(graphOf('a -> b, b -> c, c -> a'));
    expect(laid.reversed).toEqual([['c', 'a']]);
    expect(laid.layers).toEqual({ a: 0, b: 1, c: 2 });
    const back = laid.edges.find((e) => e.from === 'c');
    expect(back?.points[0][1]).toBeGreaterThan(back?.points[back.points.length - 1][1] ?? Infinity);
  });

  it('runs sideways and clips edges at the boxes', () => {
    const laid = layoutLayered(graphOf('s -> t'), { direction: 'right', layerGap: 4 });
    expect(laid.edges[0].points).toEqual([
      [0.5, 0],
      [3.5, 0],
    ]);
  });

  it('refuses unknown ends, repeated ids and an empty graph', () => {
    expect(() => layoutLayered({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'z' }] })).toThrow(SubjectError);
    expect(() => layoutLayered({ nodes: [{ id: 'a' }, { id: 'a' }], edges: [] })).toThrow(SubjectError);
    expect(() => layoutLayered({ nodes: [], edges: [] })).toThrow(SubjectError);
  });
});

describe('priority placement', () => {
  it('moves a node toward its target and pushes only lower-priority neighbors', () => {
    const x = [0, 1, 2];
    moveWithPriority(x, [1, 1], [1, 5, 0], 0, 3);
    // Node 1 has higher priority, so node 0 cannot move at all.
    expect(x).toEqual([0, 1, 2]);
    const y = [0, 1, 2];
    moveWithPriority(y, [1, 1], [5, 1, 0], 0, 2);
    expect(y).toEqual([2, 3, 4]);
  });
});

describe('force-directed layout', () => {
  const ring = graphOf('a -> b, b -> c, c -> d, d -> e, e -> a');

  it('gives the same drawing for the same seed and a different one for another seed', () => {
    const one = layoutForce(ring, { seed: 7n });
    const two = layoutForce(ring, { seed: 7n });
    const three = layoutForce(ring, { seed: 8n });
    expect(two.nodes).toEqual(one.nodes);
    expect(three.nodes).not.toEqual(one.nodes);
  });

  it('settles a ring with even edges and no stacked nodes', () => {
    const laid = layoutForce(ring, { seed: 3n, length: 2 });
    const at = new Map(laid.nodes.map((n) => [n.id, n]));
    const lengths = ring.edges.map((e) => {
      const [a, b] = [at.get(e.from), at.get(e.to)];
      return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    });
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.3);
    expect(Math.min(...lengths)).toBeGreaterThan(1);
  });

  it('draws loops and two-way pairs apart', () => {
    const laid = layoutForce(graphOf('a -> a, a -> b, b -> a'), { seed: 1n });
    expect(laid.edges[0].points).toHaveLength(4);
    expect(laid.edges[1].points).toHaveLength(3);
    expect(laid.edges[2].points[1]).not.toEqual(laid.edges[1].points[1]);
  });
});
