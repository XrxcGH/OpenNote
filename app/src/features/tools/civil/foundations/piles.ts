// The foundations tool's pile calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc } from '../core/types';
import { groupEfficiency, pile } from './engine';

export const pileCalc: Calc = {
  id: 'pile',
  title: 'foundations.pile.title',
  intro: 'foundations.pile.intro',
  fields: (choices) => [
    pick('shape', 'foundations.f.pileShape', [
      ['round', 'foundations.o.round'],
      ['square', 'foundations.o.squarePile'],
    ]),
    num('D', 'foundations.f.D', '0.5', 'length'),
    grid(
      'layers',
      'foundations.f.pileLayers',
      [
        ['foundations.f.hCol', 'length'],
        ['foundations.f.gammaEffCol', 'unitWeight'],
        ['foundations.f.cuCol', 'pressure'],
        ['foundations.f.alphaCol'],
        ['foundations.f.betaCol'],
      ],
      '20 8 50 0.5 0',
    ),
    pick('tip', 'foundations.f.tip', [
      ['clay', 'foundations.o.tipClay'],
      ['sand', 'foundations.o.tipSand'],
    ]),
    ...(choices.tip === 'sand' ? [num('Nq', 'foundations.f.Nq', '40')] : []),
    num('FS', 'foundations.f.FS', '3'),
  ],
  solve({ n, s, rows }) {
    const tip = (s.tip ?? 'clay') as 'clay' | 'sand';
    const r = pile(
      (s.shape ?? 'round') as 'round' | 'square',
      n.D!,
      rows.layers!.map(([h, gammaEff, cu, alpha, beta]) => ({
        h: h!,
        gammaEff: gammaEff!,
        cu: cu!,
        alpha: alpha!,
        beta: beta!,
      })),
      tip,
      n.Nq ?? 0,
      n.FS!,
    );
    return {
      answer: { key: 'foundations.pile.answer', vars: { Qult: r.Qult, Qall: r.Qall } },
      rows: [
        row('foundations.r.Qs', r.Qs, 'kN'),
        row('foundations.r.Qb', r.Qb, 'kN'),
        row('foundations.r.QultPile', r.Qult, 'kN'),
        row('foundations.r.QallPile', r.Qall, 'kN'),
        row('foundations.r.perimeter', r.perimeter, 'm'),
        row('foundations.r.area', r.area, 'm²'),
      ],
      steps: [
        step('foundations.pile.s1', { p: r.perimeter, A: r.area }),
        step(
          'foundations.pile.s2',
          { Qs: r.Qs },
          `Q_s = \\sum (\\alpha c_u + \\beta \\sigma'_v)\\,p\\,\\Delta L = ${tex(r.Qs)}\\ \\mathrm{kN}`,
        ),
        step(
          tip === 'clay' ? 'foundations.pile.s3clay' : 'foundations.pile.s3sand',
          { Qb: r.Qb, sv: r.svTip },
          tip === 'clay'
            ? `Q_b = 9 c_u A_b = ${tex(r.Qb)}\\ \\mathrm{kN}`
            : `Q_b = \\sigma'_v N_q^* A_b = ${tex(r.Qb)}\\ \\mathrm{kN}`,
        ),
        step(
          'foundations.pile.s4',
          { Qult: r.Qult, Qall: r.Qall },
          `Q_{all} = \\frac{Q_s + Q_b}{FS} = ${tex(r.Qall)}\\ \\mathrm{kN}`,
        ),
      ],
      latex: `Q_{ult} = Q_s + Q_b = ${tex(r.Qs)} + ${tex(r.Qb)} = ${tex(r.Qult)}\\ \\mathrm{kN}`,
      plot: {
        title: 'foundations.p.friction',
        x: 'foundations.p.kPa',
        y: 'foundations.p.depth',
        yDown: true,
        series: [
          {
            name: 'foundations.p.unitFriction',
            points: r.layers.flatMap((l) => [[l.f, l.top] as const, [l.f, l.bottom] as const]),
          },
        ],
      },
      grid: {
        caption: 'foundations.g.pile',
        header: [
          'foundations.g.top',
          'foundations.g.bottom',
          'foundations.g.svMid',
          'foundations.g.f',
          'foundations.g.Qs',
        ],
        rows: r.layers.map((l) => [l.top, l.bottom, l.svMid, l.f, l.Qs]),
      },
    };
  },
};

export const groupCalc: Calc = {
  id: 'group',
  title: 'foundations.group.title',
  fields: [
    num('m', 'foundations.f.m', '3'),
    num('n', 'foundations.f.n', '4'),
    num('D', 'foundations.f.D', '0.4', 'length'),
    num('s', 'foundations.f.s', '1.2', 'length'),
    opt('Q1', 'foundations.f.Q1', '', 'force'),
  ],
  solve({ n, o }) {
    const g = groupEfficiency(n.m!, n.n!, n.D!, n.s!);
    const count = n.m! * n.n!;
    const Qg = o.Q1 === null ? null : g.E * count * o.Q1;
    const curve = linspace(1.5, 8, 40).map((ratio) => [ratio, groupEfficiency(n.m!, n.n!, 1, ratio).E] as const);
    return {
      answer: { key: 'foundations.group.answer', vars: { E: g.E } },
      rows: [
        row('foundations.r.thetaGroup', g.theta, '°'),
        row('foundations.r.E', g.E),
        ...(Qg === null ? [] : [row('foundations.r.Qg', Qg, 'kN')]),
      ],
      steps: [
        step('foundations.group.s1', { theta: g.theta }, `\\theta = \\tan^{-1}(D/s) = ${tex(g.theta)}^\\circ`),
        step(
          'foundations.group.s2',
          { E: g.E },
          `E_g = 1 - \\theta\\,\\frac{(n-1)m + (m-1)n}{90\\,m\\,n} = ${tex(g.E)}`,
        ),
        ...(Qg === null
          ? []
          : [step('foundations.group.s3', { Qg }, `Q_g = E_g\\,m\\,n\\,Q_1 = ${tex(Qg)}\\ \\mathrm{kN}`)]),
      ],
      latex: `E_g = ${tex(g.E)}`,
      plot: {
        title: 'foundations.p.group',
        x: 'foundations.p.sD',
        y: 'foundations.p.E',
        series: [
          { name: 'foundations.p.E', points: curve },
          { name: 'foundations.p.design', points: [[n.s! / n.D!, g.E] as const], style: 'points' },
        ],
      },
    };
  },
};
