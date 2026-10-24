// Mechanical behavior from data: a tensile test (modulus, 0.2% offset yield, ultimate strength, toughness, true values)
// and a fit of fatigue data to Basquin's law. Stress comes in the unit the student chooses and is converted to pascals.
import { latexNumber } from '../chemText';
import { bracketScan, lineFit } from '../num';
import { fail } from '../types';
import type { Failed, KitStep, Outcome, PlotData, Row, Series } from '../types';
import { parseTable } from '../kinetics/engine';

/** Pascals per unit, for the stress units the data may be in. */
export const STRESS_UNITS: Record<string, number> = { MPa: 1e6, ksi: 6.894757293168e6, psi: 6894.757293168, GPa: 1e9 };

/** Linear interpolation of y(x) over increasing x; the end values hold outside the data. */
export function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

export interface TensileInput {
  data: string;
  /** 'fraction' or 'percent' for the strain column. */
  strainUnit: string;
  stressUnit: string;
  /** Fit the modulus to points up to this percent of the largest stress. */
  elasticPercent: number;
  /** Modulus in Pa if known, otherwise NaN. */
  E: number;
  /** The offset strain, 0.002 for the usual 0.2 percent. */
  offset: number;
}

function readPairs(text: string, unitFactor: number, strainDivisor: number) {
  const table = parseTable(text);
  if (table === null || table.some((r) => r.length !== 2)) return null;
  const pairs = table.map((r) => [r[0] / strainDivisor, r[1] * unitFactor] as const).sort((a, b) => a[0] - b[0]);
  return pairs;
}

interface Curve {
  eps: number[];
  sig: number[];
  /** The index of the largest stress. */
  iMax: number;
}

/** Reads and checks the data; the strains come out as fractions and the stresses in pascals. */
function readCurve(input: TensileInput): Curve | Failed {
  const unitFactor = STRESS_UNITS[input.stressUnit] ?? 1e6;
  const pairs = readPairs(input.data, unitFactor, input.strainUnit === 'percent' ? 100 : 1);
  if (pairs === null) return fail('kitChemMat.ph.err.table');
  if (pairs.length < 5) return fail('kitChemMat.ph.err.fewPoints');
  if (pairs.some(([e, s]) => e < 0 || s < 0)) return fail('kitChemMat.ph.err.negative');
  for (let i = 1; i < pairs.length; i++) if (pairs[i][0] === pairs[i - 1][0]) return fail('kitChemMat.ph.err.repeated');
  if (!(input.offset > 0 && input.offset < 0.05)) return fail('kitChemMat.ph.err.offset');
  const sig = pairs.map((p) => p[1]);
  const sMax = Math.max(...sig);
  if (!(sMax > 0)) return fail('kitChemMat.ph.err.zeroStress');
  return { eps: pairs.map((p) => p[0]), sig, iMax: sig.indexOf(sMax) };
}

interface Elastic {
  E: number;
  /** The strain where the elastic line meets zero stress; a toe in the curve moves it off zero. */
  strain0: number;
  step: KitStep;
}

/** The modulus from the given value or from a line through the points up to a fraction of the peak stress. */
function elasticLine(curve: Curve, input: TensileInput): Elastic | Failed {
  const { eps, sig, iMax } = curve;
  if (!Number.isNaN(input.E)) {
    if (!(input.E > 0)) return fail('kitChemMat.ph.err.modulus');
    return {
      E: input.E,
      strain0: 0,
      step: { key: 'kitChemMat.ph.step.modulusGiven', math: `E=${latexNumber(input.E / 1e9, 5)}\\ \\mathrm{GPa}` },
    };
  }
  if (!(input.elasticPercent > 0 && input.elasticPercent <= 100)) return fail('kitChemMat.ph.err.elastic');
  const limit = (input.elasticPercent / 100) * sig[iMax];
  const idx = sig.map((s, i) => (s <= limit && i <= iMax ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 3) return fail('kitChemMat.ph.err.fewElastic');
  const fit = lineFit(
    idx.map((i) => eps[i]),
    idx.map((i) => sig[i]),
  );
  if (!fit || !(fit.slope > 0)) return fail('kitChemMat.ph.err.slope');
  return {
    E: fit.slope,
    strain0: -fit.intercept / fit.slope,
    step: {
      key: 'kitChemMat.ph.step.modulus',
      math:
        `E=\\frac{\\Delta\\sigma}{\\Delta\\varepsilon}=${latexNumber(fit.slope / 1e9, 5)}\\ \\mathrm{GPa}` +
        `\\quad(${fit.n}\\ \\text{points},\\ R^2=${latexNumber(fit.r2, 6)})`,
    },
  };
}

/** Where the curve meets the offset line sigma = E (eps - strain0 - offset): [strain, stress], or null if it never does. */
function offsetYield(curve: Curve, el: Elastic, offset: number): [number, number] | null {
  const { eps, sig } = curve;
  const line = (e: number) => el.E * (e - el.strain0 - offset);
  const f = (e: number) => interpolate(eps, sig, e) - line(e);
  const start = Math.max(eps[0], el.strain0 + offset);
  const last = eps[eps.length - 1];
  if (!(start < last) || f(start) < -1e-9 * sig[curve.iMax]) return null;
  const roots = bracketScan(f, start, last, 4000);
  return roots.length > 0 ? [roots[0], interpolate(eps, sig, roots[0])] : null;
}

function tensilePlot(curve: Curve, el: Elastic, offset: number, yieldPoint: [number, number] | null): PlotData {
  const { eps, sig, iMax } = curve;
  const last = eps.length - 1;
  const line = (e: number) => el.E * (e - el.strain0 - offset);
  const eEnd = yieldPoint ? Math.min(eps[last], yieldPoint[0] * 1.5 + offset) : eps[last] * 0.5;
  const series: Series[] = [
    { label: 'kitChemMat.ph.plot.curve', points: eps.map((e, i): [number, number] => [e, sig[i] / 1e6]) },
    {
      label: 'kitChemMat.ph.plot.offset',
      points: [el.strain0 + offset, eEnd].map((e): [number, number] => [e, line(e) / 1e6]),
    },
  ];
  if (yieldPoint)
    series.push({
      label: 'kitChemMat.ph.plot.yield',
      style: 'dots',
      points: [[yieldPoint[0], yieldPoint[1] / 1e6]],
    });
  series.push({ label: 'kitChemMat.ph.plot.uts', style: 'dots', points: [[eps[iMax], sig[iMax] / 1e6]] });
  return {
    xLabel: 'kitChemMat.ph.plot.strain',
    yLabel: 'kitChemMat.ph.plot.stress',
    series,
    alt: 'kitChemMat.ph.plot.tensileAlt',
  };
}

/** The result rows of a tensile test: modulus, yield, strengths, ductility, toughness, and true values. */
function tensileRows(curve: Curve, E: number, yieldPoint: [number, number] | null): Row[] {
  const { eps, sig, iMax } = curve;
  const last = eps.length - 1;
  const rows: Row[] = [{ key: 'kitChemMat.ph.row.E', value: E, dim: 'stress', digits: 5 }];
  if (yieldPoint) {
    rows.push({ key: 'kitChemMat.ph.row.yield', value: yieldPoint[1], dim: 'stress', digits: 5 });
    rows.push({ key: 'kitChemMat.ph.row.yieldStrain', value: yieldPoint[0], digits: 5 });
  }
  rows.push({ key: 'kitChemMat.ph.row.uts', value: sig[iMax], dim: 'stress', digits: 5 });
  rows.push({ key: 'kitChemMat.ph.row.utsStrain', value: eps[iMax], digits: 5 });
  rows.push({ key: 'kitChemMat.ph.row.fractureStrain', value: eps[last], digits: 5 });
  rows.push({ key: 'kitChemMat.ph.row.elongation', value: (eps[last] - sig[last] / E) * 100, unit: '%', digits: 4 });
  rows.push({ key: 'kitChemMat.ph.row.toughness', value: trapezoid(eps, sig) / 1e6, unit: 'MJ/m³', digits: 5 });
  if (yieldPoint) {
    const resilience = yieldPoint[1] ** 2 / (2 * E);
    rows.push({ key: 'kitChemMat.ph.row.resilience', value: resilience / 1e6, unit: 'MJ/m³', digits: 5 });
  }
  rows.push({ key: 'kitChemMat.ph.row.trueStress', value: sig[iMax] * (1 + eps[iMax]), dim: 'stress', digits: 5 });
  rows.push({ key: 'kitChemMat.ph.row.trueStrain', value: Math.log(1 + eps[iMax]), digits: 5 });
  return rows;
}

/** The area under the curve by the trapezoid rule. */
function trapezoid(xs: readonly number[], ys: readonly number[]): number {
  let area = 0;
  for (let i = 1; i < xs.length; i++) area += ((ys[i] + ys[i - 1]) / 2) * (xs[i] - xs[i - 1]);
  return area;
}

export function tensile(input: TensileInput): Outcome {
  const curve = readCurve(input);
  if ('ok' in curve) return curve;
  const el = elasticLine(curve, input);
  if ('ok' in el) return el;
  const { eps, sig, iMax } = curve;
  const yieldPoint = offsetYield(curve, el, input.offset);
  const steps: KitStep[] = [el.step];
  if (yieldPoint) {
    const [ey, sy] = yieldPoint;
    steps.push({
      key: 'kitChemMat.ph.step.offset',
      math:
        `\\sigma=E(\\varepsilon-${latexNumber(el.strain0)}-${latexNumber(input.offset)})\\ ` +
        `\\text{meets the curve at}\\ \\varepsilon=${latexNumber(ey, 5)},\\ \\sigma_y=${latexNumber(sy / 1e6, 5)}\\ \\mathrm{MPa}`,
    });
  }
  steps.push({
    key: 'kitChemMat.ph.step.true',
    math:
      `\\sigma_T=\\sigma(1+\\varepsilon)=${latexNumber((sig[iMax] * (1 + eps[iMax])) / 1e6, 5)}\\ \\mathrm{MPa},` +
      `\\quad \\varepsilon_T=\\ln(1+\\varepsilon)=${latexNumber(Math.log(1 + eps[iMax]), 5)}`,
  });
  steps.push({
    key: 'kitChemMat.ph.step.area',
    math: `U_T=\\int\\sigma\\,d\\varepsilon=${latexNumber(trapezoid(eps, sig) / 1e6, 5)}\\ \\mathrm{MJ/m^3}`,
  });
  const notes: { key: 'kitChemMat.ph.note.tensile' | 'kitChemMat.ph.note.noYield' | 'kitChemMat.ph.note.true' }[] = [
    { key: 'kitChemMat.ph.note.tensile' },
    { key: 'kitChemMat.ph.note.true' },
  ];
  if (!yieldPoint) notes.push({ key: 'kitChemMat.ph.note.noYield' });
  return {
    ok: true,
    rows: tensileRows(curve, el.E, yieldPoint),
    steps,
    notes,
    equation: '\\sigma=E\\,(\\varepsilon-0.002)',
    plot: tensilePlot(curve, el, input.offset, yieldPoint),
  };
}

// ---------- Fatigue: Basquin ----------

export interface FatigueInput {
  /** Lines of "cycles to failure, stress amplitude". */
  data: string;
  stressUnit: string;
  /** A stress amplitude (Pa) to find the life for, or NaN. */
  stress: number;
  /** A number of cycles to find the strength for, or NaN. */
  cycles: number;
}

export interface BasquinFit {
  A: number;
  b: number;
  r2: number;
}

/** Fits S = A N^b through points (N, S) on logarithms. */
export function basquin(cycles: readonly number[], stress: readonly number[]): BasquinFit | null {
  const fit = lineFit(cycles.map(Math.log), stress.map(Math.log));
  if (!fit) return null;
  return { A: Math.exp(fit.intercept), b: fit.slope, r2: fit.r2 };
}

export function fatigue(input: FatigueInput): Outcome {
  const factor = STRESS_UNITS[input.stressUnit] ?? 1e6;
  const table = parseTable(input.data);
  if (table === null || table.some((r) => r.length !== 2)) return fail('kitChemMat.ph.err.fatigueTable');
  if (table.length < 3) return fail('kitChemMat.ph.err.fewFatigue');
  if (table.some(([n, s]) => !(n > 0) || !(s > 0))) return fail('kitChemMat.ph.err.fatigueRange');
  const N = table.map((r) => r[0]);
  const S = table.map((r) => r[1] * factor);
  if (new Set(N).size < 2) return fail('kitChemMat.ph.err.sameLife');
  const fit = basquin(N, S);
  if (!fit) return fail('kitChemMat.ph.err.fatigueFit');
  const sigmaF = fit.A / 2 ** fit.b;
  const rows: Row[] = [
    { key: 'kitChemMat.ph.row.A', value: fit.A, dim: 'stress', digits: 5 },
    { key: 'kitChemMat.ph.row.b', value: fit.b, digits: 5 },
    { key: 'kitChemMat.ph.row.sigmaF', value: sigmaF, dim: 'stress', digits: 5 },
    { key: 'kitChemMat.ph.row.r2', value: fit.r2, digits: 6 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.ph.step.basquin',
      math:
        `\\ln S=\\ln A+b\\ln N\\ \\Rightarrow\\ b=${latexNumber(fit.b, 5)},\\ A=` +
        `${latexNumber(fit.A / 1e6, 5)}\\ \\mathrm{MPa}`,
    },
    {
      key: 'kitChemMat.ph.step.sigmaF',
      math: `\\sigma'_f=A\\,2^{-b}=${latexNumber(sigmaF / 1e6, 5)}\\ \\mathrm{MPa}\\quad(S=\\sigma'_f(2N)^b)`,
    },
  ];
  const notes: { key: 'kitChemMat.ph.note.basquin' | 'kitChemMat.ph.note.risingLife' }[] = [
    { key: 'kitChemMat.ph.note.basquin' },
  ];
  if (!(fit.b < 0)) notes.push({ key: 'kitChemMat.ph.note.risingLife' });
  if (!Number.isNaN(input.stress)) {
    if (!(input.stress > 0)) return fail('kitChemMat.ph.err.fatigueRange');
    if (!(fit.b < 0)) return fail('kitChemMat.ph.err.noLife');
    const life = (input.stress / fit.A) ** (1 / fit.b);
    rows.push({ key: 'kitChemMat.ph.row.life', value: life, unit: 'cycles', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.life',
      math: `N=\\left(\\frac{S}{A}\\right)^{1/b}=${latexNumber(life, 5)}\\ \\text{cycles}`,
    });
  }
  if (!Number.isNaN(input.cycles)) {
    if (!(input.cycles > 0)) return fail('kitChemMat.ph.err.fatigueRange');
    const s = fit.A * input.cycles ** fit.b;
    rows.push({ key: 'kitChemMat.ph.row.strength', value: s, dim: 'stress', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.strength',
      math: `S=AN^b=${latexNumber(s / 1e6, 5)}\\ \\mathrm{MPa}`,
    });
  }
  const nLo = Math.min(...N);
  const nHi = Math.max(...N);
  const line: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const n = nLo * (nHi / nLo) ** (i / 40);
    line.push([n, (fit.A * n ** fit.b) / 1e6]);
  }
  const plot: PlotData = {
    xLabel: 'kitChemMat.ph.plot.cycles',
    yLabel: 'kitChemMat.ph.plot.amplitude',
    series: [
      { label: 'kitChemMat.ph.plot.sn', style: 'dots', points: N.map((n, i): [number, number] => [n, S[i] / 1e6]) },
      { label: 'kitChemMat.ph.plot.basquin', points: line },
    ],
    logX: true,
    logY: true,
    alt: 'kitChemMat.ph.plot.snAlt',
  };
  return { ok: true, rows, steps, notes, equation: "S=\\sigma'_f\\,(2N)^b", plot };
}
