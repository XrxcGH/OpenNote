// The water quality and treatment tool's calculations. The methods are in ./engine.
import { grid, num, opt, pick, row, step } from '../core/calc';
import { tex } from '../core/format';
import { linspace } from '../core/num';
import type { Calc, Outcome } from '../core/types';
import {
  alkalinity,
  alphas,
  basin,
  bod,
  bufferIntensity,
  chickWatson,
  closedPh,
  fitBod,
  headloss,
  mix,
  openPh,
  osmotic,
  oxygenSaturation,
  rateAt,
  scaling,
  seriesFlux,
  softening,
  stokes,
  streeterPhelps,
  timeForLogs,
  totalCarbonate,
} from './engine';

const BK_SOURCE = 'water.source.benson';

const SAG_TC =
  't_c = \\frac{1}{k_a - k_d}\\ln\\left[\\frac{k_a}{k_d}' +
  '\\left(1 - \\frac{D_0 (k_a - k_d)}{k_d L_0}\\right)\\right]';
const LIME = '\\mathrm{Lime} = [\\mathrm{CO_2}] + [\\mathrm{HCO_3^-}] + [\\mathrm{Mg^{2+}}] + \\text{excess}';
const ERGUN =
  '\\frac{h_L}{L} = \\frac{150\\,\\mu (1-\\varepsilon)^2 v}{\\rho g \\varepsilon^3 \\phi^2 d^2} + ' +
  '\\frac{1.75 (1-\\varepsilon) v^2}{g \\varepsilon^3 \\phi d}';

const bodCalc: Calc = {
  id: 'bod',
  title: 'water.bod.title',
  fields: [
    num('L0', 'water.f.L0', '200', 'mgL'),
    num('k', 'water.f.k20', '0.23', 'perDay'),
    num('theta', 'water.f.theta', '1.047'),
    num('T', 'water.f.T', '20', 'temperature'),
    num('t', 'water.f.t', '5', 'days'),
  ],
  solve({ n }) {
    const k = rateAt(n.k!, n.theta!, n.T!);
    const value = bod(n.L0!, k, n.t!);
    const end = Math.max(20, 2 * n.t!);
    return {
      answer: { key: 'water.bod.answer', vars: { t: n.t!, bod: value } },
      rows: [
        row('water.r.bod', value, 'mg/L'),
        row('water.r.kT', k, '1/d'),
        row('water.r.left', n.L0! - value, 'mg/L'),
      ],
      steps: [
        step(
          'water.bod.s1',
          { k },
          `k_T = k_{20}\\,\\theta^{T-20} = ${tex(n.k!)} \\times ${tex(n.theta!)}^{${tex(n.T! - 20)}} = ${tex(k)}`,
        ),
        step('water.bod.s2', { bod: value }, `BOD_t = L_0\\left(1 - e^{-k t}\\right) = ${tex(value)}\\ \\mathrm{mg/L}`),
      ],
      latex: `BOD_t = L_0\\left(1 - e^{-k_T t}\\right) = ${tex(value)}\\ \\mathrm{mg/L}`,
      plot: {
        title: 'water.p.bod',
        x: 'water.p.days',
        y: 'water.p.bodAxis',
        series: [
          { name: 'water.p.bodSeries', points: linspace(0, end, 60).map((t) => [t, bod(n.L0!, k, t)] as const) },
        ],
      },
    };
  },
};

const bodFitCalc: Calc = {
  id: 'bodFit',
  title: 'water.fit.title',
  intro: 'water.fit.intro',
  fields: [
    pick('method', 'water.f.method', [
      ['curve', 'water.o.curve'],
      ['thomas', 'water.o.thomas'],
    ]),
    grid(
      'data',
      'water.f.bodData',
      [
        ['water.f.day', 'days'],
        ['water.f.bodCol', 'mgL'],
      ],
      '1 41\n2 74\n3 100\n5 137\n7 160\n10 180',
      3,
    ),
  ],
  solve({ s, rows }) {
    const data = rows.data!;
    const fit = fitBod(data, s.method === 'thomas' ? 'thomas' : 'curve');
    const end = Math.max(...data.map((d) => d[0]!)) * 1.3;
    return {
      answer: { key: 'water.fit.answer', vars: { L0: fit.L0, k: fit.k } },
      rows: [row('water.r.L0', fit.L0, 'mg/L'), row('water.r.k', fit.k, '1/d')],
      steps: [
        step(
          'water.fit.s1',
          { A: fit.A, B: fit.B },
          `\\left(\\frac{t}{y}\\right)^{1/3} = ${tex(fit.A)} + ${tex(fit.B)}\\,t`,
        ),
        step('water.fit.s2', { k: (6 * fit.B) / fit.A }, `k = 6B/A = ${tex((6 * fit.B) / fit.A)}\\ \\mathrm{d^{-1}}`),
        ...(s.method === 'thomas' ? [] : [step('water.fit.s3', { L0: fit.L0, k: fit.k })]),
      ],
      latex: `L_0 = ${tex(fit.L0)}\\ \\mathrm{mg/L},\\quad k = ${tex(fit.k)}\\ \\mathrm{d^{-1}}`,
      plot: {
        title: 'water.p.bodFit',
        x: 'water.p.days',
        y: 'water.p.bodAxis',
        series: [
          { name: 'water.p.measured', points: data.map((d) => [d[0]!, d[1]!] as const), style: 'points' },
          { name: 'water.p.fitted', points: linspace(0, end, 60).map((t) => [t, bod(fit.L0, fit.k, t)] as const) },
        ],
      },
    };
  },
};

const oxygenCalc: Calc = {
  id: 'oxygen',
  title: 'water.oxygen.title',
  fields: [
    num('T', 'water.f.T', '20', 'temperature'),
    num('S', 'water.f.salinity', '0'),
    num('P', 'water.f.P', '1', 'vapor', { unit: 'atm' }),
  ],
  solve({ n }) {
    const P = n.P! / 1.01325;
    const sat = oxygenSaturation(n.T!, n.S!, P);
    return {
      answer: { key: 'water.oxygen.answer', vars: { value: sat.value } },
      rows: [
        row('water.r.doSat', sat.value, 'mg/L'),
        row('water.r.doFresh', sat.fresh, 'mg/L'),
        row('water.r.doSalt', sat.atOneAtm, 'mg/L'),
        row('water.r.pwv', sat.pwv, 'atm'),
      ],
      steps: [
        step('water.oxygen.s1', { value: sat.fresh }),
        ...(n.S! > 0 ? [step('water.oxygen.s2', { value: sat.atOneAtm })] : []),
        ...(Math.abs(P - 1) > 1e-12 ? [step('water.oxygen.s3', { value: sat.value })] : []),
      ],
      latex:
        `\\ln DO^* = -139.34411 + \\frac{1.575701\\times10^5}{T} - \\frac{6.642308\\times10^7}{T^2} + ` +
        `\\frac{1.2438\\times10^{10}}{T^3} - \\frac{8.621949\\times10^{11}}{T^4},\\quad DO^* = ${tex(sat.value)}`,
      source: BK_SOURCE,
    };
  },
};

const sagCalc: Calc = {
  id: 'sag',
  title: 'water.sag.title',
  fields: [
    num('kd', 'water.f.kd', '0.3', 'perDay'),
    num('ka', 'water.f.ka', '0.6', 'perDay'),
    num('L0', 'water.f.L0mix', '20', 'mgL'),
    num('D0', 'water.f.D0', '2', 'mgL'),
    opt('sat', 'water.f.doSat', '9.09', 'mgL'),
    opt('u', 'water.f.velocity', '', 'speed'),
  ],
  solve({ n, o }) {
    const sag = streeterPhelps(n.kd!, n.ka!, n.L0!, n.D0!);
    const distance = o.u === null ? null : o.u! * 24 * sag.tc;
    const end = Math.max(10, 3 * sag.tc);
    const sat = o.sat;
    const points = linspace(0, end, 80).map((t) => [t, sat === null ? sag.deficit(t) : sat - sag.deficit(t)] as const);
    return {
      answer: { key: 'water.sag.answer', vars: { tc: sag.tc, Dc: sag.Dc } },
      rows: [
        row('water.r.tc', sag.tc, 'd'),
        row('water.r.Dc', sag.Dc, 'mg/L'),
        ...(sat === null ? [] : [row('water.r.doMin', sat - sag.Dc, 'mg/L')]),
        ...(distance === null ? [] : [row('water.r.xc', distance, 'km')]),
      ],
      steps: [
        sag.same
          ? step(
              'water.sag.s1same',
              { tc: sag.tc },
              `t_c = \\frac{1}{k_d}\\left(1 - \\frac{D_0}{L_0}\\right) = ${tex(sag.tc)}\\ \\mathrm{d}`,
            )
          : step('water.sag.s1', { tc: sag.tc }, `${SAG_TC} = ${tex(sag.tc)}\\ \\mathrm{d}`),
        step(
          'water.sag.s2',
          { Dc: sag.Dc },
          `D_c = \\frac{k_d}{k_a} L_0 e^{-k_d t_c} = ${tex(sag.Dc)}\\ \\mathrm{mg/L}`,
        ),
        ...(sat === null ? [] : [step('water.sag.s3', { value: sat - sag.Dc })]),
        ...(distance === null ? [] : [step('water.sag.s4', { x: distance })]),
      ],
      notes: sag.tc === 0 ? [{ key: 'water.sag.atStart' }] : [],
      latex: `D(t) = \\frac{k_d L_0}{k_a - k_d}\\left(e^{-k_d t} - e^{-k_a t}\\right) + D_0 e^{-k_a t},\\quad D_c = ${tex(sag.Dc)}`,
      plot: {
        title: 'water.p.sag',
        x: 'water.p.days',
        y: sat === null ? 'water.p.deficit' : 'water.p.oxygen',
        series: [{ name: sat === null ? 'water.p.deficit' : 'water.p.oxygen', points }],
      },
    };
  },
};

const mixCalc: Calc = {
  id: 'mix',
  title: 'water.mix.title',
  intro: 'water.mix.intro',
  fields: [
    grid(
      'streams',
      'water.f.streams',
      [
        ['water.f.flowCol', 'flow'],
        ['water.f.bodCol', 'mgL'],
        ['water.f.doCol', 'mgL'],
        ['water.f.tempCol', 'temperature'],
      ],
      '5 2 8.5 15\n0.5 180 1 22',
      2,
    ),
  ],
  solve({ rows }) {
    const result = mix(rows.streams!);
    const [bodMix, doMix, tMix] = result.mixed as [number, number, number];
    return {
      answer: { key: 'water.mix.answer', vars: { bod: bodMix, oxygen: doMix, T: tMix } },
      rows: [
        row('water.r.Qmix', result.total, 'm³/s'),
        row('water.r.bodMix', bodMix, 'mg/L'),
        row('water.r.doMix', doMix, 'mg/L'),
        row('water.r.tMix', tMix, '°C'),
      ],
      steps: [step('water.mix.s1', { Q: result.total }, `C = \\frac{\\sum Q_i C_i}{\\sum Q_i}`)],
      latex: `C_{mix} = \\frac{\\sum Q_i C_i}{\\sum Q_i}`,
    };
  },
};

const ALK_EQ = 50040;

const carbonateCalc: Calc = {
  id: 'carbonate',
  title: 'water.carb.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'speciate';
    return [
      pick('mode', 'water.f.mode', [
        ['speciate', 'water.o.speciate'],
        ['fromAlk', 'water.o.fromAlk'],
        ['closed', 'water.o.closed'],
        ['open', 'water.o.open'],
      ]),
      ...(mode === 'speciate' || mode === 'fromAlk' ? [num('pH', 'water.f.pH', '7')] : []),
      ...(mode === 'speciate' || mode === 'closed' ? [num('CT', 'water.f.CT', '2', 'molar', { unit: 'mmol/L' })] : []),
      ...(mode !== 'speciate' ? [num('alk', 'water.f.alk', '100', 'mgL')] : []),
      ...(mode === 'open'
        ? [num('pCO2', 'water.f.pCO2', '0.00042', 'vapor', { unit: 'atm' }), num('KH', 'water.f.KH', '0.0339')]
        : []),
      num('pK1', 'water.f.pK1', '6.35'),
      num('pK2', 'water.f.pK2', '10.33'),
      num('pKw', 'water.f.pKw', '14'),
    ];
  },
  solve({ n, s }): Outcome {
    const k = { pK1: n.pK1!, pK2: n.pK2!, pKw: n.pKw! };
    const alkEq = n.alk === undefined ? null : n.alk / ALK_EQ;
    let pH: number;
    let CT: number;
    if (s.mode === 'fromAlk') {
      pH = n.pH!;
      CT = totalCarbonate(pH, alkEq!, k);
    } else if (s.mode === 'closed') {
      CT = n.CT!;
      pH = closedPh(CT, alkEq!, k);
    } else if (s.mode === 'open') {
      const open = openPh(n.pCO2! / 1.01325, n.KH!, alkEq!, k);
      pH = open.pH;
      CT = open.CT;
    } else {
      pH = n.pH!;
      CT = n.CT!;
    }
    const a = alphas(pH, k.pK1, k.pK2);
    const alk = alkalinity(pH, CT, k);
    const beta = bufferIntensity(pH, CT, k);
    const curve = (which: 'a0' | 'a1' | 'a2') =>
      linspace(2, 12, 101).map((p) => [p, alphas(p, k.pK1, k.pK2)[which]] as const);
    return {
      answer: { key: 'water.carb.answer', vars: { pH, CT: CT * 1000, a1: a.a1 } },
      rows: [
        row('water.r.pH', pH),
        row('water.r.CT', CT * 1000, 'mmol/L'),
        row('water.r.a0', a.a0),
        row('water.r.a1', a.a1),
        row('water.r.a2', a.a2),
        row('water.r.hco3', a.a1 * CT * 61017, 'mg/L'),
        row('water.r.alk', alk * ALK_EQ, 'mg/L as CaCO₃'),
        row('water.r.beta', beta * 1000, 'meq/L per pH'),
      ],
      steps: [
        step(
          'water.carb.s1',
          { a0: a.a0, a1: a.a1, a2: a.a2 },
          `\\alpha_1 = \\frac{1}{1 + [\\mathrm{H^+}]/K_1 + K_2/[\\mathrm{H^+}]} = ${tex(a.a1)}`,
        ),
        step(
          'water.carb.s2',
          { alk: alk * ALK_EQ },
          `\\mathrm{Alk} = C_T(\\alpha_1 + 2\\alpha_2) + [\\mathrm{OH^-}] - [\\mathrm{H^+}]`,
        ),
        step('water.carb.s3', { beta: beta * 1000 }),
      ],
      latex: `\\alpha_0 = ${tex(a.a0)},\\ \\alpha_1 = ${tex(a.a1)},\\ \\alpha_2 = ${tex(a.a2)}`,
      plot: {
        title: 'water.p.speciation',
        x: 'water.p.pH',
        y: 'water.p.fraction',
        series: [
          { name: 'water.p.h2co3', points: curve('a0') },
          { name: 'water.p.hco3', points: curve('a1') },
          { name: 'water.p.co3', points: curve('a2') },
          {
            name: 'water.p.here',
            points: [
              [pH, 0],
              [pH, 1],
            ],
            style: 'dashed',
          },
        ],
      },
    };
  },
};

const scalingCalc: Calc = {
  id: 'scaling',
  title: 'water.scale.title',
  fields: [
    num('TDS', 'water.f.TDS', '500', 'mgL'),
    num('T', 'water.f.T', '25', 'temperature'),
    num('Ca', 'water.f.CaH', '200', 'mgL'),
    num('alk', 'water.f.alk', '150', 'mgL'),
    num('pH', 'water.f.pH', '7.8'),
  ],
  solve({ n }) {
    const r = scaling(n.TDS!, n.T!, n.Ca!, n.alk!, n.pH!);
    const tendency = r.lsi > 0.05 ? '~water.o.scaling' : r.lsi < -0.05 ? '~water.o.corrosive' : '~water.o.balanced';
    return {
      answer: { key: 'water.scale.answer', vars: { lsi: r.lsi, tendency } },
      rows: [row('water.r.pHs', r.pHs), row('water.r.lsi', r.lsi), row('water.r.rsi', r.rsi)],
      steps: [
        step('water.scale.s1', { A: r.A, B: r.B, C: r.C, D: r.D }),
        step('water.scale.s2', { pHs: r.pHs }, `pH_s = (9.3 + A + B) - (C + D) = ${tex(r.pHs)}`),
        step(
          'water.scale.s3',
          { lsi: r.lsi, rsi: r.rsi },
          `LSI = pH - pH_s = ${tex(r.lsi)},\\quad RSI = 2pH_s - pH = ${tex(r.rsi)}`,
        ),
      ],
      latex: `LSI = pH - pH_s = ${tex(n.pH!)} - ${tex(r.pHs)} = ${tex(r.lsi)}`,
    };
  },
};

const softenCalc: Calc = {
  id: 'soften',
  title: 'water.soft.title',
  fields: [
    num('Ca', 'water.f.Ca', '80', 'mgL'),
    num('Mg', 'water.f.Mg', '24.3', 'mgL'),
    num('alk', 'water.f.alk', '150', 'mgL'),
    num('co2', 'water.f.co2', '10', 'mgL'),
    num('excess', 'water.f.excess', '1.25'),
  ],
  solve({ n }) {
    const r = softening({ Ca: n.Ca!, Mg: n.Mg!, alk: n.alk!, co2: n.co2!, excess: n.excess! });
    return {
      answer: { key: 'water.soft.answer', vars: { total: r.total, lime: r.lime, soda: r.soda } },
      rows: [
        row('water.r.caH', r.caH, 'mg/L as CaCO₃'),
        row('water.r.mgH', r.mgH, 'mg/L as CaCO₃'),
        row('water.r.TH', r.total, 'mg/L as CaCO₃'),
        row('water.r.CH', r.carbonate, 'mg/L as CaCO₃'),
        row('water.r.NCH', r.noncarbonate, 'mg/L as CaCO₃'),
        row('water.r.lime', r.lime, 'mg/L as CaO'),
        row('water.r.soda', r.soda, 'mg/L as Na₂CO₃'),
      ],
      steps: [
        step('water.soft.s1', { caH: r.caH, mgH: r.mgH, total: r.total }),
        step('water.soft.s2', { CH: r.carbonate, NCH: r.noncarbonate }),
        step('water.soft.s3', { meq: r.limeMeq, lime: r.lime }, `${LIME} = ${tex(r.limeMeq)}\\ \\mathrm{meq/L}`),
        step('water.soft.s4', { meq: r.sodaMeq, soda: r.soda }),
      ],
      latex: `\\mathrm{TH} = ${tex(r.total)}\\ \\mathrm{mg/L\\ as\\ CaCO_3}`,
    };
  },
};

const stokesCalc: Calc = {
  id: 'stokes',
  title: 'water.stokes.title',
  fields: [
    num('d', 'water.f.d', '50', 'grain', { unit: 'µm' }),
    num('rhoP', 'water.f.rhoP', '2650', 'density'),
    num('rhoW', 'water.f.rhoW', '998.2', 'density'),
    num('mu', 'water.f.mu', '1.002e-3', 'viscosity'),
  ],
  solve({ n }) {
    const d = n.d! / 1000;
    const r = stokes(d, n.rhoP!, n.rhoW!, n.mu!);
    return {
      answer: { key: 'water.stokes.answer', vars: { v: r.v } },
      rows: [row('water.r.vs', r.v, 'm/s'), row('water.r.vsHour', r.v * 3600, 'm/h'), row('water.r.Re', r.Re)],
      steps: [
        step(
          'water.stokes.s1',
          { v: r.v },
          `v_s = \\frac{g(\\rho_p - \\rho_w) d^2}{18\\mu} = ${tex(r.v)}\\ \\mathrm{m/s}`,
        ),
        step('water.stokes.s2', { Re: r.Re }, `Re = \\frac{\\rho_w v_s d}{\\mu} = ${tex(r.Re)}`),
      ],
      notes: r.Re > 1 ? [{ key: 'water.stokes.turbulent', vars: { Re: r.Re } }] : [],
      latex: `v_s = \\frac{g(\\rho_p - \\rho_w) d^2}{18\\mu} = ${tex(r.v)}\\ \\mathrm{m/s}`,
    };
  },
};

const basinCalc: Calc = {
  id: 'basin',
  title: 'water.basin.title',
  fields: [
    num('Q', 'water.f.Q', '10000', 'flow', { unit: 'm³/d' }),
    num('A', 'water.f.area', '400', 'area'),
    num('h', 'water.f.depth', '3', 'length'),
    num('vs', 'water.f.vs', '0.0003', 'conductivity'),
  ],
  solve({ n }) {
    const r = basin(n.Q!, n.A!, n.h!, n.vs!);
    return {
      answer: { key: 'water.basin.answer', vars: { removal: r.removal * 100 } },
      rows: [
        row('water.r.v0', r.v0 * 86400, 'm³/(m²·d)'),
        row('water.r.removal', r.removal * 100, '%'),
        row('water.r.td', r.td / 3600, 'h'),
      ],
      steps: [
        step('water.basin.s1', { v0: r.v0 * 86400 }, `v_0 = Q/A = ${tex(r.v0 * 86400)}\\ \\mathrm{m/d}`),
        step('water.basin.s2', { removal: r.removal * 100 }, `\\text{removed} = \\min(1, v_s/v_0) = ${tex(r.removal)}`),
        step('water.basin.s3', { td: r.td / 3600 }, `t_d = V/Q = ${tex(r.td / 3600)}\\ \\mathrm{h}`),
      ],
      latex: `v_0 = \\frac{Q}{A} = ${tex(r.v0 * 86400)}\\ \\mathrm{m/d}`,
    };
  },
};

const filterCalc: Calc = {
  id: 'filter',
  title: 'water.filter.title',
  fields: [
    pick('model', 'water.f.model', [
      ['carman', 'water.o.carman'],
      ['ergun', 'water.o.ergun'],
    ]),
    num('L', 'water.f.bed', '0.6', 'length'),
    num('d', 'water.f.grain', '0.5', 'grain'),
    num('eps', 'water.f.eps', '0.4'),
    num('phi', 'water.f.phi', '0.85'),
    num('v', 'water.f.rate', '10', 'filterRate'),
    num('rho', 'water.f.rhoW', '998.2', 'density'),
    num('mu', 'water.f.mu', '1.002e-3', 'viscosity'),
  ],
  solve({ n, s }) {
    const model = s.model === 'ergun' ? 'ergun' : 'carman';
    const r = headloss(model, {
      L: n.L!,
      d: n.d! / 1000,
      eps: n.eps!,
      phi: n.phi!,
      v: n.v! / 3600,
      rho: n.rho!,
      mu: n.mu!,
    });
    return {
      answer: { key: 'water.filter.answer', vars: { h: r.h } },
      rows: [row('water.r.h', r.h, 'm'), row('water.r.gradient', r.gradient), row('water.r.Re', r.Re)],
      steps: [
        model === 'carman'
          ? step(
              'water.filter.s1',
              { h: r.h },
              `\\frac{h_L}{L} = \\frac{180\\,\\mu (1-\\varepsilon)^2 v}{\\rho g \\varepsilon^3 \\phi^2 d^2} = ${tex(r.gradient)}`,
            )
          : step('water.filter.s2', { h: r.h }, `${ERGUN} = ${tex(r.gradient)}`),
        step('water.filter.s3', { Re: r.Re }),
      ],
      latex: `h_L = ${tex(r.h)}\\ \\mathrm{m}`,
    };
  },
};

const disinfectCalc: Calc = {
  id: 'disinfect',
  title: 'water.cw.title',
  intro: 'water.cw.intro',
  fields: [
    num('C', 'water.f.C', '1', 'mgL'),
    num('t', 'water.f.contact', '30', 'minutes'),
    num('k', 'water.f.kcw', '0.2'),
    num('n', 'water.f.ncw', '1'),
    opt('target', 'water.f.target', '4'),
  ],
  solve({ n, o }) {
    const r = chickWatson(n.C!, n.t!, n.k!, n.n!);
    const need = o.target === null ? null : timeForLogs(o.target!, n.C!, n.k!, n.n!);
    return {
      answer: { key: 'water.cw.answer', vars: { logs: r.logs, CT: r.CT } },
      rows: [
        row('water.r.logs', r.logs),
        row('water.r.ctProduct', r.CT, 'mg·min/L'),
        row('water.r.survive', r.survive),
        ...(need === null ? [] : [row('water.r.tNeed', need, 'min')]),
      ],
      steps: [
        step('water.cw.s1', { logs: r.logs }, `\\log_{10}\\frac{N_0}{N} = \\frac{k C^n t}{\\ln 10} = ${tex(r.logs)}`),
        step('water.cw.s2', { CT: r.CT }, `CT = ${tex(r.CT)}\\ \\mathrm{mg\\,min/L}`),
        ...(need === null ? [] : [step('water.cw.s3', { logs: o.target!, t: need })]),
      ],
      latex: `\\ln\\frac{N}{N_0} = -k C^n t,\\quad \\log_{10}\\frac{N_0}{N} = ${tex(r.logs)}`,
    };
  },
};

const membraneCalc: Calc = {
  id: 'membrane',
  title: 'water.mem.title',
  fields: (choices) => {
    const mode = choices.mode ?? 'osmotic';
    return [
      pick('mode', 'water.f.mode', [
        ['osmotic', 'water.o.osmotic'],
        ['flux', 'water.o.flux'],
        ['series', 'water.o.series'],
      ]),
      ...(mode === 'osmotic'
        ? [
            num('i', 'water.f.vantHoff', '2'),
            num('C', 'water.f.molar', '0.6', 'molar'),
            num('T', 'water.f.T', '25', 'temperature'),
          ]
        : []),
      ...(mode === 'flux'
        ? [
            num('Qp', 'water.f.permeate', '100', 'flow', { unit: 'm³/d' }),
            num('A', 'water.f.memArea', '200', 'area'),
            num('Cf', 'water.f.feedC', '2000', 'mgL'),
            num('Cp', 'water.f.permC', '40', 'mgL'),
            opt('Qf', 'water.f.feed', '', 'flow'),
          ]
        : []),
      ...(mode === 'series'
        ? [
            num('dP', 'water.f.tmp', '200', 'pressure'),
            num('dPi', 'water.f.dPi', '0', 'pressure'),
            num('mu', 'water.f.mu', '1.002e-3', 'viscosity'),
            num('Rm', 'water.f.Rm', '1e12'),
            num('Rf', 'water.f.Rf', '5e11'),
          ]
        : []),
    ];
  },
  solve({ n, o, s }): Outcome {
    if (s.mode === 'flux') {
      const J = (n.Qp! / n.A!) * 3.6e6;
      const rejection = 1 - n.Cp! / n.Cf!;
      const recovery = o.Qf ? n.Qp! / o.Qf : null;
      return {
        answer: { key: 'water.mem.fluxAnswer', vars: { J, R: rejection * 100 } },
        rows: [
          row('water.r.J', J, 'L/(m²·h)'),
          row('water.r.rejection', rejection * 100, '%'),
          ...(recovery === null ? [] : [row('water.r.recovery', recovery * 100, '%')]),
        ],
        steps: [
          step('water.mem.s2', { J }, `J = Q_p/A = ${tex(J)}\\ \\mathrm{L/(m^2\\,h)}`),
          step('water.mem.s3', { R: rejection * 100 }, `R = 1 - C_p/C_f = ${tex(rejection)}`),
        ],
        latex: `J = \\frac{Q_p}{A} = ${tex(J)}\\ \\mathrm{L/(m^2\\,h)},\\quad R = ${tex(rejection)}`,
      };
    }
    if (s.mode === 'series') {
      const r = seriesFlux(n.dP! * 1000, n.dPi! * 1000, n.mu!, n.Rm!, n.Rf!);
      return {
        answer: { key: 'water.mem.seriesAnswer', vars: { J: r.J * 3.6e6 } },
        rows: [row('water.r.J', r.J * 3.6e6, 'L/(m²·h)'), row('water.r.net', r.net / 1000, 'kPa')],
        steps: [
          step(
            'water.mem.s4',
            { J: r.J * 3.6e6 },
            `J = \\frac{\\Delta P - \\Delta\\pi}{\\mu (R_m + R_f)} = ${tex(r.J)}\\ \\mathrm{m/s}`,
          ),
        ],
        latex: `J = \\frac{\\Delta P - \\Delta\\pi}{\\mu (R_m + R_f)} = ${tex(r.J * 3.6e6)}\\ \\mathrm{L/(m^2\\,h)}`,
      };
    }
    const pi = osmotic(n.i!, n.C!, n.T!);
    return {
      answer: { key: 'water.mem.osmoticAnswer', vars: { pi } },
      rows: [row('water.r.pi', pi, 'bar'), row('water.r.piKpa', pi * 100, 'kPa')],
      steps: [
        step(
          'water.mem.s1',
          { pi },
          `\\pi = i C R T = ${tex(n.i!)} \\times ${tex(n.C!)} \\times 0.083145 \\times ${tex(n.T! + 273.15)} = ${tex(pi)}\\ \\mathrm{bar}`,
        ),
      ],
      latex: `\\pi = i C R T = ${tex(pi)}\\ \\mathrm{bar}`,
    };
  },
};

export const CALCS: readonly Calc[] = [
  bodCalc,
  bodFitCalc,
  oxygenCalc,
  sagCalc,
  mixCalc,
  carbonateCalc,
  scalingCalc,
  softenCalc,
  stokesCalc,
  basinCalc,
  filterCalc,
  disinfectCalc,
  membraneCalc,
];
