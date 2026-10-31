// The foundations tool's slope stability calculations.
import { num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Series } from '../core/types';
import { culmann, ground, infiniteSlope, searchCircles, slipCircle, toeOf } from './engine';
import type { SlopeSoil, SlopeWater } from './engine';

export const infiniteCalc: Calc = {
  id: 'infinite',
  title: 'foundations.infinite.title',
  fields: [
    pick('water', 'foundations.f.water', [
      ['dry', 'foundations.o.dry'],
      ['submerged', 'foundations.o.submerged'],
      ['seepage', 'foundations.o.seepage'],
    ]),
    num('phi', 'foundations.f.phi', '35', 'angle'),
    num('beta', 'foundations.f.slope', '25', 'angle'),
    num('c', 'foundations.f.c', '0', 'pressure'),
    num('z', 'foundations.f.z', '2', 'length'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('gammaSat', 'foundations.f.gammaSat', '20', 'unitWeight'),
  ],
  solve({ n, s }) {
    const water = (s.water ?? 'dry') as SlopeWater;
    const r = infiniteSlope(n.phi!, n.beta!, n.c!, n.z!, n.gamma!, n.gammaSat!, water);
    const curve = linspace(Math.max(1, n.beta! / 4), Math.min(80, n.beta! * 2), 50).map(
      (b) => [b, infiniteSlope(n.phi!, b, n.c!, n.z!, n.gamma!, n.gammaSat!, water).FS] as const,
    );
    return {
      answer: { key: r.FS < 1 ? 'foundations.infinite.fails' : 'foundations.infinite.answer', vars: { FS: r.FS } },
      rows: [
        row('foundations.r.FS', r.FS),
        row('foundations.r.frictional', r.frictional),
        row('foundations.r.cohesive', r.cohesive),
      ],
      steps: [
        step(
          `foundations.infinite.${water}`,
          { f: r.frictional },
          water === 'seepage'
            ? `FS_\\phi = \\frac{\\gamma'}{\\gamma_{sat}}\\frac{\\tan\\phi'}{\\tan\\beta} = ${tex(r.frictional)}`
            : `FS_\\phi = \\frac{\\tan\\phi'}{\\tan\\beta} = ${tex(r.frictional)}`,
        ),
        ...(n.c! > 0
          ? [
              step(
                'foundations.infinite.cohesion',
                { f: r.cohesive },
                `FS_c = \\frac{c'}{\\gamma z \\cos^2\\beta \\tan\\beta} = ${tex(r.cohesive)}`,
              ),
            ]
          : []),
        step('foundations.infinite.total', { FS: r.FS }, `FS = ${tex(r.FS)}`),
      ],
      latex: `FS = ${tex(r.FS)}`,
      plot: {
        title: 'foundations.p.fsBeta',
        x: 'foundations.p.beta',
        y: 'foundations.p.FS',
        series: [
          { name: 'foundations.p.FS', points: curve },
          { name: 'foundations.p.design', points: [[n.beta!, r.FS] as const], style: 'points' },
        ],
      },
    };
  },
};

export const planarCalc: Calc = {
  id: 'planar',
  title: 'foundations.planar.title',
  fields: [
    num('H', 'foundations.f.H', '10', 'length'),
    num('beta', 'foundations.f.slope', '60', 'angle'),
    opt('theta', 'foundations.f.plane', '', 'angle'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('c', 'foundations.f.c', '20', 'pressure'),
    num('phi', 'foundations.f.phi', '20', 'angle'),
  ],
  solve({ n, o }) {
    const r = culmann(n.H!, n.beta!, n.c!, n.phi!, n.gamma!, o.theta ?? undefined);
    const lo = Math.max(1, n.phi! / 4);
    const curve = linspace(lo, n.beta! - 0.5, 60).map(
      (th) => [th, culmann(n.H!, n.beta!, n.c!, n.phi!, n.gamma!, th).FS] as const,
    );
    return {
      answer: { key: 'foundations.planar.answer', vars: { FS: r.FS, theta: r.theta } },
      rows: [
        row('foundations.r.theta', r.theta, '°'),
        row('foundations.r.W', r.W, 'kN/m'),
        row('foundations.r.L', r.L, 'm'),
        row('foundations.r.FS', r.FS),
        row('foundations.r.Hcr', r.Hcr, 'm'),
      ],
      steps: [
        ...(o.theta === null
          ? [
              step(
                'foundations.planar.critical',
                { theta: r.theta },
                `\\theta_{cr} = \\frac{\\beta + \\phi}{2} = ${tex(r.theta)}^\\circ`,
              ),
            ]
          : []),
        step(
          'foundations.planar.s1',
          { W: r.W },
          `W = \\tfrac12 \\gamma H^2 \\frac{\\sin(\\beta - \\theta)}{\\sin\\beta \\sin\\theta}` +
            ` = ${tex(r.W)}\\ \\mathrm{kN/m}`,
        ),
        step(
          'foundations.planar.s2',
          { FS: r.FS },
          `FS = \\frac{c L + W\\cos\\theta\\tan\\phi}{W\\sin\\theta} = ${tex(r.FS)}`,
        ),
        step(
          'foundations.planar.s3',
          { Hcr: r.Hcr },
          `H_{cr} = \\frac{4c\\sin\\beta\\cos\\phi}{\\gamma[1 - \\cos(\\beta - \\phi)]}` +
            ` = ${tex(r.Hcr)}\\ \\mathrm{m}`,
        ),
      ],
      latex: `FS = \\frac{c L + W\\cos\\theta\\tan\\phi}{W\\sin\\theta} = ${tex(r.FS)}`,
      plot: {
        title: 'foundations.p.fsTheta',
        x: 'foundations.p.theta',
        y: 'foundations.p.FS',
        series: [
          { name: 'foundations.p.FS', points: curve },
          { name: 'foundations.p.design', points: [[r.theta, r.FS] as const], style: 'points' },
        ],
      },
    };
  },
};

export const slicesCalc: Calc = {
  id: 'slices',
  title: 'foundations.slices.title',
  intro: 'foundations.slices.intro',
  fields: (choices) => [
    pick('mode', 'foundations.f.mode', [
      ['search', 'foundations.o.search'],
      ['circle', 'foundations.o.circle1'],
    ]),
    num('H', 'foundations.f.H', '10', 'length'),
    num('beta', 'foundations.f.slope', '30', 'angle'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('c', 'foundations.f.c', '15', 'pressure'),
    num('phi', 'foundations.f.phi', '25', 'angle'),
    num('ru', 'foundations.f.ru', '0'),
    num('slices', 'foundations.f.slices', '20'),
    ...(choices.mode === 'circle'
      ? [
          num('xc', 'foundations.f.xc', '5', 'length'),
          num('yc', 'foundations.f.yc', '18', 'length'),
          num('R', 'foundations.f.R', '19', 'length'),
        ]
      : [
          num('x0', 'foundations.f.x0', '0', 'length'),
          num('x1', 'foundations.f.x1', '15', 'length'),
          num('y0', 'foundations.f.y0', '12', 'length'),
          num('y1', 'foundations.f.y1', '25', 'length'),
          num('steps', 'foundations.f.steps', '8'),
        ]),
  ],
  solve({ n, s }) {
    const soil: SlopeSoil = { H: n.H!, beta: n.beta!, gamma: n.gamma!, c: n.c!, phi: n.phi!, ru: n.ru! };
    const count = Math.round(n.slices!);
    const search = s.mode !== 'circle';
    const found = search ? searchCircles(soil, [n.x0!, n.x1!], [n.y0!, n.y1!], Math.round(n.steps!), count) : null;
    const r = found ? found.best : slipCircle(soil, n.xc!, n.yc!, n.R!, count);
    const toe = toeOf(soil);
    const x1 = r.slices[0]!.x - r.slices[0]!.b / 2;
    const x2 = r.slices[r.slices.length - 1]!.x + r.slices[0]!.b / 2;
    const span = Math.max(toe, x2) - Math.min(0, x1);
    const groundLine = linspace(Math.min(0, x1) - span * 0.2, Math.max(toe, x2) + span * 0.2, 60).map(
      (x) => [x, ground(soil, x)] as const,
    );
    const arc = linspace(x1, x2, 60).map(
      (x) => [x, r.yc - Math.sqrt(Math.max(0, r.R ** 2 - (x - r.xc) ** 2))] as const,
    );
    const series: Series[] = [
      { name: 'foundations.p.ground', points: groundLine },
      { name: 'foundations.p.arc', points: arc, style: 'dashed' },
      ...(found
        ? [
            {
              name: 'foundations.p.centers',
              points: found.grid.filter((g) => Number.isFinite(g.FS)).map((g) => [g.xc, g.yc] as const),
              style: 'points' as const,
            },
          ]
        : []),
      { name: 'foundations.p.center', points: [[r.xc, r.yc] as const], style: 'points' },
    ];
    const driving = r.slices.reduce((sum, sl) => sum + sl.W * Math.sin((sl.alpha * Math.PI) / 180), 0);
    return {
      answer: {
        key: search ? 'foundations.slices.searchAnswer' : 'foundations.slices.answer',
        vars: { bishop: r.bishop, ordinary: r.ordinary, xc: r.xc, yc: r.yc, R: r.R },
      },
      rows: [
        row('foundations.r.bishop', r.bishop),
        row('foundations.r.ordinary', r.ordinary),
        row('foundations.r.xc', r.xc, 'm'),
        row('foundations.r.yc', r.yc, 'm'),
        row('foundations.r.R', r.R, 'm'),
        row('foundations.r.driving', driving, 'kN/m'),
      ],
      steps: [
        ...(search ? [step('foundations.slices.grid', { count: found!.grid.length })] : []),
        step(
          'foundations.slices.ordinaryStep',
          { FS: r.ordinary },
          `FS_{O} = \\frac{\\sum [c b \\sec\\alpha` +
            ` + (W\\cos\\alpha - u b \\sec\\alpha)\\tan\\phi]}{\\sum W \\sin\\alpha} = ${tex(r.ordinary)}`,
        ),
        step(
          'foundations.slices.bishopStep',
          { FS: r.bishop, count: r.iterations.length - 1 },
          `FS_{B} = \\frac{\\sum [c b + (W - u b)\\tan\\phi]/m_\\alpha}{\\sum W\\sin\\alpha},\\ m_\\alpha` +
            ` = \\cos\\alpha + \\frac{\\sin\\alpha\\tan\\phi}{FS}`,
        ),
        step('foundations.slices.iterations', { list: r.iterations.map((v) => v.toFixed(4)).join(', ') }),
        step('foundations.slices.result', { FS: r.bishop }, `FS_{B} = ${tex(r.bishop)}`),
      ],
      latex: `FS_{Bishop} = ${tex(r.bishop)},\\quad FS_{ordinary} = ${tex(r.ordinary)}`,
      notes: [{ key: 'foundations.slices.note' }],
      plot: {
        title: 'foundations.p.slope',
        x: 'foundations.p.xm',
        y: 'foundations.p.ym',
        equal: true,
        series,
      },
      grid: {
        caption: 'foundations.g.slices',
        header: [
          'foundations.g.xMid',
          'foundations.g.b',
          'foundations.g.h',
          'foundations.g.W',
          'foundations.g.alpha',
          'foundations.g.u',
          'foundations.g.ord',
          'foundations.g.bish',
        ],
        rows: r.slices.map((sl) => [sl.x, sl.b, sl.h, sl.W, sl.alpha, sl.u, sl.ordinary, sl.bishop]),
      },
    };
  },
};
