// Solutions and lab calculations: colligative properties, osmotic pressure, calorimetry, a Beer-Lambert calibration
// line with the uncertainty of an unknown, and percent yield and purity.
import { latexNumber } from '../chemText';
import { R } from '../constants';
import { lineFit } from '../num';
import { parseTable } from '../kinetics/engine';
import { fail } from '../types';
import type { KitStep, Outcome, PlotData, Row } from '../types';

/** Typical constants of common solvents: molar mass (g/mol), Kf and Kb (K kg/mol), normal freezing and boiling points (K). */
export const SOLVENTS = {
  water: { M: 18.015, Kf: 1.86, Kb: 0.512, Tf: 273.15, Tb: 373.15, dHfus: 6010 },
  benzene: { M: 78.114, Kf: 5.12, Kb: 2.53, Tf: 278.65, Tb: 353.25, dHfus: 9870 },
  ethanol: { M: 46.069, Kf: 1.99, Kb: 1.22, Tf: 159.05, Tb: 351.52, dHfus: 4931 },
  acetic: { M: 60.052, Kf: 3.9, Kb: 3.07, Tf: 289.75, Tb: 391.05, dHfus: 11730 },
} as const;
export type SolventName = keyof typeof SOLVENTS;

/** The freezing point constant from first principles: Kf = R Tf^2 M / dH_fus, with M in kg/mol. */
export const kfFromEnthalpy = (Tf: number, molarMassGrams: number, dHfus: number) =>
  (R * Tf * Tf * (molarMassGrams / 1000)) / dHfus;

export interface ColligativeInput {
  solvent: string;
  nSolute: number;
  /** Mass of the solvent in grams. */
  solventMass: number;
  i: number;
  /** Used for a custom solvent only. */
  Kf: number;
  Kb: number;
  Tf: number;
  Tb: number;
  M: number;
}

export function colligative(input: ColligativeInput): Outcome {
  const preset = input.solvent in SOLVENTS ? SOLVENTS[input.solvent as SolventName] : null;
  const s = preset ?? { M: input.M, Kf: input.Kf, Kb: input.Kb, Tf: input.Tf, Tb: input.Tb, dHfus: NaN };
  if (!(input.nSolute >= 0) || !Number.isFinite(input.nSolute)) return fail('kitChemMat.sol.err.amount');
  if (!(input.solventMass > 0) || !Number.isFinite(input.solventMass)) return fail('kitChemMat.sol.err.solvent');
  if (!(input.i > 0) || !Number.isFinite(input.i)) return fail('kitChemMat.sol.err.factor');
  if (!(s.Kf > 0) || !(s.Kb > 0)) return fail('kitChemMat.sol.err.constants');
  if (!(s.Tf > 0) || !(s.Tb > s.Tf)) return fail('kitChemMat.sol.err.points');
  const kg = input.solventMass / 1000;
  const m = input.nSolute / kg;
  const dTf = input.i * s.Kf * m;
  const dTb = input.i * s.Kb * m;
  if (dTf >= s.Tf) return fail('kitChemMat.sol.err.tooConcentrated');
  const rows: Row[] = [
    { key: 'kitChemMat.sol.row.molality', value: m, unit: 'mol/kg', digits: 5 },
    { key: 'kitChemMat.sol.row.dTf', value: dTf, unit: 'K', digits: 4 },
    { key: 'kitChemMat.sol.row.Tf', value: s.Tf - dTf, dim: 'temperature', digits: 6 },
    { key: 'kitChemMat.sol.row.dTb', value: dTb, unit: 'K', digits: 4 },
    { key: 'kitChemMat.sol.row.Tb', value: s.Tb + dTb, dim: 'temperature', digits: 6 },
  ];
  if (s.M > 0) {
    const nSolvent = input.solventMass / s.M;
    rows.splice(1, 0, {
      key: 'kitChemMat.sol.row.fraction',
      value: input.nSolute / (input.nSolute + nSolvent),
      digits: 5,
    });
  }
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.sol.step.molality',
      math:
        `m=\\frac{n}{m_{\\text{solvent}}}=\\frac{${latexNumber(input.nSolute)}}{${latexNumber(kg)}}=` +
        `${latexNumber(m, 5)}\\ \\mathrm{mol/kg}`,
    },
    {
      key: 'kitChemMat.sol.step.freezing',
      math:
        `\\Delta T_f=iK_fm=${latexNumber(input.i)}\\times${latexNumber(s.Kf)}\\times${latexNumber(m, 5)}=` +
        `${latexNumber(dTf, 4)}\\ \\mathrm{K}`,
    },
    {
      key: 'kitChemMat.sol.step.boiling',
      math:
        `\\Delta T_b=iK_bm=${latexNumber(input.i)}\\times${latexNumber(s.Kb)}\\times${latexNumber(m, 5)}=` +
        `${latexNumber(dTb, 4)}\\ \\mathrm{K}`,
    },
  ];
  if (Number.isFinite(s.dHfus)) {
    const kf = kfFromEnthalpy(s.Tf, s.M, s.dHfus);
    rows.push({ key: 'kitChemMat.sol.row.kfCheck', value: kf, unit: 'K kg/mol', digits: 4 });
    steps.push({
      key: 'kitChemMat.sol.step.kfCheck',
      math: `K_f=\\frac{RT_f^2M}{\\Delta H_{\\text{fus}}}=${latexNumber(kf, 4)}\\ \\mathrm{K\\,kg/mol}`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.sol.note.dilute' }, { key: 'kitChemMat.sol.note.factor' }],
    equation: '\\Delta T_f=iK_fm,\\qquad \\Delta T_b=iK_bm',
  };
}

export interface OsmoticInput {
  /** Molarity of the solute in mol/L. */
  c: number;
  i: number;
  T: number;
}

/** Osmotic pressure in pascals: Pi = i c R T. */
export const osmoticPressure = (c: number, i: number, T: number) => i * c * 1000 * R * T;

export function osmotic(input: OsmoticInput): Outcome {
  if (!(input.c >= 0) || !Number.isFinite(input.c)) return fail('kitChemMat.sol.err.conc');
  if (!(input.i > 0) || !Number.isFinite(input.i)) return fail('kitChemMat.sol.err.factor');
  if (!(input.T > 0) || !Number.isFinite(input.T)) return fail('kitChemMat.err.temperature');
  const pi = osmoticPressure(input.c, input.i, input.T);
  return {
    ok: true,
    rows: [{ key: 'kitChemMat.sol.row.osmotic', value: pi, dim: 'pressure', digits: 5 }],
    steps: [
      {
        key: 'kitChemMat.sol.step.osmotic',
        math:
          `\\Pi=icRT=${latexNumber(input.i)}\\times${latexNumber(input.c * 1000)}` +
          `\\ \\mathrm{mol/m^3}\\times${latexNumber(R, 7)}\\times${latexNumber(input.T, 5)}=` +
          `${latexNumber(pi, 5)}\\ \\mathrm{Pa}`,
      },
    ],
    notes: [{ key: 'kitChemMat.sol.note.ideal' }],
    equation: '\\Pi=icRT',
  };
}

export interface CalorimetryInput {
  kind: string;
  /** Mass of the solution in grams (coffee cup). */
  mass: number;
  /** Specific heat of the solution, J/(g K). */
  c: number;
  /** Heat capacity of the calorimeter, J/K; NaN means none. */
  cal: number;
  /** Temperature change, K (the same as degrees Celsius). */
  dT: number;
  /** Moles of the limiting reactant. */
  n: number;
  /** Change in moles of gas for a bomb, to convert to enthalpy; NaN to skip. */
  dn: number;
  T: number;
}

export function calorimetry(input: CalorimetryInput): Outcome {
  const bomb = input.kind === 'bomb';
  if (!Number.isFinite(input.dT)) return fail('kitChemMat.sol.err.deltaT');
  if (!(input.n > 0) || !Number.isFinite(input.n)) return fail('kitChemMat.sol.err.moles');
  const cal = Number.isNaN(input.cal) ? 0 : input.cal;
  if (!(cal >= 0)) return fail('kitChemMat.sol.err.capacity');
  let heatCapacity: number;
  if (bomb) {
    heatCapacity = cal;
    if (!(heatCapacity > 0)) return fail('kitChemMat.sol.err.capacity');
  } else {
    if (!(input.mass > 0) || !(input.c > 0)) return fail('kitChemMat.sol.err.solution');
    heatCapacity = input.mass * input.c + cal;
  }
  const q = heatCapacity * input.dT;
  const perMole = -q / input.n;
  const rows: Row[] = [
    { key: 'kitChemMat.sol.row.q', value: q, dim: 'energy', digits: 5 },
    { key: bomb ? 'kitChemMat.sol.row.dU' : 'kitChemMat.sol.row.dH', value: perMole, dim: 'energyMol', digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: bomb ? 'kitChemMat.sol.step.qBomb' : 'kitChemMat.sol.step.qCup',
      math: bomb
        ? `q=C_{\\text{cal}}\\Delta T=${latexNumber(cal)}\\times${latexNumber(input.dT)}=` +
          `${latexNumber(q, 5)}\\ \\mathrm{J}`
        : `q=(mc+C_{\\text{cal}})\\Delta T=(${latexNumber(input.mass)}\\times${latexNumber(input.c)}+${latexNumber(cal)})` +
          `\\times${latexNumber(input.dT)}=${latexNumber(q, 5)}\\ \\mathrm{J}`,
    },
    {
      key: bomb ? 'kitChemMat.sol.step.dU' : 'kitChemMat.sol.step.dH',
      math:
        `${bomb ? '\\Delta U' : '\\Delta H'}=-\\frac{q}{n}=-\\frac{${latexNumber(q, 5)}}{${latexNumber(input.n)}}=` +
        `${latexNumber(perMole / 1000, 5)}\\ \\mathrm{kJ/mol}`,
    },
  ];
  if (bomb && Number.isFinite(input.dn) && input.T > 0) {
    const dH = perMole + input.dn * R * input.T;
    rows.push({ key: 'kitChemMat.sol.row.dHbomb', value: dH, dim: 'energyMol', digits: 5 });
    steps.push({
      key: 'kitChemMat.sol.step.dHbomb',
      math: `\\Delta H=\\Delta U+\\Delta n_{g}RT=${latexNumber(dH / 1000, 5)}\\ \\mathrm{kJ/mol}`,
    });
  }
  rows.push({
    key: 'kitChemMat.sol.row.heatFlow',
    value: '',
    word: perMole < 0 ? 'kitChemMat.sol.word.exo' : 'kitChemMat.sol.word.endo',
  });
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: bomb ? 'kitChemMat.sol.note.bomb' : 'kitChemMat.sol.note.cup' }],
    equation: bomb
      ? '\\Delta U=-\\frac{C_{\\text{cal}}\\Delta T}{n}'
      : '\\Delta H=-\\frac{(mc+C_{\\text{cal}})\\Delta T}{n}',
  };
}

export interface Calibration {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  /** Standard deviation of the residuals (n > 2), else 0. */
  sy: number;
  xMean: number;
  sxx: number;
  yMin: number;
  yMax: number;
}

export function calibrationLine(c: readonly number[], a: readonly number[]): Calibration | null {
  const fit = lineFit(c, a);
  if (!fit) return null;
  const n = c.length;
  const xMean = c.reduce((p, v) => p + v, 0) / n;
  const sxx = c.reduce((p, v) => p + (v - xMean) ** 2, 0);
  let sse = 0;
  for (let k = 0; k < n; k++) sse += (a[k] - fit.intercept - fit.slope * c[k]) ** 2;
  return {
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    n,
    sy: n > 2 ? Math.sqrt(sse / (n - 2)) : 0,
    xMean,
    sxx,
    yMin: Math.min(...a),
    yMax: Math.max(...a),
  };
}

/** The concentration that gives the mean absorbance of k replicates, and its standard uncertainty. */
export function unknownConcentration(cal: Calibration, absorbances: readonly number[]) {
  const k = absorbances.length;
  const y0 = absorbances.reduce((p, v) => p + v, 0) / k;
  const x0 = (y0 - cal.intercept) / cal.slope;
  const dy = y0 - (cal.intercept + cal.slope * cal.xMean);
  const se = (cal.sy / Math.abs(cal.slope)) * Math.sqrt(1 / k + 1 / cal.n + dy ** 2 / (cal.slope ** 2 * cal.sxx));
  return { x0, y0, se };
}

export function calibration(standards: string, unknown: string, path: number): Outcome {
  const table = parseTable(standards);
  if (table === null || table.some((r) => r.length !== 2)) return fail('kitChemMat.sol.err.standards');
  if (table.length < 2) return fail('kitChemMat.sol.err.fewStandards');
  const c = table.map((r) => r[0]);
  const a = table.map((r) => r[1]);
  if (c.some((v) => v < 0)) return fail('kitChemMat.sol.err.negativeStandard');
  if (new Set(c).size < 2) return fail('kitChemMat.sol.err.sameStandards');
  const reps = parseTable(unknown);
  if (reps === null || reps.length === 0) return fail('kitChemMat.sol.err.unknown');
  const ys = reps.flat();
  if (ys.length === 0) return fail('kitChemMat.sol.err.unknown');
  const cal = calibrationLine(c, a);
  if (!cal || cal.slope === 0) return fail('kitChemMat.sol.err.flat');
  const u = unknownConcentration(cal, ys);
  const rows: Row[] = [
    { key: 'kitChemMat.sol.row.slope', value: cal.slope, digits: 6 },
    { key: 'kitChemMat.sol.row.intercept', value: cal.intercept, digits: 6 },
    { key: 'kitChemMat.sol.row.r2', value: cal.r2, digits: 8 },
    { key: 'kitChemMat.sol.row.unknown', value: u.x0, digits: 5 },
  ];
  if (cal.n > 2) rows.push({ key: 'kitChemMat.sol.row.unknownErr', value: u.se, digits: 3 });
  if (path > 0) {
    rows.push({ key: 'kitChemMat.sol.row.epsilon', value: cal.slope / path, unit: 'L/(mol cm)', digits: 5 });
  }
  const notes: { key: 'kitChemMat.sol.note.beer' | 'kitChemMat.sol.note.extrapolated' }[] = [
    { key: 'kitChemMat.sol.note.beer' },
  ];
  if (u.y0 < cal.yMin - 1e-12 || u.y0 > cal.yMax + 1e-12) notes.push({ key: 'kitChemMat.sol.note.extrapolated' });
  const xMax = Math.max(...c, u.x0);
  const line: [number, number][] = [
    [0, cal.intercept],
    [xMax * 1.05, cal.intercept + cal.slope * xMax * 1.05],
  ];
  const plot: PlotData = {
    xLabel: 'kitChemMat.sol.plot.conc',
    yLabel: 'kitChemMat.sol.plot.abs',
    series: [
      { label: 'kitChemMat.sol.plot.standards', style: 'dots', points: c.map((x, i): [number, number] => [x, a[i]]) },
      { label: 'kitChemMat.sol.plot.line', points: line },
      { label: 'kitChemMat.sol.plot.unknown', style: 'dots', points: [[u.x0, u.y0]] },
    ],
    alt: 'kitChemMat.sol.plot.alt',
  };
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.sol.step.fit', math: `A=${latexNumber(cal.slope, 6)}\\,c+${latexNumber(cal.intercept, 4)}` },
      {
        key: 'kitChemMat.sol.step.invert',
        math:
          `c=\\frac{A-b}{m}=\\frac{${latexNumber(u.y0, 5)}-${latexNumber(cal.intercept, 4)}}{${latexNumber(cal.slope, 6)}}=` +
          `${latexNumber(u.x0, 5)}`,
      },
    ],
    notes,
    equation: 'A=\\varepsilon b c',
    plot,
  };
}

export function yieldCalc(actual: number, theoretical: number, purity: number): Outcome {
  if (!(theoretical > 0) || !Number.isFinite(theoretical)) return fail('kitChemMat.sol.err.theoretical');
  if (!(actual >= 0) || !Number.isFinite(actual)) return fail('kitChemMat.sol.err.actual');
  if (!Number.isNaN(purity) && !(purity >= 0 && purity <= 100)) return fail('kitChemMat.sol.err.purity');
  const pct = (actual / theoretical) * 100;
  const rows: Row[] = [{ key: 'kitChemMat.sol.row.yield', value: pct, unit: '%', digits: 5 }];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.sol.step.yield',
      math:
        `\\text{yield}=\\frac{${latexNumber(actual)}}{${latexNumber(theoretical)}}` +
        `\\times100\\%=${latexNumber(pct, 5)}\\%`,
    },
  ];
  if (!Number.isNaN(purity)) {
    const pure = pct * (purity / 100);
    rows.push({ key: 'kitChemMat.sol.row.pureYield', value: pure, unit: '%', digits: 5 });
    steps.push({
      key: 'kitChemMat.sol.step.pure',
      math: `${latexNumber(pct, 5)}\\%\\times${latexNumber(purity)}\\%=${latexNumber(pure, 5)}\\%`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: pct > 100 ? 'kitChemMat.sol.note.over' : 'kitChemMat.sol.note.yield' }],
    equation: '\\text{percent yield}=\\frac{m_{\\text{actual}}}{m_{\\text{theoretical}}}\\times100\\%',
  };
}
