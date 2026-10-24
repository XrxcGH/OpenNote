// Statistical thermodynamics and microscale energy: partition functions of an ideal gas molecule (translation,
// rigid rotation, harmonic vibration, electronic ground level), Einstein and Debye solids, Maxwell-Boltzmann speeds
// with the mean free path and simple kinetic theory, and Fermi-Dirac, Bose-Einstein, and Boltzmann occupancy.
// Closed-form textbook statistical mechanics; the Debye integral by Gauss-Legendre quadrature.
import { C2_CM_K, E_CHARGE, H_PLANCK, K_B, N_A, R_MOLAR } from '../common/constants';
import { fmt, tex } from '../common/format';
import { integrate, linspace } from '../common/num';
import { ThermoError, positive, type KitStep, type ResultRow, type ThermoResult } from '../common/types';

export interface GasInput {
  /** Molar mass, g/mol. */
  M: number;
  T: number;
  /** Pressure, kPa. */
  p: number;
  shape: 'atom' | 'linear';
  /** Rotational constant, cm^-1. */
  B: number;
  sigma: number;
  /** Vibrational wavenumbers, cm^-1, one per normal mode (repeat a degenerate mode). */
  modes: readonly number[];
  /** Degeneracy of the electronic ground level. */
  g0: number;
}

export interface ModeTerms {
  q: number;
  /** Molar internal energy above the ground level, J/mol. */
  U: number;
  /** Molar heat capacity at constant volume, J/(mol K). */
  cv: number;
  /** Molar entropy, J/(mol K). */
  S: number;
}

/** Sackur-Tetrode translational terms for one mole at T (K) and p (kPa). */
export function translation(M: number, T: number, p: number): ModeTerms & { lambda: number } {
  const m = M / 1000 / N_A;
  const lambda = H_PLANCK / Math.sqrt(2 * Math.PI * m * K_B * T);
  const volumePerMolecule = (K_B * T) / (p * 1000);
  const q = volumePerMolecule / lambda ** 3;
  return { q, lambda, U: 1.5 * R_MOLAR * T, cv: 1.5 * R_MOLAR, S: R_MOLAR * (Math.log(q) + 2.5) };
}

/** High-temperature rotation of a linear molecule: q = T / (sigma theta_rot). */
export function rotation(B: number, sigma: number, T: number): ModeTerms & { theta: number } {
  const theta = C2_CM_K * B;
  const q = T / (sigma * theta);
  return { q, theta, U: R_MOLAR * T, cv: R_MOLAR, S: R_MOLAR * (Math.log(q) + 1) };
}

/** One harmonic vibrational mode, energy counted from the ground level. */
export function vibration(wavenumber: number, T: number): ModeTerms & { theta: number } {
  const theta = C2_CM_K * wavenumber;
  const x = theta / T;
  const em1 = Math.expm1(x);
  const q = 1 / -Math.expm1(-x);
  const U = (R_MOLAR * theta) / em1;
  const cv = x > 700 ? 0 : (R_MOLAR * x * x * Math.exp(x)) / (em1 * em1);
  const S = R_MOLAR * (x / em1 - Math.log(-Math.expm1(-x)));
  return { q, theta, U, cv, S };
}

function checkGas(input: GasInput): void {
  positive(input.M, 'M');
  positive(input.T, 'T');
  positive(input.p, 'p');
  if (input.shape === 'linear') {
    positive(input.B, 'B');
    positive(input.sigma, 'sigma');
    if (input.T < 5 * C2_CM_K * input.B) throw new ThermoError('rotationLowT', { theta: fmt(C2_CM_K * input.B, 4) });
  }
  input.modes.forEach((mode) => positive(mode, 'modes'));
  positive(input.g0, 'g0');
}

const row = (key: ResultRow['key'], symbol: string, value: number, qty: ResultRow['qty']): ResultRow => ({
  key,
  symbol,
  value,
  qty,
});

/** Partition functions and molar U, cv, cp, and S of an ideal gas of molecules. */
export function solveGas(input: GasInput): ThermoResult {
  checkGas(input);
  const { M, T, p } = input;
  const tr = translation(M, T, p);
  const steps: KitStep[] = [
    {
      key: 'stat.trans',
      vars: { lambda: fmt(tr.lambda * 1e12, 5), q: fmt(tr.q, 5) },
      math: 'q_{tr}=\\frac{kT/p}{\\Lambda^3},\\;\\Lambda=\\frac{h}{\\sqrt{2\\pi mkT}}',
    },
    {
      key: 'stat.sackur',
      vars: { S: fmt(tr.S, 6) },
      math: `S_{tr}=R\\left[\\ln q_{tr}+\\tfrac52\\right]=${tex(tr.S, 6)}`,
    },
  ];
  const parts: ModeTerms[] = [tr];
  const rows: ResultRow[] = [row('qTrans', 'q_{tr}', tr.q, 'none'), row('sTrans', 'S_{tr}', tr.S, 'molarS')];
  if (input.shape === 'linear') {
    const rot = rotation(input.B, input.sigma, T);
    parts.push(rot);
    rows.push(row('thetaRot', '\\theta_{rot}', rot.theta, 'T'), row('qRot', 'q_{rot}', rot.q, 'none'));
    steps.push({
      key: 'stat.rot',
      vars: { theta: fmt(rot.theta, 5), q: fmt(rot.q, 5), sigma: fmt(input.sigma, 3) },
      math: `\\theta_{rot}=\\frac{hcB}{k}=${tex(rot.theta, 5)}\\,\\mathrm{K},\\;q_{rot}=\\frac{T}{\\sigma\\theta_{rot}}=${tex(rot.q, 5)}`,
    });
  }
  input.modes.forEach((wavenumber, i) => {
    const vib = vibration(wavenumber, T);
    parts.push(vib);
    rows.push({ ...row('thetaVib', '\\theta_{vib}', vib.theta, 'T'), tag: String(i + 1) });
    steps.push({
      key: 'stat.vib',
      vars: { n: String(i + 1), theta: fmt(vib.theta, 5), cv: fmt(vib.cv / R_MOLAR, 5) },
      math: `\\theta_{vib}=${tex(vib.theta, 5)}\\,\\mathrm{K},\\;\\frac{c_{v}}{R}=\\frac{x^2e^x}{(e^x-1)^2}=${tex(vib.cv / R_MOLAR, 5)}`,
    });
  });
  const elec = R_MOLAR * Math.log(input.g0);
  if (input.g0 !== 1) steps.push({ key: 'stat.elec', vars: { g: fmt(input.g0, 3), S: fmt(elec, 5) } });
  const U = parts.reduce((sum, part) => sum + part.U, 0);
  const cv = parts.reduce((sum, part) => sum + part.cv, 0);
  const S = parts.reduce((sum, part) => sum + part.S, 0) + elec;
  steps.push({ key: 'stat.total', vars: { cv: fmt(cv, 5), cp: fmt(cv + R_MOLAR, 5), S: fmt(S, 6) } });
  rows.push(
    row('uMolar', 'U-U_0', U / 1000, 'molarE'),
    row('cvMolar', 'c_v', cv, 'molarS'),
    row('cpMolar', 'c_p', cv + R_MOLAR, 'molarS'),
    row('kRatio', 'k', (cv + R_MOLAR) / cv, 'none'),
    row('sMolar', 'S', S, 'molarS'),
  );
  return {
    rows,
    steps,
    latex: `S^\\circ=${tex(S, 6)}\\ \\mathrm{J/(mol\\,K)},\\quad c_v=${tex(cv, 5)}\\ \\mathrm{J/(mol\\,K)}`,
    notes: ['idealGasMolecules', 'rigidRotor'],
  };
}

export interface SolidInput {
  model: 'einstein' | 'debye';
  /** Einstein or Debye temperature, K. */
  theta: number;
  T: number;
}

/** Einstein solid: cv / R = 3 x^2 e^x / (e^x - 1)^2 with x = theta_E / T. */
export function einsteinCv(theta: number, T: number): number {
  const x = theta / T;
  if (x > 700) return 0;
  const em1 = Math.expm1(x);
  return (3 * x * x * Math.exp(x)) / (em1 * em1);
}

/** The Debye integrand x^4 e^x / (e^x - 1)^2, written to stay finite as x goes to 0 and for large x. */
function debyeIntegrand(x: number): number {
  if (x < 1e-6) return x * x;
  const e = Math.exp(-x);
  return (x ** 4 * e) / (-Math.expm1(-x)) ** 2;
}

/** Debye solid: cv / R = 9 (T / theta_D)^3 times the integral of x^4 e^x / (e^x - 1)^2 from 0 to theta_D / T. */
export function debyeCv(theta: number, T: number): number {
  const top = theta / T;
  const integral = integrate(debyeIntegrand, 0, Math.min(top, 60), 16);
  return 9 * (T / theta) ** 3 * integral;
}

export function solveSolid(input: SolidInput): ThermoResult {
  const theta = positive(input.theta, 'theta');
  const T = positive(input.T, 'T');
  const cvR = input.model === 'einstein' ? einsteinCv(theta, T) : debyeCv(theta, T);
  const steps: KitStep[] =
    input.model === 'einstein'
      ? [
          {
            key: 'stat.einstein',
            vars: { x: fmt(theta / T, 5), cv: fmt(cvR, 5) },
            math: `\\frac{c_v}{R}=3\\frac{x^2e^x}{(e^x-1)^2},\\;x=\\frac{\\theta_E}{T}=${tex(theta / T, 5)}`,
          },
        ]
      : [
          {
            key: 'stat.debye',
            vars: { x: fmt(theta / T, 5), cv: fmt(cvR, 5) },
            math: `\\frac{c_v}{R}=9\\left(\\frac{T}{\\theta_D}\\right)^3\\int_0^{\\theta_D/T}\\frac{x^4e^x}{(e^x-1)^2}\\,dx`,
          },
        ];
  steps.push({ key: 'stat.dulong', vars: { ratio: fmt(cvR / 3, 4) } });
  const ratios = linspace(0.02, 2, 100);
  return {
    rows: [
      row('cvOverR', 'c_v/R', cvR, 'none'),
      row('cvMolar', 'c_v', cvR * R_MOLAR, 'molarS'),
      row('tOverTheta', 'T/\\theta', T / theta, 'none'),
    ],
    steps,
    latex: `\\frac{c_v}{R}=${tex(cvR, 5)}`,
    notes: ['harmonicSolid'],
    plots: [
      {
        title: 'cv',
        x: { label: 'T/θ', qty: 'none' },
        y: { label: 'cv/R', qty: 'none' },
        series: [
          { name: 'Einstein', points: ratios.map((r) => [r, einsteinCv(1, r)] as const) },
          { name: 'Debye', points: ratios.map((r) => [r, debyeCv(1, r)] as const), dashed: true },
        ],
        marks: [{ x: T / theta, y: cvR, label: fmt(cvR, 4) }],
      },
    ],
  };
}

export interface SpeedInput {
  M: number;
  T: number;
  p: number;
  /** Molecular diameter, nm. */
  d: number;
  /** A length for the Knudsen number, m. */
  L: number;
  /** Heat capacity per molecule in units of k (3/2 for atoms, 5/2 for diatomics near room temperature). */
  cvk: number;
}

/** Maxwell-Boltzmann speeds, mean free path, Knudsen number, and simple kinetic-theory k and mu. */
export function speeds(M: number, T: number): { mp: number; mean: number; rms: number } {
  const kT = (R_MOLAR * T) / (M / 1000);
  return { mp: Math.sqrt(2 * kT), mean: Math.sqrt((8 * kT) / Math.PI), rms: Math.sqrt(3 * kT) };
}

export function meanFreePath(T: number, pKPa: number, dNm: number): number {
  const d = dNm * 1e-9;
  return (K_B * T) / (Math.SQRT2 * Math.PI * d * d * pKPa * 1000);
}

function regime(kn: number): KitStep['key'] {
  if (kn < 0.01) return 'stat.knContinuum';
  if (kn < 0.1) return 'stat.knSlip';
  if (kn < 10) return 'stat.knTransition';
  return 'stat.knFree';
}

export function solveSpeeds(input: SpeedInput): ThermoResult {
  const M = positive(input.M, 'M');
  const T = positive(input.T, 'T');
  const p = positive(input.p, 'p');
  const d = positive(input.d, 'd');
  const L = positive(input.L, 'L');
  const cvk = positive(input.cvk, 'cvk');
  const v = speeds(M, T);
  const lambda = meanFreePath(T, p, d);
  const n = (p * 1000) / (K_B * T);
  const m = M / 1000 / N_A;
  const kn = lambda / L;
  const k = (1 / 3) * n * cvk * K_B * v.mean * lambda;
  const mu = (1 / 3) * n * m * v.mean * lambda;
  const a = m / (2 * K_B * T);
  const f = (s: number) => 4 * Math.PI * (a / Math.PI) ** 1.5 * s * s * Math.exp(-a * s * s);
  const top = 4 * v.rms;
  return {
    rows: [
      row('vMostProbable', 'v_{mp}', v.mp, 'speed'),
      row('vMean', '\\bar v', v.mean, 'speed'),
      row('vRms', 'v_{rms}', v.rms, 'speed'),
      row('numberDensity', 'n', n, 'none'),
      row('meanFreePath', '\\lambda', lambda * 1e9, 'nano'),
      row('collisionRate', 'z', v.mean / lambda, 'frequency'),
      row('knudsen', 'Kn', kn, 'none'),
      row('kKinetic', 'k', k, 'k'),
      row('muKinetic', '\\mu', mu, 'mu'),
    ],
    steps: [
      {
        key: 'stat.speeds',
        vars: { mp: fmt(v.mp, 5), mean: fmt(v.mean, 5), rms: fmt(v.rms, 5) },
        math: 'v_{mp}=\\sqrt{\\frac{2kT}{m}},\\;\\bar v=\\sqrt{\\frac{8kT}{\\pi m}},\\;v_{rms}=\\sqrt{\\frac{3kT}{m}}',
      },
      {
        key: 'stat.mfp',
        vars: { lambda: fmt(lambda * 1e9, 5) },
        math: `\\lambda=\\frac{kT}{\\sqrt2\\,\\pi d^2p}=${tex(lambda * 1e9, 5)}\\ \\mathrm{nm}`,
      },
      { key: 'stat.kn', vars: { kn: fmt(kn, 4) }, math: `Kn=\\frac{\\lambda}{L}=${tex(kn, 4)}` },
      { key: regime(kn) },
      {
        key: 'stat.kinetic',
        vars: { k: fmt(k, 4), mu: fmt(mu, 4) },
        math: 'k=\\tfrac13\\,C\\,\\bar v\\,\\lambda,\\;\\mu=\\tfrac13\\,\\rho\\,\\bar v\\,\\lambda',
      },
    ],
    latex: `\\bar v=${tex(v.mean, 5)}\\ \\mathrm{m/s},\\quad \\lambda=${tex(lambda * 1e9, 4)}\\ \\mathrm{nm}`,
    notes: ['hardSpheres'],
    plots: [
      {
        title: 'speeds',
        x: { label: 'v', qty: 'speed' },
        y: { label: 'f(v)', qty: 'none' },
        series: [{ name: 'f(v)', points: linspace(0, top, 120).map((s) => [s, f(s)] as const) }],
        marks: [
          { x: v.mp, y: f(v.mp), label: 'v_mp' },
          { x: v.mean, y: f(v.mean), label: 'v̄' },
          { x: v.rms, y: f(v.rms), label: 'v_rms' },
        ],
      },
    ],
  };
}

export interface OccupancyInput {
  /** Energy of the level, eV. */
  E: number;
  /** Chemical potential, eV. */
  mu: number;
  T: number;
}

export function occupancy(E: number, mu: number, T: number): { fd: number; be: number; mb: number } {
  const x = ((E - mu) * E_CHARGE) / (K_B * T);
  return { fd: 1 / (Math.exp(x) + 1), be: x > 0 ? 1 / Math.expm1(x) : Number.POSITIVE_INFINITY, mb: Math.exp(-x) };
}

export function solveOccupancy(input: OccupancyInput): ThermoResult {
  const T = positive(input.T, 'T');
  const kT = (K_B * T) / E_CHARGE;
  const at = occupancy(input.E, input.mu, T);
  const xs = linspace(input.mu - 8 * kT, input.mu + 8 * kT, 161);
  const be = xs.filter((E) => E > input.mu + 0.05 * kT);
  return {
    rows: [
      row('kT', 'kT', kT, 'eV'),
      row('fFermi', 'f_{FD}', at.fd, 'none'),
      row('fBose', 'f_{BE}', at.be, 'none'),
      row('fBoltzmann', 'f_{MB}', at.mb, 'none'),
    ],
    steps: [
      {
        key: 'stat.occX',
        vars: { x: fmt((input.E - input.mu) / kT, 5), kT: fmt(kT, 5) },
        math: 'x=\\frac{E-\\mu}{kT}',
      },
      {
        key: 'stat.occ',
        vars: { fd: fmt(at.fd, 5), be: Number.isFinite(at.be) ? fmt(at.be, 5) : '∞', mb: fmt(at.mb, 5) },
        math: 'f_{FD}=\\frac{1}{e^x+1},\\;f_{BE}=\\frac{1}{e^x-1},\\;f_{MB}=e^{-x}',
      },
    ],
    latex: `f_{FD}=${tex(at.fd, 5)}`,
    notes: input.E <= input.mu ? ['boseBelowMu'] : [],
    plots: [
      {
        title: 'occupancy',
        x: { label: 'E (eV)', qty: 'none' },
        y: { label: 'f', qty: 'none' },
        series: [
          { name: 'Fermi-Dirac', points: xs.map((E) => [E, occupancy(E, input.mu, T).fd] as const) },
          {
            name: 'Bose-Einstein',
            points: be.map((E) => [E, Math.min(occupancy(E, input.mu, T).be, 3)] as const),
            dashed: true,
          },
          {
            name: 'Boltzmann',
            points: xs
              .filter((E) => occupancy(E, input.mu, T).mb <= 3)
              .map((E) => [E, occupancy(E, input.mu, T).mb] as const),
          },
        ],
        marks: [{ x: input.E, y: at.fd, label: 'E' }],
      },
    ],
  };
}
