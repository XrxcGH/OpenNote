// Membrane potentials and passive properties: Nernst and Goldman-Hodgkin-Katz potentials, the GHK current, Donnan
// equilibrium, membrane RC charging, the passive cable, conduction-velocity rules, and the leaky integrate-and-fire
// neuron. Voltages in mV, time in ms, concentrations in mM, temperature in °C.
import { LsError, nonNegative, positive } from '../num/errors';
import type { CalcResult, Step } from '../types';

type Point = [number, number];
/** CODATA 2018: the gas constant (J/(mol K)) and the Faraday constant (C/mol), both exact. */
export const R_GAS = 8.314462618;
export const FARADAY = 96485.33212;
const kelvin = (celsius: number): number => {
  const T = celsius + 273.15;
  if (!(T > 0)) throw new LsError('neuron.e.kelvin');
  return T;
};
/** RT/F in mV at a temperature in °C. */
export const thermalMv = (celsius: number): number => (1000 * R_GAS * kelvin(celsius)) / FARADAY;

/** E = (RT/zF) ln([X]o/[X]i) in mV. */
export function nernst(z: number, out: number, inside: number, celsius: number): number {
  if (z === 0 || !Number.isInteger(z)) throw new LsError('neuron.e.valence');
  positive(out, '[X]o');
  positive(inside, '[X]i');
  return (thermalMv(celsius) / z) * Math.log(out / inside);
}

export function nernstResult(z: number, out: number, inside: number, celsius: number): CalcResult {
  const E = nernst(z, out, inside, celsius);
  const rtf = thermalMv(celsius);
  return {
    rows: [
      { label: 'neuron.r.E', value: E, unit: 'mV' },
      { label: 'neuron.r.rtf', value: rtf, unit: 'mV' },
    ],
    steps: [
      { key: 'neuron.s.rtf', vars: { T: kelvin(celsius), rtf } },
      {
        key: 'neuron.s.nernst',
        vars: { rtf, z, o: out, i: inside, E },
        math: 'E = \\frac{RT}{zF} \\ln\\frac{[X]_o}{[X]_i}',
      },
    ],
    latex: 'E = \\frac{RT}{zF} \\ln\\frac{[X]_o}{[X]_i}',
    notes: [{ key: 'neuron.n.nernst' }],
  };
}

export interface GhkIons {
  pK: number;
  pNa: number;
  pCl: number;
  kOut: number;
  kIn: number;
  naOut: number;
  naIn: number;
  clOut: number;
  clIn: number;
}

/** V = (RT/F) ln((PK[K]o + PNa[Na]o + PCl[Cl]i) / (PK[K]i + PNa[Na]i + PCl[Cl]o)) in mV. */
export function ghk(ions: GhkIons, celsius: number): { V: number; top: number; bottom: number } {
  for (const [k, v] of Object.entries(ions)) nonNegative(v, k);
  const top = ions.pK * ions.kOut + ions.pNa * ions.naOut + ions.pCl * ions.clIn;
  const bottom = ions.pK * ions.kIn + ions.pNa * ions.naIn + ions.pCl * ions.clOut;
  if (!(top > 0 && bottom > 0)) throw new LsError('neuron.e.ghk');
  return { V: thermalMv(celsius) * Math.log(top / bottom), top, bottom };
}

export function ghkResult(ions: GhkIons, celsius: number): CalcResult {
  const { V, top, bottom } = ghk(ions, celsius);
  const each = (z: number, o: number, i: number) => (o > 0 && i > 0 ? nernst(z, o, i, celsius) : NaN);
  const rows = [
    { label: 'neuron.r.vGhk' as const, value: V, unit: 'mV' },
    { label: 'neuron.r.eK' as const, value: each(1, ions.kOut, ions.kIn), unit: 'mV' },
    { label: 'neuron.r.eNa' as const, value: each(1, ions.naOut, ions.naIn), unit: 'mV' },
    { label: 'neuron.r.eCl' as const, value: each(-1, ions.clOut, ions.clIn), unit: 'mV' },
  ].filter((r) => Number.isFinite(r.value));
  const latex =
    'V_m = \\frac{RT}{F} \\ln\\frac{P_K[K]_o + P_{Na}[Na]_o + P_{Cl}[Cl]_i}{P_K[K]_i + P_{Na}[Na]_i + P_{Cl}[Cl]_o}';
  return {
    rows,
    steps: [
      { key: 'neuron.s.ghkSums', vars: { top, bottom } },
      { key: 'neuron.s.ghk', vars: { rtf: thermalMv(celsius), top, bottom, V }, math: latex },
    ],
    latex,
    notes: [{ key: 'neuron.n.ghk' }],
  };
}

/** GHK current density in µA/cm² for permeability P (cm/s), valence z, concentrations in mM, at V mV. */
export function ghkCurrent(p: number, z: number, cIn: number, cOut: number, v: number, celsius: number): number {
  const u = (z * v) / thermalMv(celsius);
  const molPerCm3 = 1e-6;
  const scale = p * z * FARADAY * molPerCm3 * 1e6;
  // At V = 0 the limit is P z F (Ci − Co).
  if (Math.abs(u) < 1e-9) return scale * (cIn - cOut);
  return scale * u * ((cIn - cOut * Math.exp(-u)) / (1 - Math.exp(-u)));
}

export function ghkCurrentResult(
  p: number,
  z: number,
  cIn: number,
  cOut: number,
  v: number,
  celsius: number,
): CalcResult {
  positive(p, 'P');
  if (z === 0 || !Number.isInteger(z)) throw new LsError('neuron.e.valence');
  nonNegative(cIn, '[X]i');
  nonNegative(cOut, '[X]o');
  const I = ghkCurrent(p, z, cIn, cOut, v, celsius);
  const reversal = cIn > 0 && cOut > 0 ? nernst(z, cOut, cIn, celsius) : NaN;
  const points: Point[] = Array.from({ length: 121 }, (_, i) => {
    const vv = -120 + (180 * i) / 120;
    return [vv, ghkCurrent(p, z, cIn, cOut, vv, celsius)];
  });
  return {
    rows: [
      { label: 'neuron.r.iGhk', vars: { v }, value: I, unit: 'µA/cm²' },
      ...(Number.isFinite(reversal) ? [{ label: 'neuron.r.reversal' as const, value: reversal, unit: 'mV' }] : []),
    ],
    steps: [
      {
        key: 'neuron.s.ghkCurrent',
        vars: { P: p, z, v, I },
        math: 'I = P z^2 \\frac{F^2 V}{RT} \\frac{[X]_i - [X]_o e^{-zFV/RT}}{1 - e^{-zFV/RT}}',
      },
    ],
    latex: 'I = P z^2 \\frac{F^2 V}{RT} \\frac{[X]_i - [X]_o e^{-zFV/RT}}{1 - e^{-zFV/RT}}',
    notes: [{ key: 'neuron.n.ghkCurrent' }],
    plots: [
      {
        title: 'neuron.p.iv',
        x: { label: 'neuron.p.vm' },
        y: { label: 'neuron.p.current' },
        series: [{ name: 'neuron.p.ghkSeries', points }],
      },
    ],
  };
}

/** Donnan equilibrium of a 1:1 salt at c mM outside against an impermeant anion of charge zA at A mM inside. */
export function donnan(c: number, a: number, zA: number, celsius: number) {
  positive(c, '[salt]o');
  nonNegative(a, '[A]i');
  if (!(zA < 0) || !Number.isInteger(zA)) throw new LsError('neuron.e.anion');
  const charge = -zA * a;
  const clIn = (-charge + Math.sqrt(charge * charge + 4 * c * c)) / 2;
  const kIn = clIn + charge;
  return { kIn, clIn, E: thermalMv(celsius) * Math.log(c / kIn), osmotic: kIn + clIn + a - 2 * c };
}

export function donnanResult(c: number, a: number, zA: number, celsius: number): CalcResult {
  const d = donnan(c, a, zA, celsius);
  return {
    rows: [
      { label: 'neuron.r.kIn', value: d.kIn, unit: 'mM' },
      { label: 'neuron.r.clIn', value: d.clIn, unit: 'mM' },
      { label: 'neuron.r.donnanE', value: d.E, unit: 'mV' },
      { label: 'neuron.r.osmotic', value: d.osmotic, unit: 'mOsm/L' },
    ],
    steps: [
      { key: 'neuron.s.donnanProduct', vars: { c, a, z: zA }, math: '[K]_i [Cl]_i = [K]_o [Cl]_o' },
      { key: 'neuron.s.donnanSolve', vars: { k: d.kIn, cl: d.clIn } },
      { key: 'neuron.s.donnanE', vars: { c, k: d.kIn, E: d.E } },
    ],
    latex: '[K]_i [Cl]_i = [K]_o [Cl]_o',
    notes: [{ key: 'neuron.n.donnan' }],
  };
}

/** A spherical cell's input resistance (MΩ), capacitance (pF), and time constant (ms). */
export function rcCell(rm: number, cm: number, diameterUm: number) {
  positive(rm, 'Rm');
  positive(cm, 'Cm');
  positive(diameterUm, 'd');
  const areaCm2 = Math.PI * (diameterUm * 1e-4) ** 2;
  return { areaCm2, rin: rm / areaCm2 / 1e6, cap: cm * areaCm2 * 1e6, tau: rm * cm * 1e-3 };
}

export function rcResult(rm: number, cm: number, diameterUm: number, currentPa: number): CalcResult {
  const c = rcCell(rm, cm, diameterUm);
  const dv = currentPa * 1e-12 * c.rin * 1e6 * 1e3;
  const end = 5 * c.tau;
  return {
    rows: [
      { label: 'neuron.r.tau', value: c.tau, unit: 'ms' },
      { label: 'neuron.r.rin', value: c.rin, unit: 'MΩ' },
      { label: 'neuron.r.cap', value: c.cap, unit: 'pF' },
      { label: 'neuron.r.dv', value: dv, unit: 'mV' },
    ],
    steps: [
      { key: 'neuron.s.area', vars: { d: diameterUm, A: c.areaCm2 }, math: 'A = \\pi d^2' },
      { key: 'neuron.s.rin', vars: { rm, A: c.areaCm2, r: c.rin, cm, C: c.cap } },
      { key: 'neuron.s.tau', vars: { rm, cm, tau: c.tau }, math: '\\tau = R_m C_m' },
      { key: 'neuron.s.charge', vars: { I: currentPa, r: c.rin, dv }, math: 'V(t) = I R_{in}(1 - e^{-t/\\tau})' },
    ],
    latex: 'V(t) = I R_{in}\\left(1 - e^{-t/\\tau}\\right)',
    plots: [
      {
        title: 'neuron.p.charging',
        x: { label: 'neuron.p.time' },
        y: { label: 'neuron.p.dv' },
        series: [
          {
            name: 'neuron.p.charge',
            points: Array.from({ length: 101 }, (_, i) => {
              const t = (end * i) / 100;
              return [t, dv * (1 - Math.exp(-t / c.tau))] as Point;
            }),
          },
        ],
      },
    ],
  };
}

/** λ = √(Rm d / (4 Ri)) in mm, from Rm (Ω cm²), Ri (Ω cm), and d (µm). */
export const lengthConstant = (rm: number, ri: number, diameterUm: number): number =>
  Math.sqrt((rm * diameterUm * 1e-4) / (4 * ri)) * 10;

export function cableResult(rm: number, ri: number, diameterUm: number, cm: number, xMm: number): CalcResult {
  positive(rm, 'Rm');
  positive(ri, 'Ri');
  positive(diameterUm, 'd');
  positive(cm, 'Cm');
  nonNegative(xMm, 'x');
  const lambda = lengthConstant(rm, ri, diameterUm);
  const ratio = Math.exp(-xMm / lambda);
  const tau = rm * cm * 1e-3;
  const end = Math.max(4 * lambda, xMm * 1.2);
  return {
    rows: [
      { label: 'neuron.r.lambda', value: lambda, unit: 'mm' },
      { label: 'neuron.r.ratio', vars: { x: xMm }, value: ratio },
      { label: 'neuron.r.tau', value: tau, unit: 'ms' },
    ],
    steps: [
      {
        key: 'neuron.s.lambda',
        vars: { rm, d: diameterUm, ri, l: lambda },
        math: '\\lambda = \\sqrt{\\frac{R_m d}{4 R_i}}',
      },
      { key: 'neuron.s.decay', vars: { x: xMm, l: lambda, r: ratio }, math: 'V(x) = V_0 e^{-x/\\lambda}' },
      { key: 'neuron.s.tau', vars: { rm, cm, tau } },
    ],
    latex: '\\lambda = \\sqrt{\\frac{R_m d}{4 R_i}}',
    notes: [{ key: 'neuron.n.cable' }],
    plots: [
      {
        title: 'neuron.p.cable',
        x: { label: 'neuron.p.distance' },
        y: { label: 'neuron.p.ratio', min: 0, max: 1 },
        series: [
          {
            name: 'neuron.p.decay',
            points: Array.from({ length: 101 }, (_, i) => {
              const x = (end * i) / 100;
              return [x, Math.exp(-x / lambda)] as Point;
            }),
          },
        ],
      },
    ],
  };
}

/**
 * Teaching rules for conduction velocity: about 6 m/s per µm of outer diameter for myelinated axons (Hursh 1939), and
 * about √d m/s (d in µm) for unmyelinated axons, since velocity grows with the square root of the diameter.
 */
export const velocity = (diameterUm: number, myelinated: boolean): number =>
  myelinated ? 6 * diameterUm : Math.sqrt(diameterUm);

export function velocityResult(diameterUm: number, distanceMm: number | null): CalcResult {
  positive(diameterUm, 'd');
  const my = velocity(diameterUm, true);
  const un = velocity(diameterUm, false);
  const rows: CalcResult['rows'] = [
    { label: 'neuron.r.vMyelinated', value: my, unit: 'm/s' },
    { label: 'neuron.r.vUnmyelinated', value: un, unit: 'm/s' },
  ];
  const steps: Step[] = [
    { key: 'neuron.s.vMyelinated', vars: { d: diameterUm, v: my } },
    { key: 'neuron.s.vUnmyelinated', vars: { d: diameterUm, v: un } },
  ];
  if (distanceMm !== null) {
    positive(distanceMm, 'L');
    rows.push(
      { label: 'neuron.r.delayMyelinated', value: distanceMm / my, unit: 'ms' },
      { label: 'neuron.r.delayUnmyelinated', value: distanceMm / un, unit: 'ms' },
    );
    steps.push({ key: 'neuron.s.delay', vars: { L: distanceMm, a: distanceMm / my, b: distanceMm / un } });
  }
  const top = Math.max(diameterUm * 2, 20);
  return {
    rows,
    steps,
    notes: [{ key: 'neuron.n.velocity' }],
    plots: [
      {
        title: 'neuron.p.velocity',
        x: { label: 'neuron.p.diameter' },
        y: { label: 'neuron.p.speed' },
        series: [
          {
            name: 'neuron.p.myelinated',
            points: Array.from({ length: 61 }, (_, i) => [(top * i) / 60, velocity((top * i) / 60, true)] as Point),
          },
          {
            name: 'neuron.p.unmyelinated',
            style: 'dashed',
            points: Array.from({ length: 61 }, (_, i) => [(top * i) / 60, velocity((top * i) / 60, false)] as Point),
          },
        ],
      },
    ],
  };
}

export interface Lif {
  tau: number;
  el: number;
  reset: number;
  th: number;
  /** MΩ. */
  r: number;
  /** nA. */
  i: number;
  /** Refractory period (ms). */
  ref: number;
}

/** The interspike interval (ms) of a leaky integrate-and-fire neuron, or Infinity below rheobase. */
export function lifIsi(p: Lif): number {
  const vInf = p.el + p.r * p.i;
  if (!(vInf > p.th)) return Infinity;
  return p.ref + p.tau * Math.log((vInf - p.reset) / (vInf - p.th));
}

export function lifResult(p: Lif, duration: number): CalcResult {
  positive(p.tau, 'τ');
  positive(p.r, 'R');
  nonNegative(p.ref, 't_ref');
  positive(duration, 't');
  if (!(p.reset < p.th)) throw new LsError('neuron.e.reset');
  const isi = lifIsi(p);
  const vInf = p.el + p.r * p.i;
  const rheobase = (p.th - p.el) / p.r;
  // The trace: integrate exactly between spikes.
  const trace: Point[] = [];
  let v = p.el;
  let t = 0;
  let spikes = 0;
  const dt = Math.min(p.tau / 50, duration / 400);
  let hold = 0;
  while (t <= duration && trace.length < 20000) {
    trace.push([t, v]);
    if (hold > 0) {
      hold -= dt;
      v = p.reset;
    } else {
      v = vInf + (v - vInf) * Math.exp(-dt / p.tau);
      if (v >= p.th) {
        trace.push([t + dt, 0]);
        spikes += 1;
        v = p.reset;
        hold = p.ref;
      }
    }
    t += dt;
  }
  const fi: Point[] = Array.from({ length: 81 }, (_, k) => {
    const current = (Math.max(2 * p.i, 2 * rheobase) * k) / 80;
    const interval = lifIsi({ ...p, i: current });
    return [current, Number.isFinite(interval) ? 1000 / interval : 0];
  });
  const fires = Number.isFinite(isi);
  return {
    rows: [
      { label: 'neuron.r.vInf', value: vInf, unit: 'mV' },
      { label: 'neuron.r.rheobase', value: rheobase, unit: 'nA' },
      ...(fires
        ? [
            { label: 'neuron.r.isi' as const, value: isi, unit: 'ms' },
            { label: 'neuron.r.rate' as const, value: 1000 / isi, unit: 'Hz' },
          ]
        : [{ label: 'neuron.r.rate' as const, value: 0, unit: 'Hz' }]),
      { label: 'neuron.r.spikes', vars: { t: duration }, value: spikes },
    ],
    steps: [
      { key: 'neuron.s.vInf', vars: { el: p.el, r: p.r, i: p.i, v: vInf } },
      fires
        ? {
            key: 'neuron.s.isi',
            vars: { ref: p.ref, tau: p.tau, v: vInf, reset: p.reset, th: p.th, isi },
            math: 'T = t_{ref} + \\tau \\ln\\frac{V_\\infty - V_{reset}}{V_\\infty - V_{th}}',
          }
        : { key: 'neuron.s.noFire', vars: { v: vInf, th: p.th, rh: rheobase } },
    ],
    latex: '\\tau \\frac{dV}{dt} = -(V - E_L) + R I',
    notes: [{ key: 'neuron.n.lif' }],
    plots: [
      {
        title: 'neuron.p.lifTrace',
        x: { label: 'neuron.p.time' },
        y: { label: 'neuron.p.vm' },
        series: [{ name: 'neuron.p.vSeries', points: trace }],
      },
      {
        title: 'neuron.p.fi',
        x: { label: 'neuron.p.inputNa' },
        y: { label: 'neuron.p.rate', min: 0 },
        series: [{ name: 'neuron.p.fiSeries', points: fi }],
      },
    ],
  };
}
