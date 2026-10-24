// The special relativity tool's calculations: the Lorentz factor, an event in another frame, velocity addition, a
// particle's energy and momentum, mass and energy, and the relativistic Doppler effect.
import { C, M_E, M_N, M_P, MEV } from '../kit/constants';
import { fmt, q, qIn } from '../kit/format';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, ToolSpec } from '../kit/types';
import { addVelocities, dopplerFactor, interval, lorentzBoost, lorentzFactor, particle, rapidity } from './engine';
import type { ParticleGiven } from './engine';

/** The muon's rest energy, CODATA 2022, in joules. */
const MUON = 105.6583755 * MEV;

const betaCheck = { min: -1, max: 1 } as const;
const c = q(C, 'm/s');

/** beta from a fraction typed or a speed typed. */
function readBeta(read: Reader): { beta: number; steps: KitStep[] } {
  if (read.choice('given') === 'speed') {
    const v = read.num('v');
    const beta = v / C;
    return { beta, steps: [{ key: 'kitPhysics.relativity.s.beta', vars: { v: q(v, 'm/s'), c, beta: fmt(beta, 8) } }] };
  }
  return { beta: read.num('beta', betaCheck), steps: [] };
}

const factorMode: ModeDef = {
  id: 'factor',
  label: 'kitPhysics.relativity.modes.factor',
  fields: [
    {
      id: 'given',
      label: 'kitPhysics.relativity.f.given',
      kind: 'choice',
      initial: 'beta',
      options: [
        { value: 'beta', label: 'kitPhysics.relativity.o.beta' },
        { value: 'speed', label: 'kitPhysics.relativity.o.speed' },
      ],
    },
    { id: 'beta', label: 'kitPhysics.relativity.f.beta', initial: '0.6', when: (ch) => ch('given') === 'beta' },
    {
      id: 'v',
      label: 'kitPhysics.relativity.f.speed',
      dim: 'speed',
      initial: '1.8e8',
      when: (ch) => ch('given') === 'speed',
    },
    { id: 'tau', label: 'kitPhysics.relativity.f.tau', dim: 'time', initial: '1', optional: true },
    { id: 'L0', label: 'kitPhysics.relativity.f.length', dim: 'length', initial: '1', optional: true },
  ],
  solve(read): Outcome {
    const { beta, steps } = readBeta(read);
    const gamma = lorentzFactor(beta);
    const tau = read.opt('tau', 'nonNegative');
    const L0 = read.opt('L0', 'nonNegative');
    const g = fmt(gamma, 8);
    steps.push({ key: 'kitPhysics.relativity.s.gamma', vars: { beta: fmt(beta, 8), gamma: g } });
    if (tau !== null)
      steps.push({
        key: 'kitPhysics.relativity.s.dilated',
        vars: { gamma: g, tau: q(tau, 's'), t: q(gamma * tau, 's') },
      });
    if (L0 !== null)
      steps.push({
        key: 'kitPhysics.relativity.s.contracted',
        vars: { L0: q(L0, 'm'), gamma: g, L: q(L0 / gamma, 'm') },
      });
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.gamma', symbol: 'γ', value: gamma, primary: true, digits: 8 },
        { key: 'kitPhysics.relativity.r.beta', symbol: 'β', value: beta, digits: 8 },
        { key: 'kitPhysics.relativity.r.speed', symbol: 'v', value: beta * C, dim: 'speed' },
        { key: 'kitPhysics.relativity.r.rapidity', symbol: 'φ', value: rapidity(beta) },
        ...(tau !== null
          ? [
              {
                key: 'kitPhysics.relativity.r.dilated' as const,
                symbol: 'Δt',
                value: gamma * tau,
                dim: 'time' as const,
              },
            ]
          : []),
        ...(L0 !== null
          ? [
              {
                key: 'kitPhysics.relativity.r.contracted' as const,
                symbol: 'L',
                value: L0 / gamma,
                dim: 'length' as const,
              },
            ]
          : []),
      ],
      latex:
        '\\gamma=\\frac{1}{\\sqrt{1-\\beta^2}},\\qquad \\Delta t=\\gamma\\,\\Delta\\tau,\\qquad L=\\frac{L_0}{\\gamma}',
      steps,
      notes: [{ key: 'kitPhysics.relativity.notes.inertial' }, { key: 'kitPhysics.relativity.notes.nearLight' }],
    };
  },
};

function spacetimePlot(X: number, T: number, Xp: number, Tp: number, beta: number): Plot {
  const R = 1.25 * Math.max(Math.abs(X), Math.abs(T), Math.abs(Xp), Math.abs(Tp), 1e-300) || 1;
  const line = (f: (s: number) => [number, number]) => [f(-R), f(R)];
  return {
    frame: 'equal',
    alt: { key: 'kitPhysics.relativity.plot.events' },
    x: { label: 'x', min: -R, max: R },
    y: { label: 'ct', min: -R, max: R },
    series: [
      { points: line((s) => [s, 0]), tone: 'ink', width: 1.5 },
      { points: line((s) => [0, s]), tone: 'ink', width: 1.5 },
      { points: line((s) => [s, s]), tone: 'third', dash: true, width: 1 },
      { points: line((s) => [s, -s]), tone: 'third', dash: true, width: 1 },
      { points: line((s) => [beta * s, s]), tone: 'second', width: 1.5 },
      { points: line((s) => [s, beta * s]), tone: 'second', width: 1.5 },
      {
        points: [
          [X, 0],
          [X, T],
          [0, T],
        ],
        tone: 'muted',
        dash: true,
        width: 1,
      },
    ],
    circles: [{ x: X, y: T, r: 4, px: true, fill: true, tone: 'accent' }],
    labels: [
      { x: R * 0.96, y: -R * 0.06, text: 'x', anchor: 'end' },
      { x: R * 0.04, y: R * 0.94, text: 'ct', anchor: 'start' },
      { x: R * 0.96, y: beta * R * 0.96 + R * 0.05, text: 'x′', anchor: 'end', tone: 'second' },
      { x: beta * R * 0.94 + R * 0.04, y: R * 0.94, text: 'ct′', anchor: 'start', tone: 'second' },
      { x: X + R * 0.04, y: T + R * 0.04, text: 'E', anchor: 'start', tone: 'accent' },
    ],
    legend: [
      { tone: 'ink', key: 'kitPhysics.relativity.legend.rest' },
      { tone: 'second', key: 'kitPhysics.relativity.legend.moving' },
      { tone: 'third', key: 'kitPhysics.relativity.legend.light', dash: true },
    ],
  };
}

const eventsMode: ModeDef = {
  id: 'events',
  label: 'kitPhysics.relativity.modes.events',
  intro: 'kitPhysics.relativity.intro.events',
  fields: [
    { id: 't', label: 'kitPhysics.relativity.f.t', dim: 'time', initial: '2' },
    { id: 'x', label: 'kitPhysics.relativity.f.x', dim: 'length', unit: 'light-s', usUnit: 'light-s', initial: '1' },
    { id: 'beta', label: 'kitPhysics.relativity.f.frame', initial: '0.6' },
  ],
  solve(read): Outcome {
    const t = read.num('t');
    const x = read.num('x');
    const beta = read.num('beta', betaCheck);
    const out = lorentzBoost(t, x, beta, C);
    const span = interval(t, x, C);
    const [tu, xu] = [read.unit('t'), read.unit('x')];
    const T = (s: number) => qIn(s, 'time', tu, 6);
    const L = (m: number) => qIn(m, 'length', xu, 6);
    const g = fmt(out.gamma, 8);
    const properTime = span.kind === 'timelike' ? Math.sqrt(span.s2) / C : null;
    const properLength = span.kind === 'spacelike' ? Math.sqrt(-span.s2) : null;
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.tPrime', symbol: 't′', value: out.t, dim: 'time', unit: tu, primary: true },
        {
          key: 'kitPhysics.relativity.r.xPrime',
          symbol: 'x′',
          value: out.x,
          dim: 'length',
          unit: xu,
          usUnit: xu,
          primary: true,
        },
        { key: 'kitPhysics.relativity.r.gamma', symbol: 'γ', value: out.gamma, digits: 8 },
        { key: 'kitPhysics.relativity.r.interval', value: '', word: `kitPhysics.relativity.kind.${span.kind}` },
        ...(properTime !== null
          ? [
              {
                key: 'kitPhysics.relativity.r.properTime' as const,
                symbol: 'τ',
                value: properTime,
                dim: 'time' as const,
              },
            ]
          : []),
        ...(properLength !== null
          ? [
              {
                key: 'kitPhysics.relativity.r.properLength' as const,
                symbol: 'σ',
                value: properLength,
                dim: 'length' as const,
                unit: xu,
                usUnit: xu,
              },
            ]
          : []),
      ],
      latex: "t'=\\gamma\\left(t-\\frac{\\beta x}{c}\\right),\\qquad x'=\\gamma\\left(x-\\beta c t\\right)",
      steps: [
        { key: 'kitPhysics.relativity.s.gamma', vars: { beta: fmt(beta, 8), gamma: g } },
        { key: 'kitPhysics.relativity.s.tPrime', vars: { gamma: g, t: T(t), beta: fmt(beta), x: L(x), tp: T(out.t) } },
        { key: 'kitPhysics.relativity.s.xPrime', vars: { gamma: g, x: L(x), beta: fmt(beta), t: T(t), xp: L(out.x) } },
        {
          key: 'kitPhysics.relativity.s.interval',
          vars: { s2: q(span.s2, 'm²') },
          labels: { kind: `kitPhysics.relativity.kind.${span.kind}` },
        },
        { key: 'kitPhysics.relativity.s.simultaneity', vars: { shift: T((-out.gamma * beta * x) / C) } },
      ],
      notes: [{ key: 'kitPhysics.relativity.notes.events' }, { key: 'kitPhysics.relativity.notes.signs' }],
      plot: spacetimePlot(x / C, t, out.x / C, out.t, beta),
    };
  },
};

const velocityMode: ModeDef = {
  id: 'velocity',
  label: 'kitPhysics.relativity.modes.velocity',
  intro: 'kitPhysics.relativity.intro.velocity',
  fields: [
    { id: 'u', label: 'kitPhysics.relativity.f.u', initial: '0.6' },
    { id: 'v', label: 'kitPhysics.relativity.f.v', initial: '0.6' },
  ],
  solve(read): Outcome {
    const u = read.num('u', betaCheck);
    const v = read.num('v', betaCheck);
    const w = addVelocities(u, v);
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.combined', symbol: 'w/c', value: w, primary: true, digits: 8 },
        { key: 'kitPhysics.relativity.r.combinedSpeed', symbol: 'w', value: w * C, dim: 'speed' },
        { key: 'kitPhysics.relativity.r.galilean', symbol: '(u′ + v)/c', value: u + v },
      ],
      latex: "w=\\frac{u'+v}{1+u'v/c^2}",
      steps: [{ key: 'kitPhysics.relativity.s.velocity', vars: { u: fmt(u), v: fmt(v), w: fmt(w, 8) } }],
      notes: [{ key: 'kitPhysics.relativity.notes.signs' }],
    };
  },
};

const REST: Record<string, number> = {
  electron: M_E * C * C,
  proton: M_P * C * C,
  neutron: M_N * C * C,
  muon: MUON,
};

const energyMode: ModeDef = {
  id: 'energy',
  label: 'kitPhysics.relativity.modes.energy',
  fields: [
    {
      id: 'particle',
      label: 'kitPhysics.relativity.f.particle',
      kind: 'choice',
      initial: 'electron',
      options: [
        { value: 'electron', label: 'kitPhysics.relativity.o.electron' },
        { value: 'proton', label: 'kitPhysics.relativity.o.proton' },
        { value: 'neutron', label: 'kitPhysics.relativity.o.neutron' },
        { value: 'muon', label: 'kitPhysics.relativity.o.muon' },
        { value: 'custom', label: 'kitPhysics.relativity.o.custom' },
      ],
    },
    {
      id: 'm',
      label: 'kitPhysics.relativity.f.mass',
      dim: 'mass',
      unit: 'MeV/c²',
      usUnit: 'MeV/c²',
      initial: '938.272',
      when: (ch) => ch('particle') === 'custom',
    },
    {
      id: 'given',
      label: 'kitPhysics.relativity.f.given',
      kind: 'choice',
      initial: 'ke',
      options: [
        { value: 'ke', label: 'kitPhysics.relativity.o.ke' },
        { value: 'beta', label: 'kitPhysics.relativity.o.beta' },
        { value: 'momentum', label: 'kitPhysics.relativity.o.momentum' },
      ],
    },
    {
      id: 'K',
      label: 'kitPhysics.relativity.f.ke',
      dim: 'energy',
      unit: 'MeV',
      usUnit: 'MeV',
      initial: '1',
      when: (ch) => ch('given') === 'ke',
    },
    { id: 'beta', label: 'kitPhysics.relativity.f.beta', initial: '0.9', when: (ch) => ch('given') === 'beta' },
    {
      id: 'p',
      label: 'kitPhysics.relativity.f.momentum',
      dim: 'momentum',
      unit: 'MeV/c',
      usUnit: 'MeV/c',
      initial: '1',
      when: (ch) => ch('given') === 'momentum',
    },
  ],
  solve(read): Outcome {
    const which = read.choice('particle');
    const rest = which === 'custom' ? read.num('m', 'positive') * C * C : (REST[which] ?? REST.electron);
    const given = read.choice('given');
    const input: ParticleGiven =
      given === 'beta'
        ? { beta: read.num('beta', { min: 0, max: 1 }) }
        : given === 'momentum'
          ? { pc: read.num('p', 'nonNegative') * C }
          : { ke: read.num('K', 'nonNegative') };
    const p = particle(rest, input);
    const MeV = (joules: number) => q(joules / MEV, 'MeV', 7);
    const first: KitStep =
      given === 'beta'
        ? { key: 'kitPhysics.relativity.s.fromBeta', vars: { gamma: fmt(p.gamma, 8) } }
        : given === 'momentum'
          ? { key: 'kitPhysics.relativity.s.fromMomentum', vars: { gamma: fmt(p.gamma, 8) } }
          : {
              key: 'kitPhysics.relativity.s.fromKe',
              vars: { K: MeV(p.kinetic), E0: MeV(rest), gamma: fmt(p.gamma, 8) },
            };
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.gamma', symbol: 'γ', value: p.gamma, primary: true, digits: 6 },
        { key: 'kitPhysics.relativity.r.beta', symbol: 'β', value: p.beta, primary: true, digits: 6 },
        { key: 'kitPhysics.relativity.r.speed', symbol: 'v', value: p.beta * C, dim: 'speed' },
        {
          key: 'kitPhysics.relativity.r.restEnergy',
          symbol: 'E₀',
          value: p.rest,
          dim: 'energy',
          unit: 'MeV',
          usUnit: 'MeV',
          digits: 7,
        },
        {
          key: 'kitPhysics.relativity.r.total',
          symbol: 'E',
          value: p.total,
          dim: 'energy',
          unit: 'MeV',
          usUnit: 'MeV',
          digits: 7,
        },
        {
          key: 'kitPhysics.relativity.r.ke',
          symbol: 'K',
          value: p.kinetic,
          dim: 'energy',
          unit: 'MeV',
          usUnit: 'MeV',
          digits: 7,
        },
        {
          key: 'kitPhysics.relativity.r.momentum',
          symbol: 'p',
          value: p.pc / C,
          dim: 'momentum',
          unit: 'MeV/c',
          usUnit: 'MeV/c',
          digits: 7,
        },
      ],
      latex: 'E=\\gamma mc^2,\\qquad K=(\\gamma-1)mc^2,\\qquad E^2=(pc)^2+(mc^2)^2',
      steps: [
        { key: 'kitPhysics.relativity.s.restEnergy', vars: { E0: MeV(rest) } },
        first,
        { key: 'kitPhysics.relativity.s.betaOf', vars: { beta: fmt(p.beta, 8) } },
        { key: 'kitPhysics.relativity.s.total', vars: { E: MeV(p.total), K: MeV(p.kinetic) } },
        { key: 'kitPhysics.relativity.s.momentum', vars: { pc: MeV(p.pc), p: q(p.pc / MEV, 'MeV/c', 7) } },
      ],
      notes: which === 'muon' ? [{ key: 'kitPhysics.relativity.notes.muon' }] : [],
    };
  },
};

const restMode: ModeDef = {
  id: 'rest',
  label: 'kitPhysics.relativity.modes.rest',
  fields: [{ id: 'm', label: 'kitPhysics.relativity.f.restMass', dim: 'mass', unit: 'g', initial: '1' }],
  solve(read): Outcome {
    const m = read.num('m', 'nonNegative');
    const E = m * C * C;
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.restEnergy', symbol: 'E', value: E, dim: 'energy', primary: true },
        { key: 'kitPhysics.relativity.r.restEnergy', symbol: 'E', value: E, dim: 'energy', unit: 'kWh', usUnit: 'kWh' },
        { key: 'kitPhysics.relativity.r.restEnergy', symbol: 'E', value: E, dim: 'energy', unit: 'MeV', usUnit: 'MeV' },
      ],
      latex: 'E=mc^2',
      steps: [{ key: 'kitPhysics.relativity.s.mass', vars: { m: q(m, 'kg'), c, E: q(E, 'J') } }],
    };
  },
};

const dopplerMode: ModeDef = {
  id: 'doppler',
  label: 'kitPhysics.relativity.modes.doppler',
  fields: [
    { id: 'beta', label: 'kitPhysics.relativity.f.beta', initial: '0.6' },
    {
      id: 'direction',
      label: 'kitPhysics.relativity.f.direction',
      kind: 'choice',
      initial: 'receding',
      options: [
        { value: 'receding', label: 'kitPhysics.relativity.o.receding' },
        { value: 'approaching', label: 'kitPhysics.relativity.o.approaching' },
      ],
    },
    { id: 'f0', label: 'kitPhysics.relativity.f.f0', dim: 'frequency', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const beta = read.num('beta', { min: 0, max: 1 });
    const receding = read.choice('direction') !== 'approaching';
    const factor = dopplerFactor(beta, receding);
    const f0 = read.opt('f0', 'positive');
    const vars = { factor: fmt(factor, 8), beta: fmt(beta) };
    const steps: KitStep[] = [
      { key: receding ? 'kitPhysics.relativity.s.doppler' : 'kitPhysics.relativity.s.dopplerToward', vars },
    ];
    if (f0 !== null)
      steps.push({
        key: 'kitPhysics.relativity.s.observed',
        vars: { factor: fmt(factor, 8), f0: q(f0, 'Hz'), f: q(factor * f0, 'Hz') },
      });
    return {
      ok: true,
      rows: [
        { key: 'kitPhysics.relativity.r.factor', symbol: 'f/f₀', value: factor, primary: true, digits: 8 },
        { key: 'kitPhysics.relativity.r.redshift', symbol: 'z', value: 1 / factor - 1 },
        ...(f0 !== null
          ? [
              {
                key: 'kitPhysics.relativity.r.observed' as const,
                symbol: 'f',
                value: factor * f0,
                dim: 'frequency' as const,
              },
            ]
          : []),
      ],
      latex: receding
        ? '\\frac{f}{f_0}=\\sqrt{\\frac{1-\\beta}{1+\\beta}}'
        : '\\frac{f}{f_0}=\\sqrt{\\frac{1+\\beta}{1-\\beta}}',
      steps,
      notes: [{ key: 'kitPhysics.relativity.notes.longitudinal' }],
    };
  },
};

export const RELATIVITY: ToolSpec = {
  id: 'relativity',
  modes: [factorMode, eventsMode, velocityMode, energyMode, restMode, dopplerMode],
};
