// The process tool's separation calculations: vapor-liquid equilibrium, flash, McCabe-Thiele, shortcut
// distillation, and Kremser absorption and stripping.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import { need } from '../core/types';
import type { Calc, Field, Outcome } from '../core/types';
import { fenske, flash, gilliland, kremser, mccabeStages, minLiquid, underwood, vlePoint, xEq, yEq } from './engine';
import { minReflux, tableEquilibrium } from './equilibrium';

import type { ActivityModel, Antoine } from './engine';

const NIST = 'process.source.nist';

const modelFields = (choices: Readonly<Record<string, string>>): Field[] => [
  pick('model', 'process.f.model', [
    ['ideal', 'process.o.ideal'],
    ['margules', 'process.o.margules'],
    ['vanLaar', 'process.o.vanLaar'],
    ['wilson', 'process.o.wilson'],
  ]),
  ...(choices.model === 'wilson'
    ? [num('p12', 'process.f.L12', '0.5'), num('p21', 'process.f.L21', '0.7')]
    : choices.model === 'margules' || choices.model === 'vanLaar'
      ? [num('p12', 'process.f.A12', '0.5'), num('p21', 'process.f.A21', '0.3')]
      : []),
];

function readModel(n: Readonly<Record<string, number>>, model: string | undefined): ActivityModel {
  if (model === 'wilson') return { kind: 'wilson', L12: n.p12!, L21: n.p21! };
  if (model === 'margules') return { kind: 'margules', A12: n.p12!, A21: n.p21! };
  if (model === 'vanLaar') return { kind: 'vanLaar', A12: n.p12!, A21: n.p21! };
  return { kind: 'ideal' };
}

const vleCalc: Calc = {
  id: 'vle',
  title: 'process.vle.title',
  intro: 'process.vle.intro',
  fields: (choices) => [
    pick('kind', 'process.f.point', [
      ['bubble', 'process.o.bubble'],
      ['dew', 'process.o.dew'],
    ]),
    pick('fixed', 'process.f.fixed', [
      ['P', 'process.o.fixedP'],
      ['T', 'process.o.fixedT'],
    ]),
    choices.fixed === 'T' ? num('T', 'process.f.T', '365', 'kelvin') : num('P', 'process.f.P', '1.01325', 'vapor'),
    num('z', choices.kind === 'dew' ? 'process.f.y1' : 'process.f.x1', '0.5'),
    num('A1', 'process.f.A1', '4.01814'),
    num('B1', 'process.f.B1', '1203.835'),
    num('C1', 'process.f.C1', '-53.226'),
    num('A2', 'process.f.A2', '4.07827'),
    num('B2', 'process.f.B2', '1343.943'),
    num('C2', 'process.f.C2', '-53.773'),
    ...modelFields(choices),
  ],
  solve({ n, s }): Outcome {
    const c1: Antoine = { A: n.A1!, B: n.B1!, C: n.C1! };
    const c2: Antoine = { A: n.A2!, B: n.B2!, C: n.C2! };
    const model = readModel(n, s.model);
    const kind = s.kind === 'dew' ? 'dew' : 'bubble';
    const fixed = s.fixed === 'T' ? 'T' : 'P';
    const value = fixed === 'T' ? n.T! : n.P!;
    const r = vlePoint(kind, fixed, value, n.z!, c1, c2, model);
    const xs = linspace(0, 1, 41);
    const curve = xs.map((x) => vlePoint('bubble', fixed, value, x, c1, c2, model));
    const pick2 = (b: { T: number; P: number }) => (fixed === 'T' ? b.P : b.T);
    return {
      answer: {
        key: fixed === 'T' ? `process.vle.answerP.${kind}` : `process.vle.answerT.${kind}`,
        vars: { P: r.P, T: r.T, x: r.x1, y: r.y1 },
      },
      rows: [
        row('process.r.T', r.T, 'K'),
        row('process.r.P', r.P, 'bar'),
        row('process.r.x1', r.x1),
        row('process.r.y1', r.y1),
        row('process.r.P1', r.Psat[0], 'bar'),
        row('process.r.P2', r.Psat[1], 'bar'),
        row('process.r.g1', r.gamma[0]),
        row('process.r.g2', r.gamma[1]),
      ],
      steps: [
        step('process.vle.s1', { P1: r.Psat[0], P2: r.Psat[1], T: r.T }, `\\log_{10} P^{sat} = A - \\frac{B}{T + C}`),
        ...(model.kind === 'ideal' ? [] : [step('process.vle.gammas', { g1: r.gamma[0], g2: r.gamma[1] })]),
        step(
          'process.vle.s2',
          { P: r.P },
          `P = x_1 \\gamma_1 P_1^{sat} + x_2 \\gamma_2 P_2^{sat} = ${tex(r.P)}\\ \\mathrm{bar}`,
        ),
        step('process.vle.s3', { y: r.y1 }, `y_1 = \\frac{x_1 \\gamma_1 P_1^{sat}}{P} = ${tex(r.y1)}`),
      ],
      latex:
        `T = ${tex(r.T)}\\ \\mathrm{K},\\ P = ${tex(r.P)}\\ \\mathrm{bar},\\ x_1 = ${tex(r.x1)},\\ y_1` +
        ` = ${tex(r.y1)}`,
      source: NIST,
      plot: {
        title: fixed === 'T' ? 'process.p.Pxy' : 'process.p.Txy',
        x: 'process.p.x1',
        y: fixed === 'T' ? 'process.p.P' : 'process.p.T',
        series: [
          { name: 'process.p.bubble', points: curve.map((b) => [b.x1, pick2(b)] as const) },
          { name: 'process.p.dew', points: curve.map((b) => [b.y1, pick2(b)] as const), style: 'dashed' },
          { name: 'process.p.point', points: [[r.x1, pick2(r)] as const, [r.y1, pick2(r)] as const], style: 'points' },
        ],
      },
    };
  },
};

const flashCalc: Calc = {
  id: 'flash',
  title: 'process.flash.title',
  fields: [
    grid('data', 'process.f.flashData', [['process.f.zCol'], ['process.f.KCol']], '0.5 2\n0.5 0.5', 2),
    opt('F', 'process.f.feed', ''),
  ],
  solve({ o, rows }): Outcome {
    const z = rows.data!.map((r) => r[0]!);
    const K = rows.data!.map((r) => r[1]!);
    const f = flash(z, K);
    const F = o.F;
    const Vs = linspace(0, 1, 41);
    return {
      answer: { key: `process.flash.answer.${f.state}`, vars: { V: f.V } },
      rows: [
        row('process.r.VF', f.V),
        row('process.r.LF', f.L),
        ...(F === null ? [] : [row('process.r.Vflow', F * f.V), row('process.r.Lflow', F * f.L)]),
      ],
      steps: [
        step('process.flash.s1', undefined, `\\sum_i \\frac{z_i (K_i - 1)}{1 + \\frac{V}{F}(K_i - 1)} = 0`),
        step('process.flash.s2', { V: f.V }),
        step('process.flash.s3', undefined, `x_i = \\frac{z_i}{1 + \\frac{V}{F}(K_i - 1)},\\quad y_i = K_i x_i`),
      ],
      latex: `\\frac{V}{F} = ${tex(f.V)}`,
      plot: {
        title: 'process.p.rr',
        x: 'process.p.VF',
        y: 'process.p.rrAxis',
        series: [
          {
            name: 'process.p.rrSeries',
            points: Vs.map(
              (V) => [V, z.reduce((s, zi, i) => s + (zi * (K[i]! - 1)) / (1 + V * (K[i]! - 1)), 0)] as const,
            ),
          },
          { name: 'process.p.point', points: [[f.V, 0] as const], style: 'points' },
        ],
      },
      grid: {
        caption: 'process.g.flash',
        header: ['process.g.component', 'process.g.z', 'process.g.K', 'process.g.x', 'process.g.y'],
        rows: z.map((zi, i) => [i + 1, zi, K[i]!, f.x[i]!, f.y[i]!]),
      },
    };
  },
};

// Benzene-toluene at 1 atm, as tabulated in McCabe, Smith, and Harriott.
const BENZENE_TOLUENE = '0.1 0.21\n0.2 0.37\n0.3 0.51\n0.4 0.62\n0.5 0.71\n0.6 0.79\n0.7 0.86\n0.8 0.91\n0.9 0.96';

const DIST_FIELDS = [
  num('alpha', 'process.f.alpha', '2.25'),
  num('xD', 'process.f.xD', '0.95'),
  num('xB', 'process.f.xB', '0.05'),
  num('zF', 'process.f.zF', '0.5'),
  num('q', 'process.f.q', '1'),
];

const mccabeCalc: Calc = {
  id: 'mccabe',
  title: 'process.mt.title',
  intro: 'process.mt.intro',
  fields: (choices) => [
    pick('eqFrom', 'process.f.eqFrom', [
      ['alpha', 'process.o.eqAlpha'],
      ['table', 'process.o.eqTable'],
    ]),
    ...(choices.eqFrom === 'table'
      ? [grid('eq', 'process.f.eqTable', [['process.f.xCol'], ['process.f.yCol']], BENZENE_TOLUENE, 2)]
      : [DIST_FIELDS[0]!]),
    ...DIST_FIELDS.slice(1),
    num('Rfactor', 'process.f.Rfactor', '1.5'),
  ],
  solve({ n, s, rows }): Outcome {
    const table = s.eqFrom === 'table' ? tableEquilibrium(rows.eq!) : null;
    if (!table) need(n.alpha! > 1, 'process.errors.alpha');
    const eq = table ?? { y: (x: number) => yEq(n.alpha!, x), x: (y: number) => xEq(n.alpha!, y) };
    const Rmin = table ? minReflux(table, n.xD!, n.zF!, n.q!) : underwood(n.alpha!, n.xD!, n.zF!, n.q!).Rmin;
    const R = n.Rfactor! * Rmin;
    const m = mccabeStages(eq, Rmin, n.xD!, n.xB!, n.zF!, n.q!, R);
    const stairs: [number, number][] = [[n.xD!, n.xD!]];
    for (const st of m.stages) {
      stairs.push([st.x, st.y]);
      const next =
        st.x >= m.xi
          ? (R / (R + 1)) * st.x + n.xD! / (R + 1)
          : n.xB! + ((m.yi - n.xB!) / (m.xi - n.xB!)) * (st.x - n.xB!);
      stairs.push([st.x, Math.max(st.x, next)]);
    }
    stairs.pop();
    return {
      answer: { key: 'process.mt.answer', vars: { N: m.N, feed: m.feedStage, R } },
      rows: [
        row('process.r.N', m.N),
        row('process.r.feedStage', m.feedStage),
        row('process.r.R', R),
        row('process.r.Rmin', Rmin),
      ],
      steps: [
        step(table ? 'process.mt.s1Table' : 'process.mt.s1', { R, Rmin }, `R = ${tex(n.Rfactor!)} R_{min} = ${tex(R)}`),
        step(
          'process.mt.s2',
          undefined,
          `y = \\frac{R}{R + 1} x + \\frac{x_D}{R + 1},\\quad y = \\frac{q}{q - 1} x - \\frac{z_F}{q - 1}`,
        ),
        step('process.mt.s3', { xi: m.xi, yi: m.yi }),
        ...m.stages.map((st, i) => step('process.mt.stage', { i: i + 1, x: st.x, y: st.y })),
        step('process.mt.s4', { N: m.N, feed: m.feedStage }),
      ],
      latex: `N = ${m.N},\\quad N_{feed} = ${m.feedStage},\\quad R = ${tex(R)}`,
      notes: [{ key: 'process.mt.note' }],
      plot: {
        title: 'process.p.mt',
        x: 'process.p.x',
        y: 'process.p.y',
        equal: true,
        series: [
          {
            name: 'process.p.equilibrium',
            points: table ? table.points : linspace(0, 1, 60).map((x) => [x, eq.y(x)] as const),
          },
          { name: 'process.p.diagonal', points: [[0, 0] as const, [1, 1] as const], style: 'dashed' },
          {
            name: 'process.p.operating',
            points: [[n.xB!, n.xB!] as const, [m.xi, m.yi] as const, [n.xD!, n.xD!] as const],
          },
          { name: 'process.p.stages', points: stairs },
        ],
      },
      grid: {
        caption: 'process.g.stages',
        header: ['process.g.stage', 'process.g.x', 'process.g.y'],
        rows: m.stages.map((st, i) => [i + 1, st.x, st.y]),
      },
    };
  },
};

const shortcutCalc: Calc = {
  id: 'shortcut',
  title: 'process.short.title',
  fields: [...DIST_FIELDS, num('Rfactor', 'process.f.Rfactor', '1.5')],
  solve({ n }): Outcome {
    const Nmin = fenske(n.alpha!, n.xD!, n.xB!);
    const u = underwood(n.alpha!, n.xD!, n.zF!, n.q!);
    const R = n.Rfactor! * u.Rmin;
    const g = gilliland(Nmin, u.Rmin, R);
    return {
      answer: { key: 'process.short.answer', vars: { Nmin, Rmin: u.Rmin, N: g.N } },
      rows: [
        row('process.r.Nmin', Nmin),
        row('process.r.theta', u.theta),
        row('process.r.Rmin', u.Rmin),
        row('process.r.R', R),
        row('process.r.Ngill', g.N),
      ],
      steps: [
        step(
          'process.short.s1',
          { Nmin },
          `N_{min} = \\frac{\\ln\\left[\\frac{x_D}{1 - x_D}\\cdot\\frac{1 - x_B}{x_B}\\right]}{\\ln\\alpha}` +
            ` = ${tex(Nmin)}`,
        ),
        step(
          'process.short.s2',
          { theta: u.theta, Rmin: u.Rmin },
          `\\frac{\\alpha z_F}{\\alpha - \\theta} + \\frac{1 - z_F}{1 - \\theta} = 1 - q,\\quad R_{min}` +
            ` = ${tex(u.Rmin)}`,
        ),
        step(
          'process.short.s3',
          { X: g.X, Y: g.Y, N: g.N },
          `Y = 0.75\\left(1 - X^{0.5668}\\right),\\quad N = \\frac{N_{min} + Y}{1 - Y} = ${tex(g.N)}`,
        ),
      ],
      latex: `N_{min} = ${tex(Nmin)},\\ R_{min} = ${tex(u.Rmin)},\\ N = ${tex(g.N)}`,
      notes: [{ key: 'process.short.note' }],
      plot: {
        title: 'process.p.gilliland',
        x: 'process.p.Rratio',
        y: 'process.p.N',
        series: [
          {
            name: 'process.p.N',
            points: linspace(1.05, 4, 40).map((f) => [f, gilliland(Nmin, u.Rmin, f * u.Rmin).N] as const),
          },
          { name: 'process.p.point', points: [[n.Rfactor!, g.N] as const], style: 'points' },
        ],
      },
    };
  },
};

const kremserCalc: Calc = {
  id: 'kremser',
  title: 'process.kr.title',
  intro: 'process.kr.intro',
  fields: (choices) => [
    pick('kind', 'process.f.column', [
      ['absorb', 'process.o.absorb'],
      ['strip', 'process.o.strip'],
    ]),
    num('m', 'process.f.m', '1'),
    num('ratio', choices.kind === 'strip' ? 'process.f.VL' : 'process.f.LG', '1.5'),
    num('inlet', choices.kind === 'strip' ? 'process.f.xIn' : 'process.f.yIn', '0.05'),
    num('outlet', choices.kind === 'strip' ? 'process.f.xOut' : 'process.f.yOut', '0.005'),
    num('other', choices.kind === 'strip' ? 'process.f.yInStrip' : 'process.f.xInAbs', '0'),
  ],
  solve({ n, s }): Outcome {
    const kind = s.kind === 'strip' ? 'strip' : 'absorb';
    const factor = kind === 'absorb' ? n.ratio! / n.m! : n.m! * n.ratio!;
    const N = kremser(kind, factor, n.inlet!, n.outlet!, n.other!, n.m!);
    const lmin = kind === 'absorb' ? minLiquid(n.inlet!, n.outlet!, n.other!, n.m!) : null;
    return {
      answer: { key: `process.kr.answer.${kind}`, vars: { N, f: factor } },
      rows: [
        row(kind === 'absorb' ? 'process.r.A' : 'process.r.S', factor),
        row('process.r.Nk', N),
        ...(lmin === null ? [] : [row('process.r.LGmin', lmin)]),
      ],
      steps: [
        step(kind === 'absorb' ? 'process.kr.s1a' : 'process.kr.s1s', { f: factor }),
        step(
          'process.kr.s2',
          { N },
          kind === 'absorb'
            ? `N = \\frac{\\ln\\left[\\frac{y_{in} - m x_{in}}{y_{out} - m x_{in}}\\left(1 - \\frac1A\\right)` +
                ` + \\frac1A\\right]}{\\ln A} = ${tex(N)}`
            : `N = \\frac{\\ln\\left[\\frac{x_{in} - y_{in}/m}{x_{out} - y_{in}/m}\\left(1 - \\frac1S\\right)` +
                ` + \\frac1S\\right]}{\\ln S} = ${tex(N)}`,
        ),
        ...(lmin === null
          ? []
          : [
              step(
                'process.kr.s3',
                { L: lmin },
                `\\left(\\frac{L}{G}\\right)_{min} = \\frac{y_{in} - y_{out}}{y_{in}/m - x_{in}} = ${tex(lmin)}`,
              ),
            ]),
      ],
      latex: `N = ${tex(N)}`,
    };
  },
};

export const SEPARATION_CALCS: readonly Calc[] = [vleCalc, flashCalc, mccabeCalc, shortcutCalc, kremserCalc];
