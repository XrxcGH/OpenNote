// Diatomic spectra: the rigid rotor with centrifugal distortion, anharmonic vibrational levels with the Morse
// dissociation energy, and rovibrational P and R branches with Boltzmann and nuclear-spin intensities. Spectroscopic
// constants are in cm⁻¹, masses in u, and lengths in m.
import { fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { C } from '../shared/constants';
import { fail, nonNegative, positive } from '../shared/errors';
import { fmt, tex } from '../shared/format';

export type MolKey =
  | 'reducedMass'
  | 'inertia'
  | 'rotB'
  | 'rotLine'
  | 'spacing'
  | 'peakJ'
  | 'rotPlot'
  | 'wavenumberAxis'
  | 'intensityAxis'
  | 'fundamental'
  | 'overtone'
  | 'zeroPoint'
  | 'de'
  | 'd0'
  | 'vMax'
  | 'level'
  | 'bandOrigin'
  | 'branchLine'
  | 'bandGap'
  | 'rovibPlot'
  | 'mono'
  | 'average'
  | 'nominal'
  | 'mPlus1'
  | 'mPlus2'
  | 'dbe'
  | 'nitrogenOdd'
  | 'nitrogenEven'
  | 'peak'
  | 'patternPlot'
  | 'massAxis'
  | 'relativeAxis'
  | 'nmrLine'
  | 'multiplicity'
  | 'nmrPlot'
  | 'hzAxis'
  | 'tree'
  | 'protons'
  | 'mn'
  | 'mw'
  | 'mz'
  | 'dispersity'
  | 'xn'
  | 'rms'
  | 'contour'
  | 'wlc'
  | 'radiusGyration'
  | 'chiC'
  | 'phiC'
  | 'mixing'
  | 'mixPlot'
  | 'phiAxis'
  | 'freeAxis';

/** hc/k in cm·K, for Boltzmann factors of levels in cm⁻¹. */
const C2 = (C.h * C.c * 100) / C.kB;

/** The rigid rotor B = h / (8π² c μ r²) in cm⁻¹, from masses in u and r in m. */
export function rotorB(ma: number, mb: number, r: number): number {
  const mu = ((ma * mb) / (ma + mb)) * C.u;
  return C.h / (8 * Math.PI ** 2 * C.c * 100 * mu * r * r);
}

/** Rotational lines ν = 2B(J+1) − 4D(J+1)³ with Boltzmann intensities (2J+1) e^(−F(J)hc/kT) at T. */
export function rotor(ma: number, mb: number, r: number, d: number, t: number): Calc<MolKey> {
  positive(ma, 'massA');
  positive(mb, 'massB');
  positive(r, 'bondLength');
  nonNegative(d, 'distortion');
  positive(t, 'temperature');
  const mu = (ma * mb) / (ma + mb);
  const inertia = mu * C.u * r * r;
  const b = rotorB(ma, mb, r);
  const f = (j: number) => b * j * (j + 1) - d * j * j * (j + 1) ** 2;
  const lines: [number, number][] = [];
  let top = 0;
  for (let j = 0; j < 200; j += 1) {
    const nu = 2 * b * (j + 1) - 4 * d * (j + 1) ** 3;
    const pop = (2 * j + 1) * Math.exp((-f(j) * C2) / t);
    if (j > 3 && pop < 1e-3 * top) break;
    top = Math.max(top, pop);
    lines.push([nu, pop]);
  }
  const peak = Math.max(0, Math.round(Math.sqrt(t / (2 * b * C2)) - 0.5));
  const items: Item<MolKey>[] = [
    fixed('rotB', b, 'cm⁻¹', 6),
    fixed('reducedMass', mu, 'u', 8),
    fixed('inertia', inertia, 'kg m²', 6),
    fixed('spacing', 2 * b, 'cm⁻¹', 6),
    fixed('peakJ', peak, '', 3),
    ...lines.slice(0, 6).map(([nu], j): Item<MolKey> => ({
      key: 'rotLine',
      value: nu,
      unit: 'cm⁻¹',
      text: `J ${j} → ${j + 1}: ${fmt(nu, 7)} cm⁻¹`,
    })),
  ];
  return {
    items,
    steps: [
      {
        key: 'reducedMass',
        text: `μ = m_A m_B / (m_A + m_B) = ${fmt(ma)} × ${fmt(mb)} / ${fmt(ma + mb)} u = ${fmt(mu, 8)} u`,
        tex: `\\mu = \\frac{m_A m_B}{m_A + m_B} = ${tex(mu, 8)}\\ \\mathrm{u}`,
      },
      {
        key: 'rotB',
        text: `B = h / (8π² c μ r²) = ${fmt(b, 6)} cm⁻¹`,
        tex: `B = \\frac{h}{8\\pi^2 c\\,\\mu r^2} = ${tex(b, 6)}\\ \\mathrm{cm^{-1}}`,
      },
      {
        key: 'rotLine',
        text: `ν(J → J+1) = 2B(J+1) − 4D(J+1)³; the strongest line starts near J = √(kT/2hcB) − ½ = ${peak}`,
        tex: `\\tilde\\nu = 2B(J+1) - 4D(J+1)^3`,
      },
    ],
    plot: {
      title: 'rotPlot',
      xLabel: 'wavenumberAxis',
      yLabel: 'intensityAxis',
      series: [{ points: lines.map(([nu, p]) => [nu, p / top]), kind: 'sticks', tone: 0 }],
      y: [0, 1.1],
    },
  };
}

/** G(v) = ωe(v + ½) − ωe xe (v + ½)², in cm⁻¹. */
export const vibLevel = (we: number, wexe: number, v: number) => we * (v + 0.5) - wexe * (v + 0.5) ** 2;

/** Levels, the fundamental and overtones, and the Morse dissociation energy. */
export function vibration(we: number, wexe: number): Calc<MolKey> {
  positive(we, 'omegaE');
  nonNegative(wexe, 'anharmonicity');
  if (wexe > 0 && wexe >= we / 2) fail('badAnharmonicity');
  const g0 = vibLevel(we, wexe, 0);
  const items: Item<MolKey>[] = [fixed('fundamental', vibLevel(we, wexe, 1) - g0, 'cm⁻¹', 8)];
  for (let v = 2; v <= 3; v += 1)
    items.push({
      key: 'overtone',
      value: vibLevel(we, wexe, v) - g0,
      unit: 'cm⁻¹',
      text: `0 → ${v}: ${fmt(vibLevel(we, wexe, v) - g0, 8)} cm⁻¹`,
    });
  items.push(fixed('zeroPoint', g0, 'cm⁻¹', 8));
  const steps: Step<MolKey>[] = [
    {
      key: 'fundamental',
      text:
        `G(v) = ωe(v + ½) − ωe xe(v + ½)²; G(1) − G(0) = ωe − 2ωe xe = ${fmt(we)} − 2 × ${fmt(wexe)} = ` +
        `${fmt(we - 2 * wexe, 8)} cm⁻¹`,
      tex:
        `G(v) = \\omega_e(v+\\tfrac12) - \\omega_e x_e (v+\\tfrac12)^2,\\quad ` +
        `\\Delta G_{1/2} = ${tex(we - 2 * wexe, 8)}\\ \\mathrm{cm^{-1}}`,
    },
  ];
  if (wexe > 0) {
    const de = (we * we) / (4 * wexe);
    const vmax = Math.floor(we / (2 * wexe) - 0.5);
    items.push(
      fixed('de', de, 'cm⁻¹', 7),
      fixed('d0', de - g0, 'cm⁻¹', 7),
      { key: 'd0', value: ((de - g0) * C.h * C.c * 100) / C.e, unit: 'eV', fixed: true, sig: 6 },
      fixed('vMax', vmax, '', 4),
    );
    steps.push({
      key: 'de',
      text:
        `Morse: De = ωe² / (4ωe xe) = ${fmt(de, 7)} cm⁻¹, D0 = De − G(0) = ${fmt(de - g0, 7)} cm⁻¹; ` +
        `the last bound level is v = ${vmax}`,
      tex: `D_e = \\frac{\\omega_e^2}{4\\omega_e x_e} = ${tex(de, 7)}\\ \\mathrm{cm^{-1}}`,
    });
  }
  return { items, steps };
}

/** The nuclear-spin weight of level J of a homonuclear diatomic with nuclear spin I (doubled), Σg+ ground state. */
export function spinWeight(i2: number, j: number): number {
  const i = i2 / 2;
  const boson = i2 % 2 === 0;
  const even = j % 2 === 0;
  return (2 * i + 1) * (boson === even ? i + 1 : i);
}

/** P and R branches of the 0 → 1 band with B0 and B1 from Be and αe, at temperature T. */
export function rovibration(
  we: number,
  wexe: number,
  be: number,
  alpha: number,
  t: number,
  spin2: number | null,
): Calc<MolKey> {
  positive(be, 'rotB');
  nonNegative(alpha, 'alpha');
  positive(t, 'temperature');
  const origin = vibration(we, wexe).items[0]!.value;
  const b0 = be - alpha / 2;
  const b1 = be - (3 * alpha) / 2;
  if (!(b1 > 0)) fail('badRotation');
  const weight = (j: number) => (spin2 === null ? 1 : spinWeight(spin2, j));
  const pop = (j: number) => weight(j) * (2 * j + 1) * Math.exp((-b0 * j * (j + 1) * C2) / t);
  const lines: { nu: number; p: number; name: string }[] = [];
  for (let j = 0; j < 150; j += 1) {
    const p = pop(j);
    if (j > 3 && p < 1e-3 * Math.max(...lines.map((one) => one.p), 1e-300)) break;
    lines.push({ nu: origin + (b1 + b0) * (j + 1) + (b1 - b0) * (j + 1) ** 2, p, name: `R(${j})` });
    if (j > 0) lines.push({ nu: origin - (b1 + b0) * j + (b1 - b0) * j * j, p, name: `P(${j})` });
  }
  const top = Math.max(...lines.map((one) => one.p));
  const strongest = [...lines]
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .sort((a, b) => a.nu - b.nu);
  return {
    items: [
      fixed('bandOrigin', origin, 'cm⁻¹', 8),
      fixed(
        'bandGap',
        lines.find((one) => one.name === 'R(0)')!.nu - lines.find((one) => one.name === 'P(1)')!.nu,
        'cm⁻¹',
        6,
      ),
      ...strongest.map((one): Item<MolKey> => ({
        key: 'branchLine',
        value: one.nu,
        unit: 'cm⁻¹',
        text: `${one.name}: ${fmt(one.nu, 7)} cm⁻¹ (${fmt(one.p / top, 3)})`,
      })),
    ],
    steps: [
      {
        key: 'branchLine',
        text:
          `B0 = Be − αe/2 = ${fmt(b0, 6)}, B1 = Be − 3αe/2 = ${fmt(b1, 6)} cm⁻¹; ` +
          `R(J) = ν0 + (B1 + B0)(J + 1) + (B1 − B0)(J + 1)², P(J) = ν0 − (B1 + B0)J + (B1 − B0)J²`,
        tex: `R(J) = \\nu_0 + (B_1 + B_0)(J+1) + (B_1 - B_0)(J+1)^2,\\quad P(J) = \\nu_0 - (B_1 + B_0)J + (B_1 - B_0)J^2`,
      },
      {
        key: 'bandGap',
        text:
          spin2 === null
            ? 'Intensities follow (2J + 1) e^(−B0 J(J+1) hc/kT).'
            : `Intensities follow g_I(J)(2J + 1) e^(−B0 J(J+1) hc/kT), with spin weights ${weight(0)} and ${weight(1)} for even and odd J.`,
      },
    ],
    plot: {
      title: 'rovibPlot',
      xLabel: 'wavenumberAxis',
      yLabel: 'intensityAxis',
      series: [{ points: lines.map((one) => [one.nu, one.p / top]), kind: 'sticks', tone: 0 }],
      y: [0, 1.1],
    },
  };
}
