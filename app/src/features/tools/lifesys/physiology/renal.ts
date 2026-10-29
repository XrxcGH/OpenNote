// Renal physiology and acid-base balance: clearance, GFR, renal plasma flow, renal blood flow, filtration fraction, FENa,
// free-water clearance, glucose titration with a transport maximum and splay, the CO₂-bicarbonate
// Henderson-Hasselbalch equation, the primary disorder with its expected compensation, and the anion gap.
import { LsError, nonNegative, positive, within } from '../num/errors';
import type { CalcResult, ResultRow, Step } from '../types';

type Point = [number, number];

/** Clearance C = U V / P, in the unit of V (mL/min). */
export const clearance = (u: number, v: number, p: number): number => (u * v) / p;

export function clearanceResult(
  u: number,
  v: number,
  p: number,
  pahU: number | null,
  pahP: number | null,
  hct: number | null,
): CalcResult {
  nonNegative(u, 'U');
  positive(v, 'V');
  positive(p, 'P');
  const gfr = clearance(u, v, p);
  const rows: ResultRow[] = [{ label: 'physiology.r.clearance', value: gfr, unit: 'mL/min' }];
  const steps: Step[] = [{ key: 'physiology.s.clearance', vars: { u, v, p, c: gfr }, math: 'C = \\frac{U V}{P}' }];
  if (pahU !== null || pahP !== null) {
    if (pahU === null || pahP === null) throw new LsError('physiology.e.pahPair');
    const rpf = clearance(nonNegative(pahU, 'U_PAH'), v, positive(pahP, 'P_PAH'));
    rows.push(
      { label: 'physiology.r.rpf', value: rpf, unit: 'mL/min' },
      { label: 'physiology.r.ff', value: (100 * gfr) / rpf, unit: '%' },
    );
    steps.push({ key: 'physiology.s.rpf', vars: { u: pahU, v, p: pahP, rpf, gfr, ff: (100 * gfr) / rpf } });
    if (hct !== null) {
      within(hct, 'Hct', 0, 0.99);
      rows.push({ label: 'physiology.r.rbf', value: rpf / (1 - hct), unit: 'mL/min' });
      steps.push({ key: 'physiology.s.rbf', vars: { rpf, h: hct, rbf: rpf / (1 - hct) } });
    }
  }
  return { rows, steps, latex: 'C = \\frac{U V}{P}', notes: [{ key: 'physiology.n.inulin' }] };
}

export const fena = (uNa: number, pNa: number, uCr: number, pCr: number): number => (100 * uNa * pCr) / (pNa * uCr);

export function tubuleResult(
  uNa: number,
  pNa: number,
  uCr: number,
  pCr: number,
  v: number | null,
  uOsm: number | null,
  pOsm: number | null,
): CalcResult {
  nonNegative(uNa, 'U_Na');
  positive(pNa, 'P_Na');
  positive(uCr, 'U_Cr');
  positive(pCr, 'P_Cr');
  const f = fena(uNa, pNa, uCr, pCr);
  const rows: ResultRow[] = [{ label: 'physiology.r.fena', value: f, unit: '%' }];
  const steps: Step[] = [
    {
      key: 'physiology.s.fena',
      vars: { un: uNa, pn: pNa, uc: uCr, pc: pCr, f },
      math: 'FE_{Na} = \\frac{U_{Na} P_{Cr}}{P_{Na} U_{Cr}} \\times 100',
    },
  ];
  if (v !== null || uOsm !== null || pOsm !== null) {
    if (v === null || uOsm === null || pOsm === null) throw new LsError('physiology.e.waterTriple');
    const cOsm = clearance(nonNegative(uOsm, 'U_osm'), positive(v, 'V'), positive(pOsm, 'P_osm'));
    const cWater = v - cOsm;
    rows.push(
      { label: 'physiology.r.cOsm', value: cOsm, unit: 'mL/min' },
      { label: 'physiology.r.cWater', value: cWater, unit: 'mL/min' },
    );
    steps.push({
      key: cWater >= 0 ? 'physiology.s.freeWater' : 'physiology.s.freeWaterNegative',
      vars: { v, u: uOsm, p: pOsm, c: cOsm, w: cWater },
      math: 'C_{H_2O} = V - \\frac{U_{osm} V}{P_{osm}}',
    });
  }
  return { rows, steps, latex: 'FE_{Na} = \\frac{U_{Na} P_{Cr}}{P_{Na} U_{Cr}} \\times 100' };
}

/**
 * Reabsorption against filtered load with splay: the smaller root of θR² − (F + Tm)R + F Tm = 0, a non-rectangular
 * hyperbola that bends from R = F to R = Tm. θ = 1 is the sharp, ideal titration curve.
 */
export function reabsorbed(load: number, tm: number, theta: number): number {
  if (theta >= 1 - 1e-12) return Math.min(load, tm);
  const b = load + tm;
  return (b - Math.sqrt(b * b - 4 * theta * load * tm)) / (2 * theta);
}

export function titrationResult(gfr: number, plasma: number, tm: number, theta: number): CalcResult {
  positive(gfr, 'GFR');
  nonNegative(plasma, 'P');
  positive(tm, 'Tm');
  within(theta, 'θ', 0.01, 1);
  const load = (gfr * plasma) / 100;
  const r = reabsorbed(load, tm, theta);
  const threshold = (100 * tm) / gfr;
  const top = Math.max(plasma * 1.5, threshold * 2.5);
  const grid = Array.from({ length: 101 }, (_, i) => (top * i) / 100);
  return {
    rows: [
      { label: 'physiology.r.load', value: load, unit: 'mg/min' },
      { label: 'physiology.r.reabsorbed', value: r, unit: 'mg/min' },
      { label: 'physiology.r.excreted', value: load - r, unit: 'mg/min' },
      { label: 'physiology.r.threshold', value: threshold, unit: 'mg/dL' },
    ],
    steps: [
      { key: 'physiology.s.load', vars: { g: gfr, p: plasma, l: load } },
      { key: 'physiology.s.reabsorb', vars: { tm, r, e: load - r } },
      { key: 'physiology.s.threshold', vars: { tm, g: gfr, t: threshold } },
    ],
    latex: '\\text{filtered load} = GFR \\times P',
    notes: [{ key: 'physiology.n.splay' }],
    plots: [
      {
        title: 'physiology.p.titration',
        x: { label: 'physiology.p.plasmaGlucose' },
        y: { label: 'physiology.p.rate', min: 0 },
        series: [
          { name: 'physiology.p.filtered', points: grid.map((p) => [p, (gfr * p) / 100] as Point) },
          {
            name: 'physiology.p.reabsorbedSeries',
            style: 'dashed',
            points: grid.map((p) => [p, reabsorbed((gfr * p) / 100, tm, theta)] as Point),
          },
          {
            name: 'physiology.p.excretedSeries',
            style: 'outline',
            points: grid.map((p) => [p, (gfr * p) / 100 - reabsorbed((gfr * p) / 100, tm, theta)] as Point),
          },
        ],
      },
    ],
  };
}

/** pH = 6.1 + log₁₀(HCO₃⁻ / (0.03 PCO₂)). */
export const phFrom = (hco3: number, pco2: number): number => 6.1 + Math.log10(hco3 / (0.03 * pco2));

export type Disorder = 'normal' | 'metAcidosis' | 'metAlkalosis' | 'respAcidosis' | 'respAlkalosis';

/** The primary disorder by the pH and which value moved it, with the expected compensation range. */
export function classify(ph: number, pco2: number, hco3: number, chronic: boolean) {
  // Which value moved the pH the wrong way, by its relative change from 24 mEq/L and 40 mmHg.
  const metabolic = (24 - hco3) / 24;
  const respiratory = (pco2 - 40) / 40;
  let disorder: Disorder = 'normal';
  if (ph < 7.35) disorder = metabolic > 0 && metabolic >= respiratory ? 'metAcidosis' : 'respAcidosis';
  else if (ph > 7.45) disorder = metabolic < 0 && -metabolic >= -respiratory ? 'metAlkalosis' : 'respAlkalosis';
  let expected: [number, number] | null = null;
  let measure: 'pco2' | 'hco3' = 'pco2';
  if (disorder === 'metAcidosis') expected = [1.5 * hco3 + 8 - 2, 1.5 * hco3 + 8 + 2];
  else if (disorder === 'metAlkalosis') expected = [0.7 * hco3 + 21 - 2, 0.7 * hco3 + 21 + 2];
  else if (disorder === 'respAcidosis' || disorder === 'respAlkalosis') {
    measure = 'hco3';
    const per10 = disorder === 'respAcidosis' ? (chronic ? 3.5 : 1) : chronic ? 5 : 2;
    const centre = 24 + ((disorder === 'respAcidosis' ? 1 : -1) * per10 * Math.abs(pco2 - 40)) / 10;
    expected = [centre - 2, centre + 2];
  }
  return { disorder, expected, measure };
}

export function acidBaseResult(
  hco3: number,
  pco2: number,
  chronic: boolean,
  na: number | null,
  cl: number | null,
  albumin: number | null,
): CalcResult {
  positive(hco3, 'HCO₃⁻');
  positive(pco2, 'PCO₂');
  const ph = phFrom(hco3, pco2);
  const c = classify(ph, pco2, hco3, chronic);
  const rows: ResultRow[] = [
    { label: 'physiology.r.ph', value: ph, digits: 4 },
    { label: 'physiology.r.disorder', value: '', word: `physiology.o.${c.disorder}` },
  ];
  const latex = 'pH = 6.1 + \\log_{10}\\frac{[HCO_3^-]}{0.03\\,P_{CO_2}}';
  const steps: Step[] = [
    { key: 'physiology.s.hh', vars: { h: hco3, c: pco2, r: hco3 / (0.03 * pco2), ph }, math: latex },
  ];
  if (c.expected) {
    const [low, high] = c.expected;
    const actual = c.measure === 'pco2' ? pco2 : hco3;
    rows.push({
      label: `physiology.r.expected.${c.measure}`,
      value: '',
      word: 'physiology.r.range',
      wordVars: { low, high },
    });
    const verdict = actual < low ? 'below' : actual > high ? 'above' : 'within';
    steps.push({
      key: `physiology.s.comp.${c.disorder as Exclude<Disorder, 'normal'>}`,
      vars: { h: hco3, c: pco2, low, high },
    });
    steps.push({ key: `physiology.s.verdict.${c.measure}.${verdict}`, vars: { v: actual } });
  }
  if (na !== null || cl !== null) {
    if (na === null || cl === null) throw new LsError('physiology.e.gapPair');
    const gap = positive(na, 'Na⁺') - nonNegative(cl, 'Cl⁻') - hco3;
    const corrected = albumin === null ? gap : gap + 2.5 * (4 - nonNegative(albumin, 'albumin'));
    rows.push({ label: 'physiology.r.anionGap', value: gap, unit: 'mEq/L' });
    steps.push({ key: 'physiology.s.gap', vars: { na, cl, h: hco3, g: gap } });
    if (albumin !== null) {
      rows.push({ label: 'physiology.r.gapCorrected', value: corrected, unit: 'mEq/L' });
      steps.push({ key: 'physiology.s.gapAlbumin', vars: { g: gap, a: albumin, c: corrected } });
    }
    if (corrected > 12 && hco3 < 24) {
      const delta = (corrected - 12) / (24 - hco3);
      rows.push({ label: 'physiology.r.delta', value: delta });
      steps.push({ key: 'physiology.s.delta', vars: { g: corrected, h: hco3, d: delta } });
    }
  }
  return { rows, steps, latex, notes: [{ key: 'physiology.n.acidBase' }] };
}
