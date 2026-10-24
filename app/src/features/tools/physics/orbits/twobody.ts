// The orbital mechanics tool's two-body calculations: an orbit from its apses or period, state vector to elements
// and back, Kepler's equation, and propagation by universal variables.
import type { MessageKey } from '../../../../strings/t';
import { fmt, q } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import {
  eccentricFromTrue,
  elementsToState,
  meanFromEccentric,
  period,
  propagate,
  radiusForPeriod,
  solveKepler,
  stateToElements,
  trueFromEccentric,
} from './engine';
import type { Vec } from './engine';
import {
  angle,
  angleRow,
  bodyField,
  elementNotes,
  elementRows,
  km,
  kms,
  lengthRow,
  orbitPlot,
  readBody,
  speedRow,
  vecKm,
} from './shared';

const K = 'kitPhysics.orbits';
const posField = (id: string, label: MessageKey, initial: string) => ({
  id,
  label,
  kind: 'vector' as const,
  dim: 'length' as const,
  unit: 'km',
  usUnit: 'km',
  initial,
});
const velField = (id: string, label: MessageKey, initial: string) => ({
  id,
  label,
  kind: 'vector' as const,
  dim: 'speed' as const,
  unit: 'km/s',
  usUnit: 'km/s',
  initial,
});
const altField = (id: string, label: MessageKey, initial: string, when?: (ch: (id: string) => string) => boolean) => ({
  id,
  label,
  dim: 'length' as const,
  unit: 'km',
  usUnit: 'mi',
  initial,
  ...(when ? { when } : {}),
});

export const basicsMode: ModeDef = {
  id: 'basics',
  label: `${K}.modes.basics`,
  fields: [
    bodyField,
    {
      id: 'given',
      label: `${K}.f.given`,
      kind: 'choice',
      initial: 'apses',
      options: [
        { value: 'apses', label: `${K}.o.apses` },
        { value: 'axis', label: `${K}.o.axis` },
        { value: 'period', label: `${K}.o.period` },
      ],
    },
    altField('hp', `${K}.f.hp`, '300', (ch) => ch('given') === 'apses'),
    altField('ha', `${K}.f.ha`, '35786', (ch) => ch('given') === 'apses'),
    altField('a', `${K}.f.a`, '7000', (ch) => ch('given') === 'axis'),
    { id: 'e', label: `${K}.f.e`, initial: '0', when: (ch) => ch('given') === 'axis' },
    {
      id: 'T',
      label: `${K}.f.T`,
      dim: 'time',
      unit: 'h',
      usUnit: 'h',
      initial: '23.9344696',
      when: (ch) => ch('given') === 'period',
      help: `${K}.help.sidereal`,
    },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const given = read.choice('given');
    let a: number;
    let e: number;
    const steps: KitStep[] = [];
    if (given === 'apses') {
      const rp = body.radius + read.num('hp', 'nonNegative');
      const ra = body.radius + read.num('ha', 'nonNegative');
      if (ra < rp) fail(`${K}.errors.apsesOrder`);
      a = (rp + ra) / 2;
      e = (ra - rp) / (ra + rp);
      steps.push({ key: `${K}.s.apses`, vars: { R: km(body.radius), rp: km(rp), ra: km(ra), a: km(a), e: fmt(e, 6) } });
    } else if (given === 'axis') {
      a = read.num('a', 'positive');
      e = read.num('e', { min: 0, max: 0.999999999 });
    } else {
      const T = read.num('T', 'positive');
      a = radiusForPeriod(T, body.mu);
      e = 0;
      steps.push({ key: `${K}.s.fromPeriod`, vars: { T: q(T, 's', 9), a: km(a, 9) } });
    }
    const rp = a * (1 - e);
    const ra = a * (1 + e);
    if (rp <= body.radius) steps.push({ key: `${K}.s.hitsBody` });
    const T = period(a, body.mu);
    const vp = Math.sqrt(body.mu * (2 / rp - 1 / a));
    const va = Math.sqrt(body.mu * (2 / ra - 1 / a));
    const energy = -body.mu / (2 * a);
    steps.push(
      { key: `${K}.s.period`, vars: { a: km(a), mu: q(body.mu / 1e9, 'km³/s²', 10), T: q(T, 's', 8) } },
      { key: `${K}.s.visViva`, vars: { rp: km(rp), vp: kms(vp), ra: km(ra), va: kms(va) } },
      { key: `${K}.s.energy`, vars: { a: km(a), energy: q(energy / 1e6, 'km²/s²', 6) } },
    );
    const rows: ResultRow[] = [
      lengthRow(`${K}.r.a`, 'a', a, true),
      { key: `${K}.r.e`, symbol: 'e', value: e, digits: 6, primary: true },
      { key: `${K}.r.period`, symbol: 'T', value: T, dim: 'time', unit: 's', usUnit: 's', digits: 8, primary: true },
      lengthRow(`${K}.r.rp`, 'r_p', rp),
      lengthRow(`${K}.r.ra`, 'r_a', ra),
      speedRow(`${K}.r.vp`, 'v_p', vp),
      speedRow(`${K}.r.va`, 'v_a', va),
      { key: `${K}.r.energy`, symbol: 'ε', value: energy / 1e6, unit: 'km²/s²', digits: 6 },
      speedRow(`${K}.r.escape`, 'v_esc', Math.sqrt((2 * body.mu) / rp)),
    ];
    return {
      ok: true,
      rows,
      latex:
        'T=2\\pi\\sqrt{\\frac{a^3}{\\mu}},\\qquad v^2=\\mu\\left(\\frac{2}{r}-\\frac{1}{a}\\right),\\qquad \\varepsilon=-\\frac{\\mu}{2a}',
      steps,
      notes: [{ key: `${K}.notes.twoBody`, labels: { body: `${K}.bodies.${body.id}` as MessageKey } }],
      plot: orbitPlot(a * (1 - e * e), e, body, [
        { nu: 0, tone: 'danger', key: `${K}.legend.periapsis` },
        ...(e > 0 ? [{ nu: Math.PI, tone: 'second' as const, key: `${K}.legend.apoapsis` as MessageKey }] : []),
      ]),
    };
  },
};

/** The worked lines of state-to-elements, with each quadrant check. */
function elementSteps(r: Vec, v: Vec, out: ReturnType<typeof stateToElements>, mu: number): KitStep[] {
  const { hVec, nVec, eVec, vr } = out.work;
  const steps: KitStep[] = [
    { key: `${K}.s.rv`, vars: { r: km(Math.hypot(...r)), v: kms(Math.hypot(...v)), vr: kms(vr) } },
    {
      key: `${K}.s.h`,
      vars: { h: vecKm(hVec.map((x) => x / 1000) as Vec, 'km²/s'), size: q(out.h / 1e6, 'km²/s', 6) },
    },
    { key: `${K}.s.i`, vars: { hz: q(hVec[2] / 1e6, 'km²/s', 6), i: angle(out.i) } },
  ];
  if (out.equatorial) steps.push({ key: `${K}.s.noNode` });
  else
    steps.push(
      { key: `${K}.s.n`, vars: { n: vecKm(nVec.map((x) => x / 1000) as Vec, 'km²/s') } },
      { key: nVec[1] >= 0 ? `${K}.s.raan` : `${K}.s.raanFlip`, vars: { raan: angle(out.raan) } },
    );
  steps.push({ key: `${K}.s.e`, vars: { e: `(${eVec.map((x) => fmt(x, 6)).join(', ')})`, size: fmt(out.e, 6) } });
  if (!out.circular)
    steps.push({ key: eVec[2] >= 0 ? `${K}.s.argp` : `${K}.s.argpFlip`, vars: { argp: angle(out.argp) } });
  steps.push({ key: vr >= 0 ? `${K}.s.nu` : `${K}.s.nuFlip`, vars: { nu: angle(out.nu) } });
  if (Number.isFinite(out.a))
    steps.push({
      key: `${K}.s.a`,
      vars: { h: q(out.h / 1e6, 'km²/s', 6), mu: q(mu / 1e9, 'km³/s²', 10), a: km(out.a) },
    });
  return steps;
}

export const stateMode: ModeDef = {
  id: 'state',
  label: `${K}.modes.state`,
  fields: [bodyField, posField('r', `${K}.f.r`, '8000 2000 1000'), velField('v', `${K}.f.v`, '-1 6.5 2')],
  solve(read): Outcome {
    const body = readBody(read);
    const r = read.vector('r', 3) as Vec;
    const v = read.vector('v', 3) as Vec;
    const out = stateToElements(r, v, body.mu);
    if (Math.hypot(...r) < body.radius) fail(`${K}.errors.inside`);
    return {
      ok: true,
      rows: elementRows(out, body.mu),
      latex:
        '\\vec h=\\vec r\\times\\vec v,\\quad \\vec n=\\hat k\\times\\vec h,\\quad ' +
        '\\vec e=\\frac{1}{\\mu}\\left[\\left(v^2-\\frac{\\mu}{r}\\right)\\vec r-rv_r\\vec v\\right]',
      steps: elementSteps(r, v, out, body.mu),
      notes: [
        { key: `${K}.notes.twoBody`, labels: { body: `${K}.bodies.${body.id}` as MessageKey } },
        ...elementNotes(out),
      ],
      plot: orbitPlot((out.h * out.h) / body.mu, out.e, body, [
        { nu: out.nu, tone: 'danger', key: `${K}.legend.position` },
      ]),
    };
  },
};

const elementFields = [
  altField('a', `${K}.f.a`, '8181.17'),
  { id: 'e', label: `${K}.f.e` as MessageKey, initial: '0.123536' },
  { id: 'i', label: `${K}.f.i` as MessageKey, dim: 'angle' as const, initial: '17.6511' },
  { id: 'raan', label: `${K}.f.raan` as MessageKey, dim: 'angle' as const, initial: '351.6341' },
  { id: 'argp', label: `${K}.f.argp` as MessageKey, dim: 'angle' as const, initial: '279.2738' },
  { id: 'nu', label: `${K}.f.nu` as MessageKey, dim: 'angle' as const, initial: '104.1185' },
];

export const elementsMode: ModeDef = {
  id: 'elements',
  label: `${K}.modes.elements`,
  intro: `${K}.help.elements`,
  fields: [bodyField, ...elementFields],
  solve(read): Outcome {
    const body = readBody(read);
    const a = read.num('a');
    const e = read.num('e', 'nonNegative');
    const i = read.num('i', { min: 0, max: Math.PI });
    const raan = read.num('raan');
    const argp = read.num('argp');
    const nu = read.num('nu');
    const out = elementsToState(a, e, i, raan, argp, nu, body.mu);
    const rows: ResultRow[] = [
      lengthRow(`${K}.r.rx`, 'x', out.r[0], true),
      lengthRow(`${K}.r.ry`, 'y', out.r[1], true),
      lengthRow(`${K}.r.rz`, 'z', out.r[2], true),
      speedRow(`${K}.r.vx`, 'vₓ', out.v[0], true),
      speedRow(`${K}.r.vy`, 'v_y', out.v[1], true),
      speedRow(`${K}.r.vz`, 'v_z', out.v[2], true),
      lengthRow(`${K}.r.radius`, 'r', Math.hypot(...out.r)),
      speedRow(`${K}.r.speed`, 'v', Math.hypot(...out.v)),
    ];
    return {
      ok: true,
      rows,
      latex:
        '\\vec r_p=\\frac{p}{1+e\\cos\\nu}\\begin{pmatrix}\\cos\\nu\\\\\\sin\\nu\\\\0\\end{pmatrix},\\quad ' +
        '\\vec v_p=\\sqrt{\\frac{\\mu}{p}}\\begin{pmatrix}-\\sin\\nu\\\\e+\\cos\\nu\\\\0\\end{pmatrix},\\quad ' +
        '\\vec r=R_3(-\\Omega)R_1(-i)R_3(-\\omega)\\,\\vec r_p',
      steps: [
        { key: `${K}.s.p`, vars: { a: km(a), e: fmt(e, 6), p: km(out.p) } },
        { key: `${K}.s.perifocal`, vars: { r: vecKm(out.rPerifocal), v: vecKm(out.vPerifocal, 'km/s') } },
        {
          key: `${K}.s.rotate`,
          vars: { raan: angle(raan), i: angle(i), argp: angle(argp), r: vecKm(out.r), v: vecKm(out.v, 'km/s') },
        },
      ],
      notes: [{ key: `${K}.notes.twoBody`, labels: { body: `${K}.bodies.${body.id}` as MessageKey } }],
      plot: orbitPlot(out.p, e, body, [{ nu, tone: 'danger', key: `${K}.legend.position` }]),
    };
  },
};

export const keplerMode: ModeDef = {
  id: 'kepler',
  label: `${K}.modes.kepler`,
  fields: [
    {
      id: 'given',
      label: `${K}.f.given`,
      kind: 'choice',
      initial: 'mean',
      options: [
        { value: 'mean', label: `${K}.o.mean` },
        { value: 'true', label: `${K}.o.true` },
        { value: 'time', label: `${K}.o.time` },
      ],
    },
    { id: 'e', label: `${K}.f.e`, initial: '0.5' },
    {
      id: 'M',
      label: `${K}.f.M`,
      dim: 'angle',
      unit: 'rad',
      usUnit: 'rad',
      initial: '1',
      when: (ch) => ch('given') === 'mean',
    },
    { id: 'nu', label: `${K}.f.nu`, dim: 'angle', initial: '90', when: (ch) => ch('given') === 'true' },
    bodyField,
    altField('a', `${K}.f.aOptional`, '', (ch) => ch('given') !== 'time'),
    altField('aTime', `${K}.f.a`, '7000', (ch) => ch('given') === 'time'),
    {
      id: 't',
      label: `${K}.f.sincePeriapsis`,
      dim: 'time',
      unit: 'min',
      usUnit: 'min',
      initial: '30',
      when: (ch) => ch('given') === 'time',
    },
  ],
  solve(read): Outcome {
    const e = read.num('e', 'nonNegative');
    if (e === 1) fail(`${K}.errors.parabola`);
    const body = readBody(read);
    const given = read.choice('given');
    const a = given === 'time' ? read.num('aTime', 'positive') * (e > 1 ? -1 : 1) : read.opt('a');
    const n = a !== null ? Math.sqrt(body.mu / Math.abs(a) ** 3) : null;
    let M: number;
    let E: number;
    let nu: number;
    const steps: KitStep[] = [];
    if (given === 'true') {
      nu = read.num('nu');
      E = eccentricFromTrue(nu, e);
      M = meanFromEccentric(E, e);
      steps.push(
        { key: e < 1 ? `${K}.s.EfromNu` : `${K}.s.FfromNu`, vars: { nu: angle(nu), E: q(E, 'rad', 9) } },
        { key: e < 1 ? `${K}.s.MfromE` : `${K}.s.MfromF`, vars: { M: q(M, 'rad', 9) } },
      );
    } else {
      M = given === 'mean' ? read.num('M') : (n ?? NaN) * read.num('t');
      if (given === 'time')
        steps.push({
          key: `${K}.s.meanMotion`,
          vars: { n: q(n ?? NaN, 'rad/s', 8), t: q(read.num('t'), 's'), M: q(M, 'rad', 9) },
        });
      const solved = solveKepler(M, e);
      E = solved.E;
      nu = trueFromEccentric(E, e);
      steps.push(
        {
          key: e < 1 ? `${K}.s.newton` : `${K}.s.newtonH`,
          vars: { M: q(M, 'rad', 9), e: fmt(e, 6), E: q(E, 'rad', 10), count: String(solved.iterations) },
        },
        { key: e < 1 ? `${K}.s.nuFromE` : `${K}.s.nuFromF`, vars: { nu: angle(nu) } },
      );
    }
    const rows: ResultRow[] = [
      {
        key: e < 1 ? `${K}.r.E` : `${K}.r.F`,
        symbol: e < 1 ? 'E' : 'F',
        value: E,
        unit: 'rad',
        digits: 9,
        primary: true,
      },
      { key: `${K}.r.M`, symbol: 'M', value: M, unit: 'rad', digits: 9 },
      angleRow(`${K}.r.nu`, 'ν', nu < 0 && e < 1 ? nu + 2 * Math.PI : nu, true),
    ];
    if (n !== null && a !== null) {
      rows.push({
        key: `${K}.r.time`,
        symbol: 't − t_p',
        value: M / n,
        dim: 'time',
        unit: 'min',
        usUnit: 'min',
        digits: 7,
      });
      rows.push(lengthRow(`${K}.r.radius`, 'r', Math.abs(a) * Math.abs(1 - e * (e < 1 ? Math.cos(E) : Math.cosh(E)))));
    }
    return {
      ok: true,
      rows,
      latex:
        e < 1
          ? 'M=E-e\\sin E,\\qquad \\tan\\frac{\\nu}{2}=\\sqrt{\\frac{1+e}{1-e}}\\tan\\frac{E}{2}'
          : 'M=e\\sinh F-F,\\qquad \\tan\\frac{\\nu}{2}=\\sqrt{\\frac{e+1}{e-1}}\\tanh\\frac{F}{2}',
      steps,
      notes: [{ key: `${K}.notes.kepler` }],
    };
  },
};

export const propagateMode: ModeDef = {
  id: 'propagate',
  label: `${K}.modes.propagate`,
  fields: [
    bodyField,
    posField('r', `${K}.f.r`, '8000 2000 1000'),
    velField('v', `${K}.f.v`, '-1 6.5 2'),
    { id: 'dt', label: `${K}.f.dt`, dim: 'time', unit: 's', usUnit: 's', initial: '3000' },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r0 = read.vector('r', 3) as Vec;
    const v0 = read.vector('v', 3) as Vec;
    const dt = read.num('dt');
    const out = propagate(r0, v0, dt, body.mu);
    const start = stateToElements(r0, v0, body.mu);
    const end = stateToElements(out.r, out.v, body.mu);
    const rows: ResultRow[] = [
      lengthRow(`${K}.r.rx`, 'x', out.r[0], true),
      lengthRow(`${K}.r.ry`, 'y', out.r[1], true),
      lengthRow(`${K}.r.rz`, 'z', out.r[2], true),
      speedRow(`${K}.r.vx`, 'vₓ', out.v[0], true),
      speedRow(`${K}.r.vy`, 'v_y', out.v[1], true),
      speedRow(`${K}.r.vz`, 'v_z', out.v[2], true),
      lengthRow(`${K}.r.radius`, 'r', Math.hypot(...out.r)),
      angleRow(`${K}.r.nuEnd`, 'ν', end.nu),
    ];
    return {
      ok: true,
      rows,
      latex:
        '\\vec r=f\\vec r_0+g\\vec v_0,\\quad f=1-\\frac{\\chi^2}{r_0}C(z),\\quad ' +
        'g=\\Delta t-\\frac{\\chi^3}{\\sqrt\\mu}S(z),\\quad z=\\alpha\\chi^2',
      steps: [
        {
          key: `${K}.s.alpha`,
          vars: { alpha: q(out.alpha * 1000, '1/km', 8) },
          labels: { conic: start.e < 1 ? `${K}.kind.ellipse` : `${K}.kind.hyperbola` },
        },
        { key: `${K}.s.chi`, vars: { chi: q(out.chi / Math.sqrt(1000), '√km', 9) } },
        {
          key: `${K}.s.fg`,
          vars: { f: fmt(out.f, 9), g: q(out.g, 's', 9), fdot: q(out.fdot, '1/s', 8), gdot: fmt(out.gdot, 9) },
        },
        { key: `${K}.s.state`, vars: { r: vecKm(out.r), v: vecKm(out.v, 'km/s') } },
      ],
      notes: [{ key: `${K}.notes.propagate` }],
      plot: orbitPlot((start.h * start.h) / body.mu, start.e, body, [
        { nu: start.nu, tone: 'second', key: `${K}.legend.start` },
        { nu: end.nu, tone: 'danger', key: `${K}.legend.end` },
      ]),
    };
  },
};
