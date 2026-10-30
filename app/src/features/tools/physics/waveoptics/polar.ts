// The wave optics tool's thin film and polarization calculations: thin films, Malus's law, the Fresnel equations,
// and Jones calculus through polarizers and wave plates.
import type { MessageKey } from '../../../../strings/t';
import { deg, fmt, q, qIn, rad } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import { sub } from '../kit/symbols';
import {
  applyJones,
  brewster,
  critical,
  describe,
  filmFlips,
  filmThicknesses,
  filmWavelengths,
  fresnel,
  jonesOf,
  malus,
  polarizer,
  retarder,
} from './engine';
import type { Cx, Jones } from './engine';

const nm = (m: number) => qIn(m, 'length', 'nm');
const angle = (radians: number) => q(deg(radians), '°');

export const filmMode: ModeDef = {
  id: 'film',
  label: 'kitPhysics.waveoptics.modes.film',
  fields: [
    { id: 'nFilm', label: 'kitPhysics.waveoptics.f.nFilm', initial: '1.33' },
    { id: 'nAbove', label: 'kitPhysics.waveoptics.f.nAbove', initial: '1' },
    { id: 'nBelow', label: 'kitPhysics.waveoptics.f.nBelow', initial: '1' },
    {
      id: 'find',
      label: 'kitPhysics.waveoptics.f.find',
      kind: 'choice',
      initial: 'thickness',
      options: [
        { value: 'thickness', label: 'kitPhysics.waveoptics.o.thickness' },
        { value: 'wavelengths', label: 'kitPhysics.waveoptics.o.wavelengths' },
      ],
    },
    {
      id: 'lambda',
      label: 'kitPhysics.waveoptics.f.lambda',
      dim: 'length',
      unit: 'nm',
      usUnit: 'nm',
      initial: '550',
      when: (ch) => ch('find') !== 'wavelengths',
    },
    {
      id: 't',
      label: 'kitPhysics.waveoptics.f.thickness',
      dim: 'length',
      unit: 'nm',
      usUnit: 'nm',
      initial: '500',
      when: (ch) => ch('find') === 'wavelengths',
    },
  ],
  solve(read): Outcome {
    const n = read.num('nFilm', { min: 1, max: 5 });
    const nAbove = read.num('nAbove', { min: 1, max: 5 });
    const nBelow = read.num('nBelow', { min: 1, max: 5 });
    const flips = filmFlips(nAbove, n, nBelow);
    const steps: KitStep[] = [
      { key: 'kitPhysics.waveoptics.s.flips', vars: { flips: String(flips) } },
      flips === 1
        ? { key: 'kitPhysics.waveoptics.s.oneFlip' }
        : { key: 'kitPhysics.waveoptics.s.evenFlips', vars: { flips: String(flips) } },
    ];
    const rows: ResultRow[] = [{ key: 'kitPhysics.waveoptics.r.flips', value: flips }];
    if (read.choice('find') === 'wavelengths') {
      const t = read.num('t', 'positive');
      const list = filmWavelengths(t, n, flips, 380e-9, 750e-9);
      steps.push({ key: 'kitPhysics.waveoptics.s.path', vars: { path: nm(2 * n * t) } });
      rows.push(
        ...list.bright.map((w, i) => ({
          key: 'kitPhysics.waveoptics.r.brightWave' as const,
          symbol: `λ${sub(i + 1)}`,
          value: w,
          dim: 'length' as const,
          unit: 'nm',
          usUnit: 'nm',
          primary: i === 0,
        })),
        ...list.dark.map((w, i) => ({
          key: 'kitPhysics.waveoptics.r.darkWave' as const,
          symbol: `λ${sub(i + 1)}`,
          value: w,
          dim: 'length' as const,
          unit: 'nm',
          usUnit: 'nm',
        })),
      );
    } else {
      const lambda = read.num('lambda', 'positive');
      const list = filmThicknesses(lambda, n, flips, 3);
      const order = flips === 1 ? '½' : '1';
      steps.push({
        key: 'kitPhysics.waveoptics.s.thinnest',
        vars: { t: nm(list.bright[0]), n: fmt(n), order, lambda: nm(lambda) },
      });
      rows.push(
        ...list.bright.map((t, i) => ({
          key: 'kitPhysics.waveoptics.r.bright' as const,
          symbol: `t${sub(i + 1)}`,
          value: t,
          dim: 'length' as const,
          unit: 'nm',
          usUnit: 'nm',
          primary: i === 0,
        })),
        ...list.dark.map((t, i) => ({
          key: 'kitPhysics.waveoptics.r.dark' as const,
          symbol: `t${sub(i + 1)}`,
          value: t,
          dim: 'length' as const,
          unit: 'nm',
          usUnit: 'nm',
        })),
      );
    }
    return {
      ok: true,
      rows,
      latex: '2nt=\\left(m+\\tfrac12\\right)\\lambda\\ \\text{or}\\ 2nt=m\\lambda',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.film' }],
    };
  },
};

export const malusMode: ModeDef = {
  id: 'malus',
  label: 'kitPhysics.waveoptics.modes.malus',
  fields: [
    {
      id: 'light',
      label: 'kitPhysics.waveoptics.f.light',
      kind: 'choice',
      initial: 'unpolarized',
      options: [
        { value: 'unpolarized', label: 'kitPhysics.waveoptics.o.unpolarized' },
        { value: 'polarized', label: 'kitPhysics.waveoptics.o.polarized' },
      ],
    },
    { id: 'I0', label: 'kitPhysics.waveoptics.f.I0', dim: 'intensity', initial: '100' },
    {
      id: 'axis',
      label: 'kitPhysics.waveoptics.f.axis',
      dim: 'angle',
      initial: '0',
      when: (ch) => ch('light') === 'polarized',
    },
    {
      id: 'angles',
      label: 'kitPhysics.waveoptics.f.angles',
      kind: 'rows',
      initial: '0\n45\n90',
      columns: [{ label: 'kitPhysics.waveoptics.f.angle', dim: 'angle' }],
    },
  ],
  solve(read): Outcome {
    const I0 = read.num('I0', 'nonNegative');
    const polarized = read.choice('light') === 'polarized';
    const axis = polarized ? read.num('axis') : null;
    const angles = read.rows('angles').map((row) => row[0]);
    const out = malus(I0, angles, axis);
    const units = read.unit('I0');
    const I = (value: number) => qIn(value, 'intensity', units);
    const steps = out.map((value, k): KitStep =>
      k === 0 && axis === null
        ? { key: 'kitPhysics.waveoptics.s.unpolarized', vars: { I: I(value) } }
        : {
            key: 'kitPhysics.waveoptics.s.malus',
            vars: {
              k: String(k + 1),
              angle: angle(angles[k]),
              diff: angle(angles[k] - (k === 0 ? (axis ?? 0) : angles[k - 1])),
              I: I(value),
            },
          },
    );
    const last = out[out.length - 1];
    return {
      ok: true,
      rows: [
        ...out.map((value, k) => ({
          key: 'kitPhysics.waveoptics.r.after' as const,
          symbol: `I${sub(k + 1)}`,
          value,
          dim: 'intensity' as const,
          unit: units,
          usUnit: units,
          primary: k === out.length - 1,
        })),
        { key: 'kitPhysics.waveoptics.r.fraction', symbol: 'I/I₀', value: I0 > 0 ? last / I0 : 0 },
      ],
      latex: 'I=I_0\\cos^2\\theta',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.ideal' }],
    };
  },
};

export const fresnelMode: ModeDef = {
  id: 'fresnel',
  label: 'kitPhysics.waveoptics.modes.fresnel',
  fields: [
    { id: 'n1', label: 'kitPhysics.waveoptics.f.n1', initial: '1' },
    { id: 'n2', label: 'kitPhysics.waveoptics.f.n2', initial: '1.5' },
    { id: 'theta', label: 'kitPhysics.waveoptics.f.theta', dim: 'angle', initial: '45' },
  ],
  solve(read): Outcome {
    const n1 = read.num('n1', { min: 1, max: 10 });
    const n2 = read.num('n2', { min: 1, max: 10 });
    const theta = read.num('theta', { min: 0, max: Math.PI / 2 });
    const out = fresnel(n1, n2, theta);
    const thB = brewster(n1, n2);
    const thC = critical(n1, n2);
    const s = (n1 / n2) * Math.sin(theta);
    const steps: KitStep[] = out.tir
      ? [{ key: 'kitPhysics.waveoptics.s.tir', vars: { s: fmt(s, 6) } }]
      : [
          { key: 'kitPhysics.waveoptics.s.snell', vars: { s: fmt(s, 6), thetaT: angle(out.thetaT ?? 0) } },
          { key: 'kitPhysics.waveoptics.s.rs', vars: { rs: fmt(out.rs, 6), Rs: fmt(out.Rs, 6) } },
          { key: 'kitPhysics.waveoptics.s.rp', vars: { rp: fmt(out.rp, 6), Rp: fmt(out.Rp, 6) } },
        ];
    steps.push({ key: 'kitPhysics.waveoptics.s.brewster', vars: { theta: angle(thB) } });
    const curve = (pick: 'Rs' | 'Rp') =>
      Array.from({ length: 181 }, (_, i): [number, number] => [i / 2, fresnel(n1, n2, rad(i / 2))[pick]]);
    const rows: ResultRow[] = [
      { key: 'kitPhysics.waveoptics.r.Rs', symbol: 'Rₛ', value: out.Rs, primary: true, digits: 6 },
      { key: 'kitPhysics.waveoptics.r.Rp', symbol: 'Rₚ', value: out.Rp, primary: true, digits: 6 },
      { key: 'kitPhysics.waveoptics.r.Ravg', symbol: 'R', value: (out.Rs + out.Rp) / 2, digits: 6 },
      { key: 'kitPhysics.waveoptics.r.Ts', symbol: 'Tₛ', value: 1 - out.Rs, digits: 6 },
      { key: 'kitPhysics.waveoptics.r.Tp', symbol: 'Tₚ', value: 1 - out.Rp, digits: 6 },
      ...(out.thetaT !== null
        ? [
            {
              key: 'kitPhysics.waveoptics.r.refracted' as const,
              symbol: 'θₜ',
              value: out.thetaT,
              dim: 'angle' as const,
            },
          ]
        : []),
      { key: 'kitPhysics.waveoptics.r.brewster', symbol: 'θ_B', value: thB, dim: 'angle' },
      ...(thC !== null
        ? [{ key: 'kitPhysics.waveoptics.r.critical' as const, symbol: 'θ_c', value: thC, dim: 'angle' as const }]
        : []),
    ];
    return {
      ok: true,
      rows,
      latex:
        'r_s=\\frac{n_1\\cos\\theta_i-n_2\\cos\\theta_t}{n_1\\cos\\theta_i+n_2\\cos\\theta_t},\\quad ' +
        'r_p=\\frac{n_2\\cos\\theta_i-n_1\\cos\\theta_t}{n_2\\cos\\theta_i+n_1\\cos\\theta_t}',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.fresnel' }],
      plot: {
        frame: 'axes',
        alt: { key: 'kitPhysics.waveoptics.plot.fresnel' },
        x: { label: 'θᵢ (°)', min: 0, max: 90 },
        y: { label: 'R', min: 0, max: 1 },
        series: [
          { points: curve('Rs'), tone: 'accent', width: 1.5 },
          { points: curve('Rp'), tone: 'second', width: 1.5, dash: true },
          {
            points: [
              [deg(theta), 0],
              [deg(theta), 1],
            ],
            tone: 'muted',
            width: 1,
          },
        ],
        legend: [
          { tone: 'accent', key: 'kitPhysics.waveoptics.legend.s' },
          { tone: 'second', key: 'kitPhysics.waveoptics.legend.p', dash: true },
        ],
      },
    };
  },
};

const S2 = Math.SQRT1_2;
const INPUTS: Record<string, Jones> = {
  horizontal: [
    [1, 0],
    [0, 0],
  ],
  vertical: [
    [0, 0],
    [1, 0],
  ],
  diagonal: [
    [S2, 0],
    [S2, 0],
  ],
  antidiagonal: [
    [S2, 0],
    [-S2, 0],
  ],
  right: [
    [S2, 0],
    [0, -S2],
  ],
  left: [
    [S2, 0],
    [0, S2],
  ],
};

const ELEMENTS: Record<string, { key: MessageKey; gamma: number | null }> = {
  polarizer: { key: 'kitPhysics.waveoptics.elements.polarizer', gamma: null },
  quarter: { key: 'kitPhysics.waveoptics.elements.quarter', gamma: Math.PI / 2 },
  half: { key: 'kitPhysics.waveoptics.elements.half', gamma: Math.PI },
  retarder: { key: 'kitPhysics.waveoptics.elements.retarder', gamma: Number.NaN },
};

const cx = (z: Cx) => {
  const [re, im] = z.map((part) => (Math.abs(part) < 1e-12 ? 0 : part));
  if (im === 0) return fmt(re, 4);
  if (re === 0) return `${fmt(im, 4)}i`;
  return `${fmt(re, 4)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im), 4)}i`;
};

const stateKey = (kind: string, turn: string | null): MessageKey => {
  if (kind === 'none' || kind === 'linear') return `kitPhysics.waveoptics.state.${kind}`;
  const handed = turn === 'cw' ? 'Cw' : 'Ccw';
  return kind === 'circular'
    ? `kitPhysics.waveoptics.state.circular${handed}`
    : `kitPhysics.waveoptics.state.elliptical${handed}`;
};

export const jonesMode: ModeDef = {
  id: 'jones',
  label: 'kitPhysics.waveoptics.modes.jones',
  fields: [
    {
      id: 'input',
      label: 'kitPhysics.waveoptics.f.input',
      kind: 'choice',
      initial: 'diagonal',
      options: [
        { value: 'horizontal', label: 'kitPhysics.waveoptics.o.horizontal' },
        { value: 'vertical', label: 'kitPhysics.waveoptics.o.vertical' },
        { value: 'diagonal', label: 'kitPhysics.waveoptics.o.diagonal' },
        { value: 'antidiagonal', label: 'kitPhysics.waveoptics.o.antidiagonal' },
        { value: 'right', label: 'kitPhysics.waveoptics.o.right' },
        { value: 'left', label: 'kitPhysics.waveoptics.o.left' },
        { value: 'custom', label: 'kitPhysics.waveoptics.o.custom' },
      ],
    },
    { id: 'ex', label: 'kitPhysics.waveoptics.f.ex', initial: '1', when: (ch) => ch('input') === 'custom' },
    { id: 'ey', label: 'kitPhysics.waveoptics.f.ey', initial: '1', when: (ch) => ch('input') === 'custom' },
    {
      id: 'phase',
      label: 'kitPhysics.waveoptics.f.phase',
      dim: 'angle',
      initial: '90',
      when: (ch) => ch('input') === 'custom',
    },
    {
      id: 'elements',
      label: 'kitPhysics.waveoptics.f.elements',
      kind: 'rows',
      initial: 'quarter 0',
      help: 'kitPhysics.waveoptics.help.elements',
      columns: [
        { label: 'kitPhysics.waveoptics.f.element' },
        { label: 'kitPhysics.waveoptics.f.fast' },
        { label: 'kitPhysics.waveoptics.f.retardance' },
      ],
    },
  ],
  solve(read): Outcome {
    const choice = read.choice('input');
    let v: Jones;
    if (choice === 'custom') {
      const ax = read.num('ex', 'nonNegative');
      const ay = read.num('ey', 'nonNegative');
      if (ax === 0 && ay === 0) fail('kitPhysics.waveoptics.errors.zeroLight');
      const norm = Math.hypot(ax, ay);
      v = jonesOf(ax / norm, ay / norm, read.num('phase'));
    } else v = INPUTS[choice] ?? INPUTS.horizontal;
    const steps: KitStep[] = [{ key: 'kitPhysics.waveoptics.s.jonesIn', vars: { x: cx(v[0]), y: cx(v[1]) } }];
    read.words('elements').forEach((words, i) => {
      const line = String(i + 1);
      const element = ELEMENTS[words[0]?.toLowerCase() ?? ''];
      const theta = Number(words[1]);
      if (!element || words.length < 2 || !Number.isFinite(theta))
        fail('kitPhysics.waveoptics.errors.element', { line });
      let gamma = element.gamma;
      if (gamma !== null && Number.isNaN(gamma)) {
        gamma = rad(Number(words[2]));
        if (!Number.isFinite(gamma)) fail('kitPhysics.waveoptics.errors.retardance', { line });
      }
      v = applyJones(gamma === null ? polarizer(rad(theta)) : retarder(rad(theta), gamma), v);
      steps.push({
        key: 'kitPhysics.waveoptics.s.jonesStep',
        vars: { angle: q(theta, '°'), x: cx(v[0]), y: cx(v[1]) },
        labels: { element: element.key },
      });
    });
    const state = describe(v);
    const key = stateKey(state.kind, state.turn);
    steps.push({
      key: 'kitPhysics.waveoptics.s.jonesState',
      vars: { azimuth: angle(state.azimuth), chi: angle(state.ellipticity) },
      labels: { state: key },
    });
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.waveoptics.r.state', value: '', word: key, primary: true },
        { key: 'kitPhysics.waveoptics.r.intensity', symbol: 'I/I₀', value: state.intensity, primary: true, digits: 6 },
        { key: 'kitPhysics.waveoptics.r.azimuth', symbol: 'ψ', value: state.azimuth, dim: 'angle' },
        { key: 'kitPhysics.waveoptics.r.ellipticity', symbol: 'χ', value: state.ellipticity, dim: 'angle' },
        { key: 'kitPhysics.waveoptics.r.jx', symbol: 'Eₓ', value: cx(v[0]) },
        { key: 'kitPhysics.waveoptics.r.jy', symbol: 'E_y', value: cx(v[1]) },
      ],
      latex: '\\mathbf{E}_{out}=M_n\\cdots M_2M_1\\,\\mathbf{E}_{in}',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.jones' }],
    };
  },
};
