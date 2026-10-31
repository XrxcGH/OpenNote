import { describe, expect, it } from 'vitest';
import { kitHumanities } from '../../../../strings/en/kitHumanities';
import { buildKey, couplets, informationGain, parseMatrix, remaining, walk } from './engine';
import type { Answer, Lead } from './engine';
import { keyLines, keySvg } from './print';

const tables = kitHumanities.keys.tables;
const describeLead = (character: string, lead: Lead) =>
  lead.kind === 'states'
    ? `${character}: ${lead.states.join(' or ')}`
    : `${character} ${lead.kind === 'atMost' ? '<=' : '>'} ${lead.value}`;

describe('identification keys', () => {
  it('separate four taxa by two binary characters in three couplets, two deep', () => {
    const matrix = parseMatrix(tables.letters);
    const key = buildKey(matrix);
    // By hand: couplet 1 splits {A,B} from {C,D}, then one couplet each splits the pairs: 3 couplets, depth 2.
    expect(key.couplets).toBe(3);
    expect(key.depth).toBe(2);
    expect(key.inseparable).toEqual([]);
    expect(keyLines(couplets(key.root), matrix, describeLead, 'or')).toEqual([
      '1a. Character 1: 1 . . . 2',
      '1b. Character 1: 0 . . . 3',
      '2a. Character 2: 1 . . . A',
      '2b. Character 2: 0 . . . B',
      '3a. Character 2: 1 . . . C',
      '3b. Character 2: 0 . . . D',
    ]);
  });

  it('explain the first couplet: one bit for an even split of four', () => {
    // log2 4 - (1/2 log2 2 + 1/2 log2 2) = 2 - 1 = 1.
    expect(informationGain(4, 2, 2)).toBeCloseTo(1, 12);
    // An uneven split of four into 1 and 3: 2 - 3/4 log2 3 ≈ 0.811278.
    expect(informationGain(4, 1, 3)).toBeCloseTo(0.811278, 6);
  });
});

describe('dichotomous key edge cases', () => {
  it('report taxa with identical states as not separable', () => {
    const matrix = parseMatrix('Taxon, a, b\nP, 1, 0\nQ, 1, 0\nR, 0, 1');
    const key = buildKey(matrix);
    expect(key.inseparable.map((group) => group.map((taxon) => matrix.taxa[taxon]))).toEqual([['P', 'Q']]);
    expect(key.couplets).toBe(1);
  });

  it('narrow a multi-access key to B and D when character 2 is 0', () => {
    const matrix = parseMatrix(tables.letters);
    const answers = new Map<number, Answer>([[1, { kind: 'state', state: '0' }]]);
    expect(remaining(matrix, answers).map((taxon) => matrix.taxa[taxon])).toEqual(['B', 'D']);
  });

  it('leave no candidate for contradictory answers', () => {
    const matrix = parseMatrix('Taxon, a\nP, 1\nQ, 0');
    expect(remaining(matrix, new Map([[0, { kind: 'state', state: '2' }]]))).toEqual([]);
  });

  it('run the key down a path and refuse to go past an end', () => {
    const matrix = parseMatrix(tables.letters);
    const { root } = buildKey(matrix);
    const end = walk(root, [1, 0]);
    expect(end.kind === 'end' && end.taxa.map((taxon) => matrix.taxa[taxon])).toEqual(['C']);
    expect(() => walk(root, [1, 0, 0])).toThrow('pastEnd');
  });

  it('send a taxon with an unknown or polymorphic state down both leads', () => {
    const matrix = parseMatrix('Taxon, a, b\nP, 1, x\nQ, 0, y\nR, ?, x\nS, 0/1, y');
    const key = buildKey(matrix);
    // By hand: R (unknown, x) could be P (1, x), and S (0 or 1, y) could be Q (0, y).
    expect(key.inseparable.map((group) => group.map((taxon) => matrix.taxa[taxon]))).toEqual([
      ['P', 'R'],
      ['Q', 'S'],
    ]);
    // Every taxon is reached at least once, and R and S with the taxa they match.
    const ends: string[] = [];
    const visit = (node: typeof key.root): void => {
      if (node.kind === 'end') ends.push(...node.taxa.map((taxon) => matrix.taxa[taxon]!));
      else node.next.forEach(visit);
    };
    visit(key.root);
    expect(new Set(ends)).toEqual(new Set(['P', 'Q', 'R', 'S']));
  });
});

describe('numeric characters and pictures', () => {
  it('split a numeric character at the midpoint between values', () => {
    const matrix = parseMatrix(tables.minerals);
    expect(matrix.characters[0]!.numeric).toBe(true);
    const key = buildKey(matrix);
    expect(key.inseparable).toEqual([]);
    // Ten minerals, two ways at each couplet: nine couplets, and a balanced key is four deep (2^3 < 10 <= 2^4).
    expect(key.couplets).toBe(9);
    expect(key.depth).toBe(4);
    const first = couplets(key.root)[0]!;
    expect(first.split.leads[0]).toEqual({ kind: 'atMost', value: 5.5 });
    const fit = remaining(matrix, new Map([[0, { kind: 'value', value: 7 }]]));
    expect(fit.map((taxon) => matrix.taxa[taxon])).toEqual(['Quartz']);
  });

  it('read a range of hardness', () => {
    const matrix = parseMatrix('Mineral, Hardness\nA, 2-3\nB, 6 to 7');
    expect(matrix.cells[0]![0]).toEqual({ kind: 'range', low: 2, high: 3 });
    expect(parseMatrix('Taxon, a\nA, 0\nB, 1').characters[0]!.numeric).toBe(false);
    expect(matrix.cells[1]![0]).toEqual({ kind: 'range', low: 6, high: 7 });
  });

  it('separate every class of the instrument starter', () => {
    const matrix = parseMatrix(tables.instruments);
    const key = buildKey(matrix);
    expect(matrix.taxa).toHaveLength(12);
    expect(key.inseparable).toEqual([]);
  });

  it('draw the key as a picture with every taxon in it', () => {
    const matrix = parseMatrix(tables.letters);
    const svg = keySvg(buildKey(matrix).root, matrix, 'Key', 'or');
    expect(svg.startsWith('<svg')).toBe(true);
    for (const name of ['A', 'B', 'C', 'D', '1. Character 1']) expect(svg).toContain(`>${name}</text>`);
  });
});

describe('tables the key cannot use', () => {
  it('refuse empty, unnamed, duplicate, and too wide tables', () => {
    expect(() => parseMatrix('')).toThrow('empty');
    expect(() => parseMatrix('Taxon, a')).toThrow('empty');
    expect(() => parseMatrix('Taxon\nA')).toThrow('noCharacters');
    expect(() => parseMatrix('Taxon, a\n, 1')).toThrow('unnamed');
    expect(() => parseMatrix('Taxon, a\nA, 1\nA, 0')).toThrow('duplicate');
    expect(() => parseMatrix('Taxon, a\nA, 1, 2')).toThrow('width');
    const huge = ['Taxon, a', ...Array.from({ length: 501 }, (_, i) => `T${i}, ${i}`)].join('\n');
    expect(() => parseMatrix(huge)).toThrow('tooMany');
  });

  it('end at once for a single taxon, and for a character with one state', () => {
    expect(buildKey(parseMatrix('Taxon, a\nA, 1')).couplets).toBe(0);
    const same = buildKey(parseMatrix('Taxon, a\nA, 1\nB, 1'));
    expect(same.couplets).toBe(0);
    expect(same.inseparable).toEqual([[0, 1]]);
  });

  it('handle negative numbers', () => {
    const matrix = parseMatrix('Taxon, t\nA, -5\nB, 3\nC, 4');
    expect(couplets(buildKey(matrix).root)[0]!.split.leads[0]).toEqual({ kind: 'atMost', value: -1 });
  });
});
