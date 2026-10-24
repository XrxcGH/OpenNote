import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import { runTool } from '../spec';
import { alignAffine, alignLinear, dnaScorer, dotPlot, matchLine, stats } from './engine';
import { BLOSUM62, readMatrix } from './matrices';
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

const unit = dnaScorer(1, -1);

describe('global alignment', () => {
  it('scores GATTACA against GCATGCU 0 with match 1, mismatch -1, gap -1', () => {
    const r = alignLinear('GATTACA', 'GCATGCU', unit, -1, 'global');
    expect(r.score).toBe(0);
    expect(r.top.replace(/-/g, '')).toBe('GATTACA');
    expect(r.bottom.replace(/-/g, '')).toBe('GCATGCU');
    // The alignment's own score agrees with the matrix.
    let total = 0;
    for (let k = 0; k < r.top.length; k++)
      total += r.top[k] === '-' || r.bottom[k] === '-' ? -1 : unit(r.top[k]!, r.bottom[k]!);
    expect(total).toBe(0);
  });

  it('keeps every tied arrow in the matrix', () => {
    const r = alignLinear('A', 'AA', unit, -1, 'global');
    // Cell (1,2): from (0,1) diagonally -1 + 1 = 0, or from (1,1) left 1 - 1 = 0: both arrows.
    expect(r.arrows![1]![2]).toBe(1 | 4);
    expect(r.score).toBe(0);
  });

  it('scores ACGTTTGCA against ACGTGCA 3 with affine gaps open -3, extend -1', () => {
    const r = alignAffine('ACGTTTGCA', 'ACGTGCA', unit, { open: -3, extend: -1 }, 'global');
    expect(r.score).toBe(3);
    expect(r.top).toBe('ACGTTTGCA');
    expect(r.bottom).toMatch(/^ACG[T-]{3}GCA$/);
  });

  it('matches the linear result when open equals extend', () => {
    const affine = alignAffine('GATTACA', 'GCATGCU', unit, { open: -1, extend: -1 }, 'global');
    expect(affine.score).toBe(0);
  });
});

describe('local and semi-global alignment', () => {
  it('scores TGTTACGG against GGTTGACTA 13 as GTT-AC over GTTGAC', () => {
    const r = alignLinear('TGTTACGG', 'GGTTGACTA', dnaScorer(3, -3), -2, 'local');
    expect(r.score).toBe(13);
    expect([r.top, r.bottom]).toEqual(['GTT-AC', 'GTTGAC']);
    expect(r.span).toEqual({ a: [2, 6], b: [2, 7] });
  });

  it('gives the same local score with affine gaps of equal open and extend', () => {
    expect(alignAffine('TGTTACGG', 'GGTTGACTA', dnaScorer(3, -3), { open: -2, extend: -2 }, 'local').score).toBe(13);
  });

  it('does not charge end gaps in a semi-global alignment', () => {
    const r = alignLinear('ACGT', 'TTACGTTT', unit, -1, 'semi');
    expect(r.score).toBe(4);
    expect([r.top, r.bottom]).toEqual(['--ACGT--', 'TTACGTTT']);
    expect(alignAffine('ACGT', 'TTACGTTT', unit, { open: -3, extend: -1 }, 'semi').score).toBe(4);
  });
});

describe('scores and statistics', () => {
  it('scores HEAGAWGHEE against itself 62 with BLOSUM62', () => {
    const seq = 'HEAGAWGHEE';
    expect([...seq].reduce((sum, aa) => sum + BLOSUM62.score(aa, aa)!, 0)).toBe(62);
  });

  it('holds a symmetric BLOSUM62', () => {
    for (const x of BLOSUM62.letters)
      for (const y of BLOSUM62.letters) expect(BLOSUM62.score(x, y)).toBe(BLOSUM62.score(y, x));
  });

  it('scores transitions apart from transversions', () => {
    const s = dnaScorer(2, -1, -2);
    expect([s('A', 'G'), s('C', 'T'), s('A', 'C')]).toEqual([-1, -1, -2]);
  });

  it('counts identity, similarity and gaps', () => {
    expect(stats('GTT-AC', 'GTTGAC', unit)).toEqual({ length: 6, identical: 5, similar: 5, gaps: 1 });
    expect(matchLine('GTT-AC', 'GTTGAC', unit)).toBe('||| ||');
  });

  it('reads a pasted matrix and refuses a broken one', () => {
    const m = readMatrix('# test\n  A C\nA 1 -1\nC -1 1');
    expect(m.score('A', 'C')).toBe(-1);
    expect(errorKey(() => readMatrix('  A C\nA 1'))).toBe('align.e.matrixRow');
  });
});

describe('dot plots and limits', () => {
  it('marks windows that agree', () => {
    expect(dotPlot('ACGT', 'ACGT', 2, 2)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('refuses an empty sequence', () => {
    expect(errorKey(() => alignLinear('', 'A', unit, -1, 'global'))).toBe('align.e.empty');
  });
});

describe('the alignment tool', () => {
  it('answers each kind of alignment on its example', () => {
    for (const mode of ['global', 'local', 'semi', 'dots']) expect(runTool(spec, { mode }).ok, mode).toBe(true);
    for (const scoring of ['dna', 'transition', 'custom']) {
      expect(runTool(spec, { scoring, b: 'GCATGCT' }).ok, scoring).toBe(true);
    }
    expect(runTool(spec, { scoring: 'blosum62', a: 'HEAGAWGHEE', b: 'PAWHEAE' }).ok).toBe(true);
    expect(runTool(spec, { gaps: 'affine' }).ok).toBe(true);
  });

  it('says when a letter is not in the matrix', () => {
    expect(runTool(spec, { scoring: 'blosum62', a: 'HEJ', b: 'HE' })).toMatchObject({
      ok: false,
      error: 'align.e.notInMatrix',
    });
  });
});
