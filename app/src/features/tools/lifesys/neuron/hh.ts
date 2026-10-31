// The Hodgkin-Huxley (1952) squid giant axon model in the modern convention (rest near −65 mV): current clamp with
// steps, pulses, trains, and pulse pairs; voltage clamp with the sodium and potassium currents apart; TTX and TEA
// blocks; and a threshold search. Voltages in mV, time in ms, currents in µA/cm², conductances in mS/cm².
import { LsError, nonNegative, positive, within } from '../num/errors';
import { dopri } from '../num/ode';
import type { CalcResult, PlotData, Step } from '../types';

type Point = [number, number];

/** Hodgkin and Huxley's 1952 conductances and reversal potentials, shifted so the axon rests at about −65 mV. */
export const HH_DEFAULTS = { gNa: 120, gK: 36, gL: 0.3, eNa: 50, eK: -77, eL: -54.387, cm: 1 };
export type HhParams = typeof HH_DEFAULTS & { celsius: number };

// The rate functions (1/ms) at 6.3 °C. The removable singularities at −40 and −55 mV take their limits.
const vtrap = (x: number, y: number): number =>
  Math.abs(x / y) < 1e-6 ? y * (1 - x / y / 2) : x / (Math.exp(x / y) - 1);
export const rates = (v: number) => ({
  am: 0.1 * vtrap(-(v + 40), 10),
  bm: 4 * Math.exp(-(v + 65) / 18),
  ah: 0.07 * Math.exp(-(v + 65) / 20),
  bh: 1 / (1 + Math.exp(-(v + 35) / 10)),
  an: 0.01 * vtrap(-(v + 55), 10),
  bn: 0.125 * Math.exp(-(v + 65) / 80),
});
const phi = (celsius: number): number => 3 ** ((celsius - 6.3) / 10);

/** The steady-state gates m∞, h∞, n∞ at a voltage. */
export function steadyGates(v: number) {
  const r = rates(v);
  return { m: r.am / (r.am + r.bm), h: r.ah / (r.ah + r.bh), n: r.an / (r.an + r.bn) };
}

export interface HhRun {
  t: number[];
  v: number[];
  m: number[];
  h: number[];
  n: number[];
}

/** Integrates the current-clamp model with Dormand-Prince, at most 0.025 ms a step, from rest at v0. */
export function simulate(p: HhParams, stim: (t: number) => number, tEnd: number, v0 = -65): HhRun {
  const k = phi(p.celsius);
  const g0 = steadyGates(v0);
  const sol = dopri(
    (t, [v, m, h, n]) => {
      const r = rates(v);
      const iIon = p.gNa * m ** 3 * h * (v - p.eNa) + p.gK * n ** 4 * (v - p.eK) + p.gL * (v - p.eL);
      return [
        (stim(t) - iIon) / p.cm,
        k * (r.am * (1 - m) - r.bm * m),
        k * (r.ah * (1 - h) - r.bh * h),
        k * (r.an * (1 - n) - r.bn * n),
      ];
    },
    [v0, g0.m, g0.h, g0.n],
    0,
    tEnd,
    { maxStep: 0.025, rtol: 1e-7, atol: 1e-9 },
  );
  return {
    t: sol.t,
    v: sol.y.map((y) => y[0]),
    m: sol.y.map((y) => y[1]),
    h: sol.y.map((y) => y[2]),
    n: sol.y.map((y) => y[3]),
  };
}

export interface Spike {
  time: number;
  peak: number;
}

/** Spikes are upward crossings of 0 mV after `from`; each peak is refined by a parabola through 3 samples. */
export function spikes(run: HhRun, from = 0): Spike[] {
  const out: Spike[] = [];
  for (let i = 1; i < run.v.length - 1; i += 1) {
    if (run.t[i] < from) continue;
    const [a, b, c] = [run.v[i - 1], run.v[i], run.v[i + 1]];
    if (b > 0 && b >= a && b > c) {
      const [t0, t1, t2] = [run.t[i - 1], run.t[i], run.t[i + 1]];
      // Parabola through 3 unevenly spaced points.
      const d1 = (b - a) / (t1 - t0);
      const d2 = (c - b) / (t2 - t1);
      const curv = (d2 - d1) / (t2 - t0);
      const tp = curv < 0 ? (t0 + t1) / 2 - d1 / (2 * curv) : t1;
      const peak = curv < 0 ? a + d1 * (tp - t0) + curv * (tp - t0) * (tp - t1) : b;
      // Count it only if the voltage crossed 0 mV on the way up after `from`.
      let j = i;
      while (j > 0 && run.v[j] > 0) j -= 1;
      if (run.t[j] >= from || j === 0) out.push({ time: tp, peak });
    }
  }
  return out;
}

export type Protocol = 'step' | 'pulse' | 'train' | 'pair';
export interface Stimulus {
  protocol: Protocol;
  amp: number;
  start: number;
  width: number;
  /** Train frequency (Hz) or the pair's interval (ms). */
  rate: number;
}

export function stimulusFn(s: Stimulus): (t: number) => number {
  if (s.protocol === 'step') return (t) => (t >= s.start ? s.amp : 0);
  if (s.protocol === 'pulse') return (t) => (t >= s.start && t < s.start + s.width ? s.amp : 0);
  if (s.protocol === 'pair')
    return (t) =>
      (t >= s.start && t < s.start + s.width) || (t >= s.start + s.rate && t < s.start + s.rate + s.width) ? s.amp : 0;
  const period = 1000 / s.rate;
  return (t) => (t >= s.start && (t - s.start) % period < s.width ? s.amp : 0);
}

export type Block = 'none' | 'ttx' | 'tea';
export const blocked = (block: Block, celsius: number): HhParams => ({
  ...HH_DEFAULTS,
  celsius,
  gNa: block === 'ttx' ? 0 : HH_DEFAULTS.gNa,
  gK: block === 'tea' ? 0 : HH_DEFAULTS.gK,
});

export function currentClampResult(s: Stimulus, tEnd: number, block: Block, celsius: number): CalcResult {
  positive(tEnd, 't');
  within(tEnd, 't', 0, 500);
  nonNegative(s.start, 'start');
  if (s.protocol !== 'step') positive(s.width, 'width');
  if (s.protocol === 'train') positive(s.rate, 'f');
  if (s.protocol === 'pair') positive(s.rate, 'Δt');
  within(celsius, 'T', 0, 40);
  const p = blocked(block, celsius);
  const run = simulate(p, stimulusFn(s), tEnd);
  const found = spikes(run);
  const stim = stimulusFn(s);
  const rows: CalcResult['rows'] = [{ label: 'neuron.r.spikeCount', value: found.length }];
  const steps: Step[] = [
    {
      key: 'neuron.s.hh',
      vars: { gNa: p.gNa, gK: p.gK, gL: p.gL },
      math: 'C\\frac{dV}{dt} = I - \\bar g_{Na} m^3 h (V - E_{Na}) - \\bar g_K n^4 (V - E_K) - g_L (V - E_L)',
    },
    { key: `neuron.s.protocol.${s.protocol}`, vars: { I: s.amp, t0: s.start, w: s.width, f: s.rate } },
  ];
  if (found.length > 0) {
    rows.push(
      { label: 'neuron.r.firstPeak', value: found[0].peak, unit: 'mV' },
      { label: 'neuron.r.firstTime', value: found[0].time, unit: 'ms' },
    );
    if (found.length > 1) {
      const isi = (found[found.length - 1].time - found[0].time) / (found.length - 1);
      rows.push(
        { label: 'neuron.r.meanIsi', value: isi, unit: 'ms' },
        { label: 'neuron.r.rate', value: 1000 / isi, unit: 'Hz' },
      );
    }
    steps.push({ key: 'neuron.s.spikes', vars: { n: found.length, v: found[0].peak, t: found[0].time } });
  } else {
    rows.push({ label: 'neuron.r.vEnd', vars: { t: tEnd }, value: run.v[run.v.length - 1], unit: 'mV' });
    steps.push({ key: 'neuron.s.noSpikes', vars: { v: run.v[run.v.length - 1] } });
  }
  if (s.protocol === 'pair') {
    const second = found.some((sp) => sp.time > s.start + s.rate);
    steps.push({ key: second ? 'neuron.s.pairYes' : 'neuron.s.pairNo', vars: { d: s.rate } });
  }
  const at = <T>(xs: T[], f: (x: T, i: number) => number): Point[] => xs.map((x, i) => [run.t[i], f(x, i)]);
  const plots: PlotData[] = [
    {
      title: 'neuron.p.hhTrace',
      x: { label: 'neuron.p.time' },
      y: { label: 'neuron.p.vm' },
      series: [{ name: 'neuron.p.vSeries', points: at(run.v, (v) => v) }],
    },
    {
      title: 'neuron.p.gates',
      x: { label: 'neuron.p.time' },
      y: { label: 'neuron.p.gate', min: 0, max: 1 },
      series: [
        { name: 'neuron.p.m', points: at(run.m, (v) => v) },
        { name: 'neuron.p.h', style: 'dashed', points: at(run.h, (v) => v) },
        { name: 'neuron.p.n', style: 'outline', points: at(run.n, (v) => v) },
      ],
    },
    {
      title: 'neuron.p.stimulus',
      x: { label: 'neuron.p.time' },
      y: { label: 'neuron.p.current' },
      series: [{ name: 'neuron.p.iSeries', points: at(run.t, (t) => stim(t)) }],
    },
  ];
  return {
    rows,
    steps,
    latex: 'C\\frac{dV}{dt} = I - \\bar g_{Na} m^3 h (V - E_{Na}) - \\bar g_K n^4 (V - E_K) - g_L (V - E_L)',
    notes: [{ key: block === 'none' ? 'neuron.n.hh' : `neuron.n.${block}` }],
    source: 'neuron.src.hh',
    plots,
  };
}

/** Voltage clamp from a holding level to a step: each gate relaxes exponentially, so the currents are exact. */
export function voltageClamp(hold: number, step: number, width: number, block: Block, celsius: number) {
  const p = blocked(block, celsius);
  const k = phi(celsius);
  const g0 = steadyGates(hold);
  const r = rates(step);
  const relax = (x0: number, a: number, b: number, t: number) => {
    const inf = a / (a + b);
    return inf + (x0 - inf) * Math.exp(-k * (a + b) * t);
  };
  const n = 400;
  const t: number[] = [];
  const iNa: number[] = [];
  const iK: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const tt = (width * i) / n;
    const m = relax(g0.m, r.am, r.bm, tt);
    const h = relax(g0.h, r.ah, r.bh, tt);
    const nn = relax(g0.n, r.an, r.bn, tt);
    t.push(tt);
    iNa.push(p.gNa * m ** 3 * h * (step - p.eNa));
    iK.push(p.gK * nn ** 4 * (step - p.eK));
  }
  return { t, iNa, iK, p };
}

export function voltageClampResult(
  hold: number,
  step: number,
  width: number,
  block: Block,
  celsius: number,
): CalcResult {
  within(hold, 'V_hold', -150, 100);
  within(step, 'V_step', -150, 100);
  positive(width, 'width');
  within(celsius, 'T', 0, 40);
  const c = voltageClamp(hold, step, width, block, celsius);
  const peakIdx = c.iNa.reduce((best, v, i) => (Math.abs(v) > Math.abs(c.iNa[best]) ? i : best), 0);
  const total = c.t.map((_, i) => c.iNa[i] + c.iK[i]);
  return {
    rows: [
      { label: 'neuron.r.peakNa', value: c.iNa[peakIdx], unit: 'µA/cm²' },
      { label: 'neuron.r.peakNaTime', value: c.t[peakIdx], unit: 'ms' },
      { label: 'neuron.r.endK', value: c.iK[c.iK.length - 1], unit: 'µA/cm²' },
      { label: 'neuron.r.drivingNa', value: step - c.p.eNa, unit: 'mV' },
      { label: 'neuron.r.drivingK', value: step - c.p.eK, unit: 'mV' },
    ],
    steps: [
      { key: 'neuron.s.clamp', vars: { h: hold, v: step } },
      { key: 'neuron.s.clampNa', vars: { i: c.iNa[peakIdx], t: c.t[peakIdx], d: step - c.p.eNa } },
      { key: 'neuron.s.clampK', vars: { i: c.iK[c.iK.length - 1], d: step - c.p.eK } },
    ],
    latex: 'I_{Na} = \\bar g_{Na} m^3 h (V - E_{Na}),\\quad I_K = \\bar g_K n^4 (V - E_K)',
    notes: [{ key: block === 'none' ? 'neuron.n.clamp' : `neuron.n.${block}` }],
    source: 'neuron.src.hh',
    plots: [
      {
        title: 'neuron.p.clamp',
        x: { label: 'neuron.p.time' },
        y: { label: 'neuron.p.current' },
        series: [
          { name: 'neuron.p.iNa', points: c.t.map((tt, i) => [tt, c.iNa[i]] as Point) },
          { name: 'neuron.p.iK', style: 'dashed', points: c.t.map((tt, i) => [tt, c.iK[i]] as Point) },
          { name: 'neuron.p.iTotal', style: 'outline', points: c.t.map((tt, i) => [tt, total[i]] as Point) },
        ],
      },
    ],
  };
}

const LIMIT = 400;

/** The smallest pulse (µA/cm²) of a given width that fires a spike, optionally after a conditioning spike. */
export function threshold(
  width: number,
  celsius: number,
  interval: number | null,
): { amp: number | null; first: number | null } {
  const p = blocked('none', celsius);
  const fires = (amp: number, cond: number | null): boolean => {
    const start = 1;
    const test = cond === null ? start : start + (interval as number);
    const stim = (t: number) =>
      (cond !== null && t >= start && t < start + width ? cond : 0) + (t >= test && t < test + width ? amp : 0);
    const run = simulate(p, stim, test + width + 12);
    return spikes(run, test).length > 0;
  };
  const search = (cond: number | null): number | null => {
    if (!fires(LIMIT, cond)) return null;
    let lo = 0;
    let hi = LIMIT;
    while (hi - lo > 1e-3 * hi) {
      const mid = (lo + hi) / 2;
      if (fires(mid, cond)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const alone = search(null);
  if (interval === null || alone === null) return { amp: alone, first: alone };
  return { amp: search(2 * alone), first: alone };
}

export function thresholdResult(width: number, celsius: number, interval: number | null): CalcResult {
  positive(width, 'width');
  within(width, 'width', 0, 20);
  within(celsius, 'T', 0, 40);
  if (interval !== null) within(positive(interval, 'Δt'), 'Δt', 0, 50);
  const th = threshold(width, celsius, interval);
  if (th.first === null) throw new LsError('neuron.e.noThreshold', { max: LIMIT });
  const rows: CalcResult['rows'] = [
    { label: 'neuron.r.threshold', value: th.first, unit: 'µA/cm²' },
    { label: 'neuron.r.charge', value: th.first * width, unit: 'nC/cm²' },
  ];
  const steps: Step[] = [{ key: 'neuron.s.bisect', vars: { w: width, i: th.first } }];
  if (interval !== null) {
    rows.push({
      label: 'neuron.r.thresholdAfter',
      vars: { d: interval },
      value: th.amp ?? '—',
      unit: th.amp ? 'µA/cm²' : '',
    });
    steps.push(
      th.amp === null
        ? { key: 'neuron.s.absolute', vars: { d: interval, max: LIMIT } }
        : { key: 'neuron.s.relative', vars: { d: interval, i: th.amp, r: th.amp / th.first } },
    );
  }
  return { rows, steps, notes: [{ key: 'neuron.n.threshold' }], source: 'neuron.src.hh' };
}
