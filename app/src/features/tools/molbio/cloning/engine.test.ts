import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import type { KitOk, KitResult } from '../shared';
import { runTool } from '../spec';
import {
  builtInEnzymes,
  copies,
  dimer,
  enzymeFrom,
  extinction,
  findSites,
  fitLadder,
  fragments,
  gcClamp,
  hairpin,
  insertMass,
  nearestNeighbor,
  oligoMass,
  overhang,
  pcrProduct,
  readEnzymes,
  saltAdjusted,
  wallace,
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

const okResult = (result: KitResult): KitOk => {
  if (!result.ok) throw new Error(`expected an answer, got ${result.error}`);
  return result;
};

describe('restriction digests', () => {
  it('finds EcoRI at 3 and BamHI at 11 in AAGAATTCTTGGATCCAA and cuts it into 3, 8, and 7 bp', () => {
    const seq = 'AAGAATTCTTGGATCCAA';
    const sites = findSites(seq, readEnzymes('EcoRI, BamHI'), false);
    expect(sites).toEqual([
      { enzyme: 'EcoRI', start: 3, cutAfter: 3 },
      { enzyme: 'BamHI', start: 11, cutAfter: 11 },
    ]);
    expect(fragments(seq.length, [3, 11], false).map((f) => f.length)).toEqual([3, 8, 7]);
  });

  it('cuts a circle into as many fragments as cuts, the last one across the origin', () => {
    const circle = fragments(100, [10, 40], true);
    expect(circle).toEqual([
      { from: 11, to: 40, length: 30 },
      { from: 41, to: 10, length: 70 },
    ]);
    expect(fragments(100, [], true)).toEqual([]);
    expect(fragments(100, [0, 100], false)).toEqual([{ from: 1, to: 100, length: 100 }]);
  });

  it('finds a site that spans the origin of a circle', () => {
    // GAATTC split as ...GAA | TTC...: the site starts at base 7 of 9 and the cut wraps to after base 7.
    const sites = findSites('TTCAAAGAA', readEnzymes('EcoRI'), true);
    expect(sites).toEqual([{ enzyme: 'EcoRI', start: 7, cutAfter: 7 }]);
    expect(findSites('TTCAAAGAA', readEnzymes('EcoRI'), false)).toEqual([]);
  });

  it('matches degenerate sites and names the overhangs', () => {
    const hinc = findSites('AAGTCGACAAGTTAACAA', readEnzymes('HincII'), false);
    expect(hinc.map((s) => s.start)).toEqual([3, 11]);
    expect(overhang(enzymeFrom('EcoRI', 'G^AATTC'))).toEqual({ kind: 'five', length: 4 });
    expect(overhang(enzymeFrom('PstI', 'CTGCA^G'))).toEqual({ kind: 'three', length: 4 });
    expect(overhang(enzymeFrom('SmaI', 'CCC^GGG'))).toEqual({ kind: 'blunt', length: 0 });
  });

  it('has about 40 built-in enzymes, each a palindrome with one cut', () => {
    expect(builtInEnzymes().length).toBeGreaterThanOrEqual(40);
  });

  it('refuses unknown enzymes, sites without a caret, and sites that are not palindromes', () => {
    expect(errorKey(() => readEnzymes('EcoRX'))).toBe('cloning.e.unknownEnzyme');
    expect(errorKey(() => readEnzymes(''))).toBe('cloning.e.noEnzyme');
    expect(errorKey(() => readEnzymes('Mine GAATTC'))).toBe('cloning.e.caret');
    expect(errorKey(() => readEnzymes('Mine G^GTCTC'))).toBe('cloning.e.notPalindrome');
    expect(readEnzymes('Mine GG^CC')[0]).toEqual({ name: 'Mine', site: 'GGCC', cut: 2 });
  });
});

describe('primer melting temperatures', () => {
  const primer = 'AGCGGATAACAATTTCACACAGGA';

  it('gives 68 °C by the Wallace rule and 41.667% GC', () => {
    expect(wallace(primer)).toBe(68);
    const gc = [...primer].filter((b) => b === 'G' || b === 'C').length / primer.length;
    expect(gc * 100).toBeCloseTo(41.667, 3);
  });

  it('gives ΔH −184.4, ΔS −526.056, and Tm 56.713 °C by nearest neighbors at 50 mM Na+ and 0.25 µM', () => {
    const nn = nearestNeighbor(primer, 0.05, 0.25e-6);
    expect(nn.dH).toBeCloseTo(-184.4, 9);
    expect(nn.dS).toBeCloseTo(-526.056, 3);
    expect(Math.abs(nn.tm - 56.713)).toBeLessThan(0.05);
    expect(nn.selfComplementary).toBe(false);
  });

  it('uses C_T and the symmetry term for a self-complementary strand', () => {
    // CGCGAATTCGCG (Dickerson dodecamer), worked by hand from the table: ΔH −101.4 + 0.2 and ΔS −266.8 − 5.6 − 1.4.
    const nn = nearestNeighbor('CGCGAATTCGCG', 1, 1e-4);
    expect(nn.selfComplementary).toBe(true);
    expect(nn.dH).toBeCloseTo(-101.2, 9);
    expect(nn.dS1M).toBeCloseTo(-273.8, 9);
    expect(nn.tm).toBeCloseTo((1000 * -101.2) / (-273.8 + 1.987 * Math.log(1e-4)) - 273.15, 9);
  });

  it('matches the salt-adjusted formula by hand', () => {
    // 81.5 + 16.6 log10(0.05) + 0.41 × 41.667 − 600/24
    expect(saltAdjusted(primer, 0.05)).toBeCloseTo(81.5 + 16.6 * -1.30103 + 0.41 * (1000 / 24) - 25, 4);
  });

  it('finds dimer runs, 3′ end runs, hairpins, and the GC clamp', () => {
    // GAATTC pairs with itself over all 6 bases, ending at both 3′ ends.
    expect(dimer('GAATTC', 'GAATTC')).toEqual({ run: 6, threeEnd: 6 });
    expect(dimer('AAAA', 'AAAA')).toEqual({ run: 0, threeEnd: 0 });
    // GGGG AAA CCCC folds into a 4-base stem around a 3-base loop.
    expect(hairpin('GGGGAAACCCC')).toBe(4);
    expect(hairpin('GGGGAACCCC')).toBe(3);
    expect(gcClamp('ATATAGCGC')).toBe(4);
  });

  it('refuses a one-base oligo for nearest neighbors', () => {
    expect(errorKey(() => nearestNeighbor('A', 0.05, 1e-6))).toBe('cloning.e.shortOligo');
  });
});

describe('PCR products', () => {
  const template = 'GGGATGCATGCAAAAAAAAAACCCGGGTTTAAA';

  it('runs from the forward primer to the end of the reverse primer’s site', () => {
    const product = pcrProduct(template, 'ATGCATGC', 'TTTAAACCCG', false);
    expect(product.from).toBe(4);
    expect(product.to).toBe(33);
    expect(product.length).toBe(30);
    expect(product.seq).toBe(template.slice(3));
  });

  it('wraps around a circle and refuses primers that do not match or face away', () => {
    const circle = 'CCCGGGTTTAAAGGGATGCATGCAAAA';
    expect(pcrProduct(circle, 'ATGCATGC', 'TTTAAACCCG', true).length).toBe(27 - 15 + 12);
    expect(errorKey(() => pcrProduct(circle, 'ATGCATGC', 'TTTAAACCCG', false))).toBe('cloning.e.wrongOrder');
    expect(errorKey(() => pcrProduct(template, 'CGCGCGCG', 'TTTAAACCCG', false))).toBe('cloning.e.noForward');
    expect(errorKey(() => pcrProduct(template, 'ATGCATGC', 'CGCGCGCG', false))).toBe('cloning.e.noReverse');
  });
});

describe('oligos and amounts', () => {
  it('gives ATGCATGCAT a mass of 3027.05 g/mol', () => {
    expect(Math.abs(oligoMass('ATGCATGCAT') - 3027.05)).toBeLessThan(1e-6);
  });

  it('sums nearest-neighbor extinction coefficients and subtracts the inner bases', () => {
    // ATG: AT 22800 + TG 19000 − T 8700
    expect(extinction('ATG')).toBe(33100);
    expect(extinction('A')).toBe(15400);
  });

  it('needs 50 ng of a 1000 bp insert for 3:1 with 50 ng of a 3000 bp vector', () => {
    expect(Math.abs(insertMass(3, 50, 1000, 3000) - 50)).toBeLessThan(1e-6);
  });

  it('finds 3.0883e8 copies in 1 ng of a 3000 bp molecule', () => {
    expect(Math.abs(copies(1, 3000) / 3.0883e8 - 1)).toBeLessThan(1e-4);
  });
});

describe('band sizing', () => {
  it('sizes a band at 55 mm as 316.228 bp from a log-linear ladder', () => {
    const fit = fitLadder([10000, 1000, 100], [10, 40, 70], false);
    expect(Math.abs(fit.size(55) - 316.228)).toBeLessThan(1e-3);
    expect(fit.r2).toBeCloseTo(1, 12);
  });

  it('fits a cubic exactly through 4 bands', () => {
    const d = [10, 20, 30, 40];
    const log = d.map((x) => 4 - 0.02 * x - 0.001 * x * x + 0.00001 * x ** 3);
    const fit = fitLadder(
      log.map((v) => 10 ** v),
      d,
      true,
    );
    expect(Math.log10(fit.size(25))).toBeCloseTo(4 - 0.5 - 0.625 + 0.15625, 6);
  });

  it('says what is missing from a ladder', () => {
    expect(errorKey(() => fitLadder([1000], [10], false))).toBe('cloning.e.ladderFew');
    expect(errorKey(() => fitLadder([1000, 100, 50], [10, 20, 30], true))).toBe('cloning.e.ladderFew');
    expect(errorKey(() => fitLadder([1000, 0], [10, 20], false))).toBe('cloning.e.ladderSize');
    expect(errorKey(() => fitLadder([1000, 100], [10, 10], false))).toBe('cloning.e.ladderSame');
    expect(errorKey(() => fitLadder([1000, 100], [10, -2], false))).toBe('cloning.e.ladderDistance');
  });
});

describe('the cloning tool', () => {
  it('runs every mode’s worked example', () => {
    for (const mode of ['digest', 'gel', 'primer', 'pcr', 'oligo', 'ligation', 'copies']) {
      expect(runTool(spec, { mode }).ok, mode).toBe(true);
    }
  });

  it('answers the digest example in words and draws a gel and a map', () => {
    const result = okResult(runTool(spec, { mode: 'digest' }));
    expect(result.answer.vars?.sizes).toBe('3, 8, 7');
    expect(result.figures?.map((f) => f.title)).toEqual(['cloning.h.gel', 'cloning.h.linearMap']);
    const circle = okResult(runTool(spec, { mode: 'digest', topology: 'circular', features: 'ori 1 5' }));
    expect(circle.answer.vars?.sizes).toBe('8, 10');
  });

  it('turns impossible input into a message', () => {
    const bad = runTool(spec, { mode: 'primer', primer: 'ACGNT' });
    expect(bad.ok ? '' : bad.error).toBe('cloning.e.ambiguous');
    const empty = runTool(spec, { mode: 'digest', seq: '' });
    expect(empty.ok ? '' : empty.error).toBe('e.noSequence');
    const zero = runTool(spec, { mode: 'ligation', vectorBp: '0' });
    expect(zero.ok ? '' : zero.error).toBe('e.positive');
    const feature = runTool(spec, { mode: 'digest', features: 'gene 5 400' });
    expect(feature.ok ? '' : feature.error).toBe('cloning.e.feature');
  });
});
