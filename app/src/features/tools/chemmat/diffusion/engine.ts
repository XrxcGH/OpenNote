// Defects, diffusion, and oxidation: the equilibrium vacancy fraction, the Arrhenius diffusion coefficient, Fick's first
// law, the error-function solution for carburizing and decarburizing, predeposition, drive-in of dopants, and
// Deal-Grove thermal oxidation. Diffusivities are in m^2/s, lengths in m, times in s, unless a field says otherwise.
import { latexNumber } from '../chemText';
import { NA, R } from '../constants';
import { brent, erf, erfc, erfinv } from '../num';
import { fail } from '../types';
import type { KitStep, Outcome, PlotData, Row, Series } from '../types';

const pos = (x: number) => x > 0 && Number.isFinite(x);

// ---------- Vacancies ----------

export interface VacancyInput {
  /** Formation energy, J/mol. */
  Q: number;
  T: number;
  /** Density g/cm3 and atomic mass g/mol, NaN to skip the count per volume. */
  rho: number;
  A: number;
}

export function vacancies(input: VacancyInput): Outcome {
  if (!(input.Q >= 0) || !Number.isFinite(input.Q)) return fail('kitChemMat.df.err.energy');
  if (!pos(input.T)) return fail('kitChemMat.df.err.temperature');
  const frac = Math.exp(-input.Q / (R * input.T));
  const rows: Row[] = [
    { key: 'kitChemMat.df.row.fraction', value: frac, digits: 5 },
    { key: 'kitChemMat.df.row.exponent', value: input.Q / (R * input.T), digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.df.step.vacancy',
      math:
        `\\frac{N_v}{N}=\\exp\\!\\left(-\\frac{Q_v}{RT}\\right)=\\exp\\!\\left(-` +
        `\\frac{${latexNumber(input.Q / 1000, 5)}\\ \\mathrm{kJ/mol}}` +
        `{${latexNumber(R, 7)}\\times${latexNumber(input.T, 5)}}\\right)=${latexNumber(frac, 5)}`,
    },
  ];
  if (!Number.isNaN(input.rho) || !Number.isNaN(input.A)) {
    if (!pos(input.rho) || !pos(input.A)) return fail('kitChemMat.df.err.density');
    const atoms = (input.rho * NA) / input.A;
    rows.push({ key: 'kitChemMat.df.row.sites', value: atoms, unit: 'cm⁻³', digits: 5 });
    rows.push({ key: 'kitChemMat.df.row.count', value: atoms * frac, unit: 'cm⁻³', digits: 5 });
    steps.push({
      key: 'kitChemMat.df.step.count',
      math:
        `N=\\frac{\\rho N_A}{A}=${latexNumber(atoms, 5)}\\ \\mathrm{cm^{-3}}\\ \\Rightarrow` +
        `\\ N_v=${latexNumber(atoms * frac, 5)}\\ \\mathrm{cm^{-3}}`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.df.note.vacancy' }],
    equation: 'N_v=N\\exp\\!\\left(-\\frac{Q_v}{kT}\\right)',
  };
}

// ---------- Diffusion coefficient ----------

export interface ArrheniusInput {
  D0: number;
  /** J/mol. */
  Q: number;
  T: number;
}

export const diffusivity = (D0: number, Q: number, T: number) => D0 * Math.exp(-Q / (R * T));

export function coefficient(input: ArrheniusInput): Outcome {
  if (!pos(input.D0)) return fail('kitChemMat.df.err.d0');
  if (!(input.Q >= 0) || !Number.isFinite(input.Q)) return fail('kitChemMat.df.err.energy');
  if (!pos(input.T)) return fail('kitChemMat.df.err.temperature');
  const D = diffusivity(input.D0, input.Q, input.T);
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.df.row.D', value: D, dim: 'diffusivity', digits: 5 },
      { key: 'kitChemMat.df.row.exponent', value: input.Q / (R * input.T), digits: 5 },
    ],
    steps: [
      {
        key: 'kitChemMat.df.step.arrhenius',
        math:
          `D=D_0\\exp\\!\\left(-\\frac{Q}{RT}\\right)=${latexNumber(input.D0, 5)}\\exp\\!\\left(-` +
          `\\frac{${latexNumber(input.Q / 1000, 5)}\\ \\mathrm{kJ/mol}}` +
          `{${latexNumber(R, 7)}\\times${latexNumber(input.T, 5)}}\\right)=${latexNumber(D, 5)}\\ \\mathrm{m^2/s}`,
      },
    ],
    notes: [{ key: 'kitChemMat.df.note.arrhenius' }],
    equation: 'D=D_0\\exp\\!\\left(-\\frac{Q}{RT}\\right)',
  };
}

export interface FitInput {
  D1: number;
  T1: number;
  D2: number;
  T2: number;
  /** A third temperature at which to predict D, or NaN. */
  T3: number;
}

/** Activation energy and pre-exponential factor from the coefficient at two temperatures. */
export function arrheniusFit(input: FitInput): Outcome {
  if (!pos(input.D1) || !pos(input.D2)) return fail('kitChemMat.df.err.d');
  if (!pos(input.T1) || !pos(input.T2)) return fail('kitChemMat.df.err.temperature');
  if (input.T1 === input.T2) return fail('kitChemMat.df.err.sameT');
  const Q = (R * Math.log(input.D2 / input.D1)) / (1 / input.T1 - 1 / input.T2);
  const D0 = input.D1 * Math.exp(Q / (R * input.T1));
  const rows: Row[] = [
    { key: 'kitChemMat.df.row.Q', value: Q, dim: 'energyMol', digits: 5 },
    { key: 'kitChemMat.df.row.D0', value: D0, dim: 'diffusivity', digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.df.step.fitQ',
      math: `Q=R\\,\\frac{\\ln(D_2/D_1)}{1/T_1-1/T_2}=${latexNumber(Q / 1000, 5)}\\ \\mathrm{kJ/mol}`,
    },
    {
      key: 'kitChemMat.df.step.fitD0',
      math: `D_0=D_1\\exp\\!\\left(\\frac{Q}{RT_1}\\right)=${latexNumber(D0, 5)}\\ \\mathrm{m^2/s}`,
    },
  ];
  const notes: { key: 'kitChemMat.df.note.fit' | 'kitChemMat.df.note.negative' }[] = [
    { key: 'kitChemMat.df.note.fit' },
  ];
  if (Q < 0) notes.push({ key: 'kitChemMat.df.note.negative' });
  if (!Number.isNaN(input.T3)) {
    if (!pos(input.T3)) return fail('kitChemMat.df.err.temperature');
    const D3 = diffusivity(D0, Q, input.T3);
    rows.push({ key: 'kitChemMat.df.row.D3', value: D3, dim: 'diffusivity', digits: 5 });
  }
  return { ok: true, rows, steps, notes, equation: '\\ln D=\\ln D_0-\\frac{Q}{R}\\cdot\\frac1T' };
}

// ---------- Fick's first law ----------

export function firstLaw(D: number, C1: number, C2: number, dx: number): Outcome {
  if (!pos(D)) return fail('kitChemMat.df.err.d');
  if (!pos(dx)) return fail('kitChemMat.df.err.thickness');
  if (!Number.isFinite(C1) || !Number.isFinite(C2) || C1 < 0 || C2 < 0) return fail('kitChemMat.df.err.conc');
  // Concentrations arrive in mol/L; the flux is in mol/(m^2 s).
  const dC = (C1 - C2) * 1000;
  const J = (D * dC) / dx;
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.df.row.flux', value: J, unit: 'mol/(m² s)', digits: 5 },
      { key: 'kitChemMat.df.row.gradient', value: dC / dx, unit: 'mol/m⁴', digits: 5 },
    ],
    steps: [
      {
        key: 'kitChemMat.df.step.first',
        math:
          `J=-D\\frac{dC}{dx}\\approx D\\,\\frac{C_1-C_2}{\\Delta x}=${latexNumber(D, 5)}` +
          `\\times\\frac{${latexNumber(dC, 5)}\\ \\mathrm{mol/m^3}}{${latexNumber(dx, 5)}` +
          `\\ \\mathrm{m}}=${latexNumber(J, 5)}\\ \\mathrm{mol/(m^2\\,s)}`,
      },
    ],
    notes: [{ key: 'kitChemMat.df.note.first' }],
    equation: 'J=-D\\,\\frac{dC}{dx}',
  };
}

// ---------- Error-function solution ----------

export type Unknown = 'conc' | 'time' | 'depth';

export interface ErfInput {
  Cs: number;
  C0: number;
  D: number;
  unknown: string;
  x: number;
  t: number;
  Cx: number;
}

/** The concentration at depth x after time t when the surface is held at Cs and the bar starts at C0. */
export const erfProfile = (Cs: number, C0: number, D: number, x: number, t: number) =>
  Cs - (Cs - C0) * erf(x / (2 * Math.sqrt(D * t)));

/** The z with erfc(z) = p for 0 < p <= 1, by Brent on the logarithm so that tiny p stay accurate. */
export function erfcInverse(p: number): number {
  if (!(p > 0) || p > 1) return NaN;
  if (p === 1) return 0;
  const target = Math.log(p);
  return brent((z) => Math.log(erfc(z)) - target, 0, 27, 1e-15) ?? NaN;
}

export function errorFunction(input: ErfInput): Outcome {
  const { Cs, C0 } = input;
  if (!Number.isFinite(Cs) || !Number.isFinite(C0) || Cs < 0 || C0 < 0) return fail('kitChemMat.df.err.conc');
  if (Cs === C0) return fail('kitChemMat.df.err.sameConc');
  if (!pos(input.D)) return fail('kitChemMat.df.err.d');
  const unknown = input.unknown as Unknown;
  let x = input.x;
  let t = input.t;
  let Cx = input.Cx;
  let z: number;
  const steps: KitStep[] = [];
  if (unknown === 'conc') {
    if (!(x >= 0) || !Number.isFinite(x)) return fail('kitChemMat.df.err.depth');
    if (!pos(t)) return fail('kitChemMat.df.err.time');
    z = x / (2 * Math.sqrt(input.D * t));
    Cx = erfProfile(Cs, C0, input.D, x, t);
    steps.push({
      key: 'kitChemMat.df.step.erfArg',
      math:
        `z=\\frac{x}{2\\sqrt{Dt}}=\\frac{${latexNumber(x, 5)}}{2\\sqrt{${latexNumber(input.D, 5)}` +
        `\\times${latexNumber(t, 5)}}}=${latexNumber(z, 5)}`,
    });
    steps.push({
      key: 'kitChemMat.df.step.erfConc',
      math:
        `C_x=C_s-(C_s-C_0)\\,\\mathrm{erf}(z)=${latexNumber(Cs)}-(${latexNumber(Cs)}-${latexNumber(C0)})` +
        `\\times${latexNumber(erf(z), 6)}=${latexNumber(Cx, 6)}`,
    });
  } else {
    // Both other modes start from the target concentration: erf(z) = (Cs - Cx) / (Cs - C0).
    if (!Number.isFinite(Cx)) return fail('kitChemMat.df.err.target');
    const r = (Cs - Cx) / (Cs - C0);
    if (!(r > 0 && r < 1)) return fail('kitChemMat.df.err.targetRange');
    z = erfinv(r);
    steps.push({
      key: 'kitChemMat.df.step.erfTarget',
      math:
        `\\mathrm{erf}(z)=\\frac{C_s-C_x}{C_s-C_0}=\\frac{${latexNumber(Cs)}-${latexNumber(Cx)}}{${latexNumber(Cs)}-${latexNumber(C0)}}=` +
        `${latexNumber(r, 6)}\\ \\Rightarrow\\ z=${latexNumber(z, 6)}`,
    });
    if (unknown === 'time') {
      if (!(x > 0) || !Number.isFinite(x)) return fail('kitChemMat.df.err.depth');
      t = (x * x) / (4 * z * z * input.D);
      steps.push({
        key: 'kitChemMat.df.step.erfTime',
        math:
          `t=\\frac{x^2}{4z^2D}=\\frac{(${latexNumber(x, 5)})^2}{4\\times${latexNumber(z, 5)}^2` +
          `\\times${latexNumber(input.D, 5)}}=${latexNumber(t, 5)}\\ \\mathrm{s}`,
      });
    } else {
      if (!pos(t)) return fail('kitChemMat.df.err.time');
      x = 2 * z * Math.sqrt(input.D * t);
      steps.push({
        key: 'kitChemMat.df.step.erfDepth',
        math:
          `x=2z\\sqrt{Dt}=2\\times${latexNumber(z, 5)}\\times\\sqrt{${latexNumber(input.D, 5)}` +
          `\\times${latexNumber(t, 5)}}=${latexNumber(x, 5)}\\ \\mathrm{m}`,
      });
    }
  }
  const L = Math.sqrt(input.D * t);
  const rows: Row[] = [];
  if (unknown === 'conc') rows.push({ key: 'kitChemMat.df.row.Cx', value: Cx, digits: 6 });
  if (unknown === 'time') rows.push({ key: 'kitChemMat.df.row.t', value: t, dim: 'time', digits: 5 });
  if (unknown === 'depth') rows.push({ key: 'kitChemMat.df.row.x', value: x, dim: 'distance', digits: 5 });
  rows.push({ key: 'kitChemMat.df.row.z', value: z, digits: 6 });
  rows.push({ key: 'kitChemMat.df.row.diffLength', value: L, dim: 'distance', digits: 5 });
  const xMax = Math.max(x * 1.6, 3.2 * L);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const xi = (xMax * i) / 60;
    pts.push([xi, erfProfile(Cs, C0, input.D, xi, t)]);
  }
  const plot: PlotData = {
    xLabel: 'kitChemMat.df.plot.depth',
    yLabel: 'kitChemMat.df.plot.conc',
    series: [
      { label: 'kitChemMat.df.plot.profile', points: pts },
      { label: 'kitChemMat.df.plot.point', style: 'dots', points: [[x, Cx]] },
    ],
    alt: 'kitChemMat.df.plot.alt',
  };
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.df.note.erf' }],
    equation: 'C(x,t)=C_s-(C_s-C_0)\\,\\mathrm{erf}\\!\\left(\\frac{x}{2\\sqrt{Dt}}\\right)',
    plot,
  };
}

// ---------- Dopants: predeposition and drive-in ----------

export interface DopantInput {
  /** Surface concentration, cm^-3. */
  Cs: number;
  /** Diffusivity m^2/s and time s of the predeposition. */
  D1: number;
  t1: number;
  /** Background concentration cm^-3, or NaN. */
  Cb: number;
  /** Drive-in diffusivity m^2/s and time s, or NaN. */
  D2: number;
  t2: number;
}

const CM2_PER_M2 = 1e4;

/** The dose per area (cm^-2) of a predeposition: 2 Cs sqrt(D t / pi), with D in cm^2/s. */
export const predepositionDose = (Cs: number, Dcm: number, t: number) => 2 * Cs * Math.sqrt((Dcm * t) / Math.PI);

export function dopant(input: DopantInput): Outcome {
  if (!pos(input.Cs)) return fail('kitChemMat.df.err.surface');
  if (!pos(input.D1)) return fail('kitChemMat.df.err.d');
  if (!pos(input.t1)) return fail('kitChemMat.df.err.time');
  const D1 = input.D1 * CM2_PER_M2;
  const Q = predepositionDose(input.Cs, D1, input.t1);
  const L1 = Math.sqrt(D1 * input.t1);
  const hasBackground = !Number.isNaN(input.Cb);
  if (hasBackground && !pos(input.Cb)) return fail('kitChemMat.df.err.background');
  if (hasBackground && input.Cb >= input.Cs) return fail('kitChemMat.df.err.backgroundHigh');
  const driveIn = !Number.isNaN(input.D2) || !Number.isNaN(input.t2);
  if (driveIn && (!pos(input.D2) || !pos(input.t2))) return fail('kitChemMat.df.err.drive');
  const rows: Row[] = [
    { key: 'kitChemMat.df.row.dose', value: Q, unit: 'cm⁻²', digits: 5 },
    { key: 'kitChemMat.df.row.diffLength', value: L1 * 1e-2, dim: 'length', digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.df.step.predep',
      math:
        `Q=2C_s\\sqrt{\\frac{Dt}{\\pi}}=2\\times${latexNumber(input.Cs)}\\times\\sqrt{\\frac{${latexNumber(D1, 5)}` +
        `\\times${latexNumber(input.t1, 5)}}{\\pi}}=${latexNumber(Q, 5)}\\ \\mathrm{cm^{-2}}`,
    },
  ];
  const xMax: number[] = [3 * L1];
  const profiles: { label: 'kitChemMat.df.plot.predep' | 'kitChemMat.df.plot.drive'; f: (x: number) => number }[] = [
    { label: 'kitChemMat.df.plot.predep', f: (x) => input.Cs * erfc(x / (2 * L1)) },
  ];
  if (hasBackground) {
    const xj = 2 * L1 * erfcInverse(input.Cb / input.Cs);
    rows.push({ key: 'kitChemMat.df.row.junction1', value: xj * 1e-2, dim: 'length', digits: 5 });
    steps.push({
      key: 'kitChemMat.df.step.junction1',
      math:
        `x_j=2\\sqrt{Dt}\\,\\mathrm{erfc}^{-1}\\!\\left(\\frac{C_b}{C_s}\\right)=` +
        `${latexNumber(xj * 1e4, 5)}\\ \\mu\\mathrm{m}`,
    });
    xMax.push(xj * 1.5);
  }
  if (driveIn) {
    const D2 = input.D2 * CM2_PER_M2;
    const L2 = Math.sqrt(D2 * input.t2);
    const surface = Q / (Math.sqrt(Math.PI) * L2);
    rows.push({ key: 'kitChemMat.df.row.surface2', value: surface, unit: 'cm⁻³', digits: 5 });
    steps.push({
      key: 'kitChemMat.df.step.drive',
      math:
        `C(x,t)=\\frac{Q}{\\sqrt{\\pi D_2t_2}}\\exp\\!\\left(-\\frac{x^2}{4D_2t_2}\\right),` +
        `\\quad C(0)=${latexNumber(surface, 5)}\\ \\mathrm{cm^{-3}}`,
    });
    profiles.push({ label: 'kitChemMat.df.plot.drive', f: (x) => surface * Math.exp(-(x * x) / (4 * L2 * L2)) });
    xMax.push(3 * L2);
    if (hasBackground) {
      if (input.Cb >= surface) return fail('kitChemMat.df.err.noJunction');
      const xj2 = 2 * L2 * Math.sqrt(Math.log(surface / input.Cb));
      rows.push({ key: 'kitChemMat.df.row.junction2', value: xj2 * 1e-2, dim: 'length', digits: 5 });
      steps.push({
        key: 'kitChemMat.df.step.junction2',
        math: `x_j=2\\sqrt{D_2t_2\\ln\\frac{C(0)}{C_b}}=${latexNumber(xj2 * 1e4, 5)}\\ \\mu\\mathrm{m}`,
      });
      xMax.push(xj2 * 1.5);
    }
  }
  const top = Math.max(...xMax);
  const floor = (hasBackground ? input.Cb : input.Cs) / 1e3;
  const series: Series[] = profiles.map((p) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i++) {
      const x = (top * i) / 80;
      const c = p.f(x);
      if (c >= floor / 10) pts.push([x * 1e4, c]);
    }
    return { label: p.label, points: pts };
  });
  if (hasBackground)
    series.push({
      label: 'kitChemMat.df.plot.background',
      points: [
        [0, input.Cb],
        [top * 1e4, input.Cb],
      ],
    });
  const plot: PlotData = {
    xLabel: 'kitChemMat.df.plot.depthUm',
    yLabel: 'kitChemMat.df.plot.dopant',
    series,
    logY: true,
    alt: 'kitChemMat.df.plot.dopantAlt',
  };
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.df.note.dopant' }],
    equation:
      'C(x,t)=C_s\\,\\mathrm{erfc}\\!\\left(\\frac{x}{2\\sqrt{Dt}}\\right),\\quad Q=2C_s\\sqrt{\\frac{Dt}{\\pi}}',
    plot,
  };
}

// ---------- Deal-Grove oxidation ----------

/** Published Arrhenius constants for B and B/A on (111) silicon (divide B/A by 1.68 for (100)): [C in um^2/h or um/h, E in eV]. */
export const DEAL_GROVE = {
  dry: { B: [7.72e2, 1.23], BA: [6.23e6, 2.0] },
  wet: { B: [3.86e2, 0.78], BA: [1.63e8, 2.05] },
} as const;
const K_EV = 8.617333262e-5; // eV/K

export interface OxideInput {
  source: string;
  /** Crystal face for the published constants: '111' as published, '100' with B/A divided by 1.68. */
  orientation?: string;
  /** um^2/h and um/h, used for the typed source. */
  B: number;
  BA: number;
  T: number;
  /** Hours. */
  t: number;
  /** Starting oxide in um, or NaN. */
  xi: number;
  /** Thickness to reach in um, or NaN. */
  target: number;
}

export const oxideThickness = (B: number, A: number, tau: number, t: number) =>
  (-A + Math.sqrt(A * A + 4 * B * (t + tau))) / 2;

export function oxidation(input: OxideInput): Outcome {
  let B = input.B;
  let BA = input.BA;
  const rowsHead: Row[] = [];
  if (input.source === 'dry' || input.source === 'wet') {
    if (!pos(input.T)) return fail('kitChemMat.df.err.temperature');
    const c = DEAL_GROVE[input.source];
    B = c.B[0] * Math.exp(-c.B[1] / (K_EV * input.T));
    BA = (c.BA[0] / (input.orientation === '100' ? 1.68 : 1)) * Math.exp(-c.BA[1] / (K_EV * input.T));
    rowsHead.push({ key: 'kitChemMat.df.row.B', value: B, unit: 'µm²/h', digits: 4 });
    rowsHead.push({ key: 'kitChemMat.df.row.BA', value: BA, unit: 'µm/h', digits: 4 });
  }
  if (!pos(B) || !pos(BA)) return fail('kitChemMat.df.err.rates');
  if (!(input.t >= 0) || !Number.isFinite(input.t)) return fail('kitChemMat.df.err.hours');
  if (!Number.isNaN(input.xi) && !(input.xi >= 0)) return fail('kitChemMat.df.err.initial');
  if (!Number.isNaN(input.target) && !pos(input.target)) return fail('kitChemMat.df.err.targetOxide');
  const A = B / BA;
  const xi = Number.isNaN(input.xi) ? 0 : input.xi;
  const tau = (xi * xi + A * xi) / B;
  const x = oxideThickness(B, A, tau, input.t);
  const rows: Row[] = [
    ...rowsHead,
    { key: 'kitChemMat.df.row.A', value: A, unit: 'µm', digits: 5 },
    { key: 'kitChemMat.df.row.oxide', value: x * 1e-6, dim: 'length', digits: 5 },
    { key: 'kitChemMat.df.row.consumed', value: x * 0.44e-6, dim: 'length', digits: 4 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.df.step.dgA',
      math:
        `A=\\frac{B}{B/A}=\\frac{${latexNumber(B, 5)}}{${latexNumber(BA, 5)}}=${latexNumber(A, 5)}` +
        `\\ \\mu\\mathrm{m}`,
    },
  ];
  if (xi > 0)
    steps.push({
      key: 'kitChemMat.df.step.dgTau',
      math: `\\tau=\\frac{x_i^2+Ax_i}{B}=${latexNumber(tau, 5)}\\ \\mathrm{h}`,
    });
  steps.push({
    key: 'kitChemMat.df.step.dgX',
    math: `x=\\frac{-A+\\sqrt{A^2+4B(t+\\tau)}}{2}=${latexNumber(x, 5)}\\ \\mu\\mathrm{m}`,
  });
  let tTarget = NaN;
  if (!Number.isNaN(input.target)) {
    tTarget = (input.target * input.target + A * input.target) / B - tau;
    if (tTarget < 0) {
      rows.push({ key: 'kitChemMat.df.row.alreadyThick', value: '', word: 'kitChemMat.df.word.already' });
    } else {
      rows.push({ key: 'kitChemMat.df.row.timeTo', value: tTarget * 3600, dim: 'time', digits: 5 });
      steps.push({
        key: 'kitChemMat.df.step.dgTime',
        math:
          `t=\\frac{x^2+Ax}{B}-\\tau=\\frac{${latexNumber(input.target, 5)}^2+${latexNumber(A, 5)}` +
          `\\times${latexNumber(input.target, 5)}}{${latexNumber(B, 5)}}-${latexNumber(tau, 4)}=` +
          `${latexNumber(tTarget, 5)}\\ \\mathrm{h}`,
      });
    }
  }
  const tEnd = Math.max(input.t, Number.isFinite(tTarget) ? tTarget : 0, 1e-9) * 1.1;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const ti = (tEnd * i) / 60;
    pts.push([ti, oxideThickness(B, A, tau, ti)]);
  }
  const plot: PlotData = {
    xLabel: 'kitChemMat.df.plot.hours',
    yLabel: 'kitChemMat.df.plot.oxide',
    series: [
      { label: 'kitChemMat.df.plot.growth', points: pts },
      { label: 'kitChemMat.df.plot.now', style: 'dots', points: [[input.t, x]] },
    ],
    alt: 'kitChemMat.df.plot.oxideAlt',
  };
  return {
    ok: true,
    rows,
    steps,
    notes: [
      { key: 'kitChemMat.df.note.dg' },
      ...(input.source === 'custom' ? [] : [{ key: 'kitChemMat.df.note.dgConstants' as const }]),
    ],
    equation: 'x^2+Ax=B(t+\\tau)',
    plot,
  };
}
