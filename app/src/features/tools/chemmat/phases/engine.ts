// Phase fractions and fracture: the lever rule on a tie line, the microconstituents of a eutectic alloy, the critical
// crack length, and the Larson-Miller parameter for creep. Compositions are in the unit the student uses (wt% or
// at%), and the answer is in that same unit's fractions. Stresses are in pascals, lengths in meters, times in seconds.
import { latexNumber } from '../chemText';
import { fail } from '../types';
import type { KitStep, Outcome, Row } from '../types';

const finite = (x: number) => Number.isFinite(x);

// ---------- Lever rule ----------

export interface LeverInput {
  /** Overall alloy composition and the compositions of the phases at the two ends of the tie line. */
  C0: number;
  C1: number;
  C2: number;
  /** Densities of the two phases (g/cm3) for volume fractions, NaN to skip. */
  rho1: number;
  rho2: number;
  /** Total mass (g) to split, NaN to skip. */
  mass: number;
}

/** Mass fractions [W1, W2] of the phases whose compositions are C1 and C2, for an alloy of composition C0. */
export const leverFractions = (C0: number, C1: number, C2: number): [number, number] => [
  (C2 - C0) / (C2 - C1),
  (C0 - C1) / (C2 - C1),
];

export function lever(input: LeverInput): Outcome {
  const { C0, C1, C2 } = input;
  if (!finite(C0) || !finite(C1) || !finite(C2)) return fail('kitChemMat.ph.err.composition');
  if (C1 === C2) return fail('kitChemMat.ph.err.sameEnds');
  const lo = Math.min(C1, C2);
  const hi = Math.max(C1, C2);
  if (C0 < lo || C0 > hi) return fail('kitChemMat.ph.err.outside');
  const [W1, W2] = leverFractions(C0, C1, C2);
  const rows: Row[] = [
    { key: 'kitChemMat.ph.row.W1', value: W1, digits: 5 },
    { key: 'kitChemMat.ph.row.W2', value: W2, digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.ph.step.lever1',
      math:
        `W_1=\\frac{C_2-C_0}{C_2-C_1}=\\frac{${latexNumber(C2)}-${latexNumber(C0)}}{${latexNumber(C2)}-${latexNumber(C1)}}=` +
        `${latexNumber(W1, 5)}`,
    },
    {
      key: 'kitChemMat.ph.step.lever2',
      math:
        `W_2=\\frac{C_0-C_1}{C_2-C_1}=\\frac{${latexNumber(C0)}-${latexNumber(C1)}}{${latexNumber(C2)}-${latexNumber(C1)}}=` +
        `${latexNumber(W2, 5)}`,
    },
  ];
  const wantVolume = !Number.isNaN(input.rho1) || !Number.isNaN(input.rho2);
  if (wantVolume) {
    if (!(input.rho1 > 0) || !(input.rho2 > 0)) return fail('kitChemMat.ph.err.density');
    const v1 = W1 / input.rho1;
    const v2 = W2 / input.rho2;
    const V1 = v1 / (v1 + v2);
    rows.push({ key: 'kitChemMat.ph.row.V1', value: V1, digits: 5 });
    rows.push({ key: 'kitChemMat.ph.row.V2', value: 1 - V1, digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.volume',
      math: `V_1=\\frac{W_1/\\rho_1}{W_1/\\rho_1+W_2/\\rho_2}=${latexNumber(V1, 5)}`,
    });
  }
  if (!Number.isNaN(input.mass)) {
    if (!(input.mass > 0)) return fail('kitChemMat.ph.err.mass');
    rows.push({ key: 'kitChemMat.ph.row.m1', value: W1 * input.mass, unit: 'g', digits: 5 });
    rows.push({ key: 'kitChemMat.ph.row.m2', value: W2 * input.mass, unit: 'g', digits: 5 });
  }
  const notes: { key: 'kitChemMat.ph.note.lever' | 'kitChemMat.ph.note.single' }[] = [
    { key: 'kitChemMat.ph.note.lever' },
  ];
  if (C0 === C1 || C0 === C2) notes.push({ key: 'kitChemMat.ph.note.single' });
  return {
    ok: true,
    rows,
    steps,
    notes,
    equation: 'W_1=\\frac{C_2-C_0}{C_2-C_1},\\quad W_2=\\frac{C_0-C_1}{C_2-C_1}',
  };
}

// ---------- Eutectic microconstituents ----------

export interface EutecticInput {
  C0: number;
  /** Compositions at the eutectic temperature: the end of the alpha field, the eutectic point, the end of the beta field. */
  Ca: number;
  CE: number;
  Cb: number;
}

export function eutectic(input: EutecticInput): Outcome {
  const { C0, Ca, CE, Cb } = input;
  if (![C0, Ca, CE, Cb].every(finite)) return fail('kitChemMat.ph.err.composition');
  if (!(Ca < CE && CE < Cb)) return fail('kitChemMat.ph.err.order');
  if (C0 < Ca || C0 > Cb) return fail('kitChemMat.ph.err.outside');
  const [Wa, Wb] = leverFractions(C0, Ca, Cb);
  const hypo = C0 < CE;
  const proKey = hypo ? 'kitChemMat.ph.row.proAlpha' : 'kitChemMat.ph.row.proBeta';
  const pro = hypo ? (CE - C0) / (CE - Ca) : (C0 - CE) / (Cb - CE);
  const eut = 1 - pro;
  const aInEut = eut * ((Cb - CE) / (Cb - Ca));
  const rows: Row[] = [
    { key: 'kitChemMat.ph.row.totalAlpha', value: Wa, digits: 5 },
    { key: 'kitChemMat.ph.row.totalBeta', value: Wb, digits: 5 },
    { key: proKey, value: pro, digits: 5 },
    { key: 'kitChemMat.ph.row.eutectic', value: eut, digits: 5 },
    { key: 'kitChemMat.ph.row.alphaInEutectic', value: aInEut, digits: 5 },
    { key: 'kitChemMat.ph.row.betaInEutectic', value: eut - aInEut, digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.ph.step.total',
      math:
        `W_\\alpha=\\frac{C_\\beta-C_0}{C_\\beta-C_\\alpha}=${latexNumber(Wa, 5)},` +
        `\\quad W_\\beta=${latexNumber(Wb, 5)}`,
    },
    hypo
      ? {
          key: 'kitChemMat.ph.step.proAlpha',
          math:
            `W'_\\alpha=\\frac{C_E-C_0}{C_E-C_\\alpha}=` +
            `\\frac{${latexNumber(CE)}-${latexNumber(C0)}}{${latexNumber(CE)}-${latexNumber(Ca)}}=` +
            `${latexNumber(pro, 5)}`,
        }
      : {
          key: 'kitChemMat.ph.step.proBeta',
          math:
            `W'_\\beta=\\frac{C_0-C_E}{C_\\beta-C_E}=` +
            `\\frac{${latexNumber(C0)}-${latexNumber(CE)}}{${latexNumber(Cb)}-${latexNumber(CE)}}=` +
            `${latexNumber(pro, 5)}`,
        },
    { key: 'kitChemMat.ph.step.eutectic', math: `W_e=1-W'=${latexNumber(eut, 5)}` },
  ];
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: C0 === CE ? 'kitChemMat.ph.note.atEutectic' : 'kitChemMat.ph.note.eutectic' }],
    equation: "W'_\\alpha=\\frac{C_E-C_0}{C_E-C_\\alpha}",
  };
}

// ---------- Fracture toughness ----------

export interface FractureInput {
  find: string;
  /** MPa sqrt(m). */
  K: number;
  Y: number;
  /** Stress in Pa. */
  stress: number;
  /** Crack length in m. */
  a: number;
}

const MPA = 1e6;

/** Critical crack length from K_IC = Y sigma sqrt(pi a). */
export const criticalCrack = (K: number, Y: number, sigma: number) => (K / (Y * sigma)) ** 2 / Math.PI;

export function fracture(input: FractureInput): Outcome {
  const { K, Y } = input;
  if (!(Y > 0) || !finite(Y)) return fail('kitChemMat.ph.err.geometry');
  const steps: KitStep[] = [];
  const rows: Row[] = [];
  const sigmaMPa = input.stress / MPA;
  if (input.find === 'stress') {
    if (!(K > 0) || !finite(K)) return fail('kitChemMat.ph.err.toughness');
    if (!(input.a > 0) || !finite(input.a)) return fail('kitChemMat.ph.err.crack');
    const s = K / (Y * Math.sqrt(Math.PI * input.a));
    rows.push({ key: 'kitChemMat.ph.row.fractureStress', value: s * MPA, dim: 'stress', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.stress',
      math:
        `\\sigma_f=\\frac{K_{Ic}}{Y\\sqrt{\\pi a}}=\\frac{${latexNumber(K)}}{${latexNumber(Y)}\\sqrt{\\pi` +
        `\\times${latexNumber(input.a, 5)}}}=${latexNumber(s, 5)}\\ \\mathrm{MPa}`,
    });
  } else if (input.find === 'toughness') {
    if (!(sigmaMPa > 0) || !finite(sigmaMPa)) return fail('kitChemMat.ph.err.stress');
    if (!(input.a > 0) || !finite(input.a)) return fail('kitChemMat.ph.err.crack');
    const k = Y * sigmaMPa * Math.sqrt(Math.PI * input.a);
    rows.push({ key: 'kitChemMat.ph.row.K', value: k, unit: 'MPa√m', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.K',
      math:
        `K=Y\\sigma\\sqrt{\\pi a}=${latexNumber(Y)}\\times${latexNumber(sigmaMPa, 5)}` +
        `\\times\\sqrt{\\pi\\times${latexNumber(input.a, 5)}}=${latexNumber(k, 5)}` +
        `\\ \\mathrm{MPa\\sqrt m}`,
    });
  } else {
    if (!(K > 0) || !finite(K)) return fail('kitChemMat.ph.err.toughness');
    if (!(sigmaMPa > 0) || !finite(sigmaMPa)) return fail('kitChemMat.ph.err.stress');
    const a = criticalCrack(K, Y, sigmaMPa);
    rows.push({ key: 'kitChemMat.ph.row.crack', value: a, dim: 'distance', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.crack',
      math:
        `a_c=\\frac1\\pi\\left(\\frac{K_{Ic}}{Y\\sigma}\\right)^2=\\frac1\\pi\\left(\\frac{${latexNumber(K)}}{${latexNumber(Y)}` +
        `\\times${latexNumber(sigmaMPa, 5)}}\\right)^2=${latexNumber(a, 5)}\\ \\mathrm{m}`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.ph.note.fracture' }],
    equation: 'K_{Ic}=Y\\sigma\\sqrt{\\pi a}',
  };
}

// ---------- Creep: Larson-Miller ----------

export interface CreepInput {
  /** Kelvin, seconds. */
  T1: number;
  t1: number;
  C: number;
  /** A second temperature at which to predict the rupture life, or NaN. */
  T2: number;
  /** A life in seconds for which to find the temperature, or NaN. */
  tTarget: number;
}

const HOUR = 3600;

export const larsonMiller = (T: number, hours: number, C: number) => T * (C + Math.log10(hours));

export function creep(input: CreepInput): Outcome {
  if (!(input.T1 > 0) || !finite(input.T1)) return fail('kitChemMat.ph.err.temperature');
  if (!(input.t1 > 0) || !finite(input.t1)) return fail('kitChemMat.ph.err.life');
  if (!finite(input.C)) return fail('kitChemMat.ph.err.constant');
  const h1 = input.t1 / HOUR;
  const P = larsonMiller(input.T1, h1, input.C);
  const rows: Row[] = [{ key: 'kitChemMat.ph.row.lmp', value: P, unit: 'K', digits: 6 }];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.ph.step.lmp',
      math:
        `P=T\\,(C+\\log_{10}t_r)=${latexNumber(input.T1, 5)}\\times(${latexNumber(input.C)}+\\log_{10}${latexNumber(h1, 5)})=` +
        `${latexNumber(P, 6)}`,
    },
  ];
  if (!Number.isNaN(input.T2)) {
    if (!(input.T2 > 0)) return fail('kitChemMat.ph.err.temperature');
    const log = P / input.T2 - input.C;
    if (log > 300) return fail('kitChemMat.ph.err.hugeLife');
    const h2 = 10 ** log;
    rows.push({ key: 'kitChemMat.ph.row.life2', value: h2 * HOUR, dim: 'time', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.lifeAtT',
      math: `t_r=10^{P/T-C}=10^{${latexNumber(log, 5)}}=${latexNumber(h2, 5)}\\ \\mathrm{h}`,
    });
  }
  if (!Number.isNaN(input.tTarget)) {
    if (!(input.tTarget > 0)) return fail('kitChemMat.ph.err.life');
    const hours = input.tTarget / HOUR;
    const denominator = input.C + Math.log10(hours);
    if (!(denominator > 0)) return fail('kitChemMat.ph.err.noTemperature');
    const T = P / denominator;
    rows.push({ key: 'kitChemMat.ph.row.temp2', value: T, dim: 'temperature', digits: 5 });
    steps.push({
      key: 'kitChemMat.ph.step.temp',
      math:
        `T=\\frac{P}{C+\\log_{10}t_r}=\\frac{${latexNumber(P, 6)}}{${latexNumber(denominator, 5)}}=` +
        `${latexNumber(T, 5)}\\ \\mathrm{K}`,
    });
  }
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.ph.note.creep' }],
    equation: 'P=T\\,(C+\\log_{10}t_r)',
  };
}
