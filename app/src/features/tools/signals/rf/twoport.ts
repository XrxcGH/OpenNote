// Two-ports, noise, antennas, and decibels. Two-port matrices convert through ABCD, which every network has; Z or Y
// is reported missing when it does not exist (a series element has no Z matrix). Pure: no DOM.
import { SignalError } from '../shared/errors';
import { cabs, cadd, cconj, cdiv, cmul, csub, cx, fmt, fmtComplex, type Complex } from '../shared/num';
import { step, type Step } from '../shared/steps';
import { SPEED_OF_LIGHT } from './lines';

/** A 2 × 2 complex matrix, row by row: [p11, p12, p21, p22]. */
export type Matrix2 = readonly [Complex, Complex, Complex, Complex];
export type ParameterSet = 'S' | 'Z' | 'Y' | 'ABCD';
export const PARAMETER_SETS: readonly ParameterSet[] = ['S', 'Z', 'Y', 'ABCD'];

const ONE = cx(1);
const TWO = cx(2);
const tiny = (z: Complex) => cabs(z) < 1e-12;
const det = (m: Matrix2) => csub(cmul(m[0], m[3]), cmul(m[1], m[2]));

/** Reads a complex number: 0.5+0.2j, −3j, 40-j30, or polar 0.8∠−30 (degrees; @ also works for ∠). */
export function readComplex(text: string): Complex {
  const clean = text.replace(/\s+/g, '').replace(/−/g, '-').replace(/i/g, 'j');
  const polar = /^([-+]?[\d.]+(?:e[-+]?\d+)?)[∠@]([-+]?[\d.]+(?:e[-+]?\d+)?)$/i.exec(clean);
  if (polar) {
    const r = Number(polar[1]);
    const a = (Number(polar[2]) * Math.PI) / 180;
    if (Number.isFinite(r) && Number.isFinite(a)) return cx(r * Math.cos(a), r * Math.sin(a));
  }
  // Rectangular: split into signed terms (not at the sign of an exponent); a term with j adds to the imaginary part.
  const terms = clean.match(/[-+]?(?:[^-+]*?e[-+]\d+[^-+]*|[^-+]+)/gi);
  if (!clean || !terms || terms.join('') !== clean) throw new SignalError('notComplex', { text });
  let re = 0;
  let im = 0;
  for (const term of terms) {
    const imaginary = term.includes('j');
    const body = term.replace('j', '');
    const value = body === '' || body === '+' ? 1 : body === '-' ? -1 : Number(body);
    if (!Number.isFinite(value) || (imaginary && term.indexOf('j') !== term.lastIndexOf('j'))) {
      throw new SignalError('notComplex', { text });
    }
    if (imaginary) im += value;
    else re += value;
  }
  return cx(re, im);
}

/** Converts any parameter set to ABCD (Pozar, Microwave Engineering, table 4.2). */
export function toAbcd(set: ParameterSet, m: Matrix2, z0: number): Matrix2 {
  const [p11, p12, p21, p22] = m;
  const z0c = cx(z0);
  if (set === 'ABCD') return m;
  if (tiny(p21)) throw new SignalError('noTransfer');
  if (set === 'Z') return [cdiv(p11, p21), cdiv(det(m), p21), cdiv(ONE, p21), cdiv(p22, p21)];
  if (set === 'Y') {
    const minus = (z: Complex) => cx(-z.re, -z.im);
    return [minus(cdiv(p22, p21)), minus(cdiv(ONE, p21)), minus(cdiv(det(m), p21)), minus(cdiv(p11, p21))];
  }
  const twoS21 = cmul(TWO, p21);
  const s12s21 = cmul(p12, p21);
  return [
    cdiv(cadd(cmul(cadd(ONE, p11), csub(ONE, p22)), s12s21), twoS21),
    cmul(z0c, cdiv(csub(cmul(cadd(ONE, p11), cadd(ONE, p22)), s12s21), twoS21)),
    cdiv(csub(cmul(csub(ONE, p11), csub(ONE, p22)), s12s21), cmul(z0c, twoS21)),
    cdiv(cadd(cmul(csub(ONE, p11), cadd(ONE, p22)), s12s21), twoS21),
  ];
}

/** Converts ABCD to another set; null when that set does not exist for the network. */
export function fromAbcd(set: ParameterSet, abcd: Matrix2, z0: number): Matrix2 | null {
  const [a, b, c, d] = abcd;
  const z0c = cx(z0);
  if (set === 'ABCD') return abcd;
  if (set === 'Z') return tiny(c) ? null : [cdiv(a, c), cdiv(det(abcd), c), cdiv(ONE, c), cdiv(d, c)];
  if (set === 'Y') {
    if (tiny(b)) return null;
    const minus = (z: Complex) => cx(-z.re, -z.im);
    return [cdiv(d, b), minus(cdiv(det(abcd), b)), minus(cdiv(ONE, b)), cdiv(a, b)];
  }
  const bz = cdiv(b, z0c);
  const cz = cmul(c, z0c);
  const denominator = cadd(cadd(a, bz), cadd(cz, d));
  return [
    cdiv(csub(cadd(a, bz), cadd(cz, d)), denominator),
    cdiv(cmul(TWO, det(abcd)), denominator),
    cdiv(TWO, denominator),
    cdiv(cadd(csub(bz, a), csub(d, cz)), denominator),
  ];
}

/** Multiplies ABCD matrices in order: the cascade of the stages. */
export function cascade(stages: readonly Matrix2[]): Matrix2 {
  if (!stages.length) throw new SignalError('empty');
  return stages.reduce<Matrix2>(
    (m, n) => [
      cadd(cmul(m[0], n[0]), cmul(m[1], n[2])),
      cadd(cmul(m[0], n[1]), cmul(m[1], n[3])),
      cadd(cmul(m[2], n[0]), cmul(m[3], n[2])),
      cadd(cmul(m[2], n[1]), cmul(m[3], n[3])),
    ],
    [ONE, cx(0), cx(0), ONE],
  );
}

export interface Stability {
  k: number;
  mu: number;
  delta: number;
  unconditional: boolean;
  /** Maximum available gain when K > 1, otherwise the maximum stable gain, in dB. */
  gainDb: number;
  gainKind: 'mag' | 'msg';
  steps: Step[];
}

/** Rollett's K with |Δ|, Edwards and Sinsky's μ, and the maximum available or stable gain, from S. */
export function stability(s: Matrix2): Stability {
  const [s11, s12, s21, s22] = s;
  const delta = det(s);
  const loop = cabs(cmul(s12, s21));
  if (loop === 0) throw new SignalError('unilateral');
  const k = (1 - cabs(s11) ** 2 - cabs(s22) ** 2 + cabs(delta) ** 2) / (2 * loop);
  const mu = (1 - cabs(s11) ** 2) / (cabs(csub(s22, cmul(delta, cconj(s11)))) + loop);
  const ratio = cabs(s21) / cabs(s12);
  const unconditional = k > 1 && cabs(delta) < 1;
  const gain = k > 1 ? ratio * (k - Math.sqrt(k * k - 1)) : ratio;
  const gainDb = 10 * Math.log10(gain);
  return {
    k,
    mu,
    delta: cabs(delta),
    unconditional,
    gainDb,
    gainKind: k > 1 ? 'mag' : 'msg',
    steps: [
      step('rfDelta', `Δ = S11·S22 − S12·S21 = ${fmtComplex(delta, 5)}`),
      step('rfRollett', `K = (1 − |S11|² − |S22|² + |Δ|²)/(2|S12·S21|) = ${fmt(k)}; μ = ${fmt(mu)}`),
      step(k > 1 ? 'rfMag' : 'rfMsg', `${fmt(gainDb)} dB`),
    ],
  };
}

export interface NoiseStage {
  gainDb: number;
  noiseFigureDb: number;
}

export const T0 = 290;
const fromDb = (db: number) => 10 ** (db / 10);

/** Friis's formula: F = F1 + (F2 − 1)/G1 + (F3 − 1)/(G1 G2) + …, with the total gain and noise temperature. */
export function friisNoise(stages: readonly NoiseStage[]): {
  noiseFigureDb: number;
  noiseTemperature: number;
  gainDb: number;
  rows: [string, string, string][];
  steps: Step[];
} {
  if (!stages.length) throw new SignalError('empty');
  let factor = 0;
  let gain = 1;
  const rows: [string, string, string][] = [];
  stages.forEach((stage, i) => {
    if (!Number.isFinite(stage.gainDb) || !Number.isFinite(stage.noiseFigureDb) || stage.noiseFigureDb < 0) {
      throw new SignalError('noiseStage', { stage: i + 1 });
    }
    const f = fromDb(stage.noiseFigureDb);
    const added = i === 0 ? f : (f - 1) / gain;
    factor += added;
    rows.push([String(i + 1), fmt(f), fmt(added)]);
    gain *= fromDb(stage.gainDb);
  });
  const noiseFigureDb = 10 * Math.log10(factor);
  return {
    noiseFigureDb,
    noiseTemperature: T0 * (factor - 1),
    gainDb: 10 * Math.log10(gain),
    rows,
    steps: [
      step('rfFriis', `F = ${rows.map((row) => row[2]).join(' + ')} = ${fmt(factor)}`),
      step(
        'rfNoiseFigure',
        `NF = 10·log₁₀ ${fmt(factor)} = ${fmt(noiseFigureDb)} dB; Te = 290 (F − 1) = ${fmt(T0 * (factor - 1))} K`,
      ),
    ],
  };
}

/** Noise figure (dB) and noise temperature (K) each way, with T0 = 290 K. */
export const noiseTemperature = (noiseFigureDb: number): number => T0 * (fromDb(noiseFigureDb) - 1);
export const noiseFigure = (temperature: number): number => {
  if (!(temperature >= 0)) throw new SignalError('temperature');
  return 10 * Math.log10(1 + temperature / T0);
};

export interface Link {
  wavelength: number;
  eirpDbm: number;
  pathLossDb: number;
  receivedDbm: number;
  apertureTx: number;
  apertureRx: number;
  steps: Step[];
}

/** Friis transmission: received power from transmit power, antenna gains, frequency, and distance. */
export function friisLink(ptDbm: number, gtDbi: number, grDbi: number, frequency: number, distance: number): Link {
  if (!(frequency > 0) || !Number.isFinite(frequency)) throw new SignalError('rfFrequency');
  if (!(distance > 0) || !Number.isFinite(distance)) throw new SignalError('distance');
  if (![ptDbm, gtDbi, grDbi].every(Number.isFinite)) throw new SignalError('notFinite');
  const wavelength = SPEED_OF_LIGHT / frequency;
  const pathLossDb = 20 * Math.log10((4 * Math.PI * distance) / wavelength);
  const eirpDbm = ptDbm + gtDbi;
  const receivedDbm = eirpDbm + grDbi - pathLossDb;
  const aperture = (gDbi: number) => (fromDb(gDbi) * wavelength ** 2) / (4 * Math.PI);
  return {
    wavelength,
    eirpDbm,
    pathLossDb,
    receivedDbm,
    apertureTx: aperture(gtDbi),
    apertureRx: aperture(grDbi),
    steps: [
      step('rfWavelength', `λ = c/f = ${fmt(wavelength)} m`),
      step('rfPathLoss', `FSPL = 20·log₁₀(4πd/λ) = ${fmt(pathLossDb)} dB`),
      step('rfEirp', `EIRP = ${fmt(ptDbm)} + ${fmt(gtDbi)} = ${fmt(eirpDbm)} dBm`),
      step('rfReceived', `Pr = EIRP + Gr − FSPL = ${fmt(receivedDbm)} dBm`),
      step('rfAperture', `Ae = Gλ²/(4π) = ${fmt(aperture(grDbi))} m²`),
    ],
  };
}

/** The radar range equation: Pr = Pt G² λ² σ/((4π)³ R⁴), and the range where Pr falls to the smallest detectable. */
export function radar(
  ptW: number,
  gainDbi: number,
  frequency: number,
  rcs: number,
  range: number,
  minDbm: number,
): {
  receivedDbm: number;
  maxRange: number;
  steps: Step[];
} {
  if (!(ptW > 0) || !(rcs > 0) || !(range > 0)) throw new SignalError('radarInput');
  if (!(frequency > 0)) throw new SignalError('rfFrequency');
  const wavelength = SPEED_OF_LIGHT / frequency;
  const g = fromDb(gainDbi);
  const numerator = ptW * g * g * wavelength ** 2 * rcs;
  const pr = numerator / ((4 * Math.PI) ** 3 * range ** 4);
  const receivedDbm = 10 * Math.log10(pr * 1000);
  const minW = fromDb(minDbm) / 1000;
  const maxRange = (numerator / ((4 * Math.PI) ** 3 * minW)) ** 0.25;
  return {
    receivedDbm,
    maxRange,
    steps: [
      step('rfRadar', `Pr = Pt·G²·λ²·σ/((4π)³R⁴) = ${pr.toExponential(4)} W = ${fmt(receivedDbm)} dBm`),
      step('rfRadarRange', `R_max = (Pt·G²·λ²·σ/((4π)³·P_min))^(1/4) = ${fmt(maxRange)} m`),
    ],
  };
}

export type DbUnit = 'ratioPower' | 'ratioVoltage' | 'dB' | 'dBm' | 'dBW' | 'dBuV' | 'W' | 'V' | 'Np';
export const DB_UNITS: readonly DbUnit[] = ['dB', 'ratioPower', 'ratioVoltage', 'Np', 'dBm', 'dBW', 'W', 'dBuV', 'V'];

/**
 * Decibel conversions. Ratios: dB, power ratios, voltage ratios, and nepers (1 Np = 20 log₁₀ e dB). Levels: dBm, dBW,
 * watts, and, across a resistance (50 Ω by default), dBµV and volts rms.
 */
export function convertDb(value: number, unit: DbUnit, resistance = 50): Record<DbUnit, number> | null {
  if (!Number.isFinite(value)) throw new SignalError('notFinite');
  if (!(resistance > 0)) throw new SignalError('impedance');
  const npDb = 20 * Math.log10(Math.E);
  if (unit === 'dB' || unit === 'ratioPower' || unit === 'ratioVoltage' || unit === 'Np') {
    if ((unit === 'ratioPower' || unit === 'ratioVoltage') && !(value > 0)) throw new SignalError('positiveRatio');
    const db =
      unit === 'dB' ? value : unit === 'Np' ? value * npDb : (unit === 'ratioPower' ? 10 : 20) * Math.log10(value);
    return {
      dB: db,
      ratioPower: 10 ** (db / 10),
      ratioVoltage: 10 ** (db / 20),
      Np: db / npDb,
      dBm: NaN,
      dBW: NaN,
      W: NaN,
      dBuV: NaN,
      V: NaN,
    };
  }
  if ((unit === 'W' || unit === 'V') && !(value > 0)) throw new SignalError('positiveRatio');
  const watts =
    unit === 'W'
      ? value
      : unit === 'dBm'
        ? 10 ** (value / 10) / 1000
        : unit === 'dBW'
          ? 10 ** (value / 10)
          : unit === 'V'
            ? (value * value) / resistance
            : (10 ** (value / 20) * 1e-6) ** 2 / resistance;
  const volts = Math.sqrt(watts * resistance);
  return {
    dB: NaN,
    ratioPower: NaN,
    ratioVoltage: NaN,
    Np: NaN,
    W: watts,
    dBm: 10 * Math.log10(watts * 1000),
    dBW: 10 * Math.log10(watts),
    V: volts,
    dBuV: 20 * Math.log10(volts / 1e-6),
  };
}
