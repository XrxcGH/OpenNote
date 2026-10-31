// The orbital maneuvers tool. Its calculations, in the order the window lists them: Hohmann transfer (with a plane
// change at the second burn); bi-elliptic transfer; plane change; phasing orbit; Lambert's problem.
import type { MessageKey } from '../../../../strings/t';
import { fmt, q } from '../kit/format';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, PlotSeries, ResultRow, ToolSpec } from '../kit/types';
import { propagate, stateToElements } from '../orbits/engine';
import type { Body, Vec } from '../orbits/engine';
import {
  angle,
  angleRow,
  bodyField,
  conicPoints,
  km,
  kms,
  lengthRow,
  readBody,
  speedRow,
  vecKm,
} from '../orbits/shared';
import { biElliptic, combinedChange, hohmann, lambert, phasing, planeChange } from './engine';

const K = 'kitPhysics.maneuvers';
const hours = (s: number) => q(s / 3600, 'h', 6);
const radiusOf = (read: Reader, id: string, body: Body) =>
  read.choice('as') === 'altitude' ? body.radius + read.num(id, 'nonNegative') : read.num(id, 'positive');
const asField = {
  id: 'as',
  label: `${K}.f.as` as MessageKey,
  kind: 'choice' as const,
  initial: 'radius',
  options: [
    { value: 'radius', label: `${K}.o.radius` as MessageKey },
    { value: 'altitude', label: `${K}.o.altitude` as MessageKey },
  ],
};
const kmField = (id: string, label: MessageKey, initial: string) => ({
  id,
  label,
  dim: 'length' as const,
  unit: 'km',
  usUnit: 'mi',
  initial,
});
const timeRow = (key: MessageKey, symbol: string, value: number): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'time',
  unit: 'h',
  usUnit: 'h',
  digits: 6,
});

/** Circles for the start and end orbits, and the transfer arcs, in km. */
function transferPlot(body: Body, circles: readonly number[], arcs: readonly PlotSeries[], alt: MessageKey): Plot {
  const ring = (r: number): [number, number][] =>
    Array.from({ length: 181 }, (_, k) => [
      (r / 1000) * Math.cos((2 * Math.PI * k) / 180),
      (r / 1000) * Math.sin((2 * Math.PI * k) / 180),
    ]);
  return {
    frame: 'equal',
    alt: { key: alt },
    x: { label: 'x (km)' },
    y: { label: 'y (km)' },
    series: [...circles.map((r) => ({ points: ring(r), tone: 'muted' as const, dash: true })), ...arcs],
    circles: [{ x: 0, y: 0, r: body.radius / 1000, tone: 'muted', fill: true }],
    legend: [
      { tone: 'muted', key: `${K}.legend.orbits`, dash: true },
      { tone: 'accent', key: `${K}.legend.transfer` },
    ],
  };
}

/** Half of an ellipse from periapsis rp to apoapsis ra, starting at angle `from`. */
function halfEllipse(rp: number, ra: number, from: number, tone: PlotSeries['tone'] = 'accent'): PlotSeries {
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const p = a * (1 - e * e);
  const points: [number, number][] = [];
  for (let k = 0; k <= 120; k++) {
    const nu = (Math.PI * k) / 120;
    const r = p / (1 + e * Math.cos(nu)) / 1000;
    points.push([r * Math.cos(nu + from), r * Math.sin(nu + from)]);
  }
  return { points, tone, width: 2 };
}

/** The transfer half ellipse. It leaves r1 at +x and runs counterclockwise. */
function hohmannArc(r1: number, r2: number): PlotSeries {
  if (r1 <= r2) return halfEllipse(r1, r2, 0);
  const half = halfEllipse(r2, r1, Math.PI);
  return { ...half, points: half.points.map(([x, y]): [number, number] => [x, -y]) };
}

const hohmannMode: ModeDef = {
  id: 'hohmann',
  label: `${K}.modes.hohmann`,
  fields: [
    bodyField,
    asField,
    kmField('r1', `${K}.f.r1`, '6678'),
    kmField('r2', `${K}.f.r2`, '42164'),
    { id: 'di', label: `${K}.f.di`, dim: 'angle', initial: '0', help: `${K}.help.di` },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r1 = radiusOf(read, 'r1', body);
    const r2 = radiusOf(read, 'r2', body);
    const di = read.num('di', { min: 0, max: Math.PI });
    const out = hohmann(r1, r2, body.mu, di);
    const steps: KitStep[] = [
      { key: `${K}.s.transfer`, vars: { r1: km(r1), r2: km(r2), a: km(out.a) } },
      { key: `${K}.s.burn1`, vars: { v1: kms(out.v1), vt1: kms(out.vt1), dv: kms(out.dv1) } },
      di > 0
        ? { key: `${K}.s.burn2Plane`, vars: { vt2: kms(out.vt2), v2: kms(out.v2), di: angle(di), dv: kms(out.dv2) } }
        : { key: `${K}.s.burn2`, vars: { vt2: kms(out.vt2), v2: kms(out.v2), dv: kms(out.dv2) } },
      { key: `${K}.s.total`, vars: { dv: kms(out.total), t: hours(out.time) } },
    ];
    return {
      ok: true,
      rows: [
        speedRow(`${K}.r.total`, 'Δv', out.total, true),
        speedRow(`${K}.r.dv1`, 'Δv₁', out.dv1, true),
        speedRow(`${K}.r.dv2`, 'Δv₂', out.dv2, true),
        timeRow(`${K}.r.time`, 't', out.time),
        lengthRow(`${K}.r.a`, 'a_t', out.a),
        { key: `${K}.r.e`, symbol: 'e_t', value: out.e, digits: 6 },
      ],
      latex:
        'a_t=\\frac{r_1+r_2}{2},\\quad v=\\sqrt{\\mu\\left(\\frac{2}{r}-\\frac{1}{a}\\right)},\\quad ' +
        '\\Delta v_2=\\sqrt{v_{t2}^2+v_2^2-2v_{t2}v_2\\cos\\Delta i}',
      steps,
      notes: [{ key: `${K}.notes.impulsive` }],
      plot: transferPlot(body, [r1, r2], [hohmannArc(r1, r2)], `${K}.plot.hohmann`),
    };
  },
};

const biellipticMode: ModeDef = {
  id: 'bielliptic',
  label: `${K}.modes.bielliptic`,
  fields: [
    bodyField,
    asField,
    kmField('r1', `${K}.f.r1`, '7000'),
    kmField('r2', `${K}.f.r2`, '105000'),
    kmField('rb', `${K}.f.rb`, '210000'),
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r1 = radiusOf(read, 'r1', body);
    const r2 = radiusOf(read, 'r2', body);
    const rb = radiusOf(read, 'rb', body);
    const out = biElliptic(r1, r2, rb, body.mu);
    const direct = hohmann(r1, r2, body.mu);
    const better: MessageKey = out.total < direct.total ? `${K}.kind.biBetter` : `${K}.kind.hohmannBetter`;
    return {
      ok: true,
      rows: [
        speedRow(`${K}.r.total`, 'Δv', out.total, true),
        speedRow(`${K}.r.dv1`, 'Δv₁', out.dv1),
        speedRow(`${K}.r.dv2`, 'Δv₂', out.dv2),
        speedRow(`${K}.r.dv3`, 'Δv₃', out.dv3),
        timeRow(`${K}.r.time`, 't', out.time),
        speedRow(`${K}.r.hohmannTotal`, 'Δv_H', direct.total),
        timeRow(`${K}.r.hohmannTime`, 't_H', direct.time),
        { key: `${K}.r.cheaper`, value: '', word: better, primary: true },
      ],
      latex:
        'a_1=\\frac{r_1+r_b}{2},\\quad a_2=\\frac{r_2+r_b}{2},\\quad \\Delta v=\\sum|v_\\mathrm{after}-v_\\mathrm{before}|',
      steps: [
        { key: `${K}.s.bi1`, vars: { r1: km(r1), rb: km(rb), dv: kms(out.dv1) } },
        { key: `${K}.s.bi2`, vars: { rb: km(rb), r2: km(r2), dv: kms(out.dv2) } },
        { key: `${K}.s.bi3`, vars: { r2: km(r2), dv: kms(out.dv3) } },
        { key: `${K}.s.compare`, vars: { bi: kms(out.total), h: kms(direct.total), ratio: fmt(r2 / r1, 5) } },
      ],
      notes: [{ key: `${K}.notes.bielliptic` }],
      plot: transferPlot(
        body,
        [r1, r2],
        [halfEllipse(r1, rb, 0), halfEllipse(r2, rb, Math.PI, 'second')],
        `${K}.plot.bielliptic`,
      ),
    };
  },
};

const planeMode: ModeDef = {
  id: 'plane',
  label: `${K}.modes.plane`,
  fields: [
    bodyField,
    asField,
    kmField('r', `${K}.f.r`, '6678'),
    { id: 'di', label: `${K}.f.di`, dim: 'angle', initial: '28.5' },
    {
      id: 'v2',
      label: `${K}.f.v2`,
      dim: 'speed',
      unit: 'km/s',
      usUnit: 'ft/s',
      initial: '',
      optional: true,
      help: `${K}.help.v2`,
    },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r = radiusOf(read, 'r', body);
    const di = read.num('di', { min: 0, max: Math.PI });
    const v = Math.sqrt(body.mu / r);
    const v2 = read.opt('v2', 'positive');
    const pure = planeChange(v, di);
    const rows: ResultRow[] = [speedRow(`${K}.r.planeOnly`, 'Δv', pure, v2 === null), speedRow(`${K}.r.speed`, 'v', v)];
    const steps: KitStep[] = [{ key: `${K}.s.plane`, vars: { v: kms(v), di: angle(di), dv: kms(pure) } }];
    if (v2 !== null) {
      const both = combinedChange(v, v2, di);
      rows.unshift(speedRow(`${K}.r.combined`, 'Δv', both, true));
      // Two separate burns cost least with the plane change at the lower speed.
      rows.push(speedRow(`${K}.r.separate`, 'Δv_sep', Math.abs(v2 - v) + planeChange(Math.min(v, v2), di)));
      steps.push({ key: `${K}.s.combined`, vars: { v1: kms(v), v2: kms(v2), di: angle(di), dv: kms(both) } });
    }
    return {
      ok: true,
      rows,
      latex: '\\Delta v=2v\\sin\\frac{\\Delta i}{2},\\qquad \\Delta v=\\sqrt{v_1^2+v_2^2-2v_1v_2\\cos\\Delta i}',
      steps,
      notes: [{ key: `${K}.notes.plane` }],
    };
  },
};

/** The whole phasing ellipse: two halves, mirrored across the apse line. */
function phasingArcs(r: number, other: number): PlotSeries[] {
  const half = halfEllipse(Math.min(r, other), Math.max(r, other), other < r ? Math.PI : 0);
  return [half, { ...half, points: half.points.map(([x, y]): [number, number] => [x, -y]) }];
}

const phasingMode: ModeDef = {
  id: 'phasing',
  label: `${K}.modes.phasing`,
  fields: [
    bodyField,
    asField,
    kmField('r', `${K}.f.r`, '6778'),
    { id: 'phase', label: `${K}.f.phase`, dim: 'angle', initial: '20', help: `${K}.help.phase` },
    { id: 'revs', label: `${K}.f.revs`, initial: '3' },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r = radiusOf(read, 'r', body);
    const phase = read.num('phase', { min: -2 * Math.PI, max: 2 * Math.PI });
    const revs = read.num('revs', { min: 1, max: 100 });
    if (!Number.isInteger(revs)) return { ok: false, problem: { key: `${K}.errors.wholeRevs` } };
    const out = phasing(r, phase, revs, body.mu, body.radius);
    return {
      ok: true,
      rows: [
        speedRow(`${K}.r.total`, 'Δv', out.total, true),
        speedRow(`${K}.r.each`, 'Δv₁ = Δv₂', out.dv),
        timeRow(`${K}.r.wait`, 't', out.wait),
        {
          key: `${K}.r.phasingPeriod`,
          symbol: 'T_ph',
          value: out.Tp,
          dim: 'time',
          unit: 'min',
          usUnit: 'min',
          digits: 6,
        },
        lengthRow(`${K}.r.phasingA`, 'a_ph', out.a),
        lengthRow(`${K}.r.otherApse`, phase > 0 ? 'r_p' : 'r_a', out.other),
      ],
      latex:
        'T_{ph}=T\\left(1-\\frac{\\Delta\\theta}{2\\pi k}\\right),\\quad ' +
        'a_{ph}=\\left(\\mu\\frac{T_{ph}^2}{4\\pi^2}\\right)^{1/3},\\quad ' +
        '\\Delta v=2|v_{ph}-v_c|',
      steps: [
        {
          key: `${K}.s.phasingPeriod`,
          vars: { T: q(out.T / 60, 'min', 6), phase: angle(phase), k: fmt(revs), Tp: q(out.Tp / 60, 'min', 6) },
        },
        { key: `${K}.s.phasingOrbit`, vars: { a: km(out.a), other: km(out.other) } },
        {
          key: `${K}.s.phasingBurns`,
          vars: { v: kms(out.v), vp: kms(out.vp), dv: kms(out.dv), total: kms(out.total) },
        },
      ],
      notes: [{ key: `${K}.notes.phasing` }],
      plot: transferPlot(body, [r], phasingArcs(r, out.other), `${K}.plot.phasing`),
    };
  },
};

const lambertMode: ModeDef = {
  id: 'lambert',
  label: `${K}.modes.lambert`,
  fields: [
    bodyField,
    {
      id: 'r1',
      label: `${K}.f.r1Vec`,
      kind: 'vector',
      dim: 'length',
      unit: 'km',
      usUnit: 'km',
      initial: '8000 2000 1000',
    },
    {
      id: 'r2',
      label: `${K}.f.r2Vec`,
      kind: 'vector',
      dim: 'length',
      unit: 'km',
      usUnit: 'km',
      initial: '-6461.5145 5797.0309 1525.8516',
    },
    { id: 'dt', label: `${K}.f.dt`, dim: 'time', unit: 's', usUnit: 's', initial: '3000' },
    {
      id: 'way',
      label: `${K}.f.way`,
      kind: 'choice',
      initial: 'prograde',
      options: [
        { value: 'prograde', label: `${K}.o.prograde` },
        { value: 'retrograde', label: `${K}.o.retrograde` },
      ],
    },
  ],
  solve(read): Outcome {
    const body = readBody(read);
    const r1 = read.vector('r1', 3) as Vec;
    const r2 = read.vector('r2', 3) as Vec;
    const dt = read.num('dt', 'positive');
    const out = lambert(r1, r2, dt, body.mu, read.choice('way') !== 'retrograde');
    const el = stateToElements(r1, out.v1, body.mu);
    const check = propagate(r1, out.v1, dt, body.mu).r;
    const miss = Math.hypot(check[0] - r2[0], check[1] - r2[1], check[2] - r2[2]);
    const rows: ResultRow[] = [
      speedRow(`${K}.r.v1x`, 'v₁ₓ', out.v1[0], true),
      speedRow(`${K}.r.v1y`, 'v₁_y', out.v1[1], true),
      speedRow(`${K}.r.v1z`, 'v₁_z', out.v1[2], true),
      speedRow(`${K}.r.v2x`, 'v₂ₓ', out.v2[0]),
      speedRow(`${K}.r.v2y`, 'v₂_y', out.v2[1]),
      speedRow(`${K}.r.v2z`, 'v₂_z', out.v2[2]),
      angleRow(`${K}.r.sweep`, 'Δθ', out.theta),
      lengthRow(`${K}.r.a`, 'a', el.a),
      { key: `${K}.r.e`, symbol: 'e', value: el.e, digits: 6 },
      angleRow(`${K}.r.i`, 'i', el.i),
      { key: `${K}.r.miss`, symbol: '|Δr|', value: miss, dim: 'length', unit: 'm', usUnit: 'ft', digits: 3 },
    ];
    return {
      ok: true,
      rows,
      latex:
        'A=\\sin\\Delta\\theta\\sqrt{\\frac{r_1r_2}{1-\\cos\\Delta\\theta}},\\quad y(z)=r_1+r_2+A\\frac{zS(z)-1}{\\sqrt{C(z)}},\\quad ' +
        '\\sqrt\\mu\\,\\Delta t=\\left(\\frac{y}{C}\\right)^{3/2}S+A\\sqrt y',
      steps: [
        { key: `${K}.s.sweep`, vars: { theta: angle(out.theta), A: km(out.A) } },
        {
          key: `${K}.s.z`,
          vars: { z: fmt(out.z, 10) },
          labels: { conic: out.z > 0 ? 'kitPhysics.orbits.kind.ellipse' : 'kitPhysics.orbits.kind.hyperbola' },
        },
        { key: `${K}.s.lagrange`, vars: { f: fmt(out.f, 9), g: q(out.g, 's', 9), gdot: fmt(out.gdot, 9) } },
        { key: `${K}.s.velocities`, vars: { v1: vecKm(out.v1, 'km/s'), v2: vecKm(out.v2, 'km/s') } },
        { key: `${K}.s.check`, vars: { miss: q(miss, 'm', 3) } },
      ],
      notes: [{ key: `${K}.notes.lambert` }],
      plot: lambertPlot(r1, out.v1, dt, body),
    };
  },
};

/** The transfer arc in its own plane: r1 along +x, the motion toward +y. */
function lambertPlot(r1: Vec, v1: Vec, dt: number, body: Body): Plot {
  const e1 = r1.map((x) => x / Math.hypot(...r1)) as Vec;
  const h: Vec = [r1[1] * v1[2] - r1[2] * v1[1], r1[2] * v1[0] - r1[0] * v1[2], r1[0] * v1[1] - r1[1] * v1[0]];
  const hn = Math.hypot(...h);
  const e2: Vec = [
    (h[1] * e1[2] - h[2] * e1[1]) / hn,
    (h[2] * e1[0] - h[0] * e1[2]) / hn,
    (h[0] * e1[1] - h[1] * e1[0]) / hn,
  ];
  const flat = (r: Vec): [number, number] => [
    (r[0] * e1[0] + r[1] * e1[1] + r[2] * e1[2]) / 1000,
    (r[0] * e2[0] + r[1] * e2[1] + r[2] * e2[2]) / 1000,
  ];
  const arc: [number, number][] = [];
  for (let k = 0; k <= 120; k++) arc.push(flat(k === 0 ? r1 : propagate(r1, v1, (dt * k) / 120, body.mu).r));
  const el = stateToElements(r1, v1, body.mu);
  const p = (el.h * el.h) / body.mu;
  // The whole conic, turned so its periapsis sits where it does relative to r1.
  const turn = -el.nu;
  const whole = conicPoints(p, el.e).map(([x, y]): [number, number] => [
    x * Math.cos(turn) - y * Math.sin(turn),
    x * Math.sin(turn) + y * Math.cos(turn),
  ]);
  const end = arc[arc.length - 1];
  return {
    frame: 'equal',
    alt: { key: `${K}.plot.lambert` },
    x: { label: 'x (km)' },
    y: { label: 'y (km)' },
    series: [
      { points: whole, tone: 'muted', dash: true },
      { points: arc, tone: 'accent', width: 2 },
    ],
    circles: [
      { x: 0, y: 0, r: body.radius / 1000, tone: 'muted', fill: true },
      { x: arc[0][0], y: arc[0][1], r: 4, px: true, tone: 'second', fill: true },
      { x: end[0], y: end[1], r: 4, px: true, tone: 'danger', fill: true },
    ],
    legend: [
      { tone: 'accent', key: `${K}.legend.transfer` },
      { tone: 'second', key: `${K}.legend.departure` },
      { tone: 'danger', key: `${K}.legend.arrival` },
    ],
  };
}

export const MANEUVERS: ToolSpec = {
  id: 'maneuvers',
  modes: [hohmannMode, biellipticMode, planeMode, phasingMode, lambertMode],
};
