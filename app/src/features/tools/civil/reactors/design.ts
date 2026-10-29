// The reactors tool's design calculations: ideal reactors, reactors in series, Levenspiel sizing, multiple
// reactions, and temperature effects.
import { formula, grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Field, Outcome } from '../core/types';
import {
  activationEnergy,
  adiabaticRise,
  arrhenius,
  levenspiel,
  outlet,
  parallelReactions,
  powerLaw,
  recycleFirstOrder,
  seriesReactions,
  spaceTime,
  steadyStates,
  tanksInSeries,
  typedRate,
} from './engine';
import type { Rate, ReactorKind } from './engine';

const KINDS = [
  ['cstr', 'reactors.o.cstr'],
  ['pfr', 'reactors.o.pfr'],
  ['batch', 'reactors.o.batch'],
] as const;

const rateFields = (choices: Readonly<Record<string, string>>): Field[] => [
  pick('law', 'reactors.f.law', [
    ['power', 'reactors.o.power'],
    ['typed', 'reactors.o.typed'],
  ]),
  ...(choices.law === 'typed'
    ? [formula('rate', 'reactors.f.rate', '0.5*C/(1 + 0.2*C)', 'reactors.f.rateHelp')]
    : [num('k', 'reactors.f.k', '0.5'), num('n', 'reactors.f.n', '1')]),
];

const readRate = (n: Readonly<Record<string, number>>, s: Readonly<Record<string, string>>): Rate =>
  s.law === 'typed' ? typedRate(s.rate!) : powerLaw(n.k!, n.n!);

const rateTex = (n: Readonly<Record<string, number>>, s: Readonly<Record<string, string>>) =>
  s.law === 'typed' ? '-r_A = f(C_A)' : `-r_A = ${tex(n.k!)}\\,C_A^{${tex(n.n!)}}`;

const DESIGN: Record<ReactorKind, string> = {
  cstr: '\\tau = \\frac{C_{A0} - C_A}{-r_A(C_A)}',
  pfr: '\\tau = \\int_{C_A}^{C_{A0}} \\frac{dC_A}{-r_A}',
  batch: 't = \\int_{C_A}^{C_{A0}} \\frac{dC_A}{-r_A}',
};

const idealCalc: Calc = {
  id: 'ideal',
  title: 'reactors.ideal.title',
  intro: 'reactors.ideal.intro',
  fields: (choices) => [
    pick('kind', 'reactors.f.kind', KINDS),
    ...rateFields(choices),
    num('C0', 'reactors.f.C0', '1', 'molar'),
    pick('find', 'reactors.f.find', [
      ['X', 'reactors.o.findX'],
      ['tau', 'reactors.o.findTau'],
    ]),
    ...(choices.find === 'tau' ? [num('X', 'reactors.f.X', '0.8')] : [num('tau', 'reactors.f.tau', '4', 'minutes')]),
    opt('v0', 'reactors.f.v0', '', 'liters'),
  ],
  solve({ n, o, s }): Outcome {
    const kind = (s.kind ?? 'cstr') as ReactorKind;
    const rate = readRate(n, s);
    const C0 = n.C0!;
    const tau = s.find === 'tau' ? spaceTime(kind, rate, C0, n.X!) : n.tau!;
    const C = s.find === 'tau' ? C0 * (1 - n.X!) : outlet(kind, rate, C0, tau);
    const X = 1 - C / C0;
    const V = o.v0 === null ? null : o.v0 * tau;
    const curve = (k: ReactorKind) =>
      linspace(0, Math.max(tau, 1e-9) * 2, 50).map((t) => [t, 1 - outlet(k, rate, C0, t) / C0] as const);
    const other: ReactorKind = kind === 'cstr' ? 'pfr' : 'cstr';
    return {
      answer: { key: 'reactors.ideal.answer', vars: { X, tau, C } },
      rows: [
        row('reactors.r.X', X),
        row('reactors.r.C', C, 'mol/L'),
        row(kind === 'batch' ? 'reactors.r.t' : 'reactors.r.tau', tau, 'min'),
        ...(V === null ? [] : [row('reactors.r.V', V, 'L')]),
      ],
      steps: [
        step('reactors.ideal.s1', undefined, rateTex(n, s)),
        step(`reactors.ideal.design.${kind}`, undefined, DESIGN[kind]),
        step(
          s.find === 'tau' ? 'reactors.ideal.s2tau' : 'reactors.ideal.s2X',
          { tau, C, X },
          `C_A = ${tex(C)}\\ \\mathrm{mol/L},\\quad X = 1 - \\frac{C_A}{C_{A0}} = ${tex(X)}`,
        ),
        ...(V === null ? [] : [step('reactors.ideal.volume', { V }, `V = v_0 \\tau = ${tex(V)}\\ \\mathrm{L}`)]),
      ],
      latex: `X = ${tex(X)},\\quad \\tau = ${tex(tau)}\\ \\mathrm{min}`,
      plot: {
        title: 'reactors.p.conversion',
        x: 'reactors.p.tau',
        y: 'reactors.p.X',
        series: [
          { name: `reactors.o.${kind}`, points: curve(kind) },
          { name: `reactors.o.${other}`, points: curve(other), style: 'dashed' },
          { name: 'reactors.p.design', points: [[tau, X] as const], style: 'points' },
        ],
      },
    };
  },
};

const seriesCalc: Calc = {
  id: 'series',
  title: 'reactors.series.title',
  fields: (choices) => [
    pick('mode', 'reactors.f.arrangement', [
      ['tanks', 'reactors.o.tanks'],
      ['recycle', 'reactors.o.recycle'],
    ]),
    ...(choices.mode === 'recycle'
      ? [num('k', 'reactors.f.k1st', '0.5'), num('R', 'reactors.f.R', '1')]
      : [...rateFields(choices), num('N', 'reactors.f.N', '3'), num('C0', 'reactors.f.C0', '1', 'molar')]),
    num('tau', 'reactors.f.tauTotal', '4', 'minutes'),
  ],
  solve({ n, s }): Outcome {
    if (s.mode === 'recycle') {
      const X = recycleFirstOrder(n.k!, n.tau!, n.R!);
      const ends = [1 - Math.exp(-n.k! * n.tau!), (n.k! * n.tau!) / (1 + n.k! * n.tau!)];
      return {
        answer: { key: 'reactors.series.recycleAnswer', vars: { X, R: n.R! } },
        rows: [row('reactors.r.X', X), row('reactors.r.Xpfr', ends[0]!), row('reactors.r.Xcstr', ends[1]!)],
        steps: [
          step(
            'reactors.series.r1',
            { X },
            `\\frac{k\\tau}{R + 1} = \\ln\\frac{C_{A0} + R C_A}{(R + 1) C_A} \\Rightarrow X = ${tex(X)}`,
          ),
          step('reactors.series.r2', { pfr: ends[0]!, cstr: ends[1]! }),
        ],
        latex: `X = ${tex(X)}`,
        plot: {
          title: 'reactors.p.recycle',
          x: 'reactors.p.R',
          y: 'reactors.p.X',
          series: [
            {
              name: 'reactors.p.X',
              points: linspace(0, Math.max(10, n.R! * 2), 50).map(
                (R) => [R, recycleFirstOrder(n.k!, n.tau!, R)] as const,
              ),
            },
            { name: 'reactors.p.design', points: [[n.R!, X] as const], style: 'points' },
          ],
        },
      };
    }
    const rate = readRate(n, s);
    const N = Math.round(n.N!);
    const tanks = tanksInSeries(rate, n.C0!, n.tau!, N);
    const X = 1 - tanks[N - 1]! / n.C0!;
    const pfr = 1 - outlet('pfr', rate, n.C0!, n.tau!) / n.C0!;
    const one = 1 - outlet('cstr', rate, n.C0!, n.tau!) / n.C0!;
    return {
      answer: { key: 'reactors.series.answer', vars: { N, X } },
      rows: [row('reactors.r.X', X), row('reactors.r.Xpfr', pfr), row('reactors.r.Xcstr', one)],
      steps: [
        step('reactors.series.s1', { N, each: n.tau! / N }),
        step('reactors.series.s2', { X }, `X_N = 1 - \\frac{C_{A,N}}{C_{A0}} = ${tex(X)}`),
        step('reactors.series.s3', { pfr, one }),
      ],
      latex: `X_{${N}} = ${tex(X)}`,
      plot: {
        title: 'reactors.p.tanks',
        x: 'reactors.p.tank',
        y: 'reactors.p.X',
        series: [
          { name: 'reactors.p.X', points: tanks.map((C, i) => [i + 1, 1 - C / n.C0!] as const), style: 'points' },
          { name: 'reactors.o.pfr', points: [[1, pfr] as const, [N, pfr] as const], style: 'dashed' },
        ],
      },
      grid: {
        caption: 'reactors.g.tanks',
        header: ['reactors.g.tank', 'reactors.g.C', 'reactors.g.X'],
        rows: tanks.map((C, i) => [i + 1, C, 1 - C / n.C0!]),
      },
    };
  },
};

const levenspielCalc: Calc = {
  id: 'levenspiel',
  title: 'reactors.lev.title',
  intro: 'reactors.lev.intro',
  fields: [
    grid(
      'data',
      'reactors.f.levData',
      [['reactors.f.xCol'], ['reactors.f.rCol']],
      '0 0.53\n0.2 0.52\n0.4 0.38\n0.6 0.2\n0.8 0.06',
      2,
    ),
    num('FA0', 'reactors.f.FA0', '0.867', 'molarFlow'),
  ],
  solve({ n, rows }) {
    const l = levenspiel(rows.data!, n.FA0!);
    return {
      answer: { key: 'reactors.lev.answer', vars: { cstr: l.Vcstr, pfr: l.Vpfr, X: l.X } },
      rows: [row('reactors.r.Vcstr', l.Vcstr, 'L'), row('reactors.r.Vpfr', l.Vpfr, 'L')],
      steps: [
        step('reactors.lev.s1', { X: l.X }, `V_{CSTR} = \\frac{F_{A0} X}{-r_A(X)} = ${tex(l.Vcstr)}\\ \\mathrm{L}`),
        step(
          'reactors.lev.s2',
          undefined,
          `V_{PFR} = \\int_0^X \\frac{F_{A0}}{-r_A}\\,dX = ${tex(l.Vpfr)}\\ \\mathrm{L}`,
        ),
      ],
      latex: `V_{CSTR} = ${tex(l.Vcstr)}\\ \\mathrm{L},\\quad V_{PFR} = ${tex(l.Vpfr)}\\ \\mathrm{L}`,
      notes: [{ key: 'reactors.lev.note' }],
      plot: {
        title: 'reactors.p.levenspiel',
        x: 'reactors.p.X',
        y: 'reactors.p.F0r',
        series: [
          { name: 'reactors.p.F0r', points: l.points },
          {
            name: 'reactors.p.cstrBox',
            points: [
              [l.points[0]![0], l.points[l.points.length - 1]![1]],
              [l.X, l.points[l.points.length - 1]![1]],
            ],
            style: 'dashed',
          },
        ],
      },
    };
  },
};

const multipleCalc: Calc = {
  id: 'multiple',
  title: 'reactors.multi.title',
  fields: (choices) => [
    pick('network', 'reactors.f.network', [
      ['series', 'reactors.o.seriesNet'],
      ['parallel', 'reactors.o.parallelNet'],
    ]),
    pick('kind', 'reactors.f.kind', KINDS.slice(0, 2)),
    num('C0', 'reactors.f.C0', '1', 'molar'),
    ...(choices.network === 'parallel'
      ? [
          num('k1', 'reactors.f.k1', '2'),
          num('a1', 'reactors.f.a1', '1'),
          num('k2', 'reactors.f.k2', '1'),
          num('a2', 'reactors.f.a2', '2'),
          num('X', 'reactors.f.X', '0.8'),
        ]
      : [
          num('k1', 'reactors.f.k1', '1'),
          num('k2', 'reactors.f.k2', '0.5'),
          opt('tau', 'reactors.f.tauOpt', '', 'minutes'),
        ]),
  ],
  solve({ n, o, s }): Outcome {
    const kind = (s.kind === 'pfr' ? 'pfr' : 'cstr') as 'pfr' | 'cstr';
    if (s.network === 'parallel') {
      const p = parallelReactions(n.k1!, n.a1!, n.k2!, n.a2!, n.C0!, n.X!, kind);
      const other = parallelReactions(n.k1!, n.a1!, n.k2!, n.a2!, n.C0!, n.X!, kind === 'pfr' ? 'cstr' : 'pfr');
      return {
        answer: { key: 'reactors.multi.parallelAnswer', vars: { B: p.B, S: p.selectivity } },
        rows: [
          row('reactors.r.B', p.B, 'mol/L'),
          row('reactors.r.Cc', p.C, 'mol/L'),
          row('reactors.r.yieldB', p.yieldB),
          row('reactors.r.selectivity', p.selectivity),
          row('reactors.r.otherYield', other.yieldB),
        ],
        steps: [
          step('reactors.multi.p1', undefined, `\\varphi = \\frac{k_1 C_A^{a_1}}{k_1 C_A^{a_1} + k_2 C_A^{a_2}}`),
          step(kind === 'pfr' ? 'reactors.multi.p2pfr' : 'reactors.multi.p2cstr', { B: p.B }),
          step('reactors.multi.p3', { other: other.yieldB }),
        ],
        latex: `C_B = ${tex(p.B)}\\ \\mathrm{mol/L},\\quad S_{B/C} = ${tex(p.selectivity)}`,
      };
    }
    const best = seriesReactions(n.k1!, n.k2!, n.C0!, 1, kind).tOpt;
    const tau = o.tau ?? best;
    const r = seriesReactions(n.k1!, n.k2!, n.C0!, tau, kind);
    const end = Math.max(tau, best) * 3;
    const profile = linspace(0, end, 60).map((t) => seriesReactions(n.k1!, n.k2!, n.C0!, t, kind));
    const ts = linspace(0, end, 60);
    return {
      answer: { key: 'reactors.multi.seriesAnswer', vars: { tau, B: r.B, best } },
      rows: [
        row('reactors.r.tauOpt', best, 'min'),
        row('reactors.r.A', r.A, 'mol/L'),
        row('reactors.r.B', r.B, 'mol/L'),
        row('reactors.r.Cc', r.C, 'mol/L'),
        row('reactors.r.yieldB', r.yieldB),
      ],
      steps: [
        step(
          kind === 'pfr' ? 'reactors.multi.s1pfr' : 'reactors.multi.s1cstr',
          { best },
          kind === 'pfr'
            ? `\\tau_{opt} = \\frac{\\ln(k_2/k_1)}{k_2 - k_1} = ${tex(best)}\\ \\mathrm{min}`
            : `\\tau_{opt} = \\frac{1}{\\sqrt{k_1 k_2}} = ${tex(best)}\\ \\mathrm{min}`,
        ),
        step('reactors.multi.s2', { tau, B: r.B }),
      ],
      latex: `\\tau_{opt} = ${tex(best)}\\ \\mathrm{min},\\quad C_B = ${tex(r.B)}\\ \\mathrm{mol/L}`,
      plot: {
        title: 'reactors.p.profiles',
        x: 'reactors.p.tau',
        y: 'reactors.p.conc',
        series: [
          { name: 'reactors.p.A', points: profile.map((p, i) => [ts[i]!, p.A] as const) },
          { name: 'reactors.p.B', points: profile.map((p, i) => [ts[i]!, p.B] as const) },
          { name: 'reactors.p.C', points: profile.map((p, i) => [ts[i]!, p.C] as const), style: 'dashed' },
        ],
      },
    };
  },
};

const thermalCalc: Calc = {
  id: 'thermal',
  title: 'reactors.thermal.title',
  fields: (choices) => [
    pick('mode', 'reactors.f.find', [
      ['adiabatic', 'reactors.o.adiabatic'],
      ['arrhenius', 'reactors.o.arrhenius'],
      ['energy', 'reactors.o.energy'],
    ]),
    ...(choices.mode === 'arrhenius'
      ? [
          num('k1', 'reactors.f.kAt1', '0.5'),
          num('T1', 'reactors.f.T1', '300', 'kelvin'),
          num('T2', 'reactors.f.T2', '320', 'kelvin'),
          opt('E', 'reactors.f.E', '80', 'molarEnergy'),
          opt('k2', 'reactors.f.kAt2', ''),
        ]
      : choices.mode === 'energy'
        ? [
            num('k1', 'reactors.f.kAt1', '0.5'),
            num('T1', 'reactors.f.T1', '300', 'kelvin'),
            num('k2', 'reactors.f.kAt2', '2'),
            num('T2', 'reactors.f.T2', '320', 'kelvin'),
          ]
        : [
            num('dH', 'reactors.f.dH', '-50', 'molarEnergy'),
            num('C0', 'reactors.f.C0', '2', 'molar'),
            num('rhoCp', 'reactors.f.rhoCp', '4', 'heatCapacity'),
            num('X', 'reactors.f.X', '0.8'),
            num('T0', 'reactors.f.T0', '300', 'kelvin'),
          ]),
  ],
  solve({ n, o, s }): Outcome {
    if (s.mode === 'arrhenius') {
      const E = o.E === null ? activationEnergy(n.k1!, n.T1!, o.k2 ?? NaN, n.T2!) : o.E * 1000;
      const k2 = arrhenius(n.k1!, n.T1!, E, n.T2!);
      return {
        answer: { key: 'reactors.thermal.arrAnswer', vars: { k: k2, T: n.T2! } },
        rows: [row('reactors.r.k2', k2), row('reactors.r.E', E / 1000, 'kJ/mol'), row('reactors.r.ratio', k2 / n.k1!)],
        steps: [
          step(
            'reactors.thermal.a1',
            { k: k2 },
            `k_2 = k_1 \\exp\\left[-\\frac{E}{R}\\left(\\frac{1}{T_2} - \\frac{1}{T_1}\\right)\\right] = ${tex(k2)}`,
          ),
        ],
        latex: `k(${tex(n.T2!)}\\,\\mathrm{K}) = ${tex(k2)}`,
        plot: {
          title: 'reactors.p.arrhenius',
          x: 'reactors.p.invT',
          y: 'reactors.p.lnk',
          series: [
            {
              name: 'reactors.p.lnk',
              points: linspace(Math.min(n.T1!, n.T2!) * 0.95, Math.max(n.T1!, n.T2!) * 1.05, 30).map(
                (T) => [1000 / T, Math.log(arrhenius(n.k1!, n.T1!, E, T))] as const,
              ),
            },
          ],
        },
      };
    }
    if (s.mode === 'energy') {
      const E = activationEnergy(n.k1!, n.T1!, n.k2!, n.T2!);
      return {
        answer: { key: 'reactors.thermal.eAnswer', vars: { E: E / 1000 } },
        rows: [row('reactors.r.E', E / 1000, 'kJ/mol')],
        steps: [
          step(
            'reactors.thermal.e1',
            { E: E / 1000 },
            `E = \\frac{R \\ln(k_2/k_1)}{1/T_1 - 1/T_2} = ${tex(E / 1000)}\\ \\mathrm{kJ/mol}`,
          ),
        ],
        latex: `E = ${tex(E / 1000)}\\ \\mathrm{kJ/mol}`,
      };
    }
    const dT = adiabaticRise(n.dH!, n.C0!, n.rhoCp!, n.X!);
    return {
      answer: { key: 'reactors.thermal.adAnswer', vars: { dT, T: n.T0! + dT } },
      rows: [
        row('reactors.r.dT', dT, 'K'),
        row('reactors.r.T', n.T0! + dT, 'K'),
        row('reactors.r.dTad', dT / Math.max(n.X!, 1e-300), 'K'),
      ],
      steps: [
        step(
          'reactors.thermal.d1',
          { dT },
          `\\Delta T = \\frac{(-\\Delta H) X C_{A0}}{\\rho c_p} = ${tex(dT)}\\ \\mathrm{K}`,
        ),
      ],
      latex: `T = T_0 + \\frac{(-\\Delta H) X C_{A0}}{\\rho c_p} = ${tex(n.T0! + dT)}\\ \\mathrm{K}`,
      plot: {
        title: 'reactors.p.adiabatic',
        x: 'reactors.p.X',
        y: 'reactors.p.T',
        series: [
          { name: 'reactors.p.T', points: [[0, n.T0!] as const, [1, n.T0! + dT / Math.max(n.X!, 1e-300)] as const] },
        ],
      },
    };
  },
};

const steadyCalc: Calc = {
  id: 'steady',
  title: 'reactors.steady.title',
  intro: 'reactors.steady.intro',
  fields: [
    num('T0', 'reactors.f.T0', '298', 'kelvin'),
    num('tau', 'reactors.f.tau', '1', 'minutes'),
    num('k', 'reactors.f.kRef', '1'),
    num('Tref', 'reactors.f.Tref', '350', 'kelvin'),
    num('E', 'reactors.f.E', '100', 'molarEnergy'),
    num('dH', 'reactors.f.dH', '-200', 'molarEnergy'),
    num('C0', 'reactors.f.C0', '1', 'molar'),
    num('rhoCp', 'reactors.f.rhoCp', '1', 'heatCapacity'),
    num('kappa', 'reactors.f.kappa', '0'),
    num('Ta', 'reactors.f.Ta', '298', 'kelvin'),
  ],
  solve({ n }) {
    const r = steadyStates({
      T0: n.T0!,
      tau: n.tau!,
      kRef: n.k!,
      Tref: n.Tref!,
      E: n.E! * 1000,
      dH: n.dH!,
      CA0: n.C0!,
      rhoCp: n.rhoCp!,
      kappa: n.kappa!,
      Ta: n.Ta!,
    });
    const Ts = linspace(r.span[0], r.span[1], 120);
    return {
      answer: {
        key: r.states.length > 1 ? 'reactors.steady.many' : 'reactors.steady.one',
        vars: { count: r.states.length },
      },
      rows: r.states.flatMap((st, i) => [
        row(
          r.states.length === 1
            ? 'reactors.r.Tonly'
            : i === 0
              ? 'reactors.r.Tfirst'
              : i === r.states.length - 1
                ? 'reactors.r.Tlast'
                : 'reactors.r.Tmid',
          st.T,
          'K',
        ),
      ]),
      steps: [
        step('reactors.steady.s1', undefined, `G(T) = (-\\Delta H)\\,C_{A0}\\,\\frac{k\\tau}{1 + k\\tau}`),
        step('reactors.steady.s2', undefined, `R(T) = \\rho c_p\\left[(T - T_0) + \\kappa (T - T_a)\\right]`),
        ...r.states.map((st) =>
          step(st.stable ? 'reactors.steady.stable' : 'reactors.steady.unstable', { T: st.T, X: st.X }),
        ),
      ],
      latex: r.states.map((st) => `T = ${tex(st.T)}\\ \\mathrm{K},\\ X = ${tex(st.X)}`).join(';\\quad '),
      plot: {
        title: 'reactors.p.heat',
        x: 'reactors.p.T',
        y: 'reactors.p.heatAxis',
        series: [
          { name: 'reactors.p.G', points: Ts.map((T) => [T, r.G(T)] as const) },
          { name: 'reactors.p.Rm', points: Ts.map((T) => [T, r.Rm(T)] as const), style: 'dashed' },
          { name: 'reactors.p.states', points: r.states.map((st) => [st.T, r.G(st.T)] as const), style: 'points' },
        ],
      },
      grid: {
        caption: 'reactors.g.states',
        header: ['reactors.g.T', 'reactors.g.X', 'reactors.g.stable'],
        rows: r.states.map((st) => [st.T, st.X, st.stable ? '~reactors.o.yes' : '~reactors.o.no']),
      },
    };
  },
};

export const DESIGN_CALCS: readonly Calc[] = [
  idealCalc,
  seriesCalc,
  levenspielCalc,
  multipleCalc,
  thermalCalc,
  steadyCalc,
];
