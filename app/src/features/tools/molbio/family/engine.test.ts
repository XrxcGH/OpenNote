import { describe, expect, it } from 'vitest';
import { KitError } from '../shared';
import type { KitResult } from '../shared';
import { runTool } from '../spec';
import { HALF, chartFigure, crosses, layout } from './chart';
import { cousinKind, inbreeding, kinType, kinship, paths, readKinType, relationship, succession } from './kin';
import { peel } from './peel';
import { readFamily } from './people';
import { checkPatterns } from './rules';
import type { Pattern } from './rules';
import { fraction, spec } from './tool';

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

const verdicts = (text: string, incomplete = false) =>
  Object.fromEntries(checkPatterns(readFamily(text), { incomplete, rare: true }).map((v) => [v.pattern, v])) as Record<
    Pattern,
    ReturnType<typeof checkPatterns>[number]
  >;

const COUSINS = [
  'G1, M',
  'G2, F',
  'C1, M, G1, G2',
  'C2, F, G1, G2',
  'C3, M, G1, G2',
  'P1, F',
  'P2, M',
  'K1, F, C1, P1',
  'K2, M, C1, P1',
  'K3, M, P2, C2',
  'K4, F, P2, C2',
].join('\n');

describe('inheritance patterns', () => {
  it('fits only autosomal recessive for unaffected parents with an affected daughter', () => {
    const v = verdicts('F, M\nM, F\nD, F, F, M, affected');
    expect(v.ar.consistent).toBe(true);
    expect(v.xr).toMatchObject({ consistent: false, rule: 'xrDaughter' });
    expect(v.ad).toMatchObject({ consistent: false, rule: 'adParents' });
    expect(v.xd).toMatchObject({ consistent: false, rule: 'xdDaughter' });
    expect(v.y).toMatchObject({ consistent: false, rule: 'yFemale' });
    expect(v.mt).toMatchObject({ consistent: false, rule: 'mtChild' });
    // Allowing non-penetrance lets the dominant patterns through.
    const loose = verdicts('F, M\nM, F\nD, F, F, M, affected', true);
    expect(loose.ad.consistent).toBe(true);
    expect(loose.xd.consistent).toBe(true);
  });

  it('fits both dominant patterns for an affected father with 3 affected daughters and 2 unaffected sons', () => {
    const v = verdicts(
      [
        'Dad, M, , , affected',
        'Mum, F',
        'D1, F, Dad, Mum, affected',
        'D2, F, Dad, Mum, affected',
        'D3, F, Dad, Mum, affected',
        'S1, M, Dad, Mum',
        'S2, M, Dad, Mum',
      ].join('\n'),
    );
    expect(v.xd.consistent).toBe(true);
    expect(v.ad.consistent).toBe(true);
    expect(v.xr).toMatchObject({ consistent: false, rule: 'xrRare' });
    expect(v.y).toMatchObject({ consistent: false });
    expect(v.mt).toMatchObject({ consistent: false, rule: 'mtChild' });
  });

  it('excludes autosomal recessive when two affected parents have an unaffected child', () => {
    expect(verdicts('F, M, , , affected\nM, F, , , affected\nC, M, F, M').ar).toMatchObject({
      consistent: false,
      rule: 'arBoth',
    });
  });
});

describe('relatedness', () => {
  it('gives first cousins r = 1/8 and their child F = 1/16', () => {
    const family = readFamily(COUSINS);
    const list = paths(family, 'K1', 'K3');
    expect(list.map((p) => p.ancestor).sort()).toEqual(['G1', 'G2']);
    expect(list.every((p) => p.steps === 4)).toBe(true);
    expect(relationship(list)).toBe(1 / 8);
    expect(kinship(family)('K1', 'K3')).toBe(1 / 16);
    const child = readFamily(`${COUSINS}\nX, U, K3, K1`);
    expect(inbreeding(child, 'X')).toBe(1 / 16);
  });

  it('gives siblings 1/2, a parent and child 1/2, and an uncle 1/4', () => {
    const family = readFamily(COUSINS);
    expect(relationship(paths(family, 'C1', 'C2'))).toBe(1 / 2);
    expect(relationship(paths(family, 'G1', 'C1'))).toBe(1 / 2);
    expect(relationship(paths(family, 'C1', 'K3'))).toBe(1 / 4);
    expect(relationship(paths(family, 'P1', 'P2'))).toBe(0);
    expect(kinship(family)('C1', 'C1')).toBe(1 / 2);
  });

  it('shows fractions exactly', () => {
    expect(fraction(1 / 8)).toBe('1/8');
    expect(fraction(2 / 3)).toBe('2/3');
    expect(fraction(1)).toBe('1');
  });
});

describe('kin types', () => {
  it('reads Ego’s father’s brother’s daughter as FBD, a parallel cousin', () => {
    const family = readFamily(
      [
        'GF, M',
        'GM, F',
        'Dad, M, GF, GM',
        'Mum, F',
        'Uncle, M, GF, GM',
        'Aunt, F',
        'Ego, M, Dad, Mum',
        'Cousin, F, Uncle, Aunt',
      ].join('\n'),
    );
    expect(kinType(family, 'Ego', 'Cousin')).toBe('FBD');
    expect(cousinKind('FBD')).toBe('parallel');
    expect(cousinKind('FZD')).toBe('cross');
    expect(cousinKind('MBS')).toBe('cross');
    expect(cousinKind('FB')).toBeNull();
    expect(kinType(family, 'Ego', 'Aunt')).toBe('FBW');
    expect(kinType(family, 'Cousin', 'Ego')).toBe('FBS');
  });

  it('refuses letters that are not kin types', () => {
    expect(readKinType('f b d')).toBe('FBD');
    expect(errorKey(() => readKinType('FXD'))).toBe('family.e.kinLetter');
    expect(errorKey(() => readKinType(''))).toBe('family.e.noKinType');
  });
});

describe('probabilities by peeling', () => {
  it('gives an unaffected sibling of an affected child a 2/3 chance of being a carrier', () => {
    const family = readFamily('F, M\nM, F\nA, F, F, M, affected\nS, M, F, M');
    const r = peel(family, 'ar', 1e-6, 'S');
    expect(r.posterior[1]).toBeCloseTo(2 / 3, 5);
    expect(r.posterior[2]).toBe(0);
  });

  it('gives a possible carrier with 2 unaffected sons a carrier chance of 0.2 (X-linked recessive)', () => {
    const family = readFamily(
      ['GF, M', 'GM, F, , , carrier', 'Mum, F, GF, GM', 'Dad, M', 'S1, M, Dad, Mum', 'S2, M, Dad, Mum'].join('\n'),
    );
    expect(peel(family, 'xr', 1e-9, 'Mum').posterior[1]).toBeCloseTo(0.2, 6);
  });

  it('refuses statuses the pattern cannot explain and pedigrees without sexes for X-linkage', () => {
    expect(
      errorKey(() => peel(readFamily('F, M, , , affected\nM, F, , , affected\nC, M, F, M'), 'ar', 0.01, 'C')),
    ).toBe('family.e.impossible');
    expect(errorKey(() => peel(readFamily('A, U\nB, F'), 'xr', 0.01, 'B'))).toBe('family.e.sexNeeded');
    expect(errorKey(() => peel(readFamily('A, M'), 'ar', 0, 'A'))).toBe('family.e.frequency');
  });
});

describe('layout', () => {
  it('puts a three-generation family in 3 rows with partners adjacent, no overlaps, and no crossing lines', () => {
    const family = readFamily(COUSINS);
    const plan = layout(family);
    expect(plan.rows.length).toBe(3);
    for (const [a, b] of plan.couples) {
      const row = plan.rows.find((r) => r.includes(a))!;
      expect(row.includes(b)).toBe(true);
      expect(Math.abs(row.indexOf(a) - row.indexOf(b))).toBe(1);
    }
    for (const row of plan.rows) {
      const xs = row.map((id) => plan.at.get(id)!.x).sort((x, y) => x - y);
      for (let k = 1; k < xs.length; k++) expect(xs[k]! - xs[k - 1]!).toBeGreaterThan(2 * HALF + 10);
    }
    for (let i = 0; i < plan.lines.length; i++)
      for (let j = i + 1; j < plan.lines.length; j++) expect(crosses(plan.lines[i]!, plan.lines[j]!)).toBe(false);
    expect(chartFigure(family).figure.shapes.length).toBeGreaterThan(20);
  });
});

describe('reading people and the tool', () => {
  it('says what is wrong with a person list', () => {
    expect(errorKey(() => readFamily(''))).toBe('family.e.empty');
    expect(errorKey(() => readFamily('A, M\nA, F'))).toBe('family.e.duplicate');
    expect(errorKey(() => readFamily('A, X'))).toBe('family.e.sex');
    expect(errorKey(() => readFamily('A, M, B'))).toBe('family.e.missingParent');
    expect(errorKey(() => readFamily('B, F\nA, M, B'))).toBe('family.e.fatherSex');
    expect(errorKey(() => readFamily('A, M, , , tall'))).toBe('family.e.mark');
    expect(errorKey(() => readFamily('A, M, B, \nB, M, A'))).toBe('family.e.cycle');
  });

  it('orders succession by birth, with sons first under male preference', () => {
    const family = readFamily(
      ['K, M', 'Q, F', 'D1, F, K, Q, born:1950', 'S1, M, K, Q, born:1952', 'G, M, S1, , born:1980'].join('\n'),
    );
    expect(succession(family, 'K', false)).toEqual(['D1', 'S1', 'G']);
    expect(succession(family, 'K', true)).toEqual(['S1', 'G', 'D1']);
  });

  it('runs every mode’s worked example', () => {
    for (const mode of ['pedigree', 'probability', 'relationship', 'kinship', 'genealogy', 'genogram']) {
      expect(failed(runTool(spec, { mode })), mode).toBe('ok');
    }
    expect(failed(runTool(spec, { mode: 'relationship', b: 'Gus' }))).toBe('family.e.samePerson');
    expect(failed(runTool(spec, { mode: 'genogram', relations: 'Carl Eve friends' }))).toBe('family.e.relationLine');
  });

  it('prints an inbred common ancestor’s (1 + F_A) factor in the relatedness sum', () => {
    // Father D is a child of full sibs X and Y, so F_D = 1/4. For his children S1 and S2:
    // via D (1/2)^2 (1 + 1/4) = 5/16, via mother M (1/2)^2 = 4/16, total 9/16.
    const people = [
      'GA, M',
      'GB, F',
      'X, M, GA, GB',
      'Y, F, GA, GB',
      'D, M, X, Y',
      'M, F',
      'S1, M, D, M',
      'S2, F, D, M',
    ];
    const result = runTool(spec, { mode: 'relationship', people: people.join('\n'), a: 'S1', b: 'S2' });
    if (!result.ok) throw new Error(result.error);
    const inbred = '(\\tfrac{1}{2})^{2}(1 + 1/4)';
    const plain = '(\\tfrac{1}{2})^{2}';
    expect([`${inbred} + ${plain}`, `${plain} + ${inbred}`]).toContain(result.latex?.split(' = ').at(-2));
    expect(result.latex?.endsWith(' = 9/16')).toBe(true);
  });
});
