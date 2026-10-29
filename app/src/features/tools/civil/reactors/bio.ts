// The reactors tool's residence-time, growth, and activated sludge calculations.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Outcome } from '../core/types';
import { activatedSludge, batchGrowth, chemostat, fedBatch, oxygenTransfer, rtd, segregationX } from './engine';

const DAY = 86400;

const rtdCalc: Calc = {
  id: 'rtd',
  title: 'reactors.rtd.title',
  intro: 'reactors.rtd.intro',
  fields: [
    grid(
      'data',
      'reactors.f.tracer',
      [['reactors.f.tCol'], ['reactors.f.cCol']],
      '0 0\n1 1\n2 5\n3 8\n4 10\n5 8\n6 6\n7 4\n8 3\n9 2.2\n10 1.5\n12 0.6\n14 0',
      3,
    ),
    opt('k', 'reactors.f.kSeg', '0.25'),
  ],
  solve({ o, rows }): Outcome {
    const data = rows.data!;
    const r = rtd(data);
    const X = o.k === null ? null : segregationX(data, o.k);
    const tanksX = o.k === null || !Number.isFinite(r.N) ? null : 1 - (1 + (o.k * r.tm) / r.N) ** -r.N;
    const t = data.map((d) => d[0]!);
    return {
      answer: { key: 'reactors.rtd.answer', vars: { tm: r.tm, v: r.variance } },
      rows: [
        row('reactors.r.tm', r.tm, 'min'),
        row('reactors.r.variance', r.variance, 'min²'),
        row('reactors.r.Ntanks', r.N),
        ...(Number.isFinite(r.Dnum) ? [row('reactors.r.Dnum', r.Dnum)] : []),
        ...(X === null ? [] : [row('reactors.r.Xseg', X)]),
        ...(tanksX === null ? [] : [row('reactors.r.Xtanks', tanksX)]),
      ],
      steps: [
        step(
          'reactors.rtd.s1',
          { area: r.area },
          `E(t) = \\frac{C(t)}{\\int_0^\\infty C\\,dt},\\ \\int C\\,dt = ${tex(r.area)}`,
        ),
        step('reactors.rtd.s2', { tm: r.tm }, `t_m = \\int_0^\\infty t\\,E\\,dt = ${tex(r.tm)}\\ \\mathrm{min}`),
        step(
          'reactors.rtd.s3',
          { v: r.variance },
          `\\sigma^2 = \\int_0^\\infty (t - t_m)^2 E\\,dt = ${tex(r.variance)}\\ \\mathrm{min^2}`,
        ),
        step('reactors.rtd.s4', { N: r.N }, `N = \\frac{t_m^2}{\\sigma^2} = ${tex(r.N)}`),
        ...(Number.isFinite(r.Dnum)
          ? [
              step(
                'reactors.rtd.s5',
                { D: r.Dnum },
                `\\frac{\\sigma^2}{t_m^2} = 2\\frac{D}{uL} - 2\\left(\\frac{D}{uL}\\right)^2\\left(1 - e^{-uL/D}\\right)`,
              ),
            ]
          : []),
        ...(X === null
          ? []
          : [step('reactors.rtd.s6', { X }, `X = 1 - \\int_0^\\infty e^{-kt} E(t)\\,dt = ${tex(X)}`)]),
      ],
      latex: `t_m = ${tex(r.tm)}\\ \\mathrm{min},\\quad \\sigma^2 = ${tex(r.variance)}\\ \\mathrm{min^2}`,
      notes: [{ key: 'reactors.rtd.note' }],
      plot: {
        title: 'reactors.p.rtd',
        x: 'reactors.p.time',
        y: 'reactors.p.E',
        series: [
          { name: 'reactors.p.E', points: t.map((ti, i) => [ti, r.E[i]!] as const) },
          { name: 'reactors.p.F', points: t.map((ti, i) => [ti, r.F[i]!] as const), style: 'dashed' },
        ],
      },
      grid: {
        caption: 'reactors.g.rtd',
        header: ['reactors.g.t', 'reactors.g.E', 'reactors.g.F'],
        rows: t.map((ti, i) => [ti, r.E[i]!, r.F[i]!]),
      },
    };
  },
};

const chemostatCalc: Calc = {
  id: 'chemostat',
  title: 'reactors.chemo.title',
  fields: [
    num('muMax', 'reactors.f.muMax', '0.5', 'perHour'),
    num('Ks', 'reactors.f.Ks', '0.2', 'gL'),
    num('D', 'reactors.f.D', '0.25', 'perHour'),
    num('S0', 'reactors.f.S0', '10', 'gL'),
    num('Y', 'reactors.f.Y', '0.5'),
    num('m', 'reactors.f.m', '0', 'perHour'),
    num('kd', 'reactors.f.kdGrowth', '0', 'perHour'),
  ],
  solve({ n }): Outcome {
    const c = chemostat(n.muMax!, n.Ks!, n.D!, n.S0!, n.Y!, n.m!, n.kd!);
    const Ds = linspace(0.001, Math.max(c.Dcrit, n.D!) * 1.1, 80);
    const curve = Ds.map((D) => chemostat(n.muMax!, n.Ks!, D, n.S0!, n.Y!, n.m!, n.kd!));
    return {
      answer: c.washout
        ? { key: 'reactors.chemo.washout', vars: { D: n.D!, Dcrit: c.Dcrit } }
        : { key: 'reactors.chemo.answer', vars: { S: c.S, X: c.X } },
      rows: [
        row('reactors.r.S', c.S, 'g/L'),
        row('reactors.r.Xbio', c.X, 'g/L'),
        row('reactors.r.productivity', c.productivity, 'g/(L·h)'),
        row('reactors.r.Dcrit', c.Dcrit, '1/h'),
      ],
      steps: c.washout
        ? [
            step(
              'reactors.chemo.w1',
              { Dcrit: c.Dcrit },
              `D_{crit} = \\frac{\\mu_{max} S_0}{K_s + S_0} = ${tex(c.Dcrit)}\\ \\mathrm{h^{-1}}`,
            ),
          ]
        : [
            step('reactors.chemo.s1', { S: c.S }, `S = \\frac{K_s D}{\\mu_{max} - D} = ${tex(c.S)}\\ \\mathrm{g/L}`),
            step('reactors.chemo.s2', { X: c.X, Y: c.Yobs }, `X = Y (S_0 - S) = ${tex(c.X)}\\ \\mathrm{g/L}`),
            step(
              'reactors.chemo.s3',
              { Dcrit: c.Dcrit },
              `D_{crit} = \\frac{\\mu_{max} S_0}{K_s + S_0} = ${tex(c.Dcrit)}\\ \\mathrm{h^{-1}}`,
            ),
          ],
      latex: c.washout
        ? `D_{crit} = ${tex(c.Dcrit)}\\ \\mathrm{h^{-1}}`
        : `S = ${tex(c.S)},\\ X = ${tex(c.X)}\\ \\mathrm{g/L}`,
      plot: {
        title: 'reactors.p.chemostat',
        x: 'reactors.p.D',
        y: 'reactors.p.gL',
        series: [
          { name: 'reactors.p.Xbio', points: Ds.map((D, i) => [D, curve[i]!.X] as const) },
          { name: 'reactors.p.S', points: Ds.map((D, i) => [D, curve[i]!.S] as const), style: 'dashed' },
          { name: 'reactors.p.productivity', points: Ds.map((D, i) => [D, curve[i]!.productivity] as const) },
        ],
      },
    };
  },
};

const batchCalc: Calc = {
  id: 'batch',
  title: 'reactors.batchGrowth.title',
  fields: (choices) => [
    pick('mode', 'reactors.f.culture', [
      ['batch', 'reactors.o.batchCulture'],
      ['fed', 'reactors.o.fedBatch'],
      ['oxygen', 'reactors.o.oxygen'],
    ]),
    ...(choices.mode === 'fed'
      ? [
          num('V0', 'reactors.f.V0', '1', 'liters'),
          num('X0', 'reactors.f.X0', '2', 'gL'),
          num('F', 'reactors.f.F', '0.1'),
          num('SF', 'reactors.f.SF', '100', 'gL'),
          num('Y', 'reactors.f.Y', '0.5'),
          num('t', 'reactors.f.t', '10', 'hours'),
        ]
      : choices.mode === 'oxygen'
        ? [
            num('qO2', 'reactors.f.qO2', '0.2'),
            num('X', 'reactors.f.Xbio', '5', 'gL'),
            num('Csat', 'reactors.f.Csat', '7.5', 'mgL'),
            num('CL', 'reactors.f.CL', '2', 'mgL'),
          ]
        : [
            num('muMax', 'reactors.f.muMax', '0.5', 'perHour'),
            num('Ks', 'reactors.f.Ks', '0.2', 'gL'),
            num('X0', 'reactors.f.X0', '0.1', 'gL'),
            num('S0', 'reactors.f.S0', '10', 'gL'),
            num('Y', 'reactors.f.Y', '0.5'),
            num('tEnd', 'reactors.f.tEnd', '20', 'hours'),
          ]),
  ],
  solve({ n, s }): Outcome {
    if (s.mode === 'fed') {
      const f = fedBatch(n.V0!, n.X0!, n.F!, n.SF!, n.Y!, n.t!);
      return {
        answer: { key: 'reactors.batchGrowth.fedAnswer', vars: { X: f.X, V: f.V } },
        rows: [
          row('reactors.r.Vt', f.V, 'L'),
          row('reactors.r.XV', f.XV, 'g'),
          row('reactors.r.Xbio', f.X, 'g/L'),
          row('reactors.r.Dnow', f.D, '1/h'),
        ],
        steps: [
          step('reactors.batchGrowth.f1', { V: f.V }, `V = V_0 + F t = ${tex(f.V)}\\ \\mathrm{L}`),
          step('reactors.batchGrowth.f2', { XV: f.XV }, `XV = X_0 V_0 + Y S_F F t = ${tex(f.XV)}\\ \\mathrm{g}`),
        ],
        latex: `X = \\frac{X_0 V_0 + Y S_F F t}{V_0 + F t} = ${tex(f.X)}\\ \\mathrm{g/L}`,
        notes: [{ key: 'reactors.batchGrowth.fedNote' }],
      };
    }
    if (s.mode === 'oxygen') {
      // Oxygen concentrations are typed in mg/L, which is g/m³; the uptake is g O₂ per g cells per hour.
      const o = oxygenTransfer(n.qO2!, n.X!, n.Csat!, n.CL!);
      const OUR = o.OUR * 1000;
      const kLa = OUR / (n.Csat! - n.CL!);
      return {
        answer: { key: 'reactors.batchGrowth.o2Answer', vars: { kLa } },
        rows: [row('reactors.r.OUR', OUR, 'mg/(L·h)'), row('reactors.r.kLa', kLa, '1/h')],
        steps: [
          step('reactors.batchGrowth.o1', { OUR }, `OUR = q_{O_2} X = ${tex(OUR)}\\ \\mathrm{mg/(L\\cdot h)}`),
          step('reactors.batchGrowth.o2', { kLa }, `k_L a = \\frac{OUR}{C^* - C_L} = ${tex(kLa)}\\ \\mathrm{h^{-1}}`),
        ],
        latex: `k_L a = ${tex(kLa)}\\ \\mathrm{h^{-1}}`,
      };
    }
    const b = batchGrowth(n.muMax!, n.Ks!, n.X0!, n.S0!, n.Y!, n.tEnd!);
    return {
      answer:
        b.t99 === null
          ? { key: 'reactors.batchGrowth.notDone', vars: { X: b.X, S: b.S } }
          : { key: 'reactors.batchGrowth.answer', vars: { t: b.t99, X: b.X } },
      rows: [
        row('reactors.r.Xbio', b.X, 'g/L'),
        row('reactors.r.S', b.S, 'g/L'),
        row('reactors.r.Xmax', b.Xmax, 'g/L'),
        ...(b.t99 === null ? [] : [row('reactors.r.t99', b.t99, 'h')]),
      ],
      steps: [
        step(
          'reactors.batchGrowth.s1',
          undefined,
          `\\frac{dX}{dt} = \\frac{\\mu_{max} S}{K_s + S} X,\\quad \\frac{dS}{dt} = -\\frac{1}{Y}\\frac{dX}{dt}`,
        ),
        step('reactors.batchGrowth.s2', { Xmax: b.Xmax }, `X_{max} = X_0 + Y S_0 = ${tex(b.Xmax)}\\ \\mathrm{g/L}`),
      ],
      latex: `X(t_{end}) = ${tex(b.X)}\\ \\mathrm{g/L}`,
      plot: {
        title: 'reactors.p.batch',
        x: 'reactors.p.hours',
        y: 'reactors.p.gL',
        series: [
          { name: 'reactors.p.Xbio', points: b.points.map((p) => [p[0], p[1]] as const) },
          { name: 'reactors.p.S', points: b.points.map((p) => [p[0], p[2]] as const), style: 'dashed' },
        ],
      },
    };
  },
};

const sludgeCalc: Calc = {
  id: 'sludge',
  title: 'reactors.sludge.title',
  intro: 'reactors.sludge.intro',
  fields: [
    num('Y', 'reactors.f.Ysludge', '0.6'),
    num('kd', 'reactors.f.kd', '0.06', 'perDay'),
    num('k', 'reactors.f.kMax', '5', 'perDay'),
    num('Ks', 'reactors.f.KsSludge', '60', 'mgL'),
    num('srt', 'reactors.f.srt', '10', 'days'),
    num('hrt', 'reactors.f.hrt', '0.25', 'days'),
    num('S0', 'reactors.f.S0sludge', '200', 'mgL'),
    num('Q', 'reactors.f.Q', '1000', 'flow', { unit: 'm³/d' }),
    opt('S', 'reactors.f.Sgiven', '', 'mgL'),
  ],
  solve({ n, o }): Outcome {
    const r = activatedSludge({
      Y: n.Y!,
      kd: n.kd!,
      k: n.k!,
      Ks: n.Ks!,
      srt: n.srt!,
      hrt: n.hrt!,
      S0: n.S0!,
      Q: n.Q! * DAY,
      S: o.S,
    });
    return {
      answer: { key: 'reactors.sludge.answer', vars: { S: r.S, X: r.X } },
      rows: [
        row('reactors.r.Ssludge', r.S, 'mg/L'),
        row('reactors.r.Xsludge', r.X, 'mg/L'),
        row('reactors.r.Vsludge', r.V, 'm³'),
        row('reactors.r.Yobs', r.Yobs),
        row('reactors.r.Px', r.Px, 'kg/d'),
        row('reactors.r.O2', r.O2, 'kg/d'),
        row('reactors.r.FM', r.FM, '1/d'),
        row('reactors.r.srtMin', r.srtMin, 'd'),
      ],
      steps: [
        step(
          o.S === null ? 'reactors.sludge.s1' : 'reactors.sludge.s1given',
          { S: r.S, model: r.Smodel },
          `S = \\frac{K_s (1 + k_d \\theta_c)}{\\theta_c (Y k - k_d) - 1} = ${tex(r.Smodel)}\\ \\mathrm{mg/L}`,
        ),
        step(
          'reactors.sludge.s2',
          { X: r.X },
          `X = \\frac{\\theta_c Y (S_0 - S)}{\\theta (1 + k_d \\theta_c)} = ${tex(r.X)}\\ \\mathrm{mg/L}`,
        ),
        step(
          'reactors.sludge.s3',
          { Px: r.Px },
          `P_x = \\frac{Y}{1 + k_d \\theta_c} Q (S_0 - S) = ${tex(r.Px)}\\ \\mathrm{kg/d}`,
        ),
        step('reactors.sludge.s4', { O2: r.O2 }, `O_2 = Q (S_0 - S) - 1.42 P_x = ${tex(r.O2)}\\ \\mathrm{kg/d}`),
        step('reactors.sludge.s5', { FM: r.FM }, `F/M = \\frac{Q S_0}{V X} = ${tex(r.FM)}\\ \\mathrm{d^{-1}}`),
      ],
      latex: `X = \\frac{\\theta_c Y (S_0 - S)}{\\theta (1 + k_d \\theta_c)} = ${tex(r.X)}\\ \\mathrm{mg/L}`,
      notes: [{ key: 'reactors.sludge.note' }],
      plot: {
        title: 'reactors.p.sludge',
        x: 'reactors.p.srt',
        y: 'reactors.p.mgL',
        series: [
          {
            name: 'reactors.p.Ssludge',
            points: linspace(r.srtMin * 1.05, Math.max(n.srt! * 2, r.srtMin * 4), 60).map((srt) => {
              const denom = srt * (n.Y! * n.k! - n.kd!) - 1;
              return [srt, (n.Ks! * (1 + n.kd! * srt)) / denom] as const;
            }),
          },
        ],
      },
    };
  },
};

export const BIO_CALCS: readonly Calc[] = [rtdCalc, chemostatCalc, batchCalc, sludgeCalc];
