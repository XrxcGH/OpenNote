import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import type { KitOk, KitResult } from '../shared';
import { runTool } from '../spec';
import { chiSquareFit, chiSquareP, fText } from '../stats';
import { offspring, parseGenotype } from './genotype';
import { haldane, kosambi, lod, maxLod, readClasses, threePoint } from './mapping';
import { phenotypeShares, ratio, survivors } from './phenotype';
import type { PhenoOptions } from './phenotype';
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

const okResult = (result: KitResult): KitOk => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.error}`);
  return result;
};

const row = (result: KitOk, key: string) => result.rows.find((r) => r.key === key)?.value;
const complete: PhenoOptions = { dominance: 'complete', hierarchy: null, rules: [], elseName: null };
const punnett = (values: Record<string, string>) => okResult(runTool(spec, { mode: 'punnett', query: '', ...values }));

describe('Punnett squares', () => {
  it('gives 9:3:3:1 for AaBb × AaBb, P(aabb) = 1/16, and P(A_B_cc) = 9/64 for a trihybrid', () => {
    const di = punnett({ p1: 'AaBb', p2: 'AaBb', query: 'aabb' });
    expect(row(di, 'crosses.r.ratio')).toBe('9:3:3:1');
    expect(di.answer.vars?.p).toBe('1/16');
    const tri = punnett({ p1: 'AaBbCc', p2: 'AaBbCc', query: 'A_B_cc' });
    expect(tri.answer.vars?.p).toBe('9/64');
    // The product rule step: 3/4 × 3/4 × 1/4.
    expect(tri.steps.find((s) => s.key === 'crosses.s.product')?.vars?.parts).toBe(
      'P(A_) = 3/4 × P(B_) = 3/4 × P(cc) = 1/4',
    );
  });

  it('puts the dominant allele first for pea genes named Y', () => {
    const peas = punnett({ p1: 'YyRr', p2: 'YyRr' });
    const genotypes = peas.tables!.find((t) => t.title === 'crosses.h.genotypes')!.rows.map((r) => r[0]);
    expect(genotypes).toContain('YyRr');
    expect(genotypes).not.toContain('yYRr');
    expect(row(peas, 'crosses.r.ratio')).toBe('9:3:3:1');
  });

  it('adds patterns by the sum rule and counts overlapping ones once', () => {
    const sum = punnett({ p1: 'AaBb', p2: 'AaBb', query: 'AAbb, aaBB' });
    expect(sum.answer.vars?.p).toBe('1/8');
    expect(sum.steps.some((s) => s.key === 'crosses.s.sum')).toBe(true);
    const overlap = punnett({ p1: 'Aa', p2: 'Aa', query: 'A_, AA' });
    expect(overlap.answer.vars?.p).toBe('3/4');
    expect(overlap.steps.some((s) => s.key === 'crosses.s.sumOverlap')).toBe(true);
  });

  it('gives 1:2:1 for incomplete dominance and 2:1 when YY is lethal', () => {
    expect(row(punnett({ p1: 'Rr', p2: 'Rr', dominance: 'incomplete' }), 'crosses.r.ratio')).toBe('1:2:1');
    const lethal = punnett({ p1: 'Yy', p2: 'Yy', lethal: 'YY', query: 'Yy' });
    expect(row(lethal, 'crosses.r.ratio')).toBe('2:1');
    expect(lethal.answer.vars?.p).toBe('2/3');
  });

  it('gives the ABO groups 1:1:1:1 from IA/i × IB/i with the order IA = IB > i', () => {
    const p1 = parseGenotype('IA/i', 'crosses.f.p1');
    const kids = offspring(p1, parseGenotype('IB/i', 'crosses.f.p2'));
    const shares = phenotypeShares(kids, p1, { ...complete, hierarchy: [['IA', 'IB'], ['i']] });
    expect(shares.map((s) => `${s.label} ${fText(s.p)}`).sort()).toEqual(['IA 1/4', 'IA/IB 1/4', 'IB 1/4', 'i 1/4']);
  });

  it('gives each epistasis preset its ratio from AaBb × AaBb', () => {
    const expected: Record<string, string> = {
      e97: '9:7',
      e934: '9:4:3',
      e1231: '12:3:1',
      e151: '15:1',
      e133: '13:3',
      e961: '9:6:1',
    };
    for (const [dominance, want] of Object.entries(expected)) {
      expect(row(punnett({ p1: 'AaBb', p2: 'AaBb', dominance }), 'crosses.r.ratio'), dominance).toBe(want);
    }
  });

  it('follows the sex of each child for an X-linked recessive', () => {
    const p1 = parseGenotype('XA/Xa', 'crosses.f.p1');
    const kids = offspring(p1, parseGenotype('XA/Y', 'crosses.f.p2'));
    const shares = phenotypeShares(kids, p1, complete).map((s) => `${s.sex} ${s.label} ${fText(s.p)}`);
    expect(shares.sort()).toEqual(['female XA/_ 1/2', 'male XA/Y 1/4', 'male Xa/Y 1/4']);
  });

  it('applies a phenotype map with an else line', () => {
    const map = punnett({ p1: 'AaBb', p2: 'AaBb', dominance: 'custom', rules: 'A_B_ = purple\nelse = white' });
    expect(row(map, 'crosses.r.ratio')).toBe('9:7');
  });

  it('says what is wrong with an impossible cross', () => {
    const err = (values: Record<string, string>) => {
      const result = runTool(spec, { mode: 'punnett', query: '', ...values });
      return result.ok ? 'no error' : result.error;
    };
    expect(err({ p1: 'Aab', p2: 'Aa' })).toBe('crosses.e.oddLetters');
    expect(err({ p1: 'AB', p2: 'Aa' })).toBe('crosses.e.pair');
    expect(err({ p1: 'AaBb', p2: 'Aa' })).toBe('crosses.e.geneCount');
    expect(err({ p1: 'AaBb', p2: 'BbAa' })).toBe('crosses.e.geneOrder');
    expect(err({ p1: 'XA/Xa XB/Xb', p2: 'XA/Y XB/Y' })).toBe('crosses.e.oneX');
    expect(err({ p1: 'XA/Xa', p2: 'XA/Xa' })).toBe('crosses.e.sexPair');
    expect(err({ p1: 'Y/XA', p2: 'XA/Xa' })).toBe('crosses.e.yAlone');
    expect(err({ p1: 'Aa', p2: 'Aa', query: 'AaBb' })).toBe('crosses.e.patternGenes');
    expect(err({ p1: 'AA', p2: 'AA', lethal: 'AA' })).toBe('crosses.e.allLethal');
    expect(err({ p1: '', p2: 'Aa' })).toBe('crosses.e.noGenotype');
  });

  it('keeps fractions exact through survivors and ratios', () => {
    const p1 = parseGenotype('Aa', 'crosses.f.p1');
    const kids = survivors(offspring(p1, p1), p1, 'aa');
    expect(kids.map((k) => fText(k.p)).sort()).toEqual(['1/3', '2/3']);
    expect(
      ratio([
        { n: 1, d: 3 },
        { n: 2, d: 3 },
      ]),
    ).toEqual([1, 2]);
  });
});

describe('chi-square', () => {
  it('tests 315:108:101:32 against 9:3:3:1: chi2 0.47002, df 3, p 0.9254', () => {
    const test = chiSquareFit([315, 108, 101, 32], [9, 3, 3, 1]);
    expect(test.chi2).toBeCloseTo(0.47002, 4);
    expect(test.df).toBe(3);
    expect(test.p).toBeCloseTo(0.9254, 4);
  });

  it('matches closed forms of the distribution', () => {
    // df 2 is exponential: P(chi2 >= x) = exp(-x/2); df 1 at 3.841459 is the 5% point.
    expect(chiSquareP(3, 2)).toBeCloseTo(Math.exp(-1.5), 12);
    expect(chiSquareP(3.841458820694124, 1)).toBeCloseTo(0.05, 9);
    expect(chiSquareP(40, 3)).toBeLessThan(1e-7);
  });

  it('refuses mismatched or empty input', () => {
    expect(errorKey(() => chiSquareFit([1, 2], [1, 2, 3]))).toBe('e.ratioLength');
    expect(errorKey(() => chiSquareFit([0, 0], [1, 1]))).toBe('e.noCounts');
    expect(errorKey(() => chiSquareFit([5], [1]))).toBe('e.fewClasses');
    expect(errorKey(() => chiSquareFit([5, 5], [1, 0]))).toBe('e.ratioPositive');
  });
});

describe('mapping', () => {
  it('gives Haldane 25.541 cM and Kosambi 21.182 cM for r = 0.2', () => {
    expect(haldane(0.2)).toBeCloseTo(25.541, 3);
    expect(kosambi(0.2)).toBeCloseTo(21.182, 3);
    expect(haldane(0.5)).toBe(Infinity);
    const two = okResult(runTool(spec, { mode: 'twopoint', recombinants: '20', total: '100' }));
    expect(two.answer.vars?.haldane).toBe('25.541');
    const far = runTool(spec, { mode: 'twopoint', recombinants: '50', total: '100' });
    expect(far.ok ? '' : far.error).toBe('crosses.e.unlinked');
  });

  it('orders a three-point cross from the doubles: 11.5 and 10.5 cM, coincidence 0.828, interference 0.172', () => {
    const t = threePoint(readClasses('+ + + 400\na c b 390\n+ c b 55\na + + 50\na + b 50\n+ c + 45\n+ + b 5\na c + 5'));
    expect(t.order.map((i) => t.genes[i])).toEqual(['a', 'b', 'c']);
    expect(t.rLeft * 100).toBeCloseTo(11.5, 9);
    expect(t.rRight * 100).toBeCloseTo(10.5, 9);
    expect(t.coincidence).toBeCloseTo(0.828, 3);
    expect(t.interference).toBeCloseTo(0.172, 3);
  });

  it('refuses a three-point table that is not 8 reciprocal classes', () => {
    expect(errorKey(() => readClasses('+ + + 400'))).toBe('crosses.e.eightClasses');
    expect(errorKey(() => readClasses('+ + 400\n'.repeat(8)))).toBe('crosses.e.classLine');
    const bad = '+ + + 400\na c b 390\n+ c b 55\na + + 50\na + b 50\n+ c + 45\n+ + b 5\na + + 5';
    expect(errorKey(() => threePoint(readClasses(bad)))).toBe('crosses.e.duplicateClass');
  });

  it('scores 2 recombinants in 10 phase-known meioses LOD 0.83708 at theta 0.2', () => {
    expect(lod([{ recombinants: 2, meioses: 10 }], 0.2, true)).toBeCloseTo(0.83708, 5);
    // The maximum is at theta = R/N for phase-known meioses.
    const best = maxLod([{ recombinants: 2, meioses: 10 }], true);
    expect(best.theta).toBeCloseTo(0.2, 6);
    // Phase unknown with no recombinants: log10((0.5^10 ... )) at theta 0 is log10(0.5 / 0.5^10) = 9 log10 2.
    expect(lod([{ recombinants: 0, meioses: 10 }], 0, false)).toBeCloseTo(9 * Math.log10(2), 12);
    expect(lod([{ recombinants: 0, meioses: 4 }], 0.5, true)).toBeCloseTo(0, 12);
  });
});

describe('carrier risk', () => {
  it('gives 0.2 for a prior of 1/2 and 2 unaffected sons', () => {
    const r = okResult(runTool(spec, { mode: 'bayes', scenario: 'xlinked', prior: '1/2', sons: '2' }));
    expect(Number(row(r, 'crosses.r.posterior'))).toBeCloseTo(0.2, 12);
    expect(Number(row(r, 'crosses.r.nextSon'))).toBeCloseTo(0.1, 12);
  });

  it('takes typed chances and refuses ones that cannot happen', () => {
    const r = okResult(
      runTool(spec, { mode: 'bayes', scenario: 'custom', prior: '2/3', likeCarrier: '25%', likeNon: '1' }),
    );
    expect(Number(row(r, 'crosses.r.posterior'))).toBeCloseTo(1 / 3, 6);
    const bad = runTool(spec, { mode: 'bayes', scenario: 'custom', prior: '1', likeCarrier: '0', likeNon: '1' });
    expect(bad.ok ? '' : bad.error).toBe('crosses.e.impossible');
    const range = runTool(spec, { mode: 'bayes', scenario: 'custom', prior: '3/2' });
    expect(range.ok ? '' : range.error).toBe('e.probabilityRange');
  });
});

describe('every mode', () => {
  it('runs its worked example', () => {
    for (const mode of ['punnett', 'chisq', 'twopoint', 'threepoint', 'lod', 'bayes']) {
      expect(runTool(spec, { mode }).ok, mode).toBe(true);
    }
  });
});
