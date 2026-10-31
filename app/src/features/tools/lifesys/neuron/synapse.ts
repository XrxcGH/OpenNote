// Synaptic potentials in a passive point neuron: alpha and dual-exponential conductances, EPSP and IPSP shapes,
// temporal summation (a train of events) and spatial summation (several synapses at once), and shunting inhibition.
// Conductances in nS, voltages in mV, time in ms, input resistance in MΩ.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { dopri } from '../num/ode';
import type { CalcResult, Step } from '../types';

type Point = [number, number];
export type Kinetics = 'alpha' | 'dual';

/** A conductance waveform with its peak scaled to 1. */
export function waveform(kind: Kinetics, tau: number, rise: number): (t: number) => number {
  if (kind === 'alpha') return (t) => (t <= 0 ? 0 : (t / tau) * Math.exp(1 - t / tau));
  if (!(rise < tau)) throw new LsError('neuron.e.rise');
  const tp = ((tau * rise) / (tau - rise)) * Math.log(tau / rise);
  const norm = 1 / (Math.exp(-tp / tau) - Math.exp(-tp / rise));
  return (t) => (t <= 0 ? 0 : norm * (Math.exp(-t / tau) - Math.exp(-t / rise)));
}

export interface SynapseInput {
  kind: Kinetics;
  /** Peak conductance of one synapse (nS). */
  g: number;
  tau: number;
  rise: number;
  eSyn: number;
  /** Events in the train and the interval between them (ms). */
  events: number;
  interval: number;
  /** Synapses active together. */
  synapses: number;
  /** Membrane: resting potential, input resistance (MΩ), and time constant (ms). */
  eL: number;
  rin: number;
  tauM: number;
  /** An inhibitory synapse at the same time as the first event: peak conductance (nS) and reversal (mV). */
  gInh: number;
  eInh: number;
}

/** Simulates the membrane: C dV/dt = −gL (V − EL) − Σ g(t)(V − E), with C = τm/Rin. Returns the trace. */
export function psp(p: SynapseInput, opts: { events?: number; synapses?: number; inhibit?: boolean } = {}) {
  const events = opts.events ?? p.events;
  const synapses = opts.synapses ?? p.synapses;
  const inhibit = opts.inhibit ?? true;
  const shape = waveform(p.kind, p.tau, p.rise);
  const gL = 1000 / p.rin;
  const cap = (1000 * p.tauM) / p.rin;
  const start = 1;
  const end = start + (events - 1) * p.interval + 6 * Math.max(p.tau, p.tauM);
  const gExc = (t: number) => {
    let sum = 0;
    for (let i = 0; i < events; i += 1) sum += shape(t - start - i * p.interval);
    return synapses * p.g * sum;
  };
  const gIn = (t: number) => (inhibit ? p.gInh * shape(t - start) : 0);
  const sol = dopri(
    (t, [v]) => [(-gL * (v - p.eL) - gExc(t) * (v - p.eSyn) - gIn(t) * (v - p.eInh)) / cap],
    [p.eL],
    0,
    end,
    { maxStep: Math.min(p.tau, p.tauM, p.interval || Infinity) / 20 },
  );
  const v = sol.y.map((y) => y[0]);
  const dev = v.map((x) => x - p.eL);
  const peakIdx = dev.reduce((best, d, i) => (Math.abs(d) > Math.abs(dev[best]) ? i : best), 0);
  return { t: sol.t, v, peak: dev[peakIdx], peakTime: sol.t[peakIdx] - start };
}

export function synapseResult(p: SynapseInput): CalcResult {
  positive(p.g, 'g');
  positive(p.tau, 'τ');
  if (p.kind === 'dual') positive(p.rise, 'τ_rise');
  whole(p.events, 'n', 1);
  if (p.events > 50) throw new LsError('errors.range', { name: 'n', low: 1, high: 50 });
  if (p.events > 1) positive(p.interval, 'Δt');
  else nonNegative(p.interval, 'Δt');
  whole(p.synapses, 'm', 1);
  within(p.synapses, 'm', 1, 100);
  positive(p.rin, 'R_in');
  positive(p.tauM, 'τm');
  nonNegative(p.gInh, 'g_inh');
  const full = psp(p);
  const single = psp(p, { events: 1, synapses: 1, inhibit: false });
  const kind = full.peak >= 0 ? 'epsp' : 'ipsp';
  const rows: CalcResult['rows'] = [
    { label: `neuron.r.${kind}`, value: full.peak, unit: 'mV' },
    { label: 'neuron.r.pspTime', value: full.peakTime, unit: 'ms' },
    { label: 'neuron.r.single', value: single.peak, unit: 'mV' },
  ];
  const steps: Step[] = [
    {
      key: `neuron.s.${p.kind}`,
      vars: { g: p.g, tau: p.tau, rise: p.rise },
      math:
        p.kind === 'alpha'
          ? 'g(t) = \\bar g \\frac{t}{\\tau} e^{1 - t/\\tau}'
          : 'g(t) = \\bar g\\, f \\left(e^{-t/\\tau_d} - e^{-t/\\tau_r}\\right)',
    },
    {
      key: 'neuron.s.membrane',
      vars: { r: p.rin, tau: p.tauM, gl: 1000 / p.rin, c: (1000 * p.tauM) / p.rin },
      math: 'C\\frac{dV}{dt} = -g_L(V - E_L) - g(t)(V - E_{syn})',
    },
    { key: 'neuron.s.single', vars: { v: single.peak, e: p.eSyn - p.eL } },
  ];
  if (p.events > 1 || p.synapses > 1) {
    const linear = single.peak * p.synapses;
    const unInhibited = p.gInh > 0 ? psp(p, { inhibit: false }).peak : full.peak;
    rows.push({ label: 'neuron.r.summation', value: unInhibited / single.peak });
    steps.push({
      key: p.events > 1 ? 'neuron.s.temporal' : 'neuron.s.spatial',
      vars: { n: p.events, m: p.synapses, v: unInhibited, r: unInhibited / single.peak, lin: linear },
    });
  }
  if (p.gInh > 0) {
    const without = psp(p, { inhibit: false });
    const drop = 100 * (1 - full.peak / without.peak);
    rows.push({ label: 'neuron.r.inhibition', value: drop, unit: '%' });
    steps.push({
      key: Math.abs(p.eInh - p.eL) < 1 ? 'neuron.s.shunt' : 'neuron.s.inhibit',
      vars: { g: p.gInh, e: p.eInh, a: without.peak, b: full.peak, d: drop },
    });
  }
  const trace = (run: { t: number[]; v: number[] }): Point[] => run.t.map((t, i) => [t, run.v[i]]);
  return {
    rows,
    steps,
    latex: 'C\\frac{dV}{dt} = -g_L(V - E_L) - g(t)(V - E_{syn})',
    notes: [{ key: 'neuron.n.synapse' }],
    plots: [
      {
        title: 'neuron.p.psp',
        x: { label: 'neuron.p.time' },
        y: { label: 'neuron.p.vm' },
        series: [
          { name: 'neuron.p.response', points: trace(full) },
          { name: 'neuron.p.singleEvent', style: 'dashed', points: trace(single) },
        ],
      },
    ],
  };
}
