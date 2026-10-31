import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import type { KitResult } from '../shared';
import { runTool } from '../spec';
import {
  equilibrium,
  hardyWeinberg,
  harmonicNe,
  heterozygosity,
  hweExact,
  linkage,
  migration,
  mutationBalance,
  mutationPressure,
  pathF,
  readGenotypes,
  regression,
  selectOnce,
  sexRatioNe,
  wrightFisher,
  xLinked,
} from './engine';
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

/** ln n! by summing logs, independent of the engine. */
const lnFact = (n: number): number => {
  let s = 0;
  for (let k = 2; k <= n; k++) s += Math.log(k);
  return s;
};

/** The exact test by listing every heterozygote count with the closed-form probability (Levene 1949). */
function exactByFormula(het: number, homA: number, homB: number): number {
  const n = het + homA + homB;
  const nA = 2 * homA + het;
  const nB = 2 * n - nA;
  const prob = (h: number) => {
    const aa = (nA - h) / 2;
    const bb = (nB - h) / 2;
    return Math.exp(
      lnFact(n) - lnFact(aa) - lnFact(h) - lnFact(bb) + h * Math.log(2) + lnFact(nA) + lnFact(nB) - lnFact(2 * n),
    );
  };
  const all: number[] = [];
  for (let h = nA % 2; h <= Math.min(nA, nB); h += 2) all.push(prob(h));
  const target = prob(het);
  return all.filter((p) => p <= target * (1 + 1e-9)).reduce((a, b) => a + b, 0);
}

describe('Hardy-Weinberg', () => {
  it('gives p 0.5425, expected 294.306, 496.388, 209.306, and chi2 0.22149 for AA 298, Aa 489, aa 213', () => {
    const r = hardyWeinberg(readGenotypes('A/A 298\nA/a 489\na/a 213'));
    expect(r.freqs[0]).toBeCloseTo(0.5425, 12);
    expect(r.classes.map((c) => c.expected)).toEqual([
      expect.closeTo(294.306, 3),
      expect.closeTo(496.388, 3),
      expect.closeTo(209.306, 3),
    ]);
    expect(Math.abs(r.chi2 - 0.22149)).toBeLessThan(1e-5);
    expect(r.df).toBe(1);
  });

  it('reads one-letter genotypes and any number of alleles', () => {
    const two = hardyWeinberg(readGenotypes('AA 298\nAa 489\naa 213'));
    expect(two.freqs[0]).toBeCloseTo(0.5425, 12);
    const three = hardyWeinberg(readGenotypes('A/A 10\nA/B 20\nB/B 10\nA/C 20\nB/C 20\nC/C 10'));
    expect(three.freqs).toEqual([expect.closeTo(1 / 3, 12), expect.closeTo(1 / 3, 12), expect.closeTo(1 / 3, 12)]);
    expect(three.df).toBe(3);
    expect(three.exactP).toBeNull();
    // A sample exactly at equilibrium: 9 + 3 classes of 10 and 20 in a sample of 90.
    expect(three.chi2).toBeCloseTo(0, 12);
  });

  it('matches the exact test to the closed-form distribution', () => {
    expect(hweExact(0, 1, 1)).toBeCloseTo(1 / 3, 12);
    expect(hweExact(2, 0, 0)).toBeCloseTo(1, 12);
    for (const [het, a, b] of [
      [489, 298, 213],
      [10, 40, 0],
      [3, 1, 46],
      [57, 14, 29],
    ] as const) {
      expect(hweExact(het, a, b)).toBeCloseTo(exactByFormula(het, a, b), 9);
    }
  });

  it('says what is wrong with the counts', () => {
    expect(errorKey(() => readGenotypes(''))).toBe('popgen.e.noGenotypes');
    expect(errorKey(() => readGenotypes('A/a -3'))).toBe('popgen.e.count');
    expect(errorKey(() => readGenotypes('Aaa 3'))).toBe('popgen.e.genotypeName');
    expect(errorKey(() => readGenotypes('A/a'))).toBe('popgen.e.genotypeLine');
    expect(errorKey(() => hardyWeinberg(readGenotypes('A/A 5')))).toBe('popgen.e.oneAllele');
    expect(errorKey(() => hardyWeinberg(readGenotypes('A/A 0\na/a 0')))).toBe('popgen.e.noIndividuals');
  });
});

describe('frequencies and inbreeding', () => {
  it('counts X chromosomes: 2 per female and 1 per male', () => {
    expect(xLinked(30, 40, 30, 60, 40).p).toBeCloseTo(160 / 300, 12);
    expect(errorKey(() => xLinked(0, 0, 0, 0, 0))).toBe('popgen.e.noIndividuals');
  });

  it('gives F = 1/16 for a child of first cousins by path counting', () => {
    expect(
      pathF([
        { n: 5, fa: 0 },
        { n: 5, fa: 0 },
      ]),
    ).toBe(1 / 16);
  });
});

describe('selection, mutation, and migration', () => {
  it('takes q from 0.5 to 0.473684 in one generation against a recessive with s 0.2', () => {
    const next = selectOnce(0.5, { AA: 1, Aa: 1, aa: 0.8 });
    expect(Math.abs(1 - next.p - 0.473684)).toBeLessThan(1e-6);
    // The textbook recursion q' = q(1 − sq)/(1 − sq²).
    expect(1 - next.p).toBeCloseTo((0.5 * (1 - 0.1)) / (1 - 0.05), 12);
  });

  it('balances heterozygote advantage at p* 0.75 and mutation against selection at q 0.01', () => {
    expect(equilibrium({ AA: 0.9, Aa: 1, aa: 0.7 })).toEqual({ p: expect.closeTo(0.75, 12), stable: true });
    expect(equilibrium({ AA: 1, Aa: 0.8, aa: 1 })).toEqual({ p: expect.closeTo(0.5, 12), stable: false });
    expect(equilibrium({ AA: 1, Aa: 1, aa: 0.8 })).toBeNull();
    expect(mutationBalance(1e-5, 0.1, 0)).toBeCloseTo(0.01, 12);
    expect(mutationBalance(1e-5, 0.1, 0.5)).toBeCloseTo(2e-4, 12);
    expect(errorKey(() => mutationBalance(1e-5, 0, 0))).toBe('popgen.e.noSelection');
    expect(errorKey(() => selectOnce(0.5, { AA: 0, Aa: 0, aa: 0 }))).toBe('popgen.e.noFitness');
  });

  it('follows mutation pressure and the island model', () => {
    expect(mutationPressure(1, 0.1, 0, 1).p).toBeCloseTo(0.9, 12);
    expect(mutationPressure(0.2, 0.01, 0.03, 5).pHat).toBeCloseTo(0.75, 12);
    expect(migration(0, 1, 0.5, 2)).toBeCloseTo(0.75, 12);
  });
});

describe('drift and effective size', () => {
  it('keeps 0.408953 of H after 20 generations from 0.5 with N 50', () => {
    expect(Math.abs(heterozygosity(0.5, 50, 20) - 0.408953)).toBeLessThan(1e-6);
  });

  it('gives Ne 25 for sizes 100, 10, 100 and 36 for 10 males and 90 females', () => {
    expect(harmonicNe([100, 10, 100])).toBeCloseTo(25, 12);
    expect(sexRatioNe(10, 90)).toBeCloseTo(36, 12);
    expect(errorKey(() => harmonicNe([]))).toBe('popgen.e.noSizes');
    expect(errorKey(() => harmonicNe([10, 0]))).toBe('popgen.e.sizePositive');
    expect(errorKey(() => sexRatioNe(0, 5))).toBe('popgen.e.sexes');
  });

  it('repeats a run from its seed and fixes a neutral allele about as often as its frequency', () => {
    const a = wrightFisher(10, 0.3, 50, 5, 7n);
    const b = wrightFisher(10, 0.3, 50, 5, 7n);
    expect(a.paths).toEqual(b.paths);
    const many = wrightFisher(10, 0.3, 300, 2000, 12345n);
    expect(many.fixed + many.lost).toBe(2000);
    // Binomial(2000, 0.3): mean 600, sd 20.5, so ±4 sd.
    expect(Math.abs(many.fixed - 600)).toBeLessThan(82);
  });
});

describe('linkage and heritability', () => {
  it('gives D 0.15, D′ 0.6, and r² 0.36 for AB 0.4, Ab 0.1, aB 0.1, ab 0.4', () => {
    const r = linkage(0.4, 0.1, 0.1, 0.4);
    expect(r.d).toBeCloseTo(0.15, 12);
    expect(r.dPrime).toBeCloseTo(0.6, 12);
    expect(r.r2).toBeCloseTo(0.36, 12);
    // Counts give the same answer as frequencies, and a negative D uses the other Dmax.
    expect(linkage(40, 10, 10, 40).dPrime).toBeCloseTo(0.6, 12);
    expect(linkage(0.1, 0.4, 0.4, 0.1).dPrime).toBeCloseTo(-0.6, 12);
    expect(errorKey(() => linkage(1, 0, 0, 0))).toBe('popgen.e.monomorphic');
    expect(errorKey(() => linkage(0, 0, 0, 0))).toBe('popgen.e.noHaplotypes');
  });

  it('reads heritability from the slope of offspring on parents', () => {
    const fit = regression([10, 12, 14, 16], [15, 16, 17, 18]);
    expect(fit.slope).toBeCloseTo(0.5, 12);
    expect(fit.intercept).toBeCloseTo(10, 12);
    expect(errorKey(() => regression([1, 1, 1], [1, 2, 3]))).toBe('popgen.e.sameParents');
    expect(errorKey(() => regression([1, 2], [1, 2]))).toBe('popgen.e.fewPairs');
  });
});

describe('the population genetics tool', () => {
  it('runs every mode’s worked example', () => {
    for (const mode of spec.fields[0]!.options!.map((o) => o.value)) {
      expect(failed(runTool(spec, { mode })), mode).toBe('ok');
    }
  });

  it('turns impossible input into a message', () => {
    expect(failed(runTool(spec, { mode: 'selection', p0: '1.5' }))).toBe('e.range');
    expect(failed(runTool(spec, { mode: 'drift', seed: 'abc' }))).toBe('popgen.e.seed');
    expect(failed(runTool(spec, { mode: 'drift', generations: '10000', replicates: '2000' }))).toBe('popgen.e.tooLong');
    expect(failed(runTool(spec, { mode: 'selection', waa: '-1' }))).toBe('popgen.e.fitnessNegative');
    expect(failed(runTool(spec, { mode: 'heritability', parent: 'one' }))).toBe('ok');
  });
});
