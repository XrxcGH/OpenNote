// The transportation tool's traffic, signal, and highway geometry calculations.
import { grid, num, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Outcome } from '../core/types';
import {
  bottleneck,
  capacity,
  deflections,
  horizontalCurve,
  minRadius,
  mmc,
  shockwave,
  speedAt,
  stoppingSight,
  verticalCurve,
  webster,
  websterDelay,
} from './engine';
import type { FlowModel } from './engine';

const flowCalc: Calc = {
  id: 'flow',
  title: 'transport.flow.title',
  fields: (choices) => [
    pick('mode', 'transport.f.find', [
      ['model', 'transport.o.model'],
      ['shock', 'transport.o.shock'],
    ]),
    ...(choices.mode === 'shock'
      ? [
          num('q1', 'transport.f.q1', '1500', 'vehicles'),
          num('k1', 'transport.f.k1', '20', 'density2'),
          num('q2', 'transport.f.q2', '2000', 'vehicles'),
          num('k2', 'transport.f.k2', '80', 'density2'),
        ]
      : [
          pick('model', 'transport.f.model', [
            ['greenshields', 'transport.o.greenshields'],
            ['greenberg', 'transport.o.greenberg'],
            ['underwood', 'transport.o.underwood'],
          ]),
          num('vf', choices.model === 'greenberg' ? 'transport.f.v0' : 'transport.f.vf', '100', 'speed'),
          num('kj', choices.model === 'underwood' ? 'transport.f.k0' : 'transport.f.kj', '150', 'density2'),
        ]),
  ],
  solve({ n, s }): Outcome {
    if (s.mode === 'shock') {
      const w = shockwave(n.q1!, n.k1!, n.q2!, n.k2!);
      return {
        answer: { key: w >= 0 ? 'transport.flow.shockDown' : 'transport.flow.shockUp', vars: { w: Math.abs(w) } },
        rows: [row('transport.r.w', w, 'km/h')],
        steps: [step('transport.flow.s3', { w }, `w = \\frac{q_2 - q_1}{k_2 - k_1} = ${tex(w)}\\ \\mathrm{km/h}`)],
        latex: `w = ${tex(w)}\\ \\mathrm{km/h}`,
      };
    }
    const model = (s.model ?? 'greenshields') as FlowModel;
    const c = capacity(model, n.vf!, n.kj!);
    const kmax = model === 'underwood' ? n.kj! * 5 : n.kj!;
    const ks = linspace(kmax / 400, kmax * 0.999, 80);
    return {
      answer: { key: 'transport.flow.answer', vars: { q: c.q, k: c.k, v: c.v } },
      rows: [
        row('transport.r.qmax', c.q, 'veh/h'),
        row('transport.r.kc', c.k, 'veh/km'),
        row('transport.r.vc', c.v, 'km/h'),
      ],
      steps: [
        step(
          `transport.flow.${model}`,
          undefined,
          model === 'greenshields'
            ? 'v = v_f\\left(1 - \\frac{k}{k_j}\\right),\\ q = k v'
            : model === 'greenberg'
              ? 'v = v_0 \\ln\\frac{k_j}{k},\\ q = k v'
              : 'v = v_f e^{-k/k_0},\\ q = k v',
        ),
        step('transport.flow.s2', { q: c.q, k: c.k }, `q_{max} = ${tex(c.q)}\\ \\mathrm{veh/h}`),
      ],
      latex: `q_{max} = ${tex(c.q)}\\ \\mathrm{veh/h}\\ \\text{at}\\ k = ${tex(c.k)}\\ \\mathrm{veh/km}`,
      plot: {
        title: 'transport.p.fundamental',
        x: 'transport.p.k',
        y: 'transport.p.q',
        series: [
          { name: 'transport.p.q', points: ks.map((k) => [k, k * speedAt(model, n.vf!, n.kj!, k)] as const) },
          { name: 'transport.p.capacity', points: [[c.k, c.q] as const], style: 'points' },
        ],
      },
    };
  },
};

const queueCalc: Calc = {
  id: 'queue',
  title: 'transport.queue.title',
  fields: (choices) => [
    pick('mode', 'transport.f.queueKind', [
      ['bottleneck', 'transport.o.bottleneck'],
      ['mmc', 'transport.o.mmc'],
    ]),
    num('lambda', 'transport.f.lambda', choices.mode === 'mmc' ? '400' : '1800', 'vehicles'),
    num('mu', 'transport.f.mu', choices.mode === 'mmc' ? '250' : '3600', 'vehicles'),
    ...(choices.mode === 'mmc'
      ? [num('c', 'transport.f.servers', '2')]
      : [num('muR', 'transport.f.muR', '1200', 'vehicles'), num('tr', 'transport.f.tr', '0.5', 'hours')]),
  ],
  solve({ n, s }): Outcome {
    if (s.mode === 'mmc') {
      const q = mmc(n.lambda!, n.mu!, Math.round(n.c!));
      return {
        answer: { key: 'transport.queue.mmcAnswer', vars: { Lq: q.Lq, Wq: q.Wq * 3600 } },
        rows: [
          row('transport.r.rho', q.rho),
          row('transport.r.Pwait', q.Pwait),
          row('transport.r.Lq', q.Lq, 'veh'),
          row('transport.r.Wq', q.Wq * 3600, 's'),
          row('transport.r.W', q.W * 3600, 's'),
        ],
        steps: [
          step('transport.queue.m1', { rho: q.rho }, `\\rho = \\frac{\\lambda}{c\\mu} = ${tex(q.rho)}`),
          step('transport.queue.m2', { P: q.Pwait, Lq: q.Lq }),
          step('transport.queue.m3', { W: q.W * 3600 }, `W = W_q + \\frac{1}{\\mu},\\quad L = \\lambda W`),
        ],
        latex: `L_q = ${tex(q.Lq)},\\ W_q = ${tex(q.Wq * 3600)}\\ \\mathrm{s}`,
      };
    }
    const tr = n.tr!;
    const b = bottleneck(n.lambda!, n.mu!, n.muR!, tr);
    const end = Math.max(b.clear * 1.2, tr * 1.5);
    const ts = linspace(0, end, 60);
    const dep = (t: number) =>
      t <= tr
        ? Math.min(n.lambda!, n.muR!) * t
        : t <= b.clear
          ? Math.min(n.lambda!, n.muR!) * tr + n.mu! * (t - tr)
          : n.lambda! * t;
    return {
      answer: { key: 'transport.queue.answer', vars: { Q: b.queueMax, t: b.clear * 60, D: b.delay } },
      rows: [
        row('transport.r.queueMax', b.queueMax, 'veh'),
        row('transport.r.clear', b.clear * 60, 'min'),
        row('transport.r.delay', b.delay, 'veh·h'),
        row('transport.r.affected', b.vehicles, 'veh'),
      ],
      steps: [
        step('transport.queue.b1', { Q: b.queueMax }, `Q_{max} = (\\lambda - \\mu_r) t_r = ${tex(b.queueMax)}`),
        step('transport.queue.b2', { t: b.clear * 60 }, `t_c = t_r + \\frac{Q_{max}}{\\mu - \\lambda}`),
        step(
          'transport.queue.b3',
          { D: b.delay },
          `D = \\tfrac12 Q_{max}\\,t_c = ${tex(b.delay)}\\ \\mathrm{veh\\cdot h}`,
        ),
      ],
      latex: `D = ${tex(b.delay)}\\ \\mathrm{veh\\cdot h}`,
      plot: {
        title: 'transport.p.cumulative',
        x: 'transport.p.hours',
        y: 'transport.p.vehicles',
        series: [
          { name: 'transport.p.arrivals', points: ts.map((t) => [t, n.lambda! * t] as const) },
          { name: 'transport.p.departures', points: ts.map((t) => [t, dep(t)] as const), style: 'dashed' },
        ],
      },
    };
  },
};

const signalCalc: Calc = {
  id: 'signal',
  title: 'transport.signal.title',
  intro: 'transport.signal.intro',
  fields: [
    grid(
      'phases',
      'transport.f.phases',
      [
        ['transport.f.flowCol', 'vehicles'],
        ['transport.f.satCol', 'vehicles'],
      ],
      '600 1800\n450 1500',
      2,
    ),
    num('lost', 'transport.f.lost', '12', 'seconds'),
  ],
  solve({ n, rows }): Outcome {
    const ratios = rows.phases!.map(([q, sat]) => q! / sat!);
    const w = webster(ratios, n.lost!);
    const delays = rows.phases!.map(([q, sat], i) => websterDelay(q!, sat!, w.greens[i]!, w.C));
    return {
      answer: { key: 'transport.signal.answer', vars: { C: w.C } },
      rows: [row('transport.r.Y', w.Y), row('transport.r.C', w.C, 's')],
      steps: [
        step('transport.signal.s1', { Y: w.Y }, `Y = \\sum y_i = ${tex(w.Y)}`),
        step('transport.signal.s2', { C: w.C }, `C_0 = \\frac{1.5L + 5}{1 - Y} = ${tex(w.C)}\\ \\mathrm{s}`),
        step('transport.signal.s3', undefined, 'g_i = \\frac{y_i}{Y}(C_0 - L)'),
        step(
          'transport.signal.s4',
          undefined,
          'd = 0.9\\left[\\frac{C(1 - \\lambda)^2}{2(1 - \\lambda x)} + \\frac{x^2}{2q(1 - x)}\\right]',
        ),
      ],
      latex: `C_0 = ${tex(w.C)}\\ \\mathrm{s}`,
      grid: {
        caption: 'transport.g.phases',
        header: ['transport.g.phase', 'transport.g.y', 'transport.g.green', 'transport.g.x', 'transport.g.delay'],
        rows: ratios.map((y, i) => [i + 1, y, w.greens[i]!, delays[i]!.x, delays[i]!.total]),
      },
    };
  },
};

const geometryCalc: Calc = {
  id: 'geometry',
  title: 'transport.geo.title',
  fields: (choices) => [
    pick('mode', 'transport.f.find', [
      ['ssd', 'transport.o.ssd'],
      ['horizontal', 'transport.o.horizontal'],
      ['vertical', 'transport.o.vertical'],
    ]),
    ...(choices.mode === 'horizontal'
      ? [
          num('V', 'transport.f.V', '100', 'speed'),
          num('e', 'transport.f.e', '0.08'),
          num('f', 'transport.f.f', '0.12'),
          num('delta', 'transport.f.delta', '35', 'angle'),
          num('pi', 'transport.f.pi', '1500', 'length'),
          num('interval', 'transport.f.interval', '20', 'length'),
        ]
      : choices.mode === 'vertical'
        ? [
            pick('kind', 'transport.f.curve', [
              ['crest', 'transport.o.crest'],
              ['sag', 'transport.o.sag'],
            ]),
            num('A', 'transport.f.A', '4'),
            num('S', 'transport.f.S', '184.206', 'length'),
            num(
              'h1',
              choices.kind === 'sag' ? 'transport.f.headlight' : 'transport.f.h1',
              choices.kind === 'sag' ? '0.6' : '1.08',
              'length',
            ),
            num('h2', 'transport.f.h2', '0.6', 'length'),
          ]
        : [
            num('V', 'transport.f.V', '100', 'speed'),
            num('t', 'transport.f.t', '2.5', 'seconds'),
            num('a', 'transport.f.a', '3.4', 'accel'),
            num('G', 'transport.f.G', '0'),
          ]),
  ],
  solve({ n, s }): Outcome {
    if (s.mode === 'horizontal') {
      const R = minRadius(n.V!, n.e!, n.f!);
      const c = horizontalCurve(R, n.delta!, n.pi!);
      const defl = deflections(R, c.PC, c.PT, n.interval!);
      return {
        answer: { key: 'transport.geo.hAnswer', vars: { R, L: c.L } },
        rows: [
          row('transport.r.R', R, 'm'),
          row('transport.r.T', c.T, 'm'),
          row('transport.r.L', c.L, 'm'),
          row('transport.r.E', c.E, 'm'),
          row('transport.r.PC', c.PC, 'm'),
          row('transport.r.PT', c.PT, 'm'),
        ],
        steps: [
          step('transport.geo.h1', { R }, `R = \\frac{V^2}{127(e + f)} = ${tex(R)}\\ \\mathrm{m}`),
          step(
            'transport.geo.h2',
            { T: c.T, L: c.L },
            `T = R\\tan\\frac\\Delta2 = ${tex(c.T)},\\ L = R\\Delta = ${tex(c.L)}`,
          ),
          step('transport.geo.h3', { PC: c.PC, PT: c.PT }),
        ],
        latex: `R = ${tex(R)}\\ \\mathrm{m},\\ L = ${tex(c.L)}\\ \\mathrm{m}`,
        grid: {
          caption: 'transport.g.deflections',
          header: ['transport.g.station', 'transport.g.deflection'],
          rows: defl.map((d) => [d.station, d.angle]),
        },
      };
    }
    if (s.mode === 'vertical') {
      const kind = s.kind === 'sag' ? 'sag' : 'crest';
      const r = verticalCurve(kind, n.A!, n.S!, n.h1!, n.h2!);
      return {
        answer: { key: 'transport.geo.vAnswer', vars: { L: r.L, kind: `~transport.o.${kind}` } },
        rows: [row('transport.r.Lv', r.L, 'm'), row('transport.r.K', r.L / n.A!, 'm/%')],
        steps: [
          step(
            `transport.geo.v.${kind}`,
            { L: r.L },
            kind === 'crest'
              ? `L = \\frac{A S^2}{100\\left(\\sqrt{2h_1} + \\sqrt{2h_2}\\right)^2} = ${tex(r.L)}\\ \\mathrm{m}`
              : `L = \\frac{A S^2}{200(h + S\\tan\\beta)} = ${tex(r.L)}\\ \\mathrm{m}`,
          ),
          step(r.case === 'longer' ? 'transport.geo.longer' : 'transport.geo.shorter'),
        ],
        latex: `L = ${tex(r.L)}\\ \\mathrm{m}`,
      };
    }
    const d = stoppingSight(n.V!, n.t!, n.a!, n.G!);
    return {
      answer: { key: 'transport.geo.ssdAnswer', vars: { d } },
      rows: [row('transport.r.ssd', d, 'm'), row('transport.r.reaction', 0.278 * n.V! * n.t!, 'm')],
      steps: [
        step('transport.geo.s1', { d }, `SSD = 0.278\\,V t + \\frac{0.039\\,V^2}{a}` + ` = ${tex(d)}\\ \\mathrm{m}`),
      ],
      latex: `SSD = ${tex(d)}\\ \\mathrm{m}`,
      plot: {
        title: 'transport.p.ssd',
        x: 'transport.p.speed',
        y: 'transport.p.distance',
        series: [
          {
            name: 'transport.p.ssdSeries',
            points: linspace(20, 130, 40).map((V) => [V, stoppingSight(V, n.t!, n.a!, n.G!)] as const),
          },
        ],
      },
    };
  },
};

export const TRAFFIC_CALCS: readonly Calc[] = [flowCalc, queueCalc, signalCalc, geometryCalc];
