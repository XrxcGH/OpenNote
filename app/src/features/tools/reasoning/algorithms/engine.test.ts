// Algorithms, data structures, and networks: each validation case from the plan with its expected value worked by
// hand, textbook examples with published answers, second methods (built-in sort, brute force), and edge cases.
import { describe, expect, it } from 'vitest';
import { KitError, seeded } from '../core/util';
import { coinChange, editDistance, hmm, knapsack, lcs, matrixChain } from './dp';
import {
  bellmanFord,
  bfs,
  components,
  dfs,
  dijkstra,
  euler,
  floydWarshall,
  greedyColor,
  hamilton,
  kruskal,
  matching,
  maxFlow,
  parseGraph,
  pathTo,
  prim,
  topoSort,
} from './graphs';
import { betweenness, closeness, clustering, eigenvector, louvain, pageRank, summary } from './network';
import { alphaBeta, bestFirst, parseGameTree, parseHeuristic } from './search';
import { SORTS, binarySearch, sort } from './sorting';
import { bTreeOps, hashOps, heapOps, inorder, linear, parseOps, treeOps } from './structures';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof KitError ? e.key : 'other';
  }
  return 'none';
};

describe('sorting and searching', () => {
  it('insertion-sorts 5, 2, 4, 6, 1, 3 with 12 comparisons and 9 shifts', () => {
    const r = sort('insertion', [5, 2, 4, 6, 1, 3]);
    expect(r.result).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.comparisons).toBe(12);
    expect(r.moves).toBe(9);
    expect(r.moveKind).toBe('shifts');
  });

  it('sorts like the built-in sort with every method', () => {
    const rand = seeded(7);
    for (let trial = 0; trial < 20; trial += 1) {
      const a = Array.from({ length: Math.floor(rand() * 30) }, () => Math.floor(rand() * 100));
      const want = [...a].sort((x, y) => x - y);
      for (const id of SORTS) expect(sort(id, a).result, `${id} ${a}`).toEqual(want);
    }
    expect(sort('selection', [3, 1, 2]).comparisons).toBe(3);
    expect(sort('bubble', [1, 2, 3, 4]).comparisons).toBe(3);
    expect(sort('counting', [-2, 5, 0]).result).toEqual([-2, 0, 5]);
  });

  it('finds by binary search and words unsorted or fractional input', () => {
    const r = binarySearch([1, 3, 5, 7, 9, 11, 13], 11);
    expect(r.index).toBe(5);
    expect(r.comparisons).toBe(2);
    expect(binarySearch([1, 3], 2).index).toBe(-1);
    expect(binarySearch([], 2).index).toBe(-1);
    expect(codeOf(() => binarySearch([3, 1], 1))).toBe('notSorted');
    expect(codeOf(() => sort('radix', [3, -1]))).toBe('radixNegative');
    expect(codeOf(() => sort('counting', [1.5]))).toBe('wholeOnly');
  });
});

describe('data structures', () => {
  it('rotates left once when 1, 2, 3 go into an AVL tree', () => {
    const r = treeOps(true, parseOps('insert 1, insert 2, insert 3'));
    expect(r.rotations).toBe(1);
    expect(r.log.filter((s) => s.key === 'rotateLeft')).toHaveLength(1);
    expect(r.root!.key).toBe(2);
    expect([r.root!.left!.key, r.root!.right!.key]).toEqual([1, 3]);
  });

  it('keeps an AVL tree balanced and in order through many inserts and deletes', () => {
    const rand = seeded(3);
    const keys = Array.from({ length: 200 }, () => Math.floor(rand() * 500));
    const ops = parseOps([...keys.map((k) => `insert ${k}`), ...keys.slice(0, 80).map((k) => `delete ${k}`)].join(','));
    const r = treeOps(true, ops);
    const left = [...new Set(keys)].filter((k) => !keys.slice(0, 80).includes(k)).sort((a, b) => a - b);
    expect(inorder(r.root)).toEqual(left);
    const check = (t: typeof r.root): number => {
      if (!t) return 0;
      const a = check(t.left);
      const b = check(t.right);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
      return 1 + Math.max(a, b);
    };
    check(r.root);
    expect(inorder(treeOps(false, parseOps('50, 30, 70, 20, 40, delete 30')).root)).toEqual([20, 40, 50, 70]);
  });

  it('runs stacks, queues, heaps, B-trees, and hash tables', () => {
    expect(linear('stack', parseOps('push 1, push 2, pop, push 3')).items).toEqual([1, 3]);
    expect(linear('queue', parseOps('push 1, push 2, pop, push 3')).items).toEqual([2, 3]);
    expect(heapOps(parseOps('5, 3, 8, 1, extract')).heap).toEqual([3, 5, 8]);
    const b = bTreeOps(3, parseOps('1, 2, 3, 4, 5, 6, 7'));
    expect(b.root.keys).toEqual([4]);
    expect(b.root.kids.map((k) => k.keys)).toEqual([[2], [6]]);
    expect(b.splits).toBe(4);
    // Linear probing in a table of 10: 89 → 9, 18 → 8, 49 → 9, 0, 58 → 8, 9, 0, 1, 69 → 9, 0, 1, 2.
    const hash = hashOps(10, 'linear', parseOps('89, 18, 49, 58, 69'));
    expect(hash.slots.map((s) => s[0] ?? null)).toEqual([49, 58, 69, null, null, null, null, null, 18, 89]);
    expect(hash.probes).toBe(1 + 1 + 2 + 4 + 4);
    const dbl = hashOps(7, 'double', parseOps('10, 17'));
    expect(dbl.slots[3]).toEqual([10]);
    // 17 also lands on 3; its step is 1 + (17 mod 6) = 6, so it goes to (3 + 6) mod 7 = 2.
    expect(dbl.slots[2]).toEqual([17]);
    expect(codeOf(() => parseOps('jump 3'))).toBe('opWord');
    expect(codeOf(() => parseOps(''))).toBe('noOps');
  });
});

describe('graphs', () => {
  const DIJKSTRA = 'A-B 4, A-C 2, B-C 5, B-D 10, C-E 3, E-D 4';

  it('gives Dijkstra distances A 0, B 4, C 2, E 5, D 9', () => {
    const g = parseGraph(DIJKSTRA, true);
    const r = dijkstra(g, 'A');
    expect(Object.fromEntries(r.dist)).toEqual({ A: 0, B: 4, C: 2, D: 9, E: 5 });
    expect(pathTo(r.prev, 'A', 'D')).toEqual(['A', 'C', 'E', 'D']);
    expect(Object.fromEntries(bellmanFord(g, 'A').dist)).toEqual(Object.fromEntries(r.dist));
    const f = floydWarshall(g);
    expect(f.d[0]).toEqual(g.nodes.map((q) => r.dist.get(q)));
  });

  it('finds a negative cycle and refuses negative weights in Dijkstra', () => {
    const g = parseGraph('A B 1, B C -3, C A 1', true);
    expect(bellmanFord(g, 'A').negativeCycle).toBe(true);
    expect(floydWarshall(g).negativeCycle).toBe(true);
    expect(codeOf(() => dijkstra(g, 'A'))).toBe('negativeWeight');
    expect(codeOf(() => dijkstra(g, 'Z'))).toBe('noNode');
  });

  it('agrees on spanning tree weight by Prim and Kruskal', () => {
    // The textbook example with total weight 37.
    const g = parseGraph(
      'a b 4, a h 8, b h 11, b c 8, c i 2, c f 4, c d 7, d f 14, d e 9, e f 10, f g 2, g i 6, g h 1, h i 7',
      false,
    );
    expect(kruskal(g).weight).toBe(37);
    expect(prim(g, 'a').weight).toBe(37);
    expect(kruskal(g).tree).toHaveLength(8);
  });

  it('gives the maximum flow 23 equal to the minimum cut', () => {
    const g = parseGraph('s v1 16, s v2 13, v2 v1 4, v1 v3 12, v3 v2 9, v2 v4 14, v4 v3 7, v3 t 20, v4 t 4', true);
    const r = maxFlow(g, 's', 't');
    expect(r.total).toBe(23);
    expect(r.cutEdges.reduce((a, i) => a + g.edges[i].w, 0)).toBe(23);
  });

  it('searches, sorts topologically, and finds components', () => {
    const g = parseGraph('A B, A C, B D, C D, D E', true);
    expect(Object.fromEntries(bfs(g, 'A').dist)).toEqual({ A: 0, B: 1, C: 1, D: 2, E: 3 });
    const d = dfs(g, 'A');
    expect(d.found.get('A')).toBe(1);
    expect(d.done.get('A')).toBe(10);
    expect([...d.classes.values()].filter((c) => c === 'tree')).toHaveLength(4);
    expect(topoSort(g)).toEqual({ order: ['A', 'B', 'C', 'D', 'E'] });
    expect(topoSort(parseGraph('A B, B A', true))).toEqual({ cycle: true });
    const scc = components(parseGraph('a b, b c, c a, b d, d e, e d', true));
    expect(scc.map((c) => [...c].sort().join(''))).toEqual(['abc', 'de']);
    expect(components(parseGraph('a b, c d, e', false))).toHaveLength(3);
  });

  it('matches, tours, and colors', () => {
    expect(matching(parseGraph('a1 b1, a1 b2, a2 b1, a3 b2, a3 b3', false)).pairs).toHaveLength(3);
    expect(codeOf(() => matching(parseGraph('a b, b c, c a', false)))).toBe('notBipartite');
    const konigsberg = parseGraph('A B, A B, A C, A C, A D, B D, C D', false);
    expect(euler(konigsberg).kind).toBe('none');
    const house = euler(parseGraph('1 2, 2 3, 3 4, 4 1, 1 3', false));
    expect(house.kind).toBe('path');
    if (house.kind !== 'none') expect(house.walk).toHaveLength(6);
    expect(hamilton(parseGraph('a b, b c, c d, d a, a c', false)).kind).toBe('cycle');
    expect(hamilton(parseGraph('a b, b c, c d', false)).kind).toBe('path');
    expect(hamilton(parseGraph('a b, a c, a d', false)).kind).toBe('none');
    expect(new Set(greedyColor(parseGraph('1 2, 2 3, 3 4, 4 5, 5 1', false)).values()).size).toBe(3);
  });

  it('words bad edge lists', () => {
    expect(codeOf(() => parseGraph('', false))).toBe('noGraph');
    expect(codeOf(() => parseGraph('A B C D', false))).toBe('edgeLine');
  });
});

describe('informed and game search', () => {
  it('finds the optimal path by A* and a quick one by greedy best-first', () => {
    const g = parseGraph('S A 1, S B 4, A B 2, A C 5, B C 1, C G 3', false);
    const h = parseHeuristic('S 7, A 6, B 2, C 1, G 0');
    const a = bestFirst(g, h, 'S', 'G', false);
    expect(a.path).toEqual(['S', 'A', 'B', 'C', 'G']);
    expect(a.cost).toBe(7);
    const greedy = bestFirst(g, h, 'S', 'G', true);
    expect(greedy.path[0]).toBe('S');
    expect(greedy.path.at(-1)).toBe('G');
  });

  it('prunes 2 leaves of the classic 3-by-3 tree and keeps the value 3', () => {
    const tree = parseGameTree('((3, 12, 8), (2, 4, 6), (14, 5, 2))');
    const full = alphaBeta(tree, false);
    const cut = alphaBeta(tree, true);
    expect(full.tree.value).toBe(3);
    expect(cut.tree.value).toBe(3);
    expect(full.leaves).toBe(9);
    expect(cut.leaves).toBe(7);
    expect(codeOf(() => parseGameTree('((1, 2)'))).toBe('treeText');
  });
});

describe('dynamic programming', () => {
  it('gives edit distance 3, LCS length 4, and knapsack value 9', () => {
    expect(editDistance('kitten', 'sitting').distance).toBe(3);
    expect(lcs('ABCBDAB', 'BDCABA').length).toBe(4);
    const k = knapsack([1, 3, 4, 5], [1, 4, 5, 7], 7);
    expect(k.best).toBe(9);
    expect(k.chosen).toEqual([1, 2]);
    expect(editDistance('', 'abc').distance).toBe(3);
  });

  it('makes change and orders a matrix chain as the textbook does', () => {
    const c = coinChange([1, 2, 5], 11);
    expect(c.fewest).toBe(3);
    expect(c.ways).toBe(11);
    expect(coinChange([2], 3).fewest).toBe(Infinity);
    const m = matrixChain([30, 35, 15, 5, 10, 20, 25]);
    expect(m.cost).toBe(15125);
    expect(m.order).toBe('((A1(A2A3))((A4A5)A6))');
  });

  it('runs the forward and Viterbi algorithms, checked against every path', () => {
    const model = {
      states: ['Healthy', 'Fever'],
      symbols: ['normal', 'cold', 'dizzy'],
      start: [0.6, 0.4],
      trans: [
        [0.7, 0.3],
        [0.4, 0.6],
      ],
      emit: [
        [0.5, 0.4, 0.1],
        [0.1, 0.3, 0.6],
      ],
    };
    const obs = ['normal', 'cold', 'dizzy'];
    const r = hmm(model, obs);
    expect(r.path).toEqual(['Healthy', 'Healthy', 'Fever']);
    expect(r.pathProbability).toBeCloseTo(0.01512, 12);
    let total = 0;
    let best = 0;
    for (let p = 0; p < 8; p += 1) {
      const s = [(p >> 2) & 1, (p >> 1) & 1, p & 1];
      let pr = model.start[s[0]] * model.emit[s[0]][0];
      for (let t = 1; t < 3; t += 1) pr *= model.trans[s[t - 1]][s[t]] * model.emit[s[t]][t];
      total += pr;
      best = Math.max(best, pr);
    }
    expect(r.probability).toBeCloseTo(total, 14);
    expect(r.pathProbability).toBeCloseTo(best, 14);
    expect(codeOf(() => hmm({ ...model, start: [0.5, 0.4] }, obs))).toBe('hmmRows');
  });
});

describe('networks', () => {
  it('gives the center of a 5-node star betweenness 6 and a 3-cycle PageRank 1/3 each', () => {
    const star = parseGraph('c a, c b, c d, c e', false);
    const b = betweenness(star);
    expect(b.get('c')).toBeCloseTo(6, 9);
    expect(b.get('a')).toBeCloseTo(0, 9);
    const cycle = pageRank(parseGraph('a b, b c, c a', true)).rank;
    for (const q of ['a', 'b', 'c']) expect(cycle.get(q)).toBeCloseTo(1 / 3, 9);
  });

  it('agrees with hand values on a path and two joined triangles', () => {
    const path = parseGraph('a b, b c, c d', false);
    expect(betweenness(path).get('b')).toBeCloseTo(2, 9);
    expect(closeness(path).get('a')).toBeCloseTo(3 / 6, 9);
    expect(summary(path)).toEqual({ density: 0.5, averagePath: 20 / 12, diameter: 3, components: 1 });
    const two = parseGraph('a b, b c, c a, d e, e f, f d, c d', false);
    expect(clustering(two).get('a')).toBe(1);
    expect(clustering(two).get('c')).toBeCloseTo(1 / 3, 12);
    const l = louvain(two, 1);
    expect(new Set(l.community.values()).size).toBe(2);
    expect(l.community.get('a')).toBe(l.community.get('b'));
    expect(l.modularity).toBeCloseTo(5 / 14, 12);
    const e = eigenvector(parseGraph('c a, c b, c d, c e', false));
    // The star's leading eigenvector is (2, 1, 1, 1, 1) for the center then the leaves, scaled to sum 1.
    expect(e.get('c')).toBeCloseTo(2 / 6, 9);
  });
});
