// The soil properties, consolidation, and strength tool's calculations. The methods are in ./engine.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { rad, tex } from '../core/format';
import { linspace, logspace, polyAt } from '../core/num';
import type { Calc, KitStep, Msg, Outcome, Series } from '../core/types';
import {
  aLine,
  aashto,
  casagrande,
  circleLoad,
  cornerFactor,
  degreeOf,
  directShear,
  dryUnitWeightAt,
  failureStress,
  fallingHead,
  flowCurve,
  gradation,
  hydrometer,
  indices,
  isochrone,
  layeredK,
  lineLoad,
  constantHead,
  phases,
  pointLoad,
  preconsolidation,
  proctor,
  quickCondition,
  secondary,
  settlement,
  skempton,
  stressProfile,
  stripLoad,
  taylor,
  timeFactor,
  triaxial,
  twoToOne,
  uLine,
  uscs,
} from './engine';

const GW = (initial = '9.81') => num('gw', 'soils.f.gw', initial, 'unitWeight');
const pct = (v: number | null) => (v === null ? null : v / 100);
const box = (y0: number, y1: number): [number, number][] => [
  [0, y0],
  [1, y0],
  [1, y1],
  [0, y1],
  [0, y0],
];

const phasesCalc: Calc = {
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
                `e = \\frac{G_s\\gamma_w}{\\gamma_d} - 1 = \\frac{${tex(Gs)} \\times ${tex(gw)}}{${tex(o.gammaD!)}} - 1 = ${tex(p.e)}`,
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
          `\\gamma = \\frac{(G_s + S e)\\gamma_w}{1+e} = ${tex(p.gamma)},\\quad \\gamma_d = \\frac{G_s \\gamma_w}{1+e} = ${tex(p.gammaD)}\\ \\mathrm{kN/m^3}`,
        ),
      ],
      latex: `e = ${tex(p.e)},\\ n = ${tex(p.n)},\\ w = ${tex(100 * p.w)}\\%,\\ \\gamma = ${tex(p.gamma)}\\ \\mathrm{kN/m^3}`,
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

const gradationCalc: Calc = {
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
                `C_c = \\frac{D_{30}^2}{D_{10} D_{60}} = \\frac{${tex(g.D30!)}^2}{${tex(g.D10!)} \\times ${tex(g.D60!)}} = ${tex(g.Cc)}`,
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

const hydrometerCalc: Calc = {
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
          : [step('soils.hydro.s2', { a: h.a, P: h.finer }, `P = \\frac{a R}{W_s} \\times 100 = ${tex(h.finer)}\\%`)]),
      ],
      latex: `D = \\sqrt{\\frac{18\\,\\mu L}{(G_s - 1)\\rho_w g\\,t}} = ${tex(h.D)}\\ \\mathrm{mm}`,
      source: 'soils.source.astm',
    };
  },
};

const limitsCalc: Calc = {
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

const uscsCalc: Calc = {
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

const aashtoCalc: Calc = {
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

const compactionCalc: Calc = {
  id: 'compaction',
  title: 'soils.compact.title',
  fields: [
    grid(
      'data',
      'soils.f.proctor',
      [
        ['soils.f.wCol', 'percent'],
        ['soils.f.gdCol', 'unitWeight'],
      ],
      '10 16.9\n12 17.6\n14 17.9\n16 17.7\n18 17.1',
      3,
    ),
    num('Gs', 'soils.f.Gs', '2.7'),
    GW(),
    pick('degree', 'soils.f.degree', [
      ['2', 'soils.o.quadratic'],
      ['3', 'soils.o.cubic'],
    ]),
    opt('field', 'soils.f.fieldGd', '', 'unitWeight'),
  ],
  solve({ n, o, s, rows }) {
    const data = rows.data!;
    const degree = s.degree === '3' ? 3 : 2;
    const p = proctor(data, degree);
    const wo = p.wOpt / 100;
    const zav = dryUnitWeightAt(wo, n.Gs!, n.gw!);
    const Sopt = (wo * n.Gs!) / ((n.Gs! * n.gw!) / p.gammaMax - 1);
    const ws = linspace(p.lo, p.hi, 40);
    const wide = linspace(Math.max(0.1, p.lo - 2), p.hi + 4, 40);
    const notes: Msg[] = [];
    if (p.gammaMax > zav) notes.push({ key: 'soils.compact.aboveZav' });
    return {
      answer: { key: 'soils.compact.answer', vars: { g: p.gammaMax, w: p.wOpt } },
      rows: [
        row('soils.r.gdMax', p.gammaMax, 'kN/m³'),
        row('soils.r.wOpt', p.wOpt, '%'),
        row('soils.r.Sopt', 100 * Sopt, '%'),
        row('soils.r.zav', zav, 'kN/m³'),
        ...(o.field === null ? [] : [row('soils.r.RC', (100 * o.field!) / p.gammaMax, '%')]),
      ],
      steps: [
        step('soils.compact.s1', { degree }),
        step('soils.compact.s2', { g: p.gammaMax, w: p.wOpt }),
        step(
          'soils.compact.s3',
          { zav },
          `\\gamma_{zav} = \\frac{G_s \\gamma_w}{1 + w G_s} = \\frac{${tex(n.Gs!)} \\times ${tex(n.gw!)}}{1 + ${tex(wo)} \\times ${tex(n.Gs!)}} = ${tex(zav)}`,
        ),
        ...(o.field === null ? [] : [step('soils.compact.s4', { RC: (100 * o.field!) / p.gammaMax })]),
      ],
      latex: `\\gamma_{d,\\max} = ${tex(p.gammaMax)}\\ \\mathrm{kN/m^3},\\quad w_{opt} = ${tex(p.wOpt)}\\%`,
      notes,
      plot: {
        title: 'soils.p.proctor',
        x: 'soils.p.water',
        y: 'soils.p.gd',
        series: [
          { name: 'soils.p.tests', points: data.map((r) => [r[0]!, r[1]!] as const), style: 'points' },
          { name: 'soils.p.fit', points: ws.map((w) => [w, polyAt(p.fit, w)] as const) },
          { name: 'soils.p.zav', points: wide.map((w) => [w, dryUnitWeightAt(w / 100, n.Gs!, n.gw!)] as const) },
          {
            name: 'soils.p.s80',
            points: wide.map((w) => [w, dryUnitWeightAt(w / 100, n.Gs!, n.gw!, 0.8)] as const),
            style: 'dashed',
          },
        ],
      },
    };
  },
};

const permeabilityCalc: Calc = {
  id: 'permeability',
  title: 'soils.perm.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'falling';
    return [
      pick('mode', 'soils.f.mode', [
        ['falling', 'soils.o.falling'],
        ['constant', 'soils.o.constant'],
        ['layered', 'soils.o.layered'],
        ['hazen', 'soils.o.hazen'],
      ]),
      ...(mode === 'falling'
        ? [
            num('a', 'soils.f.standpipe', '1', 'area', { unit: 'cm²' }),
            num('L', 'soils.f.sampleL', '10', 'length', { unit: 'cm' }),
            num('A', 'soils.f.sampleA', '50', 'area', { unit: 'cm²' }),
            num('t', 'soils.f.time', '600', 'seconds'),
            num('h1', 'soils.f.h1', '100', 'length', { unit: 'cm' }),
            num('h2', 'soils.f.h2', '50', 'length', { unit: 'cm' }),
          ]
        : mode === 'constant'
          ? [
              num('V', 'soils.f.V', '500', 'volume', { unit: 'cm³' }),
              num('L', 'soils.f.sampleL', '15', 'length', { unit: 'cm' }),
              num('A', 'soils.f.sampleA', '80', 'area', { unit: 'cm²' }),
              num('h', 'soils.f.head', '40', 'length', { unit: 'cm' }),
              num('t', 'soils.f.time', '300', 'seconds'),
            ]
          : mode === 'layered'
            ? [
                grid(
                  'layers',
                  'soils.f.layers',
                  [
                    ['soils.f.thickness', 'length'],
                    ['soils.f.k', 'conductivity'],
                  ],
                  '2 1e-4\n1 1e-7\n3 5e-5',
                ),
              ]
            : [num('D10', 'soils.f.D10', '0.2', 'grain'), num('C', 'soils.f.hazenC', '100')]),
    ];
  },
  solve({ n, s, rows }): Outcome {
    if (s.mode === 'layered') {
      const k = layeredK(rows.layers!);
      return {
        answer: { key: 'soils.perm.layeredAnswer', vars: { kx: k.kx, kz: k.kz } },
        rows: [row('soils.r.kx', k.kx, 'm/s'), row('soils.r.kz', k.kz, 'm/s'), row('soils.r.ratio', k.kx / k.kz)],
        steps: [
          step('soils.perm.s3', { kx: k.kx }, `k_x = \\frac{\\sum k_i h_i}{H} = ${tex(k.kx)}\\ \\mathrm{m/s}`),
          step('soils.perm.s4', { kz: k.kz }, `k_z = \\frac{H}{\\sum h_i / k_i} = ${tex(k.kz)}\\ \\mathrm{m/s}`),
        ],
        latex: `k_x = ${tex(k.kx)},\\quad k_z = ${tex(k.kz)}\\ \\mathrm{m/s}`,
      };
    }
    let k: number;
    let math: string;
    let key: string;
    if (s.mode === 'constant') {
      k = constantHead(n.V!, n.L!, n.A!, n.h!, n.t!);
      key = 'soils.perm.s1';
      math = `k = \\frac{V L}{A h t} = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    } else if (s.mode === 'hazen') {
      k = (n.C! * (n.D10! / 10) ** 2) / 100;
      key = 'soils.perm.s5';
      math = `k = C D_{10}^2 = ${tex(n.C!)} \\times ${tex(n.D10! / 10)}^2 = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    } else {
      k = fallingHead(n.a!, n.L!, n.A!, n.t!, n.h1!, n.h2!);
      key = 'soils.perm.s2';
      math = `k = \\frac{a L}{A t}\\ln\\frac{h_1}{h_2} = ${tex(k * 100)}\\ \\mathrm{cm/s}`;
    }
    return {
      answer: { key: 'soils.perm.answer', vars: { k: k * 100 } },
      rows: [row('soils.r.kcm', k * 100, 'cm/s'), row('soils.r.km', k, 'm/s')],
      steps: [step(key, { k: k * 100 }, math)],
      latex: math,
      ...(s.mode === 'hazen' ? { notes: [{ key: 'soils.perm.hazenNote' }] } : {}),
    };
  },
};

const effectiveCalc: Calc = {
  id: 'effective',
  title: 'soils.eff.title',
  intro: 'soils.eff.intro',
  fields: [
    grid(
      'layers',
      'soils.f.profile',
      [
        ['soils.f.thickness', 'length'],
        ['soils.f.gammaCol', 'unitWeight'],
        ['soils.f.gammaSatCol', 'unitWeight'],
      ],
      '10 18 20',
    ),
    num('zw', 'soils.f.zw', '2', 'length'),
    num('hc', 'soils.f.hc', '0', 'length'),
    num('q', 'soils.f.surcharge', '0', 'pressure'),
    num('z', 'soils.f.z', '5', 'length'),
    GW(),
  ],
  solve({ n, rows }) {
    const prof = stressProfile(rows.layers!, n.zw!, n.hc!, n.gw!, n.q!);
    const at = prof.at(n.z!);
    const depths = [...new Set([...prof.marks, n.z!])].sort((a, b) => a - b);
    const pts = depths.map(prof.at);
    return {
      answer: { key: 'soils.eff.answer', vars: { z: n.z!, eff: at.eff } },
      rows: [row('soils.r.sigma', at.sigma, 'kPa'), row('soils.r.u', at.u, 'kPa'), row('soils.r.eff', at.eff, 'kPa')],
      steps: [
        step('soils.eff.s1', { sigma: at.sigma }),
        step(
          'soils.eff.s2',
          { u: at.u },
          `u = \\gamma_w (z - z_w) = ${tex(n.gw!)} \\times (${tex(n.z!)} - ${tex(n.zw!)}) = ${tex(at.u)}`,
        ),
        step(
          'soils.eff.s3',
          { eff: at.eff },
          `\\sigma' = \\sigma - u = ${tex(at.sigma)} - ${tex(at.u)} = ${tex(at.eff)}\\ \\mathrm{kPa}`,
        ),
      ],
      latex: `\\sigma' = \\sigma - u = ${tex(at.sigma)} - ${tex(at.u)} = ${tex(at.eff)}\\ \\mathrm{kPa}`,
      grid: {
        caption: 'soils.eff.grid',
        header: ['soils.g.depth', 'soils.g.sigma', 'soils.g.u', 'soils.g.eff'],
        rows: pts.map((p) => [p.z, p.sigma, p.u, p.eff]),
      },
      plot: {
        title: 'soils.p.stress',
        x: 'soils.p.stressAxis',
        y: 'soils.p.depth',
        yDown: true,
        series: [
          { name: 'soils.p.total', points: pts.map((p) => [p.sigma, p.z] as const) },
          { name: 'soils.p.pore', points: pts.map((p) => [p.u, p.z] as const) },
          { name: 'soils.p.effective', points: pts.map((p) => [p.eff, p.z] as const) },
        ],
      },
    };
  },
};

const quickCalc: Calc = {
  id: 'quick',
  title: 'soils.quick.title',
  fields: [
    num('gs', 'soils.f.gammaSat', '20', 'unitWeight'),
    num('dh', 'soils.f.dh', '1', 'length'),
    num('L', 'soils.f.flowL', '2', 'length'),
    GW(),
  ],
  solve({ n }) {
    const q = quickCondition(n.gs!, n.dh!, n.L!, n.gw!);
    return {
      answer: { key: q.FS < 1 ? 'soils.quick.boils' : 'soils.quick.answer', vars: { FS: q.FS } },
      rows: [
        row('soils.r.i', q.i),
        row('soils.r.ic', q.ic),
        row('soils.r.FS', q.FS),
        row('soils.r.effBottom', q.eff, 'kPa'),
      ],
      steps: [
        step('soils.quick.s1', { i: q.i }, `i = \\frac{\\Delta h}{L} = ${tex(q.i)}`),
        step('soils.quick.s2', { ic: q.ic }, `i_c = \\frac{\\gamma'}{\\gamma_w} = ${tex(q.ic)}`),
        step('soils.quick.s3', { FS: q.FS }, `FS = \\frac{i_c}{i} = ${tex(q.FS)}`),
      ],
      latex: `FS = \\frac{i_c}{i} = ${tex(q.FS)}`,
    };
  },
};

const loadsCalc: Calc = {
  id: 'loads',
  title: 'soils.loads.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'point';
    return [
      pick('mode', 'soils.f.load', [
        ['point', 'soils.o.point'],
        ['line', 'soils.o.line'],
        ['strip', 'soils.o.strip'],
        ['circle', 'soils.o.circle'],
        ['rect', 'soils.o.rect'],
        ['twoToOne', 'soils.o.twoToOne'],
      ]),
      ...(mode === 'point'
        ? [num('Q', 'soils.f.Q', '100', 'force'), num('r', 'soils.f.r', '0', 'length')]
        : mode === 'line'
          ? [num('q', 'soils.f.qLine', '50', 'forcePerLength'), num('x', 'soils.f.x', '0', 'length')]
          : mode === 'strip'
            ? [
                num('q', 'soils.f.qArea', '100', 'pressure'),
                num('B', 'soils.f.B', '2', 'length'),
                num('x', 'soils.f.xc', '0', 'length'),
              ]
            : mode === 'circle'
              ? [num('q', 'soils.f.qArea', '100', 'pressure'), num('a', 'soils.f.radius', '1.5', 'length')]
              : [
                  num('q', 'soils.f.qArea', '100', 'pressure'),
                  num('B', 'soils.f.B', '2', 'length'),
                  num('L', 'soils.f.Lrect', '3', 'length'),
                  ...(mode === 'rect'
                    ? [
                        pick('where', 'soils.f.where', [
                          ['corner', 'soils.o.corner'],
                          ['centre', 'soils.o.centre'],
                        ]),
                      ]
                    : []),
                ]),
      num('z', 'soils.f.z', '2', 'length'),
    ];
  },
  solve({ n, s }) {
    const mode = s.mode ?? 'point';
    const at = (z: number): number => {
      switch (mode) {
        case 'point':
          return pointLoad(n.Q!, n.r!, z);
        case 'line':
          return lineLoad(n.q!, n.x!, z);
        case 'strip':
          return stripLoad(n.q!, n.B!, n.x!, z);
        case 'circle':
          return circleLoad(n.q!, n.a!, z);
        case 'rect':
          return s.where === 'centre'
            ? n.q! * 4 * cornerFactor(n.B! / 2, n.L! / 2, z)
            : n.q! * cornerFactor(n.B!, n.L!, z);
        default:
          return twoToOne(n.q!, n.B!, n.L!, z);
      }
    };
    const z = n.z!;
    const value = at(z);
    const MATH: Record<string, string> = {
      point: `\\sigma_z = \\frac{3 Q z^3}{2\\pi R^5}`,
      line: `\\sigma_z = \\frac{2 q z^3}{\\pi (x^2 + z^2)^2}`,
      strip: `\\sigma_z = \\frac{q}{\\pi}\\left[\\alpha + \\sin\\alpha \\cos(\\alpha + 2\\delta)\\right]`,
      circle: `\\sigma_z = q\\left[1 - \\left(\\frac{1}{1 + (a/z)^2}\\right)^{3/2}\\right]`,
      rect: `\\sigma_z = q\\, I(m, n),\\ m = B/z,\\ n = L/z`,
      twoToOne: `\\sigma_z = \\frac{q B L}{(B + z)(L + z)}`,
    };
    const eq = `${MATH[mode]!} = ${tex(value)}\\ \\mathrm{kPa}`;
    const deepest = Math.max(3 * z, 4 * (n.B ?? n.a ?? 1));
    const zs = linspace(deepest / 60, deepest, 60);
    return {
      answer: { key: 'soils.loads.answer', vars: { z, s: value } },
      rows: [
        row('soils.r.sz', value, 'kPa'),
        ...(mode === 'point' || mode === 'line' ? [] : [row('soils.r.influence', value / n.q!)]),
      ],
      steps: [step(`soils.loads.${mode}`, { s: value }, eq)],
      latex: eq,
      ...(mode === 'twoToOne' ? { notes: [{ key: 'soils.loads.approx' }] } : {}),
      plot: {
        title: 'soils.p.loads',
        x: 'soils.p.sz',
        y: 'soils.p.depth',
        yDown: true,
        series: [{ name: 'soils.p.szSeries', points: zs.map((d) => [at(d), d] as const) }],
      },
    };
  },
};

const timeFactorCalc: Calc = {
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

const settlementCalc: Calc = {
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
        ? `S_c = \\frac{C_c H}{1 + e_0}\\log_{10}\\frac{\\sigma'_f}{\\sigma'_0} = \\frac{${tex(n.Cc!)} \\times ${tex(n.H!)}}{1 + ${tex(n.e0!)}}\\log_{10}\\frac{${tex(r.sf)}}{${tex(n.s0!)}} = ${tex(r.S)}\\ \\mathrm{m}`
        : r.case === 'ocBelow'
          ? `S_c = \\frac{C_r H}{1 + e_0}\\log_{10}\\frac{\\sigma'_f}{\\sigma'_0} = ${tex(r.S)}\\ \\mathrm{m}`
          : `S_c = \\frac{H}{1 + e_0}\\left[C_r\\log_{10}\\frac{\\sigma'_p}{\\sigma'_0} + C_c\\log_{10}\\frac{\\sigma'_f}{\\sigma'_p}\\right] = ${tex(r.S)}\\ \\mathrm{m}`;
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

const secondaryCalc: Calc = {
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

const cvCalc: Calc = {
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

const preconCalc: Calc = {
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
      logspace(Math.log10(from), Math.log10(to), 12).map((s) => [s, y0 + slope * (Math.log10(s) - x0)] as const);
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

const shearCalc: Calc = {
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
    if (mode === 'predict') {
      const s1 = failureStress(n.c!, n.phi!, n.s3!);
      const tt = Math.tan(rad(45 + n.phi! / 2));
      const eq = `\\sigma_1 = \\sigma_3\\tan^2\\left(45 + \\frac{\\phi}{2}\\right) + 2c\\tan\\left(45 + \\frac{\\phi}{2}\\right) = ${tex(s1)}\\ \\mathrm{kPa}`;
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
              `c' = \\frac{a}{\\cos\\phi'} = \\frac{${tex(t.a)}}{\\cos ${tex(t.phi)}^\\circ} = ${tex(t.c)}\\ \\mathrm{kPa}`,
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

const skemptonCalc: Calc = {
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

export const CALCS: readonly Calc[] = [
  phasesCalc,
  gradationCalc,
  hydrometerCalc,
  limitsCalc,
  uscsCalc,
  aashtoCalc,
  compactionCalc,
  permeabilityCalc,
  effectiveCalc,
  quickCalc,
  loadsCalc,
  timeFactorCalc,
  settlementCalc,
  secondaryCalc,
  cvCalc,
  preconCalc,
  shearCalc,
  skemptonCalc,
];
