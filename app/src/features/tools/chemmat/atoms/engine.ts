// Light and the quantum atom. Photon energy and wavelength. Hydrogen-like levels and lines. The de Broglie wavelength.
// The particle in a box. Quantum numbers. Lengths are in meters, energies in joules, masses in kilograms inside; the
// rows carry the unit the student reads them in.
import { latexNumber, plain } from '../chemText';
import { C, E_CHARGE, H, ME, MP, NA, R_H } from '../constants';
import { fail } from '../types';
import type { KitStep, Outcome, PlotData, Row } from '../types';
import type { MessageKey } from '../../../../strings/t';

const pos = (x: number) => x > 0 && Number.isFinite(x);

// ---------- Photons ----------

export type PhotonFrom = 'wavelength' | 'frequency' | 'energy';

/** The region of the spectrum for a wavelength in meters (the usual conventional boundaries). */
export function spectrumRegion(lambda: number): MessageKey {
  if (lambda < 1e-11) return 'kitChemMat.at.region.gamma';
  if (lambda < 1e-8) return 'kitChemMat.at.region.xray';
  if (lambda < 380e-9) return 'kitChemMat.at.region.uv';
  if (lambda < 750e-9) return 'kitChemMat.at.region.visible';
  if (lambda < 1e-3) return 'kitChemMat.at.region.infrared';
  if (lambda < 1) return 'kitChemMat.at.region.microwave';
  return 'kitChemMat.at.region.radio';
}

export interface PhotonInput {
  from: string;
  lambda: number;
  nu: number;
  energy: number;
}

export function photon(input: PhotonInput): Outcome {
  let lambda: number;
  if (input.from === 'frequency') {
    if (!pos(input.nu)) return fail('kitChemMat.at.err.frequency');
    lambda = C / input.nu;
  } else if (input.from === 'energy') {
    if (!pos(input.energy)) return fail('kitChemMat.at.err.energy');
    lambda = (H * C) / input.energy;
  } else {
    if (!pos(input.lambda)) return fail('kitChemMat.at.err.wavelength');
    lambda = input.lambda;
  }
  const nu = C / lambda;
  const E = H * nu;
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.wavelength', value: lambda, dim: 'length', digits: 5 },
    { key: 'kitChemMat.at.row.frequency', value: nu, dim: 'frequency', digits: 5 },
    { key: 'kitChemMat.at.row.photonEnergy', value: E, dim: 'photonEnergy', digits: 5 },
    { key: 'kitChemMat.at.row.energyJ', value: E, unit: 'J', digits: 5 },
    { key: 'kitChemMat.at.row.perMole', value: (E * NA) / 1000, unit: 'kJ/mol', digits: 5 },
    { key: 'kitChemMat.at.row.wavenumber', value: 1 / (lambda * 100), unit: 'cm⁻¹', digits: 5 },
    { key: 'kitChemMat.at.row.region', value: '', word: spectrumRegion(lambda) },
  ];
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.at.step.photon', math: `c=\\lambda\\nu,\\quad E=h\\nu=\\frac{hc}{\\lambda}` },
      {
        key: 'kitChemMat.at.step.photonNumbers',
        math:
          `E=\\frac{${latexNumber(H, 9)}\\times${latexNumber(C, 9)}}{${latexNumber(lambda, 5)}` +
          `\\ \\mathrm{m}}=${latexNumber(E, 5)}\\ \\mathrm{J}=${latexNumber(E / E_CHARGE, 5)}` +
          `\\ \\mathrm{eV}`,
      },
    ],
    notes: [{ key: 'kitChemMat.at.note.vacuum' }],
    equation: 'E=h\\nu=\\frac{hc}{\\lambda}',
  };
}

// ---------- Hydrogen-like atom ----------

const SERIES: Record<number, MessageKey> = {
  1: 'kitChemMat.at.series.lyman',
  2: 'kitChemMat.at.series.balmer',
  3: 'kitChemMat.at.series.paschen',
  4: 'kitChemMat.at.series.brackett',
  5: 'kitChemMat.at.series.pfund',
  6: 'kitChemMat.at.series.humphreys',
};

/** The energy of level n of a one-electron atom with charge Z, in joules (negative: bound). */
export const levelEnergy = (Z: number, n: number) => -(R_H * H * C * Z * Z) / (n * n);

/** The vacuum wavelength of the transition between levels n1 < n2 of a one-electron atom with charge Z, meters. */
export const lineWavelength = (Z: number, n1: number, n2: number) =>
  1 / (R_H * Z * Z * (1 / (n1 * n1) - 1 / (n2 * n2)));

export interface HydrogenInput {
  Z: number;
  /** The lower and upper levels (whole numbers). */
  nLow: number;
  nHigh: number;
}

export function hydrogen(input: HydrogenInput): Outcome {
  const { Z, nLow, nHigh } = input;
  if (!Number.isInteger(Z) || Z < 1 || Z > 118) return fail('kitChemMat.at.err.charge');
  if (!Number.isInteger(nLow) || !Number.isInteger(nHigh) || nLow < 1 || nHigh < 1)
    return fail('kitChemMat.at.err.level');
  if (nHigh === nLow) return fail('kitChemMat.at.err.sameLevel');
  const n1 = Math.min(nLow, nHigh);
  const n2 = Math.max(nLow, nHigh);
  const lambda = lineWavelength(Z, n1, n2);
  const dE = (H * C) / lambda;
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.levelLow', value: levelEnergy(Z, n1), dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.levelHigh', value: levelEnergy(Z, n2), dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.photonEnergy', value: dE, dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.wavelength', value: lambda, dim: 'length', digits: 6 },
    { key: 'kitChemMat.at.row.frequency', value: C / lambda, dim: 'frequency', digits: 6 },
    { key: 'kitChemMat.at.row.region', value: '', word: spectrumRegion(lambda) },
    { key: 'kitChemMat.at.row.ionization', value: -levelEnergy(Z, 1), dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.radius', value: (n1 * n1 * 5.29177210544e-11) / Z, dim: 'length', digits: 5 },
  ];
  if (Z === 1 && SERIES[n1]) rows.splice(5, 0, { key: 'kitChemMat.at.row.series', value: '', word: SERIES[n1] });
  // Lines of the series that ends on the lower level, for the table.
  const lines: string[][] = [];
  for (let k = n1 + 1; k <= n1 + 6; k++) {
    const l = lineWavelength(Z, n1, k);
    lines.push([`${k} → ${n1}`, plain(l * 1e9, 6), plain((H * C) / l / E_CHARGE, 5)]);
  }
  return {
    ok: true,
    rows,
    steps: [
      {
        key: 'kitChemMat.at.step.rydberg',
        math:
          `\\frac1\\lambda=R_H Z^2\\left(\\frac1{n_1^2}-\\frac1{n_2^2}\\right)=${latexNumber(R_H, 9)}` +
          `\\times${Z * Z}\\times\\left(\\frac1{${n1 * n1}}-\\frac1{${n2 * n2}}\\right)`,
      },
      { key: 'kitChemMat.at.step.rydbergResult', math: `\\lambda=${latexNumber(lambda * 1e9, 6)}\\ \\mathrm{nm}` },
      { key: 'kitChemMat.at.step.bohr', math: `E_n=-\\frac{hcR_HZ^2}{n^2}` },
    ],
    notes: [
      { key: 'kitChemMat.at.note.emission' },
      { key: 'kitChemMat.at.note.rydberg' },
      { key: 'kitChemMat.at.note.vacuum' },
    ],
    tables: [
      {
        title: 'kitChemMat.at.table.lines',
        header: ['kitChemMat.at.col.transition', 'kitChemMat.at.col.nm', 'kitChemMat.at.col.eV'],
        rows: lines,
      },
    ],
    equation: '\\frac1\\lambda=R_H Z^2\\left(\\frac1{n_1^2}-\\frac1{n_2^2}\\right)',
  };
}

// ---------- Matter waves ----------

export type Particle = 'electron' | 'proton' | 'neutron' | 'alpha' | 'custom';
const MASS: Record<Exclude<Particle, 'custom'>, number> = {
  electron: ME,
  proton: MP,
  neutron: 1.67492750056e-27,
  alpha: 6.6446573357e-27,
};

/** The mass in kilograms, from a particle name and (for a custom one) a mass in grams. */
export function massOf(particle: string, customGrams: number): number {
  return particle === 'custom' ? customGrams / 1000 : MASS[particle as Exclude<Particle, 'custom'>];
}

export interface WaveInput {
  particle: string;
  /** Grams, for the custom particle. */
  customMass: number;
  given: string;
  /** m/s, or joules. */
  speed: number;
  energy: number;
}

export function deBroglie(input: WaveInput): Outcome {
  const m = massOf(input.particle, input.customMass);
  if (!pos(m)) return fail('kitChemMat.at.err.mass');
  let v: number;
  let K: number;
  let p: number;
  const steps: KitStep[] = [];
  if (input.given === 'energy') {
    if (!pos(input.energy)) return fail('kitChemMat.at.err.kinetic');
    K = input.energy;
    // p c = sqrt(K (K + 2 m c^2)), so v = p c^2 / (K + m c^2).
    p = Math.sqrt(2 * m * K * (1 + K / (2 * m * C * C)));
    v = (p * C * C) / (K + m * C * C);
  } else {
    if (!pos(input.speed)) return fail('kitChemMat.at.err.speed');
    if (input.speed >= C) return fail('kitChemMat.at.err.light');
    v = input.speed;
    const beta2 = (v * v) / (C * C);
    const gamma = 1 / Math.sqrt(1 - beta2);
    p = gamma * m * v;
    K = (m * C * C * gamma * gamma * beta2) / (gamma + 1);
  }
  const lambda = H / p;
  // What the nonrelativistic formula gives for the same input: from the energy, p = sqrt(2mK); from the speed, p = mv.
  const lambdaNR = input.given === 'energy' ? H / Math.sqrt(2 * m * K) : H / (m * v);
  steps.push({ key: 'kitChemMat.at.step.debroglie', math: `\\lambda=\\frac{h}{p}=\\frac{h}{mv}` });
  steps.push({
    key: 'kitChemMat.at.step.debroglieNumbers',
    math:
      `\\lambda=\\frac{${latexNumber(H, 9)}}{${latexNumber(m, 6)}\\times${latexNumber(v, 6)}}=` +
      `${latexNumber(lambda, 6)}\\ \\mathrm{m}`,
  });
  const notes: { key: MessageKey }[] = [{ key: 'kitChemMat.at.note.nonrel' }];
  const fast = v > 0.1 * C;
  if (fast) notes.push({ key: 'kitChemMat.at.note.fast' });
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.at.row.lambdaDB', value: lambda, dim: 'length', digits: 6 },
      ...(fast ? [{ key: 'kitChemMat.at.row.lambdaNR' as const, value: lambdaNR, dim: 'length' as const, digits: 6 }] : []),
      { key: 'kitChemMat.at.row.momentum', value: p, unit: 'kg m/s', digits: 5 },
      { key: 'kitChemMat.at.row.speed', value: v, unit: 'm/s', digits: 5 },
      { key: 'kitChemMat.at.row.kinetic', value: K, dim: 'photonEnergy', digits: 5 },
    ],
    steps,
    notes,
    equation: '\\lambda=\\frac{h}{p}',
  };
}

// ---------- Particle in a box ----------

export interface BoxInput {
  particle: string;
  customMass: number;
  /** Meters. */
  L: number;
  n: number;
  /** A second level for the transition, or NaN. */
  m: number;
}

/** E_n = n^2 h^2 / (8 m L^2), joules. */
export const boxEnergy = (mass: number, L: number, n: number) => (n * n * H * H) / (8 * mass * L * L);

export function box(input: BoxInput): Outcome {
  const mass = massOf(input.particle, input.customMass);
  if (!pos(mass)) return fail('kitChemMat.at.err.mass');
  if (!pos(input.L)) return fail('kitChemMat.at.err.length');
  if (!Number.isInteger(input.n) || input.n < 1) return fail('kitChemMat.at.err.quantum');
  const En = boxEnergy(mass, input.L, input.n);
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.boxEnergy', value: En, dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.boxGround', value: boxEnergy(mass, input.L, 1), dim: 'photonEnergy', digits: 6 },
    { key: 'kitChemMat.at.row.boxWavelength', value: (2 * input.L) / input.n, dim: 'length', digits: 5 },
  ];
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.at.step.box',
      math:
        `E_n=\\frac{n^2h^2}{8mL^2}=\\frac{${input.n * input.n}\\times(${latexNumber(H, 9)})^2}{8` +
        `\\times${latexNumber(mass, 6)}\\times(${latexNumber(input.L, 5)})^2}=${latexNumber(En, 6)}` +
        `\\ \\mathrm{J}`,
    },
  ];
  if (!Number.isNaN(input.m)) {
    if (!Number.isInteger(input.m) || input.m < 1) return fail('kitChemMat.at.err.quantum');
    if (input.m === input.n) return fail('kitChemMat.at.err.sameLevel');
    const Em = boxEnergy(mass, input.L, input.m);
    const dE = Math.abs(Em - En);
    const lambda = (H * C) / dE;
    rows.push({ key: 'kitChemMat.at.row.boxGap', value: dE, dim: 'photonEnergy', digits: 6 });
    rows.push({ key: 'kitChemMat.at.row.wavelength', value: lambda, dim: 'length', digits: 6 });
    steps.push({
      key: 'kitChemMat.at.step.boxGap',
      math:
        `\\Delta E=|E_m-E_n|=${latexNumber(dE / E_CHARGE, 6)}\\ \\mathrm{eV},\\quad \\lambda=` +
        `\\frac{hc}{\\Delta E}=${latexNumber(lambda * 1e9, 6)}\\ \\mathrm{nm}`,
    });
  }
  const pts: [number, number][] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    pts.push([x, Math.sin(input.n * Math.PI * x) ** 2]);
  }
  const plot: PlotData = {
    xLabel: 'kitChemMat.at.plot.position',
    yLabel: 'kitChemMat.at.plot.probability',
    series: [{ label: 'kitChemMat.at.plot.density', points: pts }],
    alt: 'kitChemMat.at.plot.boxAlt',
  };
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.at.note.box' }],
    equation: 'E_n=\\frac{n^2h^2}{8mL^2}',
    plot,
  };
}

// ---------- Quantum numbers ----------

const SUBSHELL = ['s', 'p', 'd', 'f', 'g', 'h', 'i'] as const;

export interface QuantumInput {
  n: number;
  /** NaN when not given. */
  l: number;
  ml: number;
  /** +0.5 or -0.5, or NaN. */
  ms: number;
}

export function quantum(input: QuantumInput): Outcome {
  const { n, l, ml, ms } = input;
  if (!Number.isInteger(n) || n < 1 || n > 7) return fail('kitChemMat.at.err.principal');
  const table: string[][] = [];
  for (let k = 0; k < n; k++) {
    const letter = k < SUBSHELL.length ? SUBSHELL[k] : '';
    table.push([`${n}${letter}`, String(k), `${-k} … ${k}`, String(2 * k + 1), String(2 * (2 * k + 1))]);
  }
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.subshells', value: String(n) },
    { key: 'kitChemMat.at.row.orbitals', value: String(n * n) },
    { key: 'kitChemMat.at.row.maxElectrons', value: String(2 * n * n) },
  ];
  const notes: { key: MessageKey }[] = [{ key: 'kitChemMat.at.note.quantum' }];
  if (!Number.isNaN(l)) {
    if (!Number.isInteger(l) || l < 0) return fail('kitChemMat.at.err.azimuthal');
    if (l > n - 1) return fail('kitChemMat.at.err.azimuthalLarge', { n: String(n), max: String(n - 1) });
    rows.push({ key: 'kitChemMat.at.row.subshell', value: `${n}${l < SUBSHELL.length ? SUBSHELL[l] : ''}` });
    if (!Number.isNaN(ml)) {
      if (!Number.isInteger(ml)) return fail('kitChemMat.at.err.magnetic');
      if (Math.abs(ml) > l) return fail('kitChemMat.at.err.magneticLarge', { l: String(l) });
      rows.push({ key: 'kitChemMat.at.row.orbitalOk', value: '', word: 'kitChemMat.at.word.allowed' });
    }
  }
  if (!Number.isNaN(ms)) {
    if (Math.abs(ms) !== 0.5) return fail('kitChemMat.at.err.spin');
    rows.push({
      key: 'kitChemMat.at.row.spin',
      value: '',
      word: ms > 0 ? 'kitChemMat.at.word.up' : 'kitChemMat.at.word.down',
    });
  }
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.at.step.rules', math: `l=0,1,\\dots,n-1;\\quad m_l=-l,\\dots,l;\\quad m_s=\\pm\\tfrac12` },
    ],
    notes,
    tables: [
      {
        title: 'kitChemMat.at.table.subshells',
        header: [
          'kitChemMat.at.col.subshell',
          'kitChemMat.at.col.l',
          'kitChemMat.at.col.ml',
          'kitChemMat.at.col.orbitals',
          'kitChemMat.at.col.electrons',
        ],
        rows: table,
      },
    ],
    equation: 'N_{\\text{electrons}}=2n^2',
  };
}
