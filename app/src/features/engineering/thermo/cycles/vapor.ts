// Vapor cycles: the steam Rankine cycle (simple, with reheat, or with one open or closed feedwater heater) and
// vapor-compression refrigeration and heat pumps with R-134a. Each state is fixed by IF97 or the R-134a equation,
// each component gets its energy balance, and the totals follow.
import { fmt, tex } from '../common/format';
import { ThermoError, positive, type ResultRow, type ThermoResult } from '../common/types';
import { fluidOf, type Fluid, type FluidState } from '../devices/fluids';
import { CycleBuilder, cycleResult, massRows, type CycleState } from './model';

export interface RankineInput {
  variant: 'simple' | 'reheat' | 'openFwh' | 'closedFwh';
  /** Boiler and condenser pressures, kPa. */
  pHigh: number;
  pLow: number;
  /** Turbine inlet temperature, K; saturated vapor when left out. */
  T3?: number;
  etaT: number;
  etaP: number;
  /** Reheat pressure (kPa) and temperature (K, the turbine inlet one when left out). */
  pReheat?: number;
  tReheat?: number;
  /** Feedwater heater pressure, kPa. */
  pFwh?: number;
  power?: number;
}

function checkEta(...values: number[]): void {
  for (const eta of values) if (!(eta > 0 && eta <= 1)) throw new ThermoError('efficiencyRange');
}

/** A turbine or pump from state a to pressure p with its efficiency; the new state is fixed by p and h. */
function machine(build: CycleBuilder, a: CycleState, p: number, eta: number, label: string, pump: boolean) {
  const { fluid } = build;
  const ideal = fluid.fromPS(p, a.s);
  const w = pump ? (ideal.h - a.h) / eta : eta * (a.h - ideal.h);
  const state = build.add(label, fluid.fromPH(p, pump ? a.h + w : a.h - w), 'ph', a.label);
  build.join(a.label, label, eta === 1 ? 's' : 'line');
  build.step({ key: pump ? 'cyc.pump' : 'cyc.turbine', vars: { w: fmt(w, 6) } });
  return { state, w };
}

const between = (low: number, mid: number | undefined, high: number, name: string): number => {
  const p = positive(mid, name);
  if (!(p > low && p < high)) throw new ThermoError('pressureBetween', { name });
  return p;
};

function engineRows(w: number, qin: number, qout: number, wt: number, wp: number): ResultRow[] {
  return [
    { key: 'wNet', symbol: 'w_{net}', value: w, qty: 'e', answer: true },
    { key: 'qIn', symbol: 'q_{in}', value: qin, qty: 'e' },
    { key: 'qOut', symbol: 'q_{out}', value: qout, qty: 'e' },
    { key: 'etaTh', symbol: '\\eta_{th}', value: (100 * w) / qin, qty: 'percent', answer: true },
    { key: 'wTurbine', symbol: 'w_t', value: wt, qty: 'e' },
    { key: 'wPump', symbol: 'w_p', value: wp, qty: 'e' },
    { key: 'bwr', symbol: 'r_{bw}', value: wp / wt, qty: 'none' },
  ];
}

export function solveRankine(input: RankineInput): ThermoResult {
  const fluid = fluidOf('water');
  const pHigh = positive(input.pHigh, 'p_high');
  const pLow = positive(input.pLow, 'p_low');
  if (!(pHigh > pLow)) throw new ThermoError('pressureOrder');
  checkEta(input.etaT, input.etaP);
  const build = new CycleBuilder(fluid);
  const inlet = (label: string, p: number, T?: number) =>
    T === undefined ? build.add(label, fluid.fromPX(p, 1), 'px') : build.add(label, fluid.fromTP(T, p), 'Tp');
  let wt = 0;
  let wp: number;
  let qin: number;
  let qout: number;
  let y = 0;
  const one = build.add('1', fluid.fromPX(pLow, 0), 'px');
  if (input.variant === 'simple' || input.variant === 'reheat') {
    const pump = machine(build, one, pHigh, input.etaP, '2', true);
    wp = pump.w;
    const three = inlet('3', pHigh, input.T3);
    build.join('2', '3', 'p');
    qin = three.h - pump.state.h;
    build.step({ key: 'cyc.boiler', vars: { q: fmt(qin, 6) } });
    let last = three;
    if (input.variant === 'reheat') {
      const pR = between(pLow, input.pReheat, pHigh, 'p_reheat');
      const hp = machine(build, three, pR, input.etaT, '4', false);
      const five = build.add('5', fluid.fromTP(input.tReheat ?? three.T, pR), 'Tp');
      build.join('4', '5', 'p');
      qin += five.h - hp.state.h;
      wt += hp.w;
      build.step({ key: 'cyc.reheat', vars: { q: fmt(five.h - hp.state.h, 6) } });
      last = five;
    }
    const exit = machine(build, last, pLow, input.etaT, input.variant === 'reheat' ? '6' : '4', false);
    wt += exit.w;
    qout = exit.state.h - one.h;
    build.join(exit.state.label, '1', 'p');
  } else if (input.variant === 'openFwh') {
    const pF = between(pLow, input.pFwh, pHigh, 'p_fwh');
    const p1 = machine(build, one, pF, input.etaP, '2', true);
    const three = build.add('3', fluid.fromPX(pF, 0), 'px');
    const p2 = machine(build, three, pHigh, input.etaP, '4', true);
    const five = inlet('5', pHigh, input.T3);
    build.join('4', '5', 'p');
    const hp = machine(build, five, pF, input.etaT, '6', false);
    const lp = machine(build, hp.state, pLow, input.etaT, '7', false);
    build.join('7', '1', 'p');
    build.join('6', '3', 'p');
    build.join('2', '3', 'p');
    y = (three.h - p1.state.h) / (hp.state.h - p1.state.h);
    build.step({ key: 'cyc.fwhOpen', vars: { y: fmt(y, 5) }, math: 'y\\,h_6+(1-y)\\,h_2=h_3' });
    wt = hp.w + (1 - y) * lp.w;
    wp = (1 - y) * p1.w + p2.w;
    qin = five.h - p2.state.h;
    qout = (1 - y) * (lp.state.h - one.h);
    build.step({ key: 'cyc.boiler', vars: { q: fmt(qin, 6) } });
  } else {
    const pF = between(pLow, input.pFwh, pHigh, 'p_fwh');
    const pump = machine(build, one, pHigh, input.etaP, '2', true);
    const drainT = fluid.fromPX(pF, 0).T;
    if (!(drainT > pump.state.T)) throw new ThermoError('fwhTooCold');
    // The feedwater leaves at the saturation temperature of the extracted steam.
    const three = build.add('3', fluid.fromTP(drainT, pHigh), 'Tp');
    build.join('2', '3', 'p');
    const four = inlet('4', pHigh, input.T3);
    build.join('3', '4', 'p');
    const hp = machine(build, four, pF, input.etaT, '5', false);
    const lp = machine(build, hp.state, pLow, input.etaT, '6', false);
    const seven = build.add('7', fluid.fromPX(pF, 0), 'px');
    build.join('5', '7', 'p');
    const eight = build.add('8', fluid.fromPH(pLow, seven.h), 'ph', '7');
    build.join('7', '8', 'line');
    build.join('6', '1', 'p');
    y = (three.h - pump.state.h) / (hp.state.h - seven.h);
    build.step({ key: 'cyc.fwhClosed', vars: { y: fmt(y, 5) }, math: 'y\\,(h_5-h_7)=h_3-h_2' });
    wt = hp.w + (1 - y) * lp.w;
    wp = pump.w;
    qin = four.h - three.h;
    qout = (1 - y) * (lp.state.h - one.h) + y * (eight.h - one.h);
    build.step({ key: 'cyc.boiler', vars: { q: fmt(qin, 6) } });
  }
  build.step({ key: 'cyc.condenser', vars: { q: fmt(qout, 6) } });
  const w = wt - wp;
  build.step({
    key: 'cyc.totals',
    vars: { w: fmt(w, 6), qin: fmt(qin, 6), qout: fmt(qout, 6), eta: fmt((100 * w) / qin, 5) },
    math: '\\eta_{th}=\\frac{w_t-w_p}{q_{in}}',
  });
  const rows = [
    ...engineRows(w, qin, qout, wt, wp),
    ...(y > 0 ? [{ key: 'yFraction' as const, symbol: 'y', value: y, qty: 'none' as const }] : []),
    ...massRows(build, input.power, w, qin),
  ];
  return cycleResult(build, rows, `\\eta_{th}=${tex(w / qin, 5)},\\ w_{net}=${tex(w, 5)}\\ \\mathrm{kJ/kg}`, [
    'steadyCycle',
    ...(y > 0 ? (['perKgBoiler'] as const) : []),
  ]);
}

export interface FridgeInput {
  /** Evaporator and condenser pressures, kPa. */
  pLow: number;
  pHigh: number;
  etaC: number;
  /** Superheat at the compressor inlet and subcooling at the condenser exit, K. */
  superheat: number;
  subcool: number;
  /** Cooling load, kW, for the mass flow. */
  load?: number;
}

export function solveFridge(input: FridgeInput): ThermoResult {
  const fluid: Fluid = fluidOf('r134a');
  const pLow = positive(input.pLow, 'p_evap');
  const pHigh = positive(input.pHigh, 'p_cond');
  if (!(pHigh > pLow)) throw new ThermoError('pressureOrder');
  checkEta(input.etaC);
  if (!(input.superheat >= 0 && input.subcool >= 0)) throw new ThermoError('notNegative', { name: 'ΔT' });
  const build = new CycleBuilder(fluid);
  const evap = fluid.fromPX(pLow, 1);
  const one =
    input.superheat > 0
      ? build.add('1', fluid.fromTP(evap.T + input.superheat, pLow), 'Tp')
      : build.add('1', evap, 'px');
  const ideal = fluid.fromPS(pHigh, one.s);
  const w = (ideal.h - one.h) / input.etaC;
  const two = build.add('2', fluid.fromPH(pHigh, one.h + w), 'ph', '1');
  build.join('1', '2', input.etaC === 1 ? 's' : 'line');
  build.step({ key: 'cyc.compressor', vars: { w: fmt(w, 6), ws: fmt(ideal.h - one.h, 6) } });
  const cond = fluid.fromPX(pHigh, 0);
  const three: FluidState =
    input.subcool > 0 ? build.add('3', fluid.fromTP(cond.T - input.subcool, pHigh), 'Tp') : build.add('3', cond, 'px');
  build.join('2', '3', 'p');
  const qH = two.h - three.h;
  build.step({ key: 'cyc.condenser', vars: { q: fmt(qH, 6) } });
  const four = build.add('4', fluid.fromPH(pLow, three.h), 'ph', '3');
  build.join('3', '4', 'line');
  build.step({ key: 'cyc.valve', vars: { h: fmt(three.h, 6), x: four.x === null ? '0' : fmt(four.x, 4) } });
  build.join('4', '1', 'p');
  const qL = one.h - four.h;
  build.step({ key: 'cyc.evaporator', vars: { q: fmt(qL, 6) } });
  const copR = qL / w;
  const copHP = qH / w;
  build.step({
    key: 'cyc.cop',
    vars: { cop: fmt(copR, 5), hp: fmt(copHP, 5) },
    math: '\\mathrm{COP}_R=\\frac{h_1-h_4}{h_2-h_1}',
  });
  const rows: ResultRow[] = [
    { key: 'copR', symbol: '\\mathrm{COP}_R', value: copR, qty: 'none', answer: true },
    { key: 'copHP', symbol: '\\mathrm{COP}_{HP}', value: copHP, qty: 'none' },
    { key: 'qL', symbol: 'q_L', value: qL, qty: 'e' },
    { key: 'qH', symbol: 'q_H', value: qH, qty: 'e' },
    { key: 'wIn', symbol: 'w_{in}', value: w, qty: 'e' },
  ];
  if (input.load !== undefined) {
    const m = positive(input.load, 'Q̇_L') / qL;
    rows.push(
      { key: 'mFlow', symbol: '\\dot m', value: m, qty: 'mdot' },
      { key: 'powerRow', symbol: '\\dot W_{in}', value: m * w, qty: 'power' },
    );
    build.step({ key: 'cyc.load', vars: { Q: fmt(input.load, 6), m: fmt(m, 6), W: fmt(m * w, 6) } });
  }
  return cycleResult(build, rows, `\\mathrm{COP}_R=${tex(copR, 5)}`, ['steadyCycle', 'iirReference']);
}
