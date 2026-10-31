// The foundations tool's bearing capacity calculation.
import { num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Outcome } from '../core/types';
import { bearing } from './engine';
import type { BearingMethod, FootingShape } from './engine';

export const bearingCalc: Calc = {
  id: 'bearing',
  title: 'foundations.bearing.title',
  intro: 'foundations.bearing.intro',
  fields: (choices) => [
    pick('method', 'foundations.f.method', [
      ['vesic', 'foundations.o.vesic'],
      ['hansen', 'foundations.o.hansen'],
      ['meyerhof', 'foundations.o.meyerhof'],
      ['terzaghi', 'foundations.o.terzaghi'],
    ]),
    pick('shape', 'foundations.f.shape', [
      ['strip', 'foundations.o.strip'],
      ['square', 'foundations.o.square'],
      ['circle', 'foundations.o.circle'],
      ['rectangle', 'foundations.o.rectangle'],
    ]),
    num('B', 'foundations.f.B', '2', 'length'),
    ...(choices.shape === 'rectangle' ? [num('L', 'foundations.f.L', '3', 'length')] : []),
    num('Df', 'foundations.f.Df', '1', 'length'),
    num('gamma', 'foundations.f.gamma', '18', 'unitWeight'),
    num('gammaSat', 'foundations.f.gammaSat', '20', 'unitWeight'),
    num('c', 'foundations.f.c', '0', 'pressure'),
    num('phi', 'foundations.f.phi', '30', 'angle'),
    opt('zw', 'foundations.f.zwFooting', '', 'length'),
    ...(choices.method === 'terzaghi'
      ? []
      : [
          num('e', 'foundations.f.e', '0', 'length'),
          num('incline', 'foundations.f.incline', '0', 'angle'),
          pick('depth', 'foundations.f.depth', [
            ['off', 'foundations.o.off'],
            ['on', 'foundations.o.on'],
          ]),
        ]),
    num('FS', 'foundations.f.FS', '3'),
  ],
  solve({ n, o, s }): Outcome {
    const method = (s.method ?? 'vesic') as BearingMethod;
    const shape = (s.shape ?? 'strip') as FootingShape;
    const input = {
      method,
      shape,
      B: n.B!,
      L: n.L ?? n.B!,
      Df: n.Df!,
      gamma: n.gamma!,
      gammaSat: n.gammaSat!,
      c: n.c!,
      phi: n.phi!,
      zw: o.zw ?? Infinity,
      e: n.e ?? 0,
      incline: n.incline ?? 0,
      depthFactors: s.depth === 'on',
      FS: n.FS!,
    };
    const r = bearing(input);
    const fmt3 = (v: readonly [number, number, number]) => v.map((x) => tex(x)).join(',\\ ');
    const perLength = shape === 'strip';
    return {
      answer: { key: 'foundations.bearing.answer', vars: { qult: r.qult, qall: r.qall } },
      rows: [
        row('foundations.r.Nc', r.Nc),
        row('foundations.r.Nq', r.Nq),
        row('foundations.r.Ng', r.Ng),
        row('foundations.r.q', r.q, 'kPa'),
        row('foundations.r.qult', r.qult, 'kPa'),
        row('foundations.r.qall', r.qall, 'kPa'),
        row(perLength ? 'foundations.r.QultStrip' : 'foundations.r.Qult', r.Qult, perLength ? 'kN/m' : 'kN'),
        row(perLength ? 'foundations.r.QallStrip' : 'foundations.r.Qall', r.Qall, perLength ? 'kN/m' : 'kN'),
      ],
      steps: [
        step(
          `foundations.bearing.factors.${method}`,
          { Nc: r.Nc, Nq: r.Nq, Ng: r.Ng },
          method === 'terzaghi'
            ? `N_q = \\frac{e^{2(3\\pi/4 - \\phi/2)\\tan\\phi}}{2\\cos^2(45^\\circ + \\phi/2)}` +
                ` = ${tex(r.Nq)},\\ N_c = ${tex(r.Nc)},\\ N_\\gamma = ${tex(r.Ng)}`
            : `N_q = e^{\\pi\\tan\\phi}\\tan^2(45^\\circ + \\phi/2) = ${tex(r.Nq)},\\ N_c = (N_q - 1)\\cot\\phi` +
                ` = ${tex(r.Nc)},\\ N_\\gamma = ${tex(r.Ng)}`,
        ),
        step(`foundations.bearing.water${r.waterCase}`, { q: r.q, g: r.gBar }),
        ...(input.e > 0
          ? [step('foundations.bearing.eccentric', { Bp: r.Bp }, `B' = B - 2e = ${tex(r.Bp)}\\ \\mathrm{m}`)]
          : []),
        ...(method === 'terzaghi'
          ? []
          : [
              step('foundations.bearing.shape', undefined, `s_c, s_q, s_\\gamma = ${fmt3(r.s)}`),
              step('foundations.bearing.depthStep', undefined, `d_c, d_q, d_\\gamma = ${fmt3(r.d)}`),
              step('foundations.bearing.inclineStep', undefined, `i_c, i_q, i_\\gamma = ${fmt3(r.i)}`),
            ]),
        step(
          'foundations.bearing.terms',
          { c: r.terms[0], q: r.terms[1], g: r.terms[2] },
          `q_{ult} = c N_c F_c + q N_q F_q + \\tfrac12 \\gamma B' N_\\gamma F_\\gamma = ${tex(r.terms[0])}` +
            ` + ${tex(r.terms[1])} + ${tex(r.terms[2])} = ${tex(r.qult)}\\ \\mathrm{kPa}`,
        ),
        step(
          'foundations.bearing.allow',
          { qall: r.qall, FS: input.FS },
          `q_{all} = q_{ult}/FS = ${tex(r.qall)}\\ \\mathrm{kPa}`,
        ),
      ],
      latex:
        `q_{ult} = ${tex(r.terms[0])} + ${tex(r.terms[1])} + ${tex(r.terms[2])}` + ` = ${tex(r.qult)}\\ \\mathrm{kPa}`,
      notes:
        method === 'terzaghi'
          ? [{ key: 'foundations.bearing.terzaghiNote' }]
          : [{ key: 'foundations.bearing.generalNote' }],
      plot: {
        title: 'foundations.p.bearingB',
        x: 'foundations.p.B',
        y: 'foundations.p.qult',
        series: [
          {
            name: 'foundations.p.qult',
            points: linspace(Math.max(0.25, input.B / 4), input.B * 3, 40).flatMap((B) => {
              try {
                return [[B, bearing({ ...input, B, L: Math.max(input.L, B) }).qult] as const];
              } catch {
                return [];
              }
            }),
          },
          { name: 'foundations.p.design', points: [[input.B, r.qult] as const], style: 'points' },
        ],
      },
    };
  },
};
