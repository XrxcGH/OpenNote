// The groundwater tool's calculations: fields in, a worded result out. The methods are in ./engine.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { logspace, linspace } from '../core/num';
import type { Calc, Input, Outcome } from '../core/types';
import {
  GAMMA_W,
  captureZone,
  damSeepage,
  darcy,
  dupuit,
  fitJacob,
  fitTheis,
  flowNet,
  hantushW,
  layered,
  ogataBanks,
  retardation,
  superpose,
  theis,
  theisU,
  thiem,
  threeWells,
} from './engine';
import type { Boundary } from './engine';

const K = (label = 'groundwater.f.K') => num('K', label, '1e-4', 'conductivity');

const darcyCalc: Calc = {
  id: 'darcy',
  title: 'groundwater.darcy.title',
  fields: [
    K(),
    num('i', 'groundwater.f.i', '0.01'),
    num('ne', 'groundwater.f.ne', '0.3'),
    opt('A', 'groundwater.f.A', '', 'area'),
  ],
  solve({ n, o }: Input): Outcome {
    const r = darcy(n.K!, n.i!, n.ne!, o.A ?? null);
    return {
      answer: { key: 'groundwater.darcy.answer', vars: { q: r.q, v: r.v } },
      rows: [
        row('groundwater.r.q', r.q, 'm/s'),
        row('groundwater.r.v', r.v, 'm/s'),
        ...(r.Q === null ? [] : [row('groundwater.r.Q', r.Q, 'm³/s')]),
      ],
      steps: [
        step(
          'groundwater.darcy.s1',
          { q: r.q },
          `q = K i = ${tex(n.K!)} \\times ${tex(n.i!)} = ${tex(r.q)}\\ \\mathrm{m/s}`,
        ),
        step(
          'groundwater.darcy.s2',
          { v: r.v },
          `v = \\frac{q}{n_e} = \\frac{${tex(r.q)}}{${tex(n.ne!)}} = ${tex(r.v)}\\ \\mathrm{m/s}`,
        ),
        ...(r.Q === null ? [] : [step('groundwater.darcy.s3', { Q: r.Q }, `Q = q A = ${tex(r.Q)}\\ \\mathrm{m^3/s}`)]),
      ],
      latex: `q = K i = ${tex(r.q)}\\ \\mathrm{m/s},\\quad v = q/n_e = ${tex(r.v)}\\ \\mathrm{m/s}`,
    };
  },
};

const threeWellCalc: Calc = {
  id: 'threeWells',
  title: 'groundwater.three.title',
  intro: 'groundwater.three.intro',
  fields: [
    grid(
      'wells',
      'groundwater.f.wells',
      [
        ['groundwater.f.x', 'length'],
        ['groundwater.f.y', 'length'],
        ['groundwater.f.head', 'length'],
      ],
      '0 0 30\n400 0 29.6\n0 300 29.9',
      3,
    ),
    opt('K', 'groundwater.f.K', '', 'conductivity'),
    opt('ne', 'groundwater.f.ne', ''),
  ],
  solve({ rows, o }) {
    const plane = threeWells(rows.wells!);
    const q = o.K === null ? null : o.K! * plane.gradient;
    const v = q !== null && o.ne ? q / o.ne : null;
    return {
      answer: { key: 'groundwater.three.answer', vars: { i: plane.gradient, azimuth: plane.azimuth } },
      rows: [
        row('groundwater.r.gradient', plane.gradient),
        row('groundwater.r.azimuth', plane.azimuth, '°'),
        row('groundwater.r.dhdx', plane.a),
        row('groundwater.r.dhdy', plane.b),
        ...(q === null ? [] : [row('groundwater.r.q', q, 'm/s')]),
        ...(v === null ? [] : [row('groundwater.r.v', v, 'm/s')]),
      ],
      steps: [
        step(
          'groundwater.three.s1',
          { a: plane.a, b: plane.b, c: plane.c },
          `h = ${tex(plane.a)}\\,x + ${tex(plane.b)}\\,y + ${tex(plane.c)}`,
        ),
        step('groundwater.three.s2', { i: plane.gradient }, `i = \\sqrt{a^2 + b^2} = ${tex(plane.gradient)}`),
        step('groundwater.three.s3', { azimuth: plane.azimuth }),
      ],
      latex: `i = \\sqrt{(\\partial h/\\partial x)^2 + (\\partial h/\\partial y)^2} = ${tex(plane.gradient)}`,
    };
  },
};

const layersCalc: Calc = {
  id: 'layers',
  title: 'groundwater.layers.title',
  fields: [
    grid(
      'layers',
      'groundwater.f.layers',
      [
        ['groundwater.f.thickness', 'length'],
        ['groundwater.f.K', 'conductivity'],
      ],
      '2 1e-3\n3 1e-5\n1 1e-4',
    ),
  ],
  solve({ rows }) {
    const r = layered(rows.layers!);
    return {
      answer: { key: 'groundwater.layers.answer', vars: { kh: r.kh, kv: r.kv } },
      rows: [
        row('groundwater.r.kh', r.kh, 'm/s'),
        row('groundwater.r.kv', r.kv, 'm/s'),
        row('groundwater.r.ratio', r.kh / r.kv),
        row('groundwater.r.thickness', r.total, 'm'),
      ],
      steps: [
        step(
          'groundwater.layers.s1',
          { kh: r.kh },
          `K_h = \\frac{\\sum K_i b_i}{\\sum b_i} = ${tex(r.kh)}\\ \\mathrm{m/s}`,
        ),
        step(
          'groundwater.layers.s2',
          { kv: r.kv },
          `K_v = \\frac{\\sum b_i}{\\sum b_i / K_i} = ${tex(r.kv)}\\ \\mathrm{m/s}`,
        ),
      ],
      latex: `K_h = \\frac{\\sum K_i b_i}{\\sum b_i} = ${tex(r.kh)},\\quad K_v = \\frac{\\sum b_i}{\\sum b_i/K_i} = ${tex(r.kv)}`,
    };
  },
};

const steadyCalc: Calc = {
  id: 'steady',
  title: 'groundwater.steady.title',
  fields: [
    pick('type', 'groundwater.f.aquifer', [
      ['confined', 'groundwater.o.confined'],
      ['unconfined', 'groundwater.o.unconfined'],
    ]),
    num('Q', 'groundwater.f.Q', '0.01', 'flow'),
    K(),
    num('b', 'groundwater.f.b', '20', 'length', { help: 'groundwater.h.b' }),
    num('R', 'groundwater.f.R', '500', 'length'),
    num('r', 'groundwater.f.r', '10', 'length'),
  ],
  solve({ n, s }) {
    const confined = s.type === 'confined';
    const T = n.K! * n.b!;
    const at = (r: number) => (confined ? thiem(n.Q!, T, n.R!, r) : dupuit(n.Q!, n.K!, n.b!, n.R!, r).s);
    const drawdown = at(n.r!);
    const cone = logspace(n.r!, n.R! * 0.999, 40).map((r) => [r, at(r)] as const);
    const head = n.b! - drawdown;
    return {
      answer: { key: 'groundwater.steady.answer', vars: { s: drawdown, r: n.r! } },
      rows: [
        row('groundwater.r.s', drawdown, 'm'),
        ...(confined ? [row('groundwater.r.T', T, 'm²/s')] : [row('groundwater.r.h', head, 'm')]),
      ],
      steps: confined
        ? [
            step('groundwater.steady.s1', { T }, `T = K b = ${tex(T)}\\ \\mathrm{m^2/s}`),
            step(
              'groundwater.steady.s2',
              { s: drawdown },
              `s = \\frac{Q}{2\\pi T}\\ln\\frac{R}{r} = ${tex(drawdown)}\\ \\mathrm{m}`,
            ),
          ]
        : [
            step(
              'groundwater.steady.s3',
              { h: head },
              `h = \\sqrt{H^2 - \\frac{Q}{\\pi K}\\ln\\frac{R}{r}} = ${tex(head)}\\ \\mathrm{m}`,
            ),
            step('groundwater.steady.s4', { s: drawdown }, `s = H - h = ${tex(drawdown)}\\ \\mathrm{m}`),
          ],
      latex: confined
        ? `s = \\frac{Q}{2\\pi T}\\ln\\frac{R}{r} = ${tex(drawdown)}\\ \\mathrm{m}`
        : `h^2 = H^2 - \\frac{Q}{\\pi K}\\ln\\frac{R}{r},\\quad s = ${tex(drawdown)}\\ \\mathrm{m}`,
      plot: {
        title: 'groundwater.p.cone',
        x: 'groundwater.p.radius',
        y: 'groundwater.p.drawdown',
        xLog: true,
        yDown: true,
        series: [{ name: 'groundwater.p.drawdown', points: cone }],
      },
    };
  },
};

const transientCalc: Calc = {
  id: 'transient',
  title: 'groundwater.transient.title',
  fields: (choices) => [
    pick('model', 'groundwater.f.model', [
      ['theis', 'groundwater.o.theis'],
      ['hantush', 'groundwater.o.hantush'],
    ]),
    num('Q', 'groundwater.f.Q', '0.01', 'flow'),
    num('T', 'groundwater.f.T', '0.001', 'transmissivity'),
    num('S', 'groundwater.f.S', '1e-4'),
    num('r', 'groundwater.f.r', '10', 'length'),
    num('t', 'groundwater.f.t', '250', 'seconds'),
    ...(choices.model === 'hantush' ? [num('B', 'groundwater.f.B', '100', 'length', { help: 'groundwater.h.B' })] : []),
  ],
  solve({ n, s }) {
    const hantush = s.model === 'hantush';
    const result = theis(n.Q!, n.T!, n.S!, n.r!, n.t!);
    const beta = hantush ? n.r! / n.B! : 0;
    const W = hantush ? hantushW(result.u, beta) : result.W;
    const drawdown = result.factor * W;
    const curve = (t: number) =>
      result.factor * (hantush ? hantushW(theisU(n.r!, n.S!, n.T!, t), beta) : theis(n.Q!, n.T!, n.S!, n.r!, t).W);
    const times = logspace(n.t! / 100, n.t! * 100, 50);
    const notes = !hantush && result.u > 0.05 ? [{ key: 'groundwater.transient.uLarge', vars: { u: result.u } }] : [];
    return {
      answer: { key: 'groundwater.transient.answer', vars: { s: drawdown } },
      rows: [
        row('groundwater.r.u', result.u),
        row(hantush ? 'groundwater.r.Wleaky' : 'groundwater.r.W', W),
        ...(hantush ? [row('groundwater.r.rB', beta)] : []),
        row('groundwater.r.s', drawdown, 'm'),
        ...(hantush ? [] : [row('groundwater.r.sJacob', result.jacob, 'm')]),
      ],
      steps: [
        step('groundwater.transient.s1', { u: result.u }, `u = \\frac{r^2 S}{4 T t} = ${tex(result.u)}`),
        hantush
          ? step(
              'groundwater.transient.s2h',
              { W },
              `W(u, r/B) = \\int_u^\\infty \\frac{1}{y} e^{-y - \\frac{(r/B)^2}{4y}}\\,dy = ${tex(W)}`,
            )
          : step('groundwater.transient.s2', { W }, `W(u) = E_1(u) = ${tex(W)}`),
        step(
          'groundwater.transient.s3',
          { s: drawdown },
          `s = \\frac{Q}{4\\pi T} W = ${tex(result.factor)} \\times ${tex(W)} = ${tex(drawdown)}\\ \\mathrm{m}`,
        ),
        ...(hantush
          ? []
          : [
              step(
                'groundwater.transient.s4',
                { s: result.jacob },
                `s \\approx \\frac{Q}{4\\pi T}\\left(-0.5772 - \\ln u\\right) = ${tex(result.jacob)}\\ \\mathrm{m}`,
              ),
            ]),
      ],
      notes,
      latex: `s = \\frac{Q}{4\\pi T}\\,W(u),\\quad u = \\frac{r^2 S}{4 T t} = ${tex(result.u)},\\quad s = ${tex(drawdown)}\\ \\mathrm{m}`,
      plot: {
        title: 'groundwater.p.timeDrawdown',
        x: 'groundwater.p.time',
        y: 'groundwater.p.drawdown',
        xLog: true,
        yDown: true,
        series: [
          {
            name: hantush ? 'groundwater.o.hantush' : 'groundwater.o.theis',
            points: times.map((t) => [t, curve(t)] as const),
          },
        ],
      },
    };
  },
};

const PUMP_DATA = '60 0.1952\n120 0.3796\n300 0.6832\n600 0.9375\n1200 1.2023\n3000 1.5603\n6000 1.8338\n12000 2.1085';

const pumpCalc: Calc = {
  id: 'pumpTest',
  title: 'groundwater.pump.title',
  intro: 'groundwater.pump.intro',
  fields: [
    pick('method', 'groundwater.f.method', [
      ['theis', 'groundwater.o.theisFit'],
      ['jacob', 'groundwater.o.jacobFit'],
    ]),
    num('Q', 'groundwater.f.Q', '0.01', 'flow'),
    num('r', 'groundwater.f.rObs', '30', 'length'),
    grid(
      'data',
      'groundwater.f.data',
      [
        ['groundwater.f.time', 'seconds'],
        ['groundwater.f.drawdown', 'length'],
      ],
      PUMP_DATA,
      3,
    ),
  ],
  solve({ n, s, rows }) {
    const data = rows.data!;
    const jacob = s.method === 'jacob';
    const fit = jacob ? fitJacob(data, n.Q!, n.r!) : fitTheis(data, n.Q!, n.r!);
    const times = logspace(Math.min(...data.map((d) => d[0]!)) / 2, Math.max(...data.map((d) => d[0]!)) * 2, 50);
    const model = (t: number) =>
      jacob
        ? (fit as ReturnType<typeof fitJacob>).slope * Math.log10(t / (fit as ReturnType<typeof fitJacob>).t0)
        : theis(n.Q!, fit.T, fit.S, n.r!, t).s;
    const uFirst = theisU(n.r!, fit.S, fit.T, Math.min(...data.map((d) => d[0]!)));
    const jacobFit = jacob ? (fit as ReturnType<typeof fitJacob>) : null;
    return {
      answer: { key: 'groundwater.pump.answer', vars: { T: fit.T, S: fit.S } },
      rows: [
        row('groundwater.r.T', fit.T, 'm²/s'),
        row('groundwater.r.S', fit.S),
        ...(jacobFit
          ? [row('groundwater.r.slope', jacobFit.slope, 'm'), row('groundwater.r.t0', jacobFit.t0, 's')]
          : [row('groundwater.r.rms', (fit as ReturnType<typeof fitTheis>).rms, 'm')]),
        row('groundwater.r.uFirst', uFirst),
      ],
      steps: jacobFit
        ? [
            step('groundwater.pump.j1', { ds: jacobFit.slope, t0: jacobFit.t0 }),
            step(
              'groundwater.pump.j2',
              { T: fit.T },
              `T = \\frac{2.303 Q}{4\\pi \\Delta s} = ${tex(fit.T)}\\ \\mathrm{m^2/s}`,
            ),
            step('groundwater.pump.j3', { S: fit.S }, `S = \\frac{2.25 T t_0}{r^2} = ${tex(fit.S)}`),
          ]
        : [
            step('groundwater.pump.t1'),
            step('groundwater.pump.t2', { T: fit.T, S: fit.S, rms: (fit as ReturnType<typeof fitTheis>).rms }),
          ],
      notes: jacob && uFirst > 0.05 ? [{ key: 'groundwater.pump.early', vars: { u: uFirst } }] : [],
      latex: `T = ${tex(fit.T)}\\ \\mathrm{m^2/s},\\quad S = ${tex(fit.S)}`,
      plot: {
        title: 'groundwater.p.fit',
        x: 'groundwater.p.time',
        y: 'groundwater.p.drawdown',
        xLog: true,
        series: [
          { name: 'groundwater.p.measured', points: data.map((d) => [d[0]!, d[1]!] as const), style: 'points' },
          { name: 'groundwater.p.fitted', points: times.map((t) => [t, model(t)] as const) },
        ],
      },
    };
  },
};

const superCalc: Calc = {
  id: 'superpose',
  title: 'groundwater.super.title',
  intro: 'groundwater.super.intro',
  fields: [
    grid(
      'wells',
      'groundwater.f.wellsQ',
      [
        ['groundwater.f.x', 'length'],
        ['groundwater.f.y', 'length'],
        ['groundwater.f.Q', 'flow'],
      ],
      '10 0 0.01\n40 30 0.005',
    ),
    num('px', 'groundwater.f.px', '0', 'length'),
    num('py', 'groundwater.f.py', '0', 'length'),
    num('T', 'groundwater.f.T', '0.001', 'transmissivity'),
    num('S', 'groundwater.f.S', '1e-4'),
    num('t', 'groundwater.f.t', '3600', 'seconds'),
    pick('boundary', 'groundwater.f.boundary', [
      ['none', 'groundwater.o.none'],
      ['recharge', 'groundwater.o.recharge'],
      ['barrier', 'groundwater.o.barrier'],
    ]),
  ],
  solve({ n, s, rows }) {
    const result = superpose(rows.wells!, [n.px!, n.py!], { T: n.T!, S: n.S!, t: n.t! }, s.boundary as Boundary);
    return {
      answer: { key: 'groundwater.super.answer', vars: { s: result.total } },
      rows: [row('groundwater.r.sTotal', result.total, 'm'), row('groundwater.r.wellCount', result.parts.length)],
      steps: [
        ...result.parts.map((p, i) =>
          step(p.image ? 'groundwater.super.image' : 'groundwater.super.well', { n: i + 1, r: p.r, u: p.u, s: p.s }),
        ),
        step(
          'groundwater.super.total',
          { s: result.total },
          `s = \\sum_i \\frac{Q_i}{4\\pi T} W(u_i) = ${tex(result.total)}\\ \\mathrm{m}`,
        ),
      ],
      latex: `s = \\sum_i \\frac{Q_i}{4\\pi T} W(u_i) = ${tex(result.total)}\\ \\mathrm{m}`,
      grid: {
        caption: 'groundwater.super.grid',
        header: [
          'groundwater.f.x',
          'groundwater.f.y',
          'groundwater.f.Q',
          'groundwater.r.r',
          'groundwater.r.u',
          'groundwater.r.s',
        ],
        rows: result.parts.map((p) => [p.x, p.y, p.Q, p.r, p.u, p.s]),
      },
    };
  },
};

const captureCalc: Calc = {
  id: 'capture',
  title: 'groundwater.capture.title',
  fields: [
    num('Q', 'groundwater.f.Q', '0.01', 'flow'),
    num('b', 'groundwater.f.thicknessB', '10', 'length'),
    K(),
    num('i', 'groundwater.f.i', '0.005'),
  ],
  solve({ n }) {
    const zone = captureZone(n.Q!, n.b!, n.K!, n.i!);
    const ys = linspace((-zone.far / 2) * 0.98, (zone.far / 2) * 0.98, 81).filter((y) => Math.abs(y) > 1e-9);
    const boundary = ys.map((y) => [-y / Math.tan((2 * Math.PI * n.b! * zone.q * y) / n.Q!), y] as const);
    return {
      answer: { key: 'groundwater.capture.answer', vars: { far: zone.far, well: zone.atWell, x0: zone.stagnation } },
      rows: [
        row('groundwater.r.far', zone.far, 'm'),
        row('groundwater.r.atWell', zone.atWell, 'm'),
        row('groundwater.r.x0', zone.stagnation, 'm'),
        row('groundwater.r.q', zone.q, 'm/s'),
      ],
      steps: [
        step('groundwater.capture.s1', { q: zone.q }, `q = K i = ${tex(zone.q)}\\ \\mathrm{m/s}`),
        step(
          'groundwater.capture.s2',
          { x0: zone.stagnation },
          `x_0 = \\frac{Q}{2\\pi b q} = ${tex(zone.stagnation)}\\ \\mathrm{m}`,
        ),
        step(
          'groundwater.capture.s3',
          { far: zone.far, well: zone.atWell },
          `y_{\\max} = \\pm\\frac{Q}{2 b q},\\quad W = \\frac{Q}{b q} = ${tex(zone.far)}\\ \\mathrm{m}`,
        ),
      ],
      latex: `x = -\\frac{y}{\\tan\\left(2\\pi b q y / Q\\right)},\\quad W = \\frac{Q}{b q} = ${tex(zone.far)}\\ \\mathrm{m}`,
      plot: {
        title: 'groundwater.p.capture',
        x: 'groundwater.p.x',
        y: 'groundwater.p.y',
        equal: true,
        series: [{ name: 'groundwater.p.zone', points: boundary.filter((p) => p[0] > -zone.far * 3) }],
      },
    };
  },
};

const flowNetCalc: Calc = {
  id: 'flowNet',
  title: 'groundwater.net.title',
  fields: [
    num('k', 'groundwater.f.k', '1e-5', 'conductivity'),
    num('H', 'groundwater.f.H', '10', 'length'),
    num('Nf', 'groundwater.f.Nf', '4'),
    num('Nd', 'groundwater.f.Nd', '12'),
    opt('l', 'groundwater.f.exitLength', '', 'length'),
  ],
  solve({ n, o }) {
    const net = flowNet(n.k!, n.H!, n.Nf!, n.Nd!, o.l ?? null);
    return {
      answer: { key: 'groundwater.net.answer', vars: { q: net.q } },
      rows: [
        row('groundwater.r.qWidth', net.q, 'm³/s per m'),
        row('groundwater.r.drop', net.drop, 'm'),
        ...(net.exit === null ? [] : [row('groundwater.r.exit', net.exit)]),
      ],
      steps: [
        step(
          'groundwater.net.s1',
          { q: net.q },
          `q = k H \\frac{N_f}{N_d} = ${tex(n.k!)} \\times ${tex(n.H!)} \\times \\frac{${tex(n.Nf!)}}{${tex(n.Nd!)}} = ${tex(net.q)}`,
        ),
        step('groundwater.net.s2', { drop: net.drop }, `\\Delta h = H / N_d = ${tex(net.drop)}\\ \\mathrm{m}`),
        ...(net.exit === null
          ? []
          : [step('groundwater.net.s3', { i: net.exit }, `i_{exit} = \\Delta h / l = ${tex(net.exit)}`)]),
      ],
      latex: `q = k H \\frac{N_f}{N_d} = ${tex(net.q)}\\ \\mathrm{m^3/s\\ per\\ m}`,
    };
  },
};

const damCalc: Calc = {
  id: 'dam',
  title: 'groundwater.dam.title',
  intro: 'groundwater.dam.intro',
  fields: [
    num('k', 'groundwater.f.k', '1e-5', 'conductivity'),
    num('H', 'groundwater.f.H', '10', 'length'),
    num('B', 'groundwater.f.base', '20', 'length'),
    num('D', 'groundwater.f.depth', '10', 'length'),
    num('side', 'groundwater.f.side', '30', 'length'),
  ],
  solve({ n }) {
    const r = damSeepage({ k: n.k!, H: n.H!, B: n.B!, D: n.D!, side: n.side! });
    return {
      answer: { key: 'groundwater.dam.answer', vars: { q: r.q, U: r.upliftForce } },
      rows: [
        row('groundwater.r.qWidth', r.q, 'm³/s per m'),
        row('groundwater.r.inflow', r.inflow, 'm³/s per m'),
        row('groundwater.r.uplift', r.upliftForce, 'kN/m'),
        row('groundwater.r.exit', r.exitGradient),
      ],
      steps: [
        step(
          'groundwater.dam.s1',
          { iterations: r.iterations },
          `\\frac{\\partial^2 h}{\\partial x^2} + \\frac{\\partial^2 h}{\\partial z^2} = 0`,
        ),
        step(
          'groundwater.dam.s2',
          { q: r.q, inflow: r.inflow },
          `q = \\int k \\frac{\\partial h}{\\partial z}\\,dx = ${tex(r.q)}`,
        ),
        step(
          'groundwater.dam.s3',
          { U: r.upliftForce },
          `U = \\int \\gamma_w h\\,dx = ${tex(r.upliftForce)}\\ \\mathrm{kN/m}`,
        ),
      ],
      notes: [{ key: 'groundwater.dam.gammaW', vars: { g: GAMMA_W } }],
      latex: `q = ${tex(r.q)}\\ \\mathrm{m^3/s\\ per\\ m},\\quad U = ${tex(r.upliftForce)}\\ \\mathrm{kN/m}`,
      plot: {
        title: 'groundwater.p.uplift',
        x: 'groundwater.p.fromHeel',
        y: 'groundwater.p.pressure',
        series: [{ name: 'groundwater.p.upliftSeries', points: r.uplift }],
      },
    };
  },
};

const OGATA =
  '\\frac{C}{C_0} = \\tfrac{1}{2}\\left[\\operatorname{erfc}\\frac{x - v t}{2\\sqrt{D t}} + ' +
  'e^{v x / D}\\operatorname{erfc}\\frac{x + v t}{2\\sqrt{D t}}\\right]';

const transportCalc: Calc = {
  id: 'transport',
  title: 'groundwater.transport.title',
  intro: 'groundwater.transport.intro',
  fields: [
    num('x', 'groundwater.f.xDist', '10', 'length'),
    num('v', 'groundwater.f.vSeep', '1', 'slowSpeed'),
    num('D', 'groundwater.f.D', '1', 'diffusion'),
    num('t', 'groundwater.f.tDays', '10', 'days'),
    opt('rho', 'groundwater.f.rhoB', '', 'density'),
    opt('Kd', 'groundwater.f.Kd', '', 'partition'),
    opt('n', 'groundwater.f.n', ''),
    opt('lambda', 'groundwater.f.lambda', '', 'perDay'),
  ],
  solve({ n, o }) {
    const sorbs = o.rho !== null && o.Kd !== null && o.n !== null;
    const R = sorbs ? retardation(o.rho! / 1000, o.Kd!, o.n!) : 1;
    const lambda = o.lambda ?? 0;
    const c = ogataBanks(n.x!, n.v!, n.D!, n.t!, R, lambda);
    const tEnd = Math.max(3 * n.t!, (3 * n.x! * R) / Math.max(n.v!, 1e-12));
    const times = linspace(tEnd / 200, tEnd, 120);
    return {
      answer: { key: 'groundwater.transport.answer', vars: { c, x: n.x!, t: n.t! } },
      rows: [
        row('groundwater.r.c', c),
        row('groundwater.r.R', R),
        row('groundwater.r.vR', n.v! / R, 'm/d'),
        row('groundwater.r.DR', n.D! / R, 'm²/d'),
      ],
      steps: [
        ...(sorbs ? [step('groundwater.transport.s0', { R }, `R = 1 + \\frac{\\rho_b K_d}{n} = ${tex(R)}`)] : []),
        step('groundwater.transport.s1', { c }, `${OGATA} = ${tex(c)}`),
        ...(lambda > 0 ? [step('groundwater.transport.s2', { lambda })] : []),
      ],
      latex: `${OGATA} = ${tex(c)}`,
      plot: {
        title: 'groundwater.p.breakthrough',
        x: 'groundwater.p.timeDays',
        y: 'groundwater.p.relative',
        series: [
          {
            name: 'groundwater.p.relative',
            points: times.map((t) => [t, ogataBanks(n.x!, n.v!, n.D!, t, R, lambda)] as const),
          },
        ],
      },
    };
  },
};

export const CALCS: readonly Calc[] = [
  darcyCalc,
  threeWellCalc,
  layersCalc,
  steadyCalc,
  transientCalc,
  pumpCalc,
  superCalc,
  captureCalc,
  flowNetCalc,
  damCalc,
  transportCalc,
];
