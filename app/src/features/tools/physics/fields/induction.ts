// The fields tool's induction calculations: Faraday's law for a changing flux, motional emf, a rotating coil, and a
// solenoid's inductance with its stored energy and time constant.
import type { MessageKey } from '../../../../strings/t';
import { fmt, q, qIn } from '../kit/format';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import { solenoidInductance } from './engine';

const K = 'kitPhysics.fields';

const INDUCTION = ['flux', 'motional', 'generator', 'inductor'] as const;
const is =
  (...kinds: string[]) =>
  (ch: (id: string) => string) =>
    kinds.includes(ch('kind'));

export const inductionMode: ModeDef = {
  id: 'induction',
  label: `${K}.modes.induction`,
  fields: [
    {
      id: 'kind',
      label: `${K}.f.induction`,
      kind: 'choice',
      initial: 'flux',
      options: INDUCTION.map((one) => ({ value: one, label: `${K}.o.${one}` as MessageKey })),
    },
    { id: 'N', label: `${K}.f.turns`, initial: '100', when: is('flux', 'generator', 'inductor') },
    { id: 'B1', label: `${K}.f.B1`, dim: 'bfield', unit: 'T', initial: '0', when: is('flux') },
    { id: 'B2', label: `${K}.f.B2`, dim: 'bfield', unit: 'T', initial: '0.5', when: is('flux') },
    {
      id: 'B',
      label: `${K}.f.bMagnitude`,
      dim: 'bfield',
      unit: 'T',
      initial: '0.5',
      when: is('motional', 'generator'),
    },
    {
      id: 'A',
      label: `${K}.f.coilArea`,
      dim: 'area',
      unit: 'cm²',
      usUnit: 'in²',
      initial: '20',
      when: is('flux', 'generator', 'inductor'),
    },
    { id: 'tilt', label: `${K}.f.tilt`, dim: 'angle', initial: '0', when: is('flux') },
    { id: 'dt', label: `${K}.f.dt`, dim: 'time', unit: 'ms', initial: '50', when: is('flux') },
    { id: 'rod', label: `${K}.f.rod`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '20', when: is('motional') },
    { id: 'speed', label: `${K}.f.speed`, dim: 'speed', unit: 'm/s', initial: '2', when: is('motional') },
    { id: 'f', label: `${K}.f.turnRate`, dim: 'frequency', unit: 'Hz', initial: '60', when: is('generator') },
    {
      id: 'length',
      label: `${K}.f.solenoidLength`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '10',
      when: is('inductor'),
    },
    { id: 'mu', label: `${K}.f.mu`, initial: '1', when: is('inductor') },
    { id: 'I', label: `${K}.f.current`, dim: 'current', unit: 'A', initial: '', optional: true, when: is('inductor') },
    {
      id: 'R',
      label: `${K}.f.resistance`,
      dim: 'resistance',
      unit: 'Ω',
      initial: '',
      optional: true,
      when: is('motional', 'inductor'),
    },
  ],
  solve(read): Outcome {
    const kind = INDUCTION.find((one) => one === read.choice('kind')) ?? 'flux';
    return INDUCTION_SOLVERS[kind](read);
  },
};

const V = (v: number) => q(v, 'V');

const INDUCTION_SOLVERS: Record<(typeof INDUCTION)[number], (read: Reader) => Outcome> = {
  flux(read): Outcome {
    const N = read.num('N', 'positive');
    const A = read.num('A', 'positive');
    const tilt = read.num('tilt', { min: 0, max: Math.PI / 2 });
    const dt = read.num('dt', 'positive');
    const phi1 = read.num('B1') * A * Math.cos(tilt);
    const phi2 = read.num('B2') * A * Math.cos(tilt);
    const emf = (-N * (phi2 - phi1)) / dt;
    const Wb = (phi: number) => qIn(phi, 'flux', 'mWb');
    return {
      ok: true,
      rows: [
        { key: `${K}.r.emf`, symbol: 'ℰ', value: emf, dim: 'voltage', unit: 'V', primary: true },
        { key: `${K}.r.flux1`, symbol: 'Φ₁', value: phi1, dim: 'flux', unit: 'mWb' },
        { key: `${K}.r.flux2`, symbol: 'Φ₂', value: phi2, dim: 'flux', unit: 'mWb' },
      ],
      latex: '\\mathcal E=-N\\frac{\\Delta\\Phi}{\\Delta t},\\qquad \\Phi=BA\\cos\\theta',
      steps: [
        { key: `${K}.s.flux`, vars: { phi1: Wb(phi1), phi2: Wb(phi2) } },
        { key: `${K}.s.faraday`, vars: { N: fmt(N), dphi: Wb(phi2 - phi1), dt: qIn(dt, 'time', 'ms'), emf: V(emf) } },
      ],
      notes: [{ key: `${K}.notes.faraday` }],
    };
  },
  motional(read): Outcome {
    const B = read.num('B');
    const L = read.num('rod', 'positive');
    const v = read.num('speed');
    const R = read.opt('R', 'positive');
    const emf = B * L * v;
    const rows: ResultRow[] = [
      { key: `${K}.r.emf`, symbol: 'ℰ', value: emf, dim: 'voltage', unit: 'V', primary: true },
    ];
    const steps: KitStep[] = [
      { key: `${K}.s.motional`, vars: { B: q(B, 'T'), L: qIn(L, 'length', 'cm'), v: q(v, 'm/s'), emf: V(emf) } },
    ];
    if (R !== null) {
      const I = emf / R;
      rows.push(
        { key: `${K}.r.current`, symbol: 'I', value: I, dim: 'current', unit: 'A' },
        { key: `${K}.r.drag`, symbol: 'F', value: Math.abs(I * L * B), dim: 'force', unit: 'N', usUnit: 'lbf' },
        { key: `${K}.r.power`, symbol: 'P', value: (emf * emf) / R, dim: 'power', unit: 'W' },
      );
      steps.push({
        key: `${K}.s.motionalCurrent`,
        vars: { R: q(R, 'Ω'), I: q(I, 'A'), F: q(Math.abs(I * L * B), 'N'), P: q((emf * emf) / R, 'W') },
      });
    }
    return { ok: true, rows, latex: '\\mathcal E=BLv', steps, notes: [{ key: `${K}.notes.motional` }] };
  },
  generator(read): Outcome {
    const N = read.num('N', 'positive');
    const B = read.num('B', 'nonNegative');
    const A = read.num('A', 'positive');
    const omega = 2 * Math.PI * read.num('f', 'positive');
    const peak = N * B * A * omega;
    return {
      ok: true,
      rows: [
        { key: `${K}.r.peak`, symbol: 'ℰ₀', value: peak, dim: 'voltage', unit: 'V', primary: true },
        { key: `${K}.r.rms`, symbol: 'ℰ_rms', value: peak / Math.SQRT2, dim: 'voltage', unit: 'V' },
        { key: `${K}.r.omega`, symbol: 'ω', value: omega, dim: 'angularRate', unit: 'rad/s' },
      ],
      latex: '\\mathcal E(t)=NBA\\omega\\sin\\omega t',
      steps: [
        {
          key: `${K}.s.generator`,
          vars: {
            N: fmt(N),
            B: q(B, 'T'),
            A: qIn(A, 'area', 'cm²'),
            omega: q(omega, 'rad/s'),
            peak: V(peak),
            rms: V(peak / Math.SQRT2),
          },
        },
      ],
      notes: [{ key: `${K}.notes.generator` }],
    };
  },
  inductor(read): Outcome {
    const N = read.num('N', 'positive');
    const A = read.num('A', 'positive');
    const length = read.num('length', 'positive');
    const mu = read.num('mu', { min: 1 });
    const I = read.opt('I');
    const R = read.opt('R', 'positive');
    const L = solenoidInductance(N, A, length, mu);
    const mH = (l: number) => qIn(l, 'inductance', 'mH');
    const rows: ResultRow[] = [
      { key: `${K}.r.L`, symbol: 'L', value: L, dim: 'inductance', unit: 'mH', primary: true },
    ];
    const steps: KitStep[] = [
      {
        key: `${K}.s.inductance`,
        vars: { mu: fmt(mu), N: fmt(N), A: qIn(A, 'area', 'cm²'), l: qIn(length, 'length', 'cm'), L: mH(L) },
      },
    ];
    if (I !== null) {
      rows.push({ key: `${K}.r.stored`, symbol: 'U', value: 0.5 * L * I * I, dim: 'energy', unit: 'J', usUnit: 'J' });
      steps.push({ key: `${K}.s.inductorEnergy`, vars: { L: mH(L), I: q(I, 'A'), U: q(0.5 * L * I * I, 'J') } });
    }
    if (R !== null) {
      rows.push({ key: `${K}.r.tau`, symbol: 'τ', value: L / R, dim: 'time', unit: 'ms' });
      steps.push({ key: `${K}.s.tau`, vars: { L: mH(L), R: q(R, 'Ω'), tau: qIn(L / R, 'time', 'ms') } });
    }
    return {
      ok: true,
      rows,
      latex: 'L=\\frac{\\mu_r\\mu_0N^2A}{\\ell},\\qquad U=\\tfrac12LI^2,\\qquad \\tau=\\frac{L}{R}',
      steps,
      notes: [{ key: `${K}.notes.inductor` }],
    };
  },
};
