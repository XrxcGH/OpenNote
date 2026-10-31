// The soils tool's consolidation and shear strength calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { rad, tex } from '../core/format';
import { linspace, logspace } from '../core/num';
import type { Calc, Input, Outcome, Series } from '../core/types';
import {
  casagrande,
  degreeOf,
  directShear,
  failureStress,
  isochrone,
  preconsolidation,
  secondary,
  settlement,
  skempton,
  taylor,
  timeFactor,
  triaxial,
} from './engine';

export const timeFactorCalc: Calc = {
  id: 'timeFactor',
  title: 'soils.tv.title',
  fields: (choices) => [
    pick('mode', 'soils.f.find', [
      ['tv', 'soils.o.findTv'],
      ['u', 'soils.o.findU'],
    ]),
    ...((choices.mode ?? 'tv') === 'tv' ? [num('U', 'soils.f.U', '50', 'percent')] : [num('Tv', 'soils.f.Tv', '0.2')]),
  ],
  solve({ n, s }) {
    const findTv = (s.mode ?? 'tv') === 'tv';
    const Tv = findTv ? timeFactor(n.U! / 100).exact : n.Tv!;
    const U = findTv ? n.U! / 100 : degreeOf(Tv);
    const tf = U > 0 && U < 1 ? timeFactor(U) : null;
    const Z = linspace(0, 2, 41);
    const curves: Series[] = [0.05, 0.2, 0.5, Math.max(0.005, Tv)].map((T, i) => ({
      name: i === 3 ? 'soils.p.thisTv' : `soils.p.tv${i}`,
      points: Z.map((z) => [isochrone(z, T), z] as const),
    }));
    return {
      answer: { key: 'soils.tv.answer', vars: { U: 100 * U, Tv } },
      rows: [
        row('soils.r.U', 100 * U, '%'),
        row('soils.r.Tv', Tv),
        ...(tf ? [row('soils.r.TvApprox', tf.approx)] : []),
      ],
      steps: [
        step(
          'soils.tv.s1',
          { U: 100 * U, Tv },
          `U = 1 - \\sum_{m=0}^{\\infty} \\frac{2}{M^2} e^{-M^2 T_v},\\quad M = \\frac{\\pi}{2}(2m + 1)`,
        ),
        ...(tf
          ? [
              step(
                U < 0.6 ? 'soils.tv.s2' : 'soils.tv.s3',
                { Tv: tf.approx },
                U < 0.6
                  ? `T_v \\approx \\frac{\\pi}{4} U^2 = ${tex(tf.approx)}`
                  : `T_v \\approx 1.781 - 0.933\\log_{10}(100 - U\\%) = ${tex(tf.approx)}`,
              ),
            ]
          : []),
      ],
      latex: `T_v = ${tex(Tv)}\\ \\text{for}\\ U = ${tex(100 * U)}\\%`,
      grid: {
        caption: 'soils.tv.grid',
        header: ['soils.g.U', 'soils.g.Tv'],
        rows: [10, 20, 30, 40, 50, 60, 70, 80, 90, 95].map((u) => [u, timeFactor(u / 100).exact]),
      },
      plot: {
        title: 'soils.p.isochrones',
        x: 'soils.p.excess',
        y: 'soils.p.Z',
        yDown: true,
        series: curves,
      },
    };
  },
};

export const settlementCalc: Calc = {
  id: 'settlement',
  title: 'soils.settle.title',
  fields: [
    num('Cc', 'soils.f.Cc2', '0.3'),
    opt('Cr', 'soils.f.Cr', '0.05'),
    num('e0', 'soils.f.e0', '0.9'),
    num('H', 'soils.f.H', '4', 'length'),
    num('s0', 'soils.f.s0', '100', 'pressure'),
    num('ds', 'soils.f.ds', '50', 'pressure'),
    opt('sp', 'soils.f.sp', '', 'pressure'),
    opt('cv', 'soils.f.cv', '2', 'consolidation'),
    pick('drain', 'soils.f.drainage', [
      ['double', 'soils.o.double'],
      ['single', 'soils.o.single'],
    ]),
    opt('t', 'soils.f.tYears', '1', 'years'),
  ],
  solve({ n, o, s }) {
    const r = settlement({ Cc: n.Cc!, Cr: o.Cr!, e0: n.e0!, H: n.H!, s0: n.s0!, ds: n.ds!, sp: o.sp! });
    const Hdr = s.drain === 'single' ? n.H! : n.H! / 2;
    const cv = o.cv;
    const time = (Tv: number) => (cv === null ? null : (Tv * Hdr * Hdr) / cv!);
    const t50 = time(timeFactor(0.5).exact);
    const t90 = time(timeFactor(0.9).exact);
    const Ut = cv === null || o.t === null ? null : degreeOf((cv! * o.t!) / (Hdr * Hdr));
    const k = n.H! / (1 + n.e0!);
    const eq =
      r.case === 'nc'
        ? `S_c = \\frac{C_c H}{1 + e_0}\\log_{10}\\frac{\\sigma'_f}{\\sigma'_0}` +
          ` = \\frac{${tex(n.Cc!)} \\times ${tex(n.H!)}}{1` +
          ` + ${tex(n.e0!)}}\\log_{10}\\frac{${tex(r.sf)}}{${tex(n.s0!)}} = ${tex(r.S)}\\ \\mathrm{m}`
        : r.case === 'ocBelow'
          ? `S_c = \\frac{C_r H}{1 + e_0}\\log_{10}\\frac{\\sigma'_f}{\\sigma'_0} = ${tex(r.S)}\\ \\mathrm{m}`
          : `S_c = \\frac{H}{1 + e_0}\\left[C_r\\log_{10}\\frac{\\sigma'_p}{\\sigma'_0}` +
            ` + C_c\\log_{10}\\frac{\\sigma'_f}{\\sigma'_p}\\right] = ${tex(r.S)}\\ \\mathrm{m}`;
    const tEnd = t90 === null ? 0 : 2 * t90;
    return {
      answer: { key: 'soils.settle.answer', vars: { S: r.S * 1000 } },
      rows: [
        row('soils.r.Sc', r.S * 1000, 'mm'),
        row('soils.r.sf', r.sf, 'kPa'),
        row('soils.r.de', r.de),
        ...(t50 === null ? [] : [row('soils.r.t50', t50, 'yr'), row('soils.r.t90', t90!, 'yr')]),
        ...(Ut === null ? [] : [row('soils.r.Ut', 100 * Ut, '%'), row('soils.r.St', Ut * r.S * 1000, 'mm')]),
      ],
      steps: [
        step(`soils.settle.${r.case}`, { sf: r.sf, sp: o.sp ?? 0 }),
        step('soils.settle.s1', { S: r.S * 1000, k }, eq),
        ...(t50 === null
          ? []
          : [
              step(
                'soils.settle.s2',
                { Hdr, t50, t90: t90! },
                `t = \\frac{T_v H_{dr}^2}{c_v}:\\ t_{50} = ${tex(t50)},\\ t_{90} = ${tex(t90!)}\\ \\mathrm{yr}`,
              ),
            ]),
        ...(Ut === null ? [] : [step('soils.settle.s3', { t: o.t!, U: 100 * Ut, St: Ut * r.S * 1000 })]),
      ],
      latex: eq,
      ...(cv === null
        ? {}
        : {
            plot: {
              title: 'soils.p.settleTime',
              x: 'soils.p.years',
              y: 'soils.p.settlement',
              yDown: true,
              series: [
                {
                  name: 'soils.p.settleSeries',
                  points: linspace(0, tEnd, 60).map(
                    (t) => [t, 1000 * r.S * degreeOf((cv! * t) / (Hdr * Hdr))] as const,
                  ),
                },
              ],
            },
          }),
    };
  },
};

export const secondaryCalc: Calc = {
  id: 'secondary',
  title: 'soils.sec.title',
  fields: [
    num('Ca', 'soils.f.Ca', '0.01'),
    num('H', 'soils.f.H', '4', 'length'),
    num('ep', 'soils.f.ep', '0.85'),
    num('t1', 'soils.f.t1', '2', 'years'),
    num('t2', 'soils.f.t2', '20', 'years'),
  ],
  solve({ n }) {
    const S = secondary(n.Ca!, n.H!, n.ep!, n.t1!, n.t2!);
    const eq = `S_s = \\frac{C_\\alpha H}{1 + e_p}\\log_{10}\\frac{t_2}{t_1} = ${tex(S * 1000)}\\ \\mathrm{mm}`;
    return {
      answer: { key: 'soils.sec.answer', vars: { S: S * 1000 } },
      rows: [row('soils.r.Ss', S * 1000, 'mm')],
      steps: [step('soils.sec.s1', { S: S * 1000 }, eq)],
      latex: eq,
    };
  },
};

const READINGS =
  '0 0\n0.1 0.07\n0.25 0.11\n0.5 0.156\n1 0.22\n2 0.311\n4 0.44\n8 0.617\n15 0.802\n30 0.951\n60 0.997\n120 1.006\n' +
  '240 1.012\n480 1.018\n1440 1.028';

export const cvCalc: Calc = {
  id: 'cvFit',
  title: 'soils.cv.title',
  intro: 'soils.cv.intro',
  fields: (choices) => [
    pick('method', 'soils.f.method', [
      ['taylor', 'soils.o.taylor'],
      ['casagrande', 'soils.o.casagrande'],
    ]),
    grid(
      'data',
      'soils.f.readings',
      [
        ['soils.f.tCol', 'minutes'],
        ['soils.f.dial', 'dial'],
      ],
      READINGS,
      5,
    ),
    num('Hdr', 'soils.f.Hdr', '10', 'length', { unit: 'mm' }),
    (choices.method ?? 'taylor') === 'taylor' ? num('early', 'soils.f.early', '4') : num('late', 'soils.f.late', '4'),
  ],
  solve({ n, s, rows }) {
    const data = rows.data!;
    const H2 = n.Hdr! * n.Hdr!;
    const perYear = 365.25 * 1440;
    if ((s.method ?? 'taylor') === 'taylor') {
      const t = taylor(data, Math.round(n.early!));
      const cv = ((0.848 * H2) / t.t90) * perYear;
      const roots = data.map((r) => Math.sqrt(r[0]!));
      const top = Math.max(...roots);
      return {
        answer: { key: 'soils.cv.answer', vars: { cv } },
        rows: [row('soils.r.t90', t.t90, 'min'), row('soils.r.d0', t.d0, 'mm'), row('soils.r.cv', cv, 'm²/yr')],
        steps: [
          step('soils.cv.t1', { d0: t.d0 }),
          step('soils.cv.t2', { t90: t.t90 }),
          step('soils.cv.t3', { cv }, `c_v = \\frac{0.848\\,H_{dr}^2}{t_{90}} = ${tex(cv)}\\ \\mathrm{m^2/yr}`),
        ],
        latex: `c_v = \\frac{0.848\\,H_{dr}^2}{t_{90}} = ${tex(cv)}\\ \\mathrm{m^2/yr}`,
        notes: [{ key: 'soils.cv.approx' }],
        plot: {
          title: 'soils.p.taylor',
          x: 'soils.p.rootTime',
          y: 'soils.p.reading',
          yDown: t.slope > 0,
          series: [
            { name: 'soils.p.readings', points: data.map((r, i) => [roots[i]!, r[1]!] as const) },
            {
              name: 'soils.p.initial',
              points: [[0, t.d0] as const, [top / 2, t.d0 + (t.slope * top) / 2] as const],
              style: 'dashed',
            },
            { name: 'soils.p.line115', points: [[0, t.d0] as const, [top, t.d0 + (t.slope / 1.15) * top] as const] },
            { name: 'soils.p.t90', points: [[Math.sqrt(t.t90), t.d90] as const], style: 'points' },
          ],
        },
      };
    }
    const c = casagrande(data, Math.round(n.late!));
    const cv = ((0.197 * H2) / c.t50) * perYear;
    const positive = data.filter((r) => r[0]! > 0);
    return {
      answer: { key: 'soils.cv.answer', vars: { cv } },
      rows: [
        row('soils.r.t50', c.t50, 'min'),
        row('soils.r.d0', c.d0, 'mm'),
        row('soils.r.d100', c.d100, 'mm'),
        row('soils.r.cv', cv, 'm²/yr'),
      ],
      steps: [
        step('soils.cv.c1', { d0: c.d0 }),
        step('soils.cv.c2', { d100: c.d100 }),
        step('soils.cv.c3', { d50: c.d50, t50: c.t50 }),
        step('soils.cv.c4', { cv }, `c_v = \\frac{0.197\\,H_{dr}^2}{t_{50}} = ${tex(cv)}\\ \\mathrm{m^2/yr}`),
      ],
      latex: `c_v = \\frac{0.197\\,H_{dr}^2}{t_{50}} = ${tex(cv)}\\ \\mathrm{m^2/yr}`,
      notes: [{ key: 'soils.cv.approx' }],
      plot: {
        title: 'soils.p.casagrande',
        x: 'soils.p.time',
        y: 'soils.p.reading',
        xLog: true,
        yDown: c.d100 > c.d0,
        series: [
          { name: 'soils.p.readings', points: positive.map((r) => [r[0]!, r[1]!] as const) },
          { name: 'soils.p.t50', points: [[c.t50, c.d50] as const], style: 'points' },
          {
            name: 'soils.p.d100',
            points: [[positive[0]![0]!, c.d100] as const, [positive[positive.length - 1]![0]!, c.d100] as const],
            style: 'dashed',
          },
        ],
      },
    };
  },
};

export const preconCalc: Calc = {
  id: 'preconsolidation',
  title: 'soils.pc.title',
  intro: 'soils.pc.intro',
  fields: [
    grid(
      'data',
      'soils.f.elog',
      [['soils.f.sCol', 'pressure'], ['soils.f.eCol']],
      '25 1.0\n50 0.99\n100 0.975\n200 0.94\n400 0.83\n800 0.71\n1600 0.59',
      5,
    ),
    num('virgin', 'soils.f.virgin', '3'),
  ],
  solve({ n, rows }) {
    const data = rows.data!;
    const p = preconsolidation(data, Math.round(n.virgin!));
    const xs = data.map((r) => r[0]!);
    const hi = Math.max(...xs);
    const [sb, eb] = p.bend;
    const span = (from: number, to: number, slope: number, x0: number, y0: number) =>
      logspace(from, to, 12).map((s) => [s, y0 + slope * (Math.log10(s) - x0)] as const);
    return {
      answer: { key: 'soils.pc.answer', vars: { sp: p.sp } },
      rows: [row('soils.r.sp', p.sp, 'kPa'), row('soils.r.Cc', p.Cc), row('soils.r.Cr', p.Cr)],
      steps: [
        step('soils.pc.s1', { s: sb, e: eb }),
        step('soils.pc.s2', { slope: p.tangent, bisector: p.bisector }),
        step('soils.pc.s3', { Cc: p.Cc }, `e = ${tex(p.line.intercept)} - ${tex(p.Cc)}\\log_{10}\\sigma'`),
        step('soils.pc.s4', { sp: p.sp }, `\\sigma'_p = 10^{${tex(p.xp)}} = ${tex(p.sp)}\\ \\mathrm{kPa}`),
      ],
      latex: `\\sigma'_p \\approx ${tex(p.sp)}\\ \\mathrm{kPa},\\quad C_c = ${tex(p.Cc)}`,
      notes: [{ key: 'soils.pc.approx' }],
      plot: {
        title: 'soils.p.elog',
        x: 'soils.p.sEff',
        y: 'soils.p.e',
        xLog: true,
        series: [
          { name: 'soils.p.tests', points: data.map((r) => [r[0]!, r[1]!] as const) },
          {
            name: 'soils.p.virgin',
            points: span(Math.min(p.sp, sb) / 1.5, hi, -p.Cc, 0, p.line.intercept),
            style: 'dashed',
          },
          {
            name: 'soils.p.bisector',
            points: span(sb, Math.max(p.sp * 1.2, sb * 1.5), p.bisector, Math.log10(sb), eb),
          },
          { name: 'soils.p.spPoint', points: [[p.sp, p.line.intercept - p.Cc * p.xp] as const], style: 'points' },
        ],
      },
    };
  },
};

const circle = (s3: number, s1: number) => {
  const pc = (s1 + s3) / 2;
  const r = (s1 - s3) / 2;
  return linspace(0, Math.PI, 40).map((t) => [pc + r * Math.cos(t), r * Math.sin(t)] as const);
};
const envelope = (c: number, phiDeg: number, top: number) =>
  [
    [0, c],
    [top, c + top * Math.tan(rad(phiDeg))],
  ] as const;

/** The failure stress of a soil with known strength, with its Mohr circle. */
function predictOutcome(n: Input['n']): Outcome {
  const s1 = failureStress(n.c!, n.phi!, n.s3!);
  const tt = Math.tan(rad(45 + n.phi! / 2));
  const eq =
    `\\sigma_1 = \\sigma_3\\tan^2\\left(45 + \\frac{\\phi}{2}\\right) + 2c\\tan\\left(45` +
    ` + \\frac{\\phi}{2}\\right) = ${tex(s1)}\\ \\mathrm{kPa}`;
  return {
    answer: { key: 'soils.shear.predictAnswer', vars: { s1 } },
    rows: [row('soils.r.s1', s1, 'kPa'), row('soils.r.theta', 45 + n.phi! / 2, '°')],
    steps: [step('soils.shear.p1', { t: tt * tt }), step('soils.shear.p2', { s1 }, eq)],
    latex: eq,
    plot: {
      title: 'soils.p.mohr',
      x: 'soils.p.normal',
      y: 'soils.p.shear',
      equal: true,
      series: [
        { name: 'soils.p.circles', points: circle(n.s3!, s1) },
        { name: 'soils.p.envelope', points: envelope(n.c!, n.phi!, s1) },
      ],
    },
  };
}

export const shearCalc: Calc = {
  id: 'shear',
  title: 'soils.shear.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'triaxial';
    return [
      pick('mode', 'soils.f.test', [
        ['triaxial', 'soils.o.triaxial'],
        ['direct', 'soils.o.direct'],
        ['predict', 'soils.o.predict'],
      ]),
      ...(mode === 'triaxial'
        ? [
            grid(
              'data',
              'soils.f.failures',
              [
                ['soils.f.s3Col', 'pressure'],
                ['soils.f.s1Col', 'pressure'],
              ],
              '100 300\n200 500',
            ),
          ]
        : mode === 'direct'
          ? [
              grid(
                'data',
                'soils.f.shearData',
                [
                  ['soils.f.snCol', 'pressure'],
                  ['soils.f.tauCol', 'pressure'],
                ],
                '50 45\n100 74\n200 133',
                2,
              ),
            ]
          : [
              num('c', 'soils.f.c', '20', 'pressure'),
              num('phi', 'soils.f.phi', '30', 'angle'),
              num('s3', 'soils.f.s3', '100', 'pressure'),
            ]),
    ];
  },
  solve({ n, s, rows }): Outcome {
    const mode = s.mode ?? 'triaxial';
    if (mode === 'predict') return predictOutcome(n);
    const data = rows.data!;
    if (mode === 'direct') {
      const d = directShear(data);
      const top = Math.max(...data.map((r) => r[0]!)) * 1.1;
      return {
        answer: { key: 'soils.shear.answer', vars: { c: d.c, phi: d.phi } },
        rows: [row('soils.r.c', d.c, 'kPa'), row('soils.r.phi', d.phi, '°'), row('soils.r.r2', d.r2)],
        steps: [
          step(
            'soils.shear.d1',
            { c: d.c, phi: d.phi },
            `\\tau_f = c' + \\sigma' \\tan\\phi' = ${tex(d.c)} + \\sigma' \\tan ${tex(d.phi)}^\\circ`,
          ),
        ],
        latex: `c' = ${tex(d.c)}\\ \\mathrm{kPa},\\quad \\phi' = ${tex(d.phi)}^\\circ`,
        plot: {
          title: 'soils.p.direct',
          x: 'soils.p.normal',
          y: 'soils.p.shear',
          equal: true,
          series: [
            { name: 'soils.p.tests', points: data.map((r) => [r[0]!, r[1]!] as const), style: 'points' },
            { name: 'soils.p.envelope', points: envelope(d.c, d.phi, top) },
          ],
        },
      };
    }
    const t = triaxial(data);
    const top = Math.max(...data.map((r) => r[1]!));
    const circles = data.flatMap((r, i) => [...(i ? [[NaN, NaN] as const] : []), ...circle(r[0]!, r[1]!)]);
    return {
      answer: t.undrained
        ? { key: 'soils.shear.undrained', vars: { c: t.c } }
        : { key: 'soils.shear.answer', vars: { c: t.c, phi: t.phi } },
      rows: [row('soils.r.c', t.c, 'kPa'), row('soils.r.phi', t.phi, '°')],
      steps: t.undrained
        ? [step('soils.shear.u1', { c: t.c }, `s_u = \\frac{\\sigma_1 - \\sigma_3}{2} = ${tex(t.c)}\\ \\mathrm{kPa}`)]
        : [
            step('soils.shear.t1', { a: t.a, tanA: t.tanAlpha }, `q = ${tex(t.a)} + ${tex(t.tanAlpha)}\\,p`),
            step(
              'soils.shear.t2',
              { tanA: t.tanAlpha, phi: t.phi },
              `\\phi' = \\sin^{-1}(\\tan\\alpha) = ${tex(t.phi)}^\\circ`,
            ),
            step(
              'soils.shear.t3',
              { c: t.c },
              `c' = \\frac{a}{\\cos\\phi'} = \\frac{${tex(t.a)}}{\\cos ${tex(t.phi)}^\\circ}` +
                ` = ${tex(t.c)}\\ \\mathrm{kPa}`,
            ),
          ],
      latex: `c' = ${tex(t.c)}\\ \\mathrm{kPa},\\quad \\phi' = ${tex(t.phi)}^\\circ`,
      grid: {
        caption: 'soils.shear.grid',
        header: ['soils.g.s3', 'soils.g.s1', 'soils.g.p', 'soils.g.q'],
        rows: data.map((r, i) => [r[0]!, r[1]!, t.p[i]!, t.q[i]!]),
      },
      plot: {
        title: 'soils.p.mohr',
        x: 'soils.p.normal',
        y: 'soils.p.shear',
        equal: true,
        series: [
          { name: 'soils.p.circles', points: circles },
          { name: 'soils.p.envelope', points: envelope(t.c, t.phi, top) },
        ],
      },
    };
  },
};

export const skemptonCalc: Calc = {
  id: 'skempton',
  title: 'soils.skem.title',
  fields: [
    num('ds3', 'soils.f.ds3', '100', 'pressure'),
    num('du3', 'soils.f.du3', '98', 'pressure'),
    num('dsd', 'soils.f.dsd', '200', 'pressure'),
    num('dud', 'soils.f.dud', '60', 'pressure'),
  ],
  solve({ n }) {
    const k = skempton(n.ds3!, n.du3!, n.dsd!, n.dud!);
    return {
      answer: { key: 'soils.skem.answer', vars: { A: k.A, B: k.B } },
      rows: [row('soils.r.B', k.B), row('soils.r.A', k.A)],
      steps: [
        step('soils.skem.s1', { B: k.B }, `B = \\frac{\\Delta u_c}{\\Delta\\sigma_3} = ${tex(k.B)}`),
        step('soils.skem.s2', { A: k.A }, `A = \\frac{\\Delta u_d}{B\\,\\Delta\\sigma_d} = ${tex(k.A)}`),
      ],
      latex: `B = ${tex(k.B)},\\quad A = ${tex(k.A)}`,
      notes: [{ key: k.A > 0.7 ? 'soils.skem.soft' : k.A < 0 ? 'soils.skem.dense' : 'soils.skem.mid' }],
    };
  },
};
