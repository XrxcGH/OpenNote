// The soils tool's phase relation, gradation, limit, and classification calculations.
import { grid, num, opt, row, step } from '../core/calc';
import { tex } from '../core/format';
import { logspace } from '../core/num';
import type { Calc, KitStep, Msg, Outcome } from '../core/types';
import { aLine, aashto, flowCurve, gradation, hydrometer, indices, phases, uLine, uscs } from './engine';

const GW = (initial = '9.81') => num('gw', 'soils.f.gw', initial, 'unitWeight');
const pct = (v: number | null) => (v === null ? null : v / 100);
const box = (y0: number, y1: number): [number, number][] => [
  [0, y0],
  [1, y0],
  [1, y1],
  [0, y1],
  [0, y0],
];

export const phasesCalc: Calc = {
  id: 'phases',
  title: 'soils.phases.title',
  intro: 'soils.phases.intro',
  fields: [
    num('Gs', 'soils.f.Gs', '2.7'),
    GW(),
    opt('e', 'soils.f.e', '0.6'),
    opt('n', 'soils.f.n', ''),
    opt('w', 'soils.f.w', '', 'percent'),
    opt('S', 'soils.f.S', '100', 'percent'),
    opt('gamma', 'soils.f.gamma', '', 'unitWeight'),
    opt('gammaD', 'soils.f.gammaD', '', 'unitWeight'),
  ],
  solve({ n, o }) {
    const Gs = n.Gs!;
    const gw = n.gw!;
    const p = phases(Gs, { e: o.e, n: o.n, w: pct(o.w!), S: pct(o.S!), gamma: o.gamma, gammaD: o.gammaD }, gw);
    const first: KitStep =
      p.route === 'void'
        ? o.e !== null
          ? step('soils.phases.sE', { e: p.e })
          : o.n !== null
            ? step(
                'soils.phases.sN',
                { e: p.e },
                `e = \\frac{n}{1-n} = \\frac{${tex(o.n!)}}{1-${tex(o.n!)}} = ${tex(p.e)}`,
              )
            : step(
                'soils.phases.sGd',
                { e: p.e },
                `e = \\frac{G_s\\gamma_w}{\\gamma_d} - 1` +
                  ` = \\frac{${tex(Gs)} \\times ${tex(gw)}}{${tex(o.gammaD!)}} - 1 = ${tex(p.e)}`,
              )
        : p.route === 'wS'
          ? step('soils.phases.sWS', { e: p.e }, `e = \\frac{w G_s}{S} = ${tex(p.e)}`)
          : p.route === 'wGamma'
            ? step('soils.phases.sWG', { e: p.e }, `e = \\frac{G_s (1+w)\\gamma_w}{\\gamma} - 1 = ${tex(p.e)}`)
            : step(
                'soils.phases.sSG',
                { e: p.e },
                `e = \\frac{G_s\\gamma_w - \\gamma}{\\gamma - S\\gamma_w} = ${tex(p.e)}`,
              );
    return {
      answer: { key: 'soils.phases.answer', vars: { e: p.e, w: 100 * p.w, gamma: p.gamma } },
      rows: [
        row('soils.r.e', p.e),
        row('soils.r.n', p.n),
        row('soils.r.w', 100 * p.w, '%'),
        row('soils.r.S', 100 * p.S, '%'),
        row('soils.r.gamma', p.gamma, 'kN/m³'),
        row('soils.r.gammaD', p.gammaD, 'kN/m³'),
        row('soils.r.gammaSat', p.gammaSat, 'kN/m³'),
        row('soils.r.gammaSub', p.gammaSub, 'kN/m³'),
      ],
      steps: [
        first,
        step('soils.phases.s2', { S: 100 * p.S, n: p.n }, `n = \\frac{e}{1+e} = ${tex(p.n)}`),
        step('soils.phases.s3', { w: 100 * p.w }, `w = \\frac{S e}{G_s} = ${tex(p.w)}`),
        step(
          'soils.phases.s4',
          { gamma: p.gamma, gammaD: p.gammaD },
          `\\gamma = \\frac{(G_s + S e)\\gamma_w}{1+e} = ${tex(p.gamma)},\\quad \\gamma_d` +
            ` = \\frac{G_s \\gamma_w}{1+e} = ${tex(p.gammaD)}\\ \\mathrm{kN/m^3}`,
        ),
      ],
      latex:
        `e = ${tex(p.e)},\\ n = ${tex(p.n)},\\ w = ${tex(100 * p.w)}\\%,\\ \\gamma` +
        ` = ${tex(p.gamma)}\\ \\mathrm{kN/m^3}`,
      grid: {
        caption: 'soils.phases.grid',
        header: ['soils.g.phase', 'soils.g.volume', 'soils.g.weight'],
        rows: [
          ['~soils.g.solids', p.Vs, Gs * gw * p.Vs],
          ['~soils.g.water', p.Vw, gw * p.Vw],
          ['~soils.g.air', p.Va, 0],
        ],
      },
      plot: {
        title: 'soils.p.phases',
        x: 'soils.p.width',
        y: 'soils.p.volume',
        equal: true,
        series: [
          { name: 'soils.g.solids', points: box(0, p.Vs) },
          { name: 'soils.g.water', points: box(p.Vs, p.Vs + p.Vw) },
          ...(p.Va > 1e-9 ? [{ name: 'soils.g.air', points: box(p.Vs + p.Vw, 1) }] : []),
        ],
      },
    };
  },
};

const SIEVE = '4.75 100\n2 92\n0.85 74\n0.425 48\n0.25 31\n0.15 18\n0.075 7';

export const gradationCalc: Calc = {
  id: 'gradation',
  title: 'soils.grad.title',
  fields: [
    grid(
      'data',
      'soils.f.sieve',
      [
        ['soils.f.size', 'grain'],
        ['soils.f.passing', 'percent'],
      ],
      SIEVE,
      2,
    ),
  ],
  solve({ rows }): Outcome {
    const data = rows.data!;
    const g = gradation(data);
    const notes: Msg[] = [];
    if (g.D10 === null) notes.push({ key: 'soils.grad.noD10' });
    return {
      answer:
        g.Cu !== null && g.Cc !== null
          ? { key: 'soils.grad.answer', vars: { Cu: g.Cu, Cc: g.Cc } }
          : { key: 'soils.grad.partial', vars: { D60: g.D60 ?? '—' } },
      rows: [
        ...(g.D10 !== null ? [row('soils.r.D10', g.D10, 'mm')] : []),
        ...(g.D30 !== null ? [row('soils.r.D30', g.D30, 'mm')] : []),
        ...(g.D60 !== null ? [row('soils.r.D60', g.D60, 'mm')] : []),
        ...(g.Cu !== null ? [row('soils.r.Cu', g.Cu)] : []),
        ...(g.Cc !== null ? [row('soils.r.Cc', g.Cc)] : []),
        ...(g.gravel !== null ? [row('soils.r.gravel', g.gravel, '%')] : []),
        ...(g.sand !== null ? [row('soils.r.sand', g.sand, '%')] : []),
        ...(g.fines !== null ? [row('soils.r.fines', g.fines, '%')] : []),
      ],
      steps: [
        step('soils.grad.s1'),
        ...(g.Cu !== null && g.Cc !== null
          ? [
              step(
                'soils.grad.s2',
                { Cu: g.Cu },
                `C_u = \\frac{D_{60}}{D_{10}} = \\frac{${tex(g.D60!)}}{${tex(g.D10!)}} = ${tex(g.Cu)}`,
              ),
              step(
                'soils.grad.s3',
                { Cc: g.Cc },
                `C_c = \\frac{D_{30}^2}{D_{10} D_{60}}` +
                  ` = \\frac{${tex(g.D30!)}^2}{${tex(g.D10!)} \\times ${tex(g.D60!)}} = ${tex(g.Cc)}`,
              ),
            ]
          : []),
      ],
      ...(g.Cu !== null && g.Cc !== null ? { latex: `C_u = ${tex(g.Cu)},\\quad C_c = ${tex(g.Cc)}` } : {}),
      notes,
      plot: {
        title: 'soils.p.grading',
        x: 'soils.p.size',
        y: 'soils.p.passing',
        xLog: true,
        series: [
          {
            name: 'soils.p.curve',
            points: [...data].sort((a, b) => a[0]! - b[0]!).map((r) => [r[0]!, r[1]!] as const),
          },
          { name: 'soils.p.sieves', points: data.map((r) => [r[0]!, r[1]!] as const), style: 'points' },
        ],
      },
    };
  },
};

export const hydrometerCalc: Calc = {
  id: 'hydrometer',
  title: 'soils.hydro.title',
  intro: 'soils.hydro.intro',
  fields: [
    num('Gs', 'soils.f.Gs', '2.65'),
    num('mu', 'soils.f.mu', '1.002', 'viscosity', { unit: 'mPa·s' }),
    num('L', 'soils.f.Leff', '10', 'length', { unit: 'cm' }),
    num('t', 'soils.f.time', '60', 'seconds'),
    num('rho', 'soils.f.rhoW', '1000', 'density'),
    opt('R', 'soils.f.reading', '30'),
    opt('Ws', 'soils.f.Ws', '50'),
  ],
  solve({ n, o }): Outcome {
    const h = hydrometer(n.Gs!, n.mu!, n.L!, n.t!, n.rho!, o.R, o.Ws);
    return {
      answer:
        h.finer === null
          ? { key: 'soils.hydro.answer', vars: { D: h.D } }
          : { key: 'soils.hydro.answerFiner', vars: { D: h.D, P: h.finer } },
      rows: [
        row('soils.r.Dstokes', h.D, 'mm'),
        row('soils.r.a', h.a),
        ...(h.finer === null ? [] : [row('soils.r.finer', h.finer, '%')]),
      ],
      steps: [
        step(
          'soils.hydro.s1',
          { D: h.D },
          `D = \\sqrt{\\frac{18\\,\\mu L}{(G_s - 1)\\rho_w g\\,t}} = ${tex(h.D)}\\ \\mathrm{mm}`,
        ),
        ...(h.finer === null
          ? []
          : [
              step(
                'soils.hydro.s2',
                { a: h.a, P: h.finer },
                `P = \\frac{a R}{W_s} \\times 100` + ` = ${tex(h.finer)}\\%`,
              ),
            ]),
      ],
      latex: `D = \\sqrt{\\frac{18\\,\\mu L}{(G_s - 1)\\rho_w g\\,t}} = ${tex(h.D)}\\ \\mathrm{mm}`,
      source: 'soils.source.astm',
    };
  },
};

export const limitsCalc: Calc = {
  id: 'limits',
  title: 'soils.limits.title',
  fields: [
    grid(
      'data',
      'soils.f.flow',
      [['soils.f.blows'], ['soils.f.wCol', 'percent']],
      '15 47.2\n22 45.1\n30 42.4\n38 41.0',
      2,
    ),
    num('PL', 'soils.f.PL', '22', 'percent'),
    opt('w', 'soils.f.wNatural', '30', 'percent'),
    opt('clay', 'soils.f.clay', '', 'percent'),
  ],
  solve({ n, o, rows }) {
    const data = rows.data!;
    const f = flowCurve(data);
    const i = indices(f.LL, n.PL!, o.w!, o.clay!);
    const Ns = data.map((r) => r[0]!);
    return {
      answer: { key: 'soils.limits.answer', vars: { LL: f.LL, PI: i.PI } },
      rows: [
        row('soils.r.LL', f.LL, '%'),
        row('soils.r.PI', i.PI, '%'),
        row('soils.r.flowIndex', f.flowIndex),
        ...(i.LI === null ? [] : [row('soils.r.LI', i.LI), row('soils.r.CI', i.CI!)]),
        ...(i.activity === null ? [] : [row('soils.r.activity', i.activity)]),
      ],
      steps: [
        step('soils.limits.s1', { a: f.a, b: f.flowIndex }, `w = ${tex(f.a)} - ${tex(f.flowIndex)} \\log_{10} N`),
        step('soils.limits.s2', { LL: f.LL }, `LL = w(25) = ${tex(f.LL)}\\%`),
        step('soils.limits.s3', { PI: i.PI }, `PI = LL - PL = ${tex(f.LL)} - ${tex(n.PL!)} = ${tex(i.PI)}`),
        ...(i.LI === null ? [] : [step('soils.limits.s4', { LI: i.LI }, `LI = \\frac{w - PL}{PI} = ${tex(i.LI)}`)]),
        ...(i.activity === null
          ? []
          : [step('soils.limits.s5', { A: i.activity }, `A = \\frac{PI}{\\%\\,\\text{clay}} = ${tex(i.activity)}`)]),
      ],
      latex: `LL = ${tex(f.LL)}\\%,\\quad PI = ${tex(i.PI)}\\%`,
      plot: {
        title: 'soils.p.flow',
        x: 'soils.p.blows',
        y: 'soils.p.water',
        xLog: true,
        series: [
          { name: 'soils.p.tests', points: data.map((r) => [r[0]!, r[1]!] as const), style: 'points' },
          {
            name: 'soils.p.flowLine',
            points: logspace(Math.log10(Math.min(10, ...Ns)), Math.log10(Math.max(50, ...Ns)), 20).map(
              (N) => [N, f.a - f.flowIndex * Math.log10(N)] as const,
            ),
          },
        ],
      },
    };
  },
};

export const uscsCalc: Calc = {
  id: 'uscs',
  title: 'soils.uscs.title',
  intro: 'soils.uscs.intro',
  fields: [
    num('F', 'soils.f.fines', '80', 'percent'),
    num('P4', 'soils.f.passing4', '100', 'percent'),
    opt('LL', 'soils.f.LL', '45', 'percent'),
    opt('PL', 'soils.f.PL', '25', 'percent'),
    opt('Cu', 'soils.f.Cu', ''),
    opt('Cc', 'soils.f.Cc', ''),
  ],
  solve({ n, o }) {
    const c = uscs({ fines: n.F!, passing4: n.P4!, LL: o.LL!, PL: o.PL!, Cu: o.Cu!, Cc: o.Cc! });
    const LL = o.LL;
    const PI = LL === null ? null : LL - (o.PL ?? LL);
    const top = Math.max(100, (LL ?? 0) + 10);
    return {
      answer: { key: 'soils.uscs.answer', vars: { symbol: c.symbol, name: `~${c.name}` } },
      rows: [row('soils.r.symbol', c.symbol), row('soils.r.name', `~${c.name}`)],
      steps: c.path.map((m) => step(m.key, m.vars)),
      notes: c.notes,
      source: 'soils.source.uscs',
      ...(LL !== null && PI !== null
        ? {
            plot: {
              title: 'soils.p.plasticity',
              x: 'soils.p.LL',
              y: 'soils.p.PI',
              series: [
                { name: 'soils.p.aLine', points: [[20, 0] as const, [top, aLine(top)] as const] },
                {
                  name: 'soils.p.uLine',
                  points: [[8, 0] as const, [top, uLine(top)] as const],
                  style: 'dashed' as const,
                },
                {
                  name: 'soils.p.llFifty',
                  points: [[50, 0] as const, [50, uLine(50)] as const],
                  style: 'dashed' as const,
                },
                { name: 'soils.p.soil', points: [[LL, PI] as const], style: 'points' as const },
              ],
            },
          }
        : {}),
    };
  },
};

export const aashtoCalc: Calc = {
  id: 'aashto',
  title: 'soils.aashto.title',
  fields: [
    num('p10', 'soils.f.p10', '100', 'percent'),
    num('p40', 'soils.f.p40', '100', 'percent'),
    num('p200', 'soils.f.p200', '95', 'percent'),
    num('LL', 'soils.f.LL', '60', 'percent'),
    num('PL', 'soils.f.PL', '20', 'percent'),
  ],
  solve({ n }) {
    const PI = n.LL! - n.PL!;
    const a = aashto({ p10: n.p10!, p40: n.p40!, p200: n.p200!, LL: n.LL!, PI });
    return {
      answer: { key: 'soils.aashto.answer', vars: { group: a.group, GI: a.GI } },
      rows: [row('soils.r.group', a.group), row('soils.r.GI', a.GI), row('soils.r.PI', PI, '%')],
      steps: [
        step('soils.aashto.s1', { group: a.group, PI }),
        step(
          'soils.aashto.s2',
          { first: a.first, second: a.second },
          `GI = (F - 35)[0.2 + 0.005(LL - 40)] + 0.01(F - 15)(PI - 10) = ${tex(a.first)} + ${tex(a.second)}`,
        ),
        step('soils.aashto.s3', { GI: a.GI, raw: a.raw }),
      ],
      latex: `\\text{${a.group}}\\ (${a.GI})`,
      source: 'soils.source.aashto',
    };
  },
};
