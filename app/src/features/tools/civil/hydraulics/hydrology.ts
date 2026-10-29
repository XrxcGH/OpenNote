// The hydraulics tool's hydrology calculations: rational and curve-number runoff, unit hydrographs, routing, flood
// frequency, and soil erosion.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Outcome } from '../core/types';
import {
  convolve,
  curveNumber,
  detention,
  frequencyFit,
  gumbelK,
  idf,
  kirpich,
  muskingum,
  nrcsLag,
  pearsonK,
  puls,
  rational,
  risk,
  sCurve,
  usleLS,
} from './engine';

const FT = 0.3048;

const rationalCalc: Calc = {
  id: 'rational',
  title: 'hydraulics.rational.title',
  fields: (choices) => [
    num('C', 'hydraulics.f.C', '0.5'),
    num('A', 'hydraulics.f.A', '2', 'catchment'),
    pick('source', 'hydraulics.f.intensity', [
      ['typed', 'hydraulics.o.typedI'],
      ['idf', 'hydraulics.o.idf'],
    ]),
    ...(choices.source === 'idf'
      ? [
          num('a', 'hydraulics.f.idfA', '1500'),
          num('b', 'hydraulics.f.idfB', '10'),
          num('c', 'hydraulics.f.idfC', '0.8'),
          opt('tc', 'hydraulics.f.tc', '', 'minutes'),
          num('L', 'hydraulics.f.L', '1500', 'length'),
          num('S', 'hydraulics.f.S', '0.01'),
        ]
      : [num('i', 'hydraulics.f.i', '50', 'intensity')]),
  ],
  solve({ n, o, s }): Outcome {
    const idfMode = s.source === 'idf';
    const tc = idfMode ? (o.tc ?? kirpich(n.L!, n.S!)) : null;
    const i = idfMode ? idf(n.a!, n.b!, n.c!, tc!) : n.i!;
    const Q = rational(n.C!, i, n.A!);
    return {
      answer: { key: 'hydraulics.rational.answer', vars: { Q } },
      rows: [
        row('hydraulics.r.Q', Q, 'm³/s'),
        row('hydraulics.r.i', i, 'mm/h'),
        ...(tc === null ? [] : [row('hydraulics.r.tc', tc, 'min')]),
      ],
      steps: [
        ...(tc !== null && o.tc === null
          ? [
              step(
                'hydraulics.rational.kirpich',
                { tc },
                `t_c = 0.0195\\,L^{0.77} S^{-0.385} = ${tex(tc)}\\ \\mathrm{min}`,
              ),
            ]
          : []),
        ...(idfMode
          ? [step('hydraulics.rational.idf', { i }, `i = \\frac{a}{(t_c + b)^c} = ${tex(i)}\\ \\mathrm{mm/h}`)]
          : []),
        step(
          'hydraulics.rational.s1',
          { Q },
          `Q = 0.278\\,C\\,i\\,A = 0.278 \\times ${tex(n.C!)} \\times ${tex(i)} \\times ${tex(n.A!)}` +
            ` = ${tex(Q)}\\ \\mathrm{m^3/s}`,
        ),
      ],
      latex: `Q = 0.278\\,C\\,i\\,A = ${tex(Q)}\\ \\mathrm{m^3/s}`,
      notes: [{ key: 'hydraulics.rational.note' }],
    };
  },
};

const scsCalc: Calc = {
  id: 'scs',
  title: 'hydraulics.scs.title',
  fields: [
    num('P', 'hydraulics.f.P', '101.6', 'rain'),
    num('CN', 'hydraulics.f.CN', '80'),
    num('lambda', 'hydraulics.f.lambda', '0.2'),
    opt('L', 'hydraulics.f.flowLength', '', 'length'),
    opt('Y', 'hydraulics.f.slopePct', ''),
  ],
  solve({ n, o }): Outcome {
    const P = n.P! / 25.4;
    const r = curveNumber(P, n.CN!, n.lambda!);
    const lag = o.L !== null && o.Y !== null ? nrcsLag(o.L / FT, n.CN!, o.Y) : null;
    const Ps = linspace(0, Math.max(2 * P, 1), 50);
    return {
      answer: { key: 'hydraulics.scs.answer', vars: { Q: r.Q * 25.4, Qin: r.Q } },
      rows: [
        row('hydraulics.r.runoff', r.Q * 25.4, 'mm'),
        row('hydraulics.r.S', r.S * 25.4, 'mm'),
        row('hydraulics.r.Ia', r.Ia * 25.4, 'mm'),
        ...(lag ? [row('hydraulics.r.lag', lag.lag, 'h'), row('hydraulics.r.tc', lag.tc * 60, 'min')] : []),
      ],
      steps: [
        step('hydraulics.scs.s1', { S: r.S }, `S = \\frac{1000}{CN} - 10 = ${tex(r.S)}\\ \\mathrm{in}`),
        step('hydraulics.scs.s2', { Ia: r.Ia }, `I_a = \\lambda S = ${tex(r.Ia)}\\ \\mathrm{in}`),
        step('hydraulics.scs.s3', { Q: r.Q }, `Q = \\frac{(P - I_a)^2}{P - I_a + S} = ${tex(r.Q)}\\ \\mathrm{in}`),
        ...(lag
          ? [
              step(
                'hydraulics.scs.lag',
                { lag: lag.lag },
                `L = \\frac{\\ell^{0.8}(S + 1)^{0.7}}{1900\\,Y^{0.5}} = ${tex(lag.lag)}\\ \\mathrm{h}`,
              ),
            ]
          : []),
      ],
      latex: `Q = \\frac{(P - 0.2S)^2}{P + 0.8S} = ${tex(r.Q)}\\ \\mathrm{in}`,
      source: 'hydraulics.source.nrcs',
      plot: {
        title: 'hydraulics.p.cn',
        x: 'hydraulics.p.Pin',
        y: 'hydraulics.p.Qin',
        series: [
          { name: 'hydraulics.p.runoff', points: Ps.map((p) => [p, curveNumber(p, n.CN!, n.lambda!).Q] as const) },
          { name: 'hydraulics.p.design', points: [[P, r.Q] as const], style: 'points' },
        ],
      },
    };
  },
};

const uhCalc: Calc = {
  id: 'unitHydrograph',
  title: 'hydraulics.uh.title',
  intro: 'hydraulics.uh.intro',
  fields: (choices) => [
    pick('mode', 'hydraulics.f.uhMode', [
      ['convolve', 'hydraulics.o.convolve'],
      ['scurve', 'hydraulics.o.scurve'],
    ]),
    num('dt', 'hydraulics.f.dt', '1', 'hours'),
    grid('uh', 'hydraulics.f.uh', [['hydraulics.f.uhCol']], '0\n10\n25\n18\n10\n5\n2\n0', 2),
    ...(choices.mode === 'scurve'
      ? [num('k', 'hydraulics.f.kSteps', '2'), num('kNew', 'hydraulics.f.kNew', '1')]
      : [grid('rain', 'hydraulics.f.excess', [['hydraulics.f.excessCol']], '1\n2.5\n0.5')]),
  ],
  solve({ n, s, rows }): Outcome {
    // Times are typed in hours, the unit the hydrographs are listed in.
    const dtH = n.dt!;
    const uh = rows.uh!.map((r) => r[0]!);
    if (s.mode === 'scurve') {
      const r = sCurve(uh, Math.round(n.k!), Math.round(n.kNew!));
      return {
        answer: { key: 'hydraulics.uh.sAnswer', vars: { D: Math.round(n.kNew!) * dtH } },
        rows: [row('hydraulics.r.peakNew', Math.max(...r.U)), row('hydraulics.r.peakOld', Math.max(...uh))],
        steps: [
          step('hydraulics.uh.s1', undefined, 'S(t) = \\sum_{j \\ge 0} U_D(t - jD)'),
          step('hydraulics.uh.s2', undefined, "U_{D'}(t) = \\frac{D}{D'}\\left[S(t) - S(t - D')\\right]"),
        ],
        latex: `\\max U_{D'} = ${tex(Math.max(...r.U))}`,
        plot: {
          title: 'hydraulics.p.scurve',
          x: 'hydraulics.p.hours',
          y: 'hydraulics.p.Q',
          series: [
            { name: 'hydraulics.p.S', points: r.S.map((v, i) => [i * dtH, v] as const), style: 'dashed' },
            { name: 'hydraulics.p.uhOld', points: uh.map((v, i) => [i * dtH, v] as const) },
            { name: 'hydraulics.p.uhNew', points: r.U.map((v, i) => [i * dtH, v] as const) },
          ],
        },
        grid: {
          caption: 'hydraulics.g.scurve',
          header: ['hydraulics.g.t', 'hydraulics.g.S', 'hydraulics.g.U'],
          rows: r.U.map((v, i) => [i * dtH, r.S[i]!, v]),
        },
      };
    }
    const rain = rows.rain!.map((r) => r[0]!);
    const q = convolve(uh, rain);
    const peak = Math.max(...q);
    const at = q.indexOf(peak) * dtH;
    return {
      answer: { key: 'hydraulics.uh.answer', vars: { peak, t: at } },
      rows: [
        row('hydraulics.r.peak', peak),
        row('hydraulics.r.tPeak', at, 'h'),
        row('hydraulics.r.volume', q.reduce((sum, v) => sum + v, 0) * n.dt! * 3600),
      ],
      steps: [
        step('hydraulics.uh.c1', undefined, 'Q_n = \\sum_{m=1}^{n} P_m\\,U_{n-m+1}'),
        step('hydraulics.uh.c2', { peak, t: at }),
      ],
      latex: `Q_{peak} = ${tex(peak)}`,
      plot: {
        title: 'hydraulics.p.drh',
        x: 'hydraulics.p.hours',
        y: 'hydraulics.p.Q',
        series: [
          { name: 'hydraulics.p.drh', points: q.map((v, i) => [i * dtH, v] as const) },
          { name: 'hydraulics.p.uhOld', points: uh.map((v, i) => [i * dtH, v] as const), style: 'dashed' },
        ],
      },
      grid: {
        caption: 'hydraulics.g.drh',
        header: ['hydraulics.g.t', 'hydraulics.g.Q'],
        rows: q.map((v, i) => [i * dtH, v]),
      },
    };
  },
};

const INFLOW = '0\n20\n60\n100\n80\n60\n40\n25\n15\n8\n4\n0';

const routingCalc: Calc = {
  id: 'routing',
  title: 'hydraulics.route.title',
  intro: 'hydraulics.route.intro',
  fields: (choices) => [
    pick('method', 'hydraulics.f.method', [
      ['muskingum', 'hydraulics.o.muskingum'],
      ['puls', 'hydraulics.o.puls'],
      ['basin', 'hydraulics.o.basin'],
    ]),
    ...(choices.method === 'basin'
      ? [
          grid(
            'inflow2',
            'hydraulics.f.inflowTimed',
            [
              ['hydraulics.f.tCol', 'seconds'],
              ['hydraulics.f.qCol', 'flow'],
            ],
            '0 0\n1800 2\n3600 0',
            2,
          ),
          num('As', 'hydraulics.f.As', '2000', 'area'),
          num('Cd', 'hydraulics.f.Cd', '0.6'),
          num('Ao', 'hydraulics.f.Ao', '0.2', 'area'),
          num('Cw', 'hydraulics.f.Cw', '1.8'),
          num('Lw', 'hydraulics.f.Lw', '2', 'length'),
          num('crest', 'hydraulics.f.crest', '1.5', 'length'),
        ]
      : [
          num('dt', 'hydraulics.f.dt', '6', 'hours'),
          grid('inflow', 'hydraulics.f.inflow', [['hydraulics.f.qCol', 'flow']], INFLOW, 2),
          ...(choices.method === 'puls'
            ? [
                grid(
                  'table',
                  'hydraulics.f.storage',
                  [
                    ['hydraulics.f.storageCol', 'volume'],
                    ['hydraulics.f.qCol', 'flow'],
                  ],
                  '0 0\n1000000 20\n3000000 50\n6000000 90\n10000000 130',
                  2,
                ),
              ]
            : [num('K', 'hydraulics.f.K', '12', 'hours'), num('X', 'hydraulics.f.X', '0.2')]),
        ]),
  ],
  solve({ n, s, rows }): Outcome {
    if (s.method === 'basin') {
      const d = detention(rows.inflow2!, n.As!, { Cd: n.Cd!, area: n.Ao! }, { Cw: n.Cw!, L: n.Lw!, crest: n.crest! });
      return {
        answer: { key: 'hydraulics.route.basinAnswer', vars: { O: d.peakO, h: d.peakH } },
        rows: [
          row('hydraulics.r.peakIn', d.peakI, 'm³/s'),
          row('hydraulics.r.peakOut', d.peakO, 'm³/s'),
          row('hydraulics.r.hMax', d.peakH, 'm'),
          row('hydraulics.r.storageMax', d.volume, 'm³'),
        ],
        steps: [
          step(
            'hydraulics.route.b1',
            undefined,
            `A_s \\frac{dh}{dt} = I(t) - C_d A_o\\sqrt{2 g h} - C_w L (h - h_w)^{3/2}`,
          ),
          step('hydraulics.route.b2', { O: d.peakO, h: d.peakH }),
        ],
        latex: `O_{peak} = ${tex(d.peakO)}\\ \\mathrm{m^3/s},\\ h_{max} = ${tex(d.peakH)}\\ \\mathrm{m}`,
        plot: {
          title: 'hydraulics.p.routing',
          x: 'hydraulics.p.seconds',
          y: 'hydraulics.p.Q',
          series: [
            { name: 'hydraulics.p.inflow', points: d.points.map((p) => [p[0], p[1]] as const) },
            { name: 'hydraulics.p.outflow', points: d.points.map((p) => [p[0], p[2]] as const) },
          ],
        },
      };
    }
    const inflow = rows.inflow!.map((r) => r[0]!);
    const dtH = n.dt!;
    const musk = s.method === 'puls' ? null : muskingum(inflow, n.K!, n.X!, dtH);
    const outflow = musk ? musk.outflow : puls(inflow, rows.table!, dtH * 3600).outflow;
    const peakIn = Math.max(...inflow);
    const peakOut = Math.max(...outflow);
    const lagSteps = outflow.indexOf(peakOut) - inflow.indexOf(peakIn);
    return {
      answer: { key: 'hydraulics.route.answer', vars: { peakIn, peakOut, lag: lagSteps * dtH } },
      rows: [
        row('hydraulics.r.peakIn', peakIn, 'm³/s'),
        row('hydraulics.r.peakOut', peakOut, 'm³/s'),
        row('hydraulics.r.lagPeak', lagSteps * dtH, 'h'),
        ...(musk
          ? [row('hydraulics.r.C0', musk.C0), row('hydraulics.r.C1', musk.C1), row('hydraulics.r.C2', musk.C2)]
          : []),
      ],
      steps: musk
        ? [
            step(
              'hydraulics.route.m1',
              { C0: musk.C0, C1: musk.C1, C2: musk.C2 },
              `C_0 = \\frac{-KX + \\Delta t/2}{D},\\ C_1 = \\frac{KX + \\Delta t/2}{D},\\ C_2` +
                ` = \\frac{K(1 - X) - \\Delta t/2}{D}`,
            ),
            step('hydraulics.route.m2', undefined, 'O_2 = C_0 I_2 + C_1 I_1 + C_2 O_1'),
            ...(musk.stable ? [] : [step('hydraulics.route.unstable')]),
          ]
        : [
            step(
              'hydraulics.route.p1',
              undefined,
              '\\frac{2S_2}{\\Delta t} + O_2 = I_1 + I_2 + \\frac{2S_1}{\\Delta t} - O_1',
            ),
            step('hydraulics.route.p2'),
          ],
      latex: `Q_{out,peak} = ${tex(peakOut)}\\ \\mathrm{m^3/s}`,
      plot: {
        title: 'hydraulics.p.routing',
        x: 'hydraulics.p.hours',
        y: 'hydraulics.p.Q',
        series: [
          { name: 'hydraulics.p.inflow', points: inflow.map((v, i) => [i * dtH, v] as const) },
          { name: 'hydraulics.p.outflow', points: outflow.map((v, i) => [i * dtH, v] as const) },
        ],
      },
      grid: {
        caption: 'hydraulics.g.routing',
        header: ['hydraulics.g.t', 'hydraulics.g.I', 'hydraulics.g.O'],
        rows: inflow.map((v, i) => [i * dtH, v, outflow[i]!]),
      },
    };
  },
};

const frequencyCalc: Calc = {
  id: 'frequency',
  title: 'hydraulics.freq.title',
  intro: 'hydraulics.freq.intro',
  fields: (choices) => [
    pick('input', 'hydraulics.f.freqInput', [
      ['stats', 'hydraulics.o.stats'],
      ['data', 'hydraulics.o.peaks'],
    ]),
    ...(choices.input === 'data'
      ? [
          grid(
            'peaks',
            'hydraulics.f.peaks',
            [['hydraulics.f.qCol', 'flow']],
            '420\n610\n380\n720\n500\n450\n890\n560\n330\n640',
            3,
          ),
        ]
      : [num('mean', 'hydraulics.f.mean', '500', 'flow'), num('sd', 'hydraulics.f.sd', '150', 'flow')]),
    num('T', 'hydraulics.f.T', '100'),
    num('years', 'hydraulics.f.years', '30'),
  ],
  solve({ n, s, rows }): Outcome {
    const T = n.T!;
    const fit = s.input === 'data' ? frequencyFit(rows.peaks!.map((r) => r[0]!)) : null;
    const mean = fit ? fit.mean : n.mean!;
    const sd = fit ? fit.sd : n.sd!;
    const K = gumbelK(T);
    const QT = mean + K * sd;
    const r = risk(T, Math.round(n.years!));
    const lp3 = fit ? 10 ** (fit.logMean + pearsonK(T, fit.logSkew) * fit.logSd) : null;
    const Ts = [1.25, 2, 5, 10, 25, 50, 100, 200, 500];
    return {
      answer: { key: 'hydraulics.freq.answer', vars: { T, Q: QT, risk: r, n: Math.round(n.years!) } },
      rows: [
        row('hydraulics.r.KT', K),
        row('hydraulics.r.QT', QT, 'm³/s'),
        ...(lp3 === null ? [] : [row('hydraulics.r.QTlp3', lp3, 'm³/s'), row('hydraulics.r.skew', fit!.logSkew)]),
        row('hydraulics.r.risk', r),
      ],
      steps: [
        ...(fit ? [step('hydraulics.freq.stats', { mean, sd, n: fit.n })] : []),
        step(
          'hydraulics.freq.s1',
          { K },
          `K_T = -\\frac{\\sqrt6}{\\pi}\\left[0.5772 + \\ln\\ln\\frac{T}{T - 1}\\right] = ${tex(K)}`,
        ),
        step('hydraulics.freq.s2', { Q: QT }, `Q_T = \\bar Q + K_T s = ${tex(QT)}\\ \\mathrm{m^3/s}`),
        ...(lp3 === null
          ? []
          : [
              step(
                'hydraulics.freq.lp3',
                { Q: lp3, g: fit!.logSkew },
                `\\log Q_T = \\bar y + K_T(g)\\,s_y \\Rightarrow Q_T = ${tex(lp3)}`,
              ),
            ]),
        step('hydraulics.freq.risk', { risk: r }, `R = 1 - \\left(1 - \\frac1T\\right)^n = ${tex(r)}`),
      ],
      latex: `Q_{${tex(T)}} = ${tex(QT)}\\ \\mathrm{m^3/s}`,
      source: 'hydraulics.source.usgs',
      plot: {
        title: 'hydraulics.p.frequency',
        x: 'hydraulics.p.T',
        y: 'hydraulics.p.Q',
        xLog: true,
        series: [
          { name: 'hydraulics.p.gumbel', points: Ts.map((t) => [t, mean + gumbelK(t) * sd] as const) },
          ...(fit
            ? [
                {
                  name: 'hydraulics.p.lp3',
                  points: Ts.map((t) => [t, 10 ** (fit.logMean + pearsonK(t, fit.logSkew) * fit.logSd)] as const),
                  style: 'dashed' as const,
                },
                {
                  name: 'hydraulics.p.weibull',
                  points: fit.ranked.map((rk) => [rk[3], rk[0]] as const),
                  style: 'points' as const,
                },
              ]
            : []),
        ],
      },
      ...(fit
        ? {
            grid: {
              caption: 'hydraulics.g.ranked',
              header: ['hydraulics.g.rank', 'hydraulics.g.Q', 'hydraulics.g.p', 'hydraulics.g.T'],
              rows: fit.ranked.map((rk) => [rk[1], rk[0], rk[2], rk[3]]),
            },
          }
        : {}),
    };
  },
};

const usleCalc: Calc = {
  id: 'usle',
  title: 'hydraulics.usle.title',
  fields: [
    num('R', 'hydraulics.f.Rusle', '150'),
    num('K', 'hydraulics.f.Kusle', '0.3'),
    num('lambda', 'hydraulics.f.slopeLength', '50', 'length'),
    num('slope', 'hydraulics.f.slopePct', '8'),
    num('C', 'hydraulics.f.Cusle', '0.2'),
    num('P', 'hydraulics.f.Pusle', '1'),
  ],
  solve({ n }): Outcome {
    const LS = usleLS(n.lambda!, n.slope!);
    const A = n.R! * n.K! * LS * n.C! * n.P!;
    return {
      answer: { key: 'hydraulics.usle.answer', vars: { A } },
      rows: [row('hydraulics.r.LS', LS), row('hydraulics.r.soilLoss', A)],
      steps: [
        step(
          'hydraulics.usle.s1',
          { LS },
          `LS = \\left(\\frac{\\lambda}{22.13}\\right)^m (65.41\\sin^2\\theta + 4.56\\sin\\theta + 0.065)` +
            ` = ${tex(LS)}`,
        ),
        step('hydraulics.usle.s2', { A }, `A = R\\,K\\,LS\\,C\\,P = ${tex(A)}`),
      ],
      latex: `A = R\\,K\\,LS\\,C\\,P = ${tex(A)}`,
      source: 'hydraulics.source.usda',
      notes: [{ key: 'hydraulics.usle.note' }],
    };
  },
};

export const HYDROLOGY_CALCS: readonly Calc[] = [rationalCalc, scsCalc, uhCalc, routingCalc, frequencyCalc, usleCalc];
