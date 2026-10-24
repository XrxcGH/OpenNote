// Heat exchangers by the effectiveness-NTU and log-mean temperature difference methods: parallel flow, counterflow,
// one shell with 2n tube passes, three cross-flow arrangements, and a condenser or boiler (Cr = 0). Temperatures in
// kelvin or celsius (the same scale in and out), heat capacity rates in W/K, UA in W/K.
import { brent, CalcError, fmt, need, nonNegative, positive, type Step } from '../numeric';

export type HxType = 'counter' | 'parallel' | 'shell' | 'crossUnmixed' | 'crossCmaxMixed' | 'crossCminMixed';

/** Effectiveness of an exchanger from NTU and the capacity ratio Cr = Cmin/Cmax. */
export function effectiveness(type: HxType, ntu: number, cr: number): number {
  if (cr === 0) return 1 - Math.exp(-ntu);
  switch (type) {
    case 'parallel':
      return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
    case 'counter':
      return cr === 1 ? ntu / (1 + ntu) : (1 - Math.exp(-ntu * (1 - cr))) / (1 - cr * Math.exp(-ntu * (1 - cr)));
    case 'shell': {
      const s = Math.sqrt(1 + cr * cr);
      const e = Math.exp(-ntu * s);
      return 2 / (1 + cr + (s * (1 + e)) / (1 - e));
    }
    case 'crossUnmixed':
      return 1 - Math.exp((ntu ** 0.22 / cr) * (Math.exp(-cr * ntu ** 0.78) - 1));
    case 'crossCmaxMixed':
      return (1 / cr) * (1 - Math.exp(-cr * (1 - Math.exp(-ntu))));
    case 'crossCminMixed':
      return 1 - Math.exp(-(1 / cr) * (1 - Math.exp(-cr * ntu)));
  }
}

/** The largest effectiveness the arrangement can reach as NTU grows without bound. */
export function maxEffectiveness(type: HxType, cr: number): number {
  if (cr === 0) return 1;
  if (type === 'parallel') return 1 / (1 + cr);
  if (type === 'crossCmaxMixed') return (1 / cr) * (1 - Math.exp(-cr));
  if (type === 'crossCminMixed') return 1 - Math.exp(-1 / cr);
  return 1;
}

/** NTU that gives a wanted effectiveness. */
export function ntuFor(type: HxType, eps: number, cr: number): number {
  need(eps > 0, 'effectiveness', 'The effectiveness must be above zero.');
  const max = maxEffectiveness(type, cr);
  need(
    eps < max * (1 - 1e-12),
    'effectiveness',
    `This arrangement cannot reach an effectiveness of ${fmt(eps, 4)}; its limit is ${fmt(max, 4)}.`,
  );
  if (cr === 0) return -Math.log(1 - eps);
  if (type === 'counter' && cr === 1) return eps / (1 - eps);
  return brent((n) => effectiveness(type, n, cr) - eps, 1e-12, 1e4);
}

/** Log-mean temperature difference of two end differences. */
export function lmtd(d1: number, d2: number): number {
  need(
    d1 > 0 && d2 > 0,
    'lmtd',
    'Both end temperature differences must be above zero: a temperature cross is not possible.',
  );
  return Math.abs(d1 - d2) < 1e-9 * Math.max(d1, d2) ? (d1 + d2) / 2 : (d1 - d2) / Math.log(d1 / d2);
}

/** The LMTD correction factor F for one shell with 2, 4, ... tube passes. P and R as in the standard definition. */
export function shellCorrection(p: number, r: number): number {
  need(p > 0 && p < 1, 'pfactor', 'P must be between 0 and 1.');
  need(r > 0, 'rfactor', 'R must be above zero.');
  if (Math.abs(r - 1) < 1e-9) {
    const a = 2 - p * (2 - Math.SQRT2);
    const b = 2 - p * (2 + Math.SQRT2);
    need(
      b > 0,
      'infeasible',
      'This temperature program is impossible in one shell: use more shells or a counterflow exchanger.',
    );
    return (Math.SQRT2 * p) / (1 - p) / Math.log(a / b);
  }
  const s = Math.sqrt(r * r + 1);
  const a = 2 - p * (r + 1 - s);
  const b = 2 - p * (r + 1 + s);
  need(
    b > 0 && (1 - p) / (1 - r * p) > 0,
    'infeasible',
    'This temperature program is impossible in one shell: use more shells or a counterflow exchanger.',
  );
  return ((s / (r - 1)) * Math.log((1 - p) / (1 - r * p))) / Math.log(a / b);
}

export interface HxInput {
  type: HxType;
  /** Hot and cold capacity rates m cp (W/K). Use a very large number (or Infinity) for a condensing or boiling stream. */
  ch: number;
  cc: number;
  thIn: number;
  tcIn: number;
  /** Rating: the conductance UA (W/K). */
  ua?: number;
}

export interface HxResult {
  cmin: number;
  cmax: number;
  cr: number;
  ntu: number;
  eps: number;
  q: number;
  thOut: number;
  tcOut: number;
  lmtd: number;
  /** Correction factor (1 for pure counterflow and parallel flow). */
  f: number;
  ua: number;
  steps: Step[];
}

function capacities(inp: Pick<HxInput, 'ch' | 'cc' | 'thIn' | 'tcIn'>) {
  need(inp.ch > 0 && inp.cc > 0, 'capacity', 'Both capacity rates (mass flow times specific heat) must be above zero.');
  need(inp.thIn > inp.tcIn, 'hotCold', 'The hot inlet must be hotter than the cold inlet.');
  const finite = [inp.ch, inp.cc].filter((c) => Number.isFinite(c));
  const cmin = Math.min(inp.ch, inp.cc);
  const cmax = Math.max(inp.ch, inp.cc);
  const cr = Number.isFinite(cmax) ? cmin / cmax : 0;
  return { cmin, cmax, cr, finiteCount: finite.length };
}

function endDifferences(type: HxType, thIn: number, thOut: number, tcIn: number, tcOut: number): [number, number] {
  return type === 'parallel' ? [thIn - tcIn, thOut - tcOut] : [thIn - tcOut, thOut - tcIn];
}

/** Rating: given UA and the inlets, the outlets and the heat rate. */
export function rate(inp: HxInput): HxResult {
  positive(inp.ua ?? NaN, 'The conductance UA');
  const { cmin, cmax, cr } = capacities(inp);
  const ntu = inp.ua! / cmin;
  const eps = effectiveness(inp.type, ntu, cr);
  const dtMax = inp.thIn - inp.tcIn;
  const q = eps * cmin * dtMax;
  const thOut = inp.thIn - (Number.isFinite(inp.ch) ? q / inp.ch : 0);
  const tcOut = inp.tcIn + (Number.isFinite(inp.cc) ? q / inp.cc : 0);
  return finish(inp, { cmin, cmax, cr, ntu, eps, q, thOut, tcOut, ua: inp.ua! }, 'rate');
}

/** Sizing: given the inlets and the heat duty `q` (W), or one outlet, the conductance needed. */
export function size(inp: HxInput & { q?: number; thOut?: number; tcOut?: number }): HxResult {
  const { cmin, cmax, cr } = capacities(inp);
  const dtMax = inp.thIn - inp.tcIn;
  let q: number;
  if (inp.q !== undefined && Number.isFinite(inp.q)) q = inp.q;
  else if (inp.thOut !== undefined && Number.isFinite(inp.thOut)) q = inp.ch * (inp.thIn - inp.thOut);
  else if (inp.tcOut !== undefined && Number.isFinite(inp.tcOut)) q = inp.cc * (inp.tcOut - inp.tcIn);
  else throw new CalcError('input', 'Give the heat duty or one outlet temperature.');
  positive(q, 'The heat duty');
  const eps = q / (cmin * dtMax);
  need(eps < 1, 'duty', 'That duty is more than the inlet temperatures allow: the effectiveness would be 1 or more.');
  const ntu = ntuFor(inp.type, eps, cr);
  const thOut = inp.thIn - (Number.isFinite(inp.ch) ? q / inp.ch : 0);
  const tcOut = inp.tcIn + (Number.isFinite(inp.cc) ? q / inp.cc : 0);
  return finish(inp, { cmin, cmax, cr, ntu, eps, q, thOut, tcOut, ua: ntu * cmin }, 'size');
}

function finish(
  inp: HxInput,
  r: {
    cmin: number;
    cmax: number;
    cr: number;
    ntu: number;
    eps: number;
    q: number;
    thOut: number;
    tcOut: number;
    ua: number;
  },
  mode: 'rate' | 'size',
): HxResult {
  const [d1, d2] = endDifferences(
    inp.type === 'parallel' ? 'parallel' : 'counter',
    inp.thIn,
    r.thOut,
    inp.tcIn,
    r.tcOut,
  );
  let meanDt = NaN;
  let f = 1;
  if (d1 > 0 && d2 > 0) {
    meanDt = lmtd(d1, d2);
    if (inp.type === 'shell') {
      const p = (r.tcOut - inp.tcIn) / (inp.thIn - inp.tcIn);
      const rr = (inp.thIn - r.thOut) / (r.tcOut - inp.tcIn);
      f = shellCorrection(p, rr);
    } else if (inp.type !== 'counter' && inp.type !== 'parallel') {
      f = r.q / (r.ua * meanDt);
    }
  }
  const steps: Step[] = [
    {
      key: 'fhHxCapacity',
      vars: { cmin: fmt(r.cmin), cmax: Number.isFinite(r.cmax) ? fmt(r.cmax) : '∞', cr: fmt(r.cr) },
      math: `C_r = \\frac{C_{min}}{C_{max}} = ${fmt(r.cr)}`,
    },
    mode === 'rate'
      ? {
          key: 'fhHxNtu',
          vars: { ntu: fmt(r.ntu) },
          math: `NTU = \\frac{UA}{C_{min}} = \\frac{${fmt(r.ua)}}{${fmt(r.cmin)}} = ${fmt(r.ntu)}`,
        }
      : {
          key: 'fhHxNtuInverse',
          vars: { ntu: fmt(r.ntu), eps: fmt(r.eps) },
          math: `\\varepsilon = \\frac{q}{C_{min}(T_{h,in} - T_{c,in})} = ${fmt(r.eps)},\\quad NTU = ${fmt(r.ntu)},\\quad UA = NTU\\,C_{min} = ${fmt(r.ua)}\\ \\mathrm{W/K}`,
        },
    {
      key: 'fhHxEps',
      vars: { eps: fmt(r.eps) },
      math: `\\varepsilon = ${fmt(r.eps)}`,
    },
    {
      key: 'fhHxQ',
      vars: { q: fmt(r.q) },
      math: `q = \\varepsilon C_{min}(T_{h,in} - T_{c,in}) = ${fmt(r.eps)}\\cdot${fmt(r.cmin)}\\cdot${fmt(inp.thIn - inp.tcIn)} = ${fmt(r.q)}\\ \\mathrm{W}`,
    },
    {
      key: 'fhHxOutlets',
      vars: { th: fmt(r.thOut), tc: fmt(r.tcOut) },
      math: `T_{h,out} = ${fmt(r.thOut)},\\quad T_{c,out} = ${fmt(r.tcOut)}`,
    },
  ];
  if (Number.isFinite(meanDt)) {
    steps.push({
      key: 'fhHxLmtd',
      vars: { lmtd: fmt(meanDt), f: fmt(f) },
      math: `\\Delta T_{lm} = \\frac{\\Delta T_1 - \\Delta T_2}{\\ln(\\Delta T_1/\\Delta T_2)} = ${fmt(meanDt)},\\quad q = F\\,UA\\,\\Delta T_{lm} \\Rightarrow F = ${fmt(f)}`,
    });
  }
  return { ...r, lmtd: meanDt, f, steps };
}

/** Rating from all four temperatures (LMTD method): the conductance and, for shell-and-tube, the correction factor. */
export function fromTemperatures(inp: {
  type: 'counter' | 'parallel' | 'shell';
  thIn: number;
  thOut: number;
  tcIn: number;
  tcOut: number;
  /** Heat duty (W). */
  q: number;
}): { lmtd: number; f: number; ua: number; p: number; r: number; steps: Step[] } {
  positive(inp.q, 'The heat duty');
  need(inp.thIn > inp.thOut, 'hotDrop', 'The hot stream must cool: its outlet must be below its inlet.');
  need(inp.tcOut > inp.tcIn, 'coldRise', 'The cold stream must warm: its outlet must be above its inlet.');
  const [d1, d2] = endDifferences(
    inp.type === 'parallel' ? 'parallel' : 'counter',
    inp.thIn,
    inp.thOut,
    inp.tcIn,
    inp.tcOut,
  );
  const meanDt = lmtd(d1, d2);
  const p = (inp.tcOut - inp.tcIn) / (inp.thIn - inp.tcIn);
  const r = (inp.thIn - inp.thOut) / (inp.tcOut - inp.tcIn);
  const f = inp.type === 'shell' ? shellCorrection(p, r) : 1;
  const ua = inp.q / (f * meanDt);
  nonNegative(ua, 'UA');
  const steps: Step[] = [
    {
      key: 'fhHxDiffs',
      vars: { d1: fmt(d1), d2: fmt(d2) },
      math: `\\Delta T_1 = ${fmt(d1)},\\quad \\Delta T_2 = ${fmt(d2)}`,
    },
    { key: 'fhHxLmtdOnly', vars: { lmtd: fmt(meanDt) }, math: `\\Delta T_{lm} = ${fmt(meanDt)}` },
    ...(inp.type === 'shell'
      ? [
          {
            key: 'fhHxFactor',
            vars: { p: fmt(p), r: fmt(r), f: fmt(f) },
            math: `P = ${fmt(p)},\\quad R = ${fmt(r)},\\quad F = ${fmt(f)}`,
          },
        ]
      : []),
    { key: 'fhHxUa', vars: { ua: fmt(ua) }, math: `UA = \\frac{q}{F\\,\\Delta T_{lm}} = ${fmt(ua)}\\ \\mathrm{W/K}` },
  ];
  return { lmtd: meanDt, f, ua, p, r, steps };
}

/** Temperature profile of a parallel or counterflow exchanger along its length (x from 0 to 1). */
export function profile(inp: HxInput & { ua: number }, points = 41): { x: number[]; hot: number[]; cold: number[] } {
  need(
    inp.type === 'parallel' || inp.type === 'counter',
    'profileType',
    'The profile is drawn for parallel and counterflow exchangers.',
  );
  const res = rate(inp);
  const ih = Number.isFinite(inp.ch) ? 1 / inp.ch : 0;
  const ic = Number.isFinite(inp.cc) ? 1 / inp.cc : 0;
  const beta = inp.ua * (inp.type === 'parallel' ? ih + ic : ih - ic);
  const dt0 = inp.type === 'parallel' ? inp.thIn - inp.tcIn : inp.thIn - res.tcOut;
  const x: number[] = [];
  const hot: number[] = [];
  const cold: number[] = [];
  for (let i = 0; i < points; i++) {
    const s = i / (points - 1);
    const dt = dt0 * Math.exp(-beta * s);
    const integral = Math.abs(beta) < 1e-12 ? s : (1 - Math.exp(-beta * s)) / beta;
    const th = inp.thIn - inp.ua * ih * dt0 * integral;
    x.push(s);
    hot.push(th);
    cold.push(th - dt);
  }
  return { x, hot, cold };
}
