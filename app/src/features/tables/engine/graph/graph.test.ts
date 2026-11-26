// The interval index against a brute-force scan, Tarjan's order and cycles on small hand-drawn graphs, and the
// graph's copy-on-write forks.

import { describe, expect, it } from 'vitest';
import { Graph, IntervalIndex, stronglyConnected, type Interval } from '.';

function random(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe('interval index', () => {
  it('finds exactly the intervals a brute-force scan finds', () => {
    const next = random(7);
    const entries: Interval[] = Array.from({ length: 500 }, (_, unit) => {
      const from = Math.floor(next() * 1000);
      const to = next() < 0.05 ? Infinity : from + Math.floor(next() * 50);
      return { from, to, unit };
    });
    const index = new IntervalIndex(entries);
    for (let q = 0; q < 200; q++) {
      const from = Math.floor(next() * 1100);
      const to = from + Math.floor(next() * 20);
      const found: number[] = [];
      index.overlapping(from, to, (e) => found.push(e.unit));
      const expected = entries.filter((e) => e.from <= to && e.to >= from).map((e) => e.unit);
      expect(found.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    }
    expect(index.size).toBe(500);
  });
});

describe('strongly connected components', () => {
  const edges = (map: Record<number, number[]>) => (unit: number, visit: (r: number) => void) =>
    (map[unit] ?? []).forEach(visit);

  it('orders a chain so each unit comes after what it reads', () => {
    const { order, cycles } = stronglyConnected([0], 4, edges({ 0: [1, 2], 1: [3], 2: [3] }));
    expect(cycles).toEqual([]);
    expect(order[0]).toBe(0);
    expect(order.indexOf(3)).toBe(3);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
  });

  it('groups a cycle and a self loop, and orders what reads them after them', () => {
    const { order, cycles } = stronglyConnected([0, 4], 6, edges({ 0: [1], 1: [2], 2: [1, 3], 4: [4] }));
    expect(cycles.map((c) => [...c].sort()).sort()).toEqual([[1, 2], [4]]);
    const at = (unit: number): number => order.findIndex((e) => (e < 0 ? cycles[-e - 1].includes(unit) : e === unit));
    expect(at(0)).toBeLessThan(at(1));
    expect(at(1)).toBeLessThan(at(3));
  });

  it('walks a chain of 100,000 without recursion', () => {
    const { order } = stronglyConnected([0], 100_000, (u, visit) => {
      if (u < 99_999) visit(u + 1);
    });
    expect(order.length).toBe(100_000);
    expect(order[99_999]).toBe(99_999);
  });
});

describe('graph', () => {
  it('finds readers of a box, leaves blockers to typed changes, and forks without sharing changes', () => {
    const graph = new Graph();
    graph.setReads(1, [{ s: 0, r1: 0, c1: 0, r2: 9, c2: 1 }]);
    graph.setReads(2, [{ s: 0, r1: 5, c1: 1, r2: 5, c2: 1, blocker: true }]);
    const readers = (g: Graph, typed: boolean): number[] => {
      const out = new Set<number>();
      g.readers({ s: 0, r1: 5, c1: 1, r2: 5, c2: 1 }, typed, (u) => out.add(u));
      return [...out].sort();
    };
    expect(readers(graph, false)).toEqual([1]);
    expect(readers(graph, true)).toEqual([1, 2]);
    const fork = graph.fork();
    fork.removeUnit(1);
    fork.setReads(3, [{ s: 0, r1: 5, c1: 1, r2: 5, c2: 1 }]);
    expect(readers(fork, false)).toEqual([3]);
    expect(readers(graph, false)).toEqual([1]);
    graph.setReads(1, [{ s: 1, r1: 0, c1: 0, r2: 0, c2: 0 }]);
    expect(readers(graph, true)).toEqual([2]);
    expect(readers(fork, true)).toEqual([2, 3]);
    expect(graph.readsOf(1)).toEqual([{ s: 1, r1: 0, c1: 0, r2: 0, c2: 0 }]);
  });
});
