import { describe, expect, it } from 'vitest';
import { Rng } from '../../subjects/num/rng';
import { KitError } from '../shared';
import type { KitResult } from '../shared';
import { runTool } from '../spec';
import {
  bootstrap,
  distances,
  fitch,
  jukesCantor,
  kimura,
  majorityRule,
  neighborJoining,
  parsimonyScore,
  poisson,
  searchParsimony,
  unrootedTrees,
  upgma,
} from './build';
import {
  isMonophyletic,
  ladderize,
  leaves,
  mrca,
  nodes,
  readNewick,
  reroot,
  sisters,
  splits,
  writeNewick,
} from './tree';
import type { TreeNode } from './tree';
import { spec } from './tool';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof KitError) return error.key;
    throw error;
  }
  return 'no error';
};
const failed = (result: KitResult): string => (result.ok ? 'ok' : result.error);

/** The length of the branch above the smallest clade holding exactly these taxa. */
function branch(root: TreeNode, taxa: string[]): number | undefined {
  const want = [...taxa].sort().join();
  return nodes(root).find((n) => [...leaves(n)].sort().join() === want)?.length;
}

describe('distances', () => {
  it('gives Jukes-Cantor 0.107326 for p 0.1 and Kimura 0.170181 for P 0.1, Q 0.05', () => {
    expect(Math.abs(jukesCantor(0.1) - 0.107326)).toBeLessThan(1e-6);
    expect(Math.abs(kimura(0.1, 0.05) - 0.170181)).toBeLessThan(1e-6);
  });

  it('reports saturation instead of a number', () => {
    expect(jukesCantor(0.75)).toBeNaN();
    expect(kimura(0.5, 0.1)).toBeNaN();
    expect(poisson(1)).toBeNaN();
    expect(poisson(1 - Math.exp(-2))).toBeCloseTo(2, 12);
  });

  it('counts differences, transitions, and transversions with gaps deleted pair by pair', () => {
    // 10 sites: 1 transition (A/G), 1 transversion (C/A); site 10 has a gap and is left out, so 9 are compared.
    const taxa = [
      { name: 'x', seq: 'AACCGGTTA-' },
      { name: 'y', seq: 'GACAGGTTAA' },
      { name: 'z', seq: 'AACCGGTTAA' },
    ];
    const p = distances(taxa, 'p', false);
    expect(p.sites[0]![1]).toBe(9);
    expect(p.d[0]![1]).toBeCloseTo(2 / 9, 12);
    expect(distances(taxa, 'k2p', false).d[0]![1]).toBeCloseTo(kimura(1 / 9, 1 / 9), 12);
    expect(distances(taxa, 'jc', false).d[0]![2]).toBe(0);
  });
});

describe('tree building', () => {
  const names = ['a', 'b', 'c', 'd', 'e'];
  const d = [
    [0, 5, 9, 9, 8],
    [5, 0, 10, 10, 9],
    [9, 10, 0, 8, 7],
    [9, 10, 8, 0, 3],
    [8, 9, 7, 3, 0],
  ];

  it('joins a and b, then c, then meets d and e: a-u 2, b-u 3, u-v 3, c-v 4, d-w 2, e-w 1, v-w 2', () => {
    const { tree, steps } = neighborJoining(names, d);
    expect(branch(tree, ['a'])).toBeCloseTo(2, 9);
    expect(branch(tree, ['b'])).toBeCloseTo(3, 9);
    expect(branch(tree, ['a', 'b'])).toBeCloseTo(3, 9);
    expect(branch(tree, ['c'])).toBeCloseTo(4, 9);
    expect(branch(tree, ['d'])).toBeCloseTo(2, 9);
    expect(branch(tree, ['e'])).toBeCloseTo(1, 9);
    expect(branch(tree, ['a', 'b', 'c'])).toBeCloseTo(2, 9);
    expect(steps.map((s) => s.node)).toEqual(['u', 'v', 'w']);
    expect(steps[0]!.q).toBe(-50);
    // The tree's path lengths add back to this additive matrix.
    expect(writeNewick(tree)).toBe('(d:2,e:1,(c:4,(a:2,b:3):3):2);');
  });

  it('builds UPGMA heights 1, 3, and 5', () => {
    const { tree, steps } = upgma(
      ['A', 'B', 'C', 'D'],
      [
        [0, 2, 6, 10],
        [2, 0, 6, 10],
        [6, 6, 0, 10],
        [10, 10, 10, 0],
      ],
    );
    expect(steps.map((s) => s.la)).toEqual([1, 3, 5]);
    expect(branch(tree, ['A'])).toBe(1);
    expect(branch(tree, ['A', 'B'])).toBe(2);
    expect(branch(tree, ['C'])).toBe(3);
    expect(branch(tree, ['A', 'B', 'C'])).toBe(2);
    expect(branch(tree, ['D'])).toBe(5);
  });

  it('refuses too few taxa and undefined distances', () => {
    expect(
      errorKey(() =>
        upgma(
          ['A', 'B'],
          [
            [0, 1],
            [1, 0],
          ],
        ),
      ),
    ).toBe('phylo.e.fewTaxa');
    expect(
      errorKey(() =>
        neighborJoining(
          ['A', 'B', 'C'],
          [
            [0, NaN, 1],
            [NaN, 0, 1],
            [1, 1, 0],
          ],
        ),
      ),
    ).toBe('phylo.e.saturated');
  });
});

describe('parsimony', () => {
  it('scores 1 change on ((A,B),(C,D)) with states T, T, G, T', () => {
    const tree = readNewick('((A,B),(C,D));');
    const site = fitch(
      tree,
      new Map([
        ['A', 'T'],
        ['B', 'T'],
        ['C', 'G'],
        ['D', 'T'],
      ]),
    );
    expect(site.score).toBe(1);
    expect(site.sets[0]!.set).toBe('T');
  });

  it('adds sites and treats gaps as missing', () => {
    const taxa = [
      { name: 'A', seq: 'TA-' },
      { name: 'B', seq: 'TCA' },
      { name: 'C', seq: 'GGC' },
      { name: 'D', seq: 'TTC' },
    ];
    // Site 1: 1 change; site 2: 4 different states on 4 tips need 3; site 3: A, C, C over B, C, D with A missing: 1.
    expect(parsimonyScore(readNewick('((A,B),(C,D));'), taxa)).toBe(5);
  });

  it('finds the most parsimonious tree by exhaustive search', () => {
    const taxa = [
      { name: 'A', seq: 'AAGG' },
      { name: 'B', seq: 'AAGG' },
      { name: 'C', seq: 'CCTT' },
      { name: 'D', seq: 'CCTT' },
      { name: 'E', seq: 'CCTA' },
    ];
    const search = searchParsimony(taxa);
    expect(search.best).toBe(5);
    expect(search.total).toBe(15);
    expect(unrootedTrees(9)).toBe(135135);
    for (const t of search.trees)
      expect(splits(t, ['A', 'B', 'C', 'D', 'E']).some((s) => s === 'C\u0000D\u0000E')).toBe(true);
    expect(errorKey(() => searchParsimony(taxa.slice(0, 3)))).toBe('phylo.e.fewParsimony');
  });
});

describe('Newick trees', () => {
  it('round-trips ((A:1,B:2):0.5,C:3);', () => {
    expect(writeNewick(readNewick('((A:1,B:2):0.5,C:3);'))).toBe('((A:1,B:2):0.5,C:3);');
    expect(writeNewick(readNewick("(('two words':1,B)90:2,C) [note];"))).toBe("(('two words':1,B)90:2,C);");
  });

  it('says where a Newick string goes wrong', () => {
    expect(errorKey(() => readNewick(''))).toBe('phylo.e.noNewick');
    expect(errorKey(() => readNewick('((A,B),C;'))).toBe('phylo.e.newickBracket');
    expect(errorKey(() => readNewick('(A:x,B);'))).toBe('phylo.e.newickLength');
    expect(errorKey(() => readNewick('(A,A);'))).toBe('phylo.e.duplicateTaxon');
    expect(errorKey(() => readNewick('(A,B);C'))).toBe('phylo.e.newickExtra');
  });

  it('reroots on an outgroup, halving its branch, and ladderizes', () => {
    const rooted = reroot(readNewick('((A:1,B:2):0.5,C:3);'), 'A');
    expect(branch(rooted, ['A'])).toBe(0.5);
    expect(branch(rooted, ['B', 'C'])).toBe(0.5);
    expect(branch(rooted, ['C'])).toBe(3.5);
    expect(leaves(rooted).sort()).toEqual(['A', 'B', 'C']);
    expect(writeNewick(ladderize(readNewick('((A,(B,C)),D);')))).toBe('(D,(A,(B,C)));');
    expect(errorKey(() => reroot(readNewick('(A,B,C);'), 'Z'))).toBe('phylo.e.unknownTaxon');
  });

  it('answers common ancestor, monophyly, and sister questions', () => {
    const tree = readNewick('(((A,B),C),(D,E));');
    expect(leaves(mrca(tree, ['A', 'C']))).toEqual(['A', 'B', 'C']);
    expect(isMonophyletic(tree, ['A', 'B'])).toBe(true);
    expect(isMonophyletic(tree, ['A', 'C'])).toBe(false);
    expect(sisters(tree, ['A', 'B'])).toEqual(['C']);
    expect(sisters(tree, ['D', 'E'])).toEqual(['A', 'B', 'C']);
  });
});

describe('bootstrap', () => {
  const taxa = [
    { name: 'A', seq: 'AAAAAAAAAAAAAAAAAAAA' },
    { name: 'B', seq: 'AAAAAAAAAAAAAAAAAAAC' },
    { name: 'C', seq: 'CCCCCCCCCCAAAAAAAAAA' },
    { name: 'D', seq: 'CCCCCCCCCCAAAAAAAAAC' },
  ];

  it('repeats from its seed and supports a split every column agrees on', () => {
    const one = bootstrap(taxa, 'p', false, 'nj', 50, new Rng(3n));
    const two = bootstrap(taxa, 'p', false, 'nj', 50, new Rng(3n));
    expect([...one.support]).toEqual([...two.support]);
    expect(one.support.get('C\u0000D')).toBeGreaterThan(0.9);
    expect(writeNewick(one.consensus)).toMatch(/\(C,D\)\d+/);
  });

  it('builds a majority-rule consensus from split shares', () => {
    const tree = majorityRule(
      ['A', 'B', 'C', 'D', 'E'],
      new Map([
        ['C\u0000D\u0000E', 0.8],
        ['D\u0000E', 0.6],
        ['B\u0000C', 0.4],
      ]),
    );
    expect(writeNewick(tree)).toBe('(((D,E)60,C)80,A,B);');
  });
});

describe('the phylogenetics tool', () => {
  it('runs every mode’s worked example', () => {
    for (const mode of ['distance', 'matrix', 'parsimony', 'bootstrap', 'newick']) {
      expect(failed(runTool(spec, { mode })), mode).toBe('ok');
    }
    for (const style of ['phylogram', 'cladogram', 'radial']) expect(failed(runTool(spec, { style }))).toBe('ok');
  });

  it('turns impossible input into a message', () => {
    expect(failed(runTool(spec, { alignment: '>A\nAC\n>B\nACG\n>C\nAC' }))).toBe('phylo.e.unequal');
    expect(failed(runTool(spec, { alignment: '>A\nAC' }))).toBe('phylo.e.fewSequences');
    expect(failed(runTool(spec, { seqType: 'protein', model: 'jc' }))).toBe('phylo.e.modelProtein');
    expect(failed(runTool(spec, { mode: 'matrix', matrix: 'a 0 1\nb 1 0\nc 2' }))).toBe('phylo.e.matrixShape');
    expect(failed(runTool(spec, { mode: 'matrix', matrix: 'a 0 1 2\nb 3 0 1\nc 2 1 0' }))).toBe('phylo.e.asymmetric');
    expect(failed(runTool(spec, { alignment: '>A\nAAAA\n>B\nCCCC\n>C\nAAAA' }))).toBe('phylo.e.saturated');
    expect(failed(runTool(spec, { mode: 'matrix', matrix: 'a\nb 1\nc 2 3' }))).toBe('ok');
  });
});
