// The qualitative coding engine against the planned cases, each checked by counting by hand.
import { describe, expect, it } from 'vitest';
import { MindError } from '../kit/types';
import { analyse, readCodebook, readSegments, readTwoCoders, retrieve, tally, twoCoders } from './engine';

const SEGMENTS = [
  's1 | I1 | A, B | first',
  's2 | I1 | A | second',
  's3 | I2 | B; C | third',
  's4 | I2 | A, B | fourth',
];

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

describe('coded segments', () => {
  const coded = analyse(readSegments(SEGMENTS.join('\n')));

  it('counts each code and the codes used together', () => {
    // A is on s1, s2, s4; B on s1, s3, s4; C on s3. A and B share s1 and s4; B and C share s3.
    expect(coded.codes).toEqual(['A', 'B', 'C']);
    expect(coded.frequency).toEqual([3, 3, 1]);
    expect(coded.together[0][1]).toBe(2);
    expect(coded.together[1][2]).toBe(1);
    expect(coded.together[0][2]).toBe(0);
    // Jaccard A-B: 2 shared over 3 + 3 - 2 = 4 segments with either.
    expect(coded.jaccard[0][1]).toBe(0.5);
    expect(coded.jaccard[0][0]).toBe(1);
  });

  it('builds the code-by-case matrix', () => {
    expect(coded.cases).toEqual(['I1', 'I2']);
    expect(coded.byCase).toEqual([
      [2, 1],
      [1, 2],
      [0, 1],
    ]);
    expect(coded.caseCount).toEqual([2, 2, 1]);
  });

  it('retrieves the passages for a code and keeps codebook order', () => {
    expect(retrieve(readSegments(SEGMENTS.join('\n')), 'C').map((s) => s.text)).toEqual(['third']);
    expect(analyse(readSegments('s1 | x | B'), ['A', 'B']).frequency).toEqual([0, 1]);
    expect(Number.isNaN(analyse(readSegments('s1 | x | B'), ['A']).jaccard[0][0])).toBe(true);
  });

  it('stops on lines it cannot read', () => {
    expect(code(() => readSegments(''))).toBe('empty');
    expect(code(() => readSegments('s1 | I1'))).toBe('segmentLine');
    expect(code(() => readSegments('s1 | I1 | A\ns1 | I1 | B'))).toBe('sameSegment');
  });
});

describe('two coders', () => {
  it('gives 80% agreement and kappa 0.6 for code A', () => {
    // Coder 1 says yes on 1 to 5, coder 2 on 2 to 6: they differ on 1 and 6 of 10.
    // po = 0.8; each says yes half the time, so pe = 0.5 and kappa = (0.8 - 0.5) / 0.5 = 0.6.
    const text = Array.from(
      { length: 10 },
      (_, i) => `s${i + 1} | ${i < 5 ? 'A' : ''} | ${i >= 1 && i < 6 ? 'A' : ''}`,
    );
    const { segments, first, second } = readTwoCoders(text.join('\n'));
    const r = twoCoders(segments, first, second);
    expect(r.perCode[0].agree).toBeCloseTo(0.8, 12);
    expect(r.perCode[0].kappa).toBeCloseTo(0.6, 9);
    expect(r.disagreements).toEqual([
      { segment: 's1', code: 'A', by: 1 },
      { segment: 's6', code: 'A', by: 2 },
    ]);
  });

  it('pools the decisions over every code', () => {
    // 2 segments x 2 codes = 4 decisions; they differ only on s2 code B, so 3 of 4 agree.
    const r = twoCoders(['s1', 's2'], [['A'], ['A', 'B']], [['A'], ['A']]);
    expect(r.agree).toBe(0.75);
    expect(r.perCode[0].kappa).toBeNaN();
  });

  it('needs segments and codes', () => {
    expect(code(() => twoCoders(['s1'], [['A']], [['A']]))).toBe('fewSegments');
    expect(code(() => twoCoders(['s1', 's2'], [[], []], [[], []]))).toBe('noCodes');
    expect(code(() => readTwoCoders('s1 | A'))).toBe('coderLine');
  });
});

describe('codebook', () => {
  it('puts children under their parents', () => {
    const book = readCodebook('feelings | | emotion words\njoy | feelings | glad\nwork | | jobs\nfear | feelings');
    expect(book.map((e) => [e.code, e.depth])).toEqual([
      ['feelings', 0],
      ['joy', 1],
      ['fear', 1],
      ['work', 0],
    ]);
  });

  it('stops on a missing parent, a loop, and a code given twice', () => {
    expect(code(() => readCodebook('joy | feelings'))).toBe('noParent');
    expect(code(() => readCodebook('a | b\nb | a'))).toBe('cycle');
    expect(code(() => readCodebook('a\na'))).toBe('sameCode');
  });
});

describe('tallies', () => {
  it('adds counts and distinct units for each category', () => {
    const r = tally('ad 1 | humor | 2\nad 2 | humor\nad 2 | fear | 3\nad 3 | fear | 0');
    expect(r.categories).toEqual(['humor', 'fear']);
    expect(r.counts).toEqual([3, 3]);
    expect(r.units).toEqual([2, 2]);
    expect(r.total).toBe(6);
    expect(r.unitCount).toBe(3);
  });

  it('stops on a count that is not a whole number and on no counts at all', () => {
    expect(code(() => tally('a | b | 1.5'))).toBe('tallyCount');
    expect(code(() => tally('a | b | -1'))).toBe('tallyCount');
    expect(code(() => tally('a | b | 0'))).toBe('noTally');
    expect(code(() => tally('a'))).toBe('tallyLine');
  });
});
