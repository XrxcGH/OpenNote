// Chemical and biological reactors: the methods behind the calculations in ./calcs. Concentrations are in mol/L (or
// g/L and mg/L for growth and sludge), times in the unit of the rate constant, and temperatures in kelvin.
import { evaluate, tryParse } from '../../../../core/expr';
import { dopri45 } from '../../kits/num/ode';
import { brent } from '../core/num';
import { CivilError, need } from '../core/types';

export const R_GAS = 8.314462618;

export type Rate = (C: number) => number;

/** A power-law rate k Cⁿ. */
export function powerLaw(k: number, n: number): Rate {
  need(k > 0, 'errors.positive', { name: '~reactors.f.k' });
  need(n >= 0 && n <= 4, 'reactors.errors.order');
  return (C) => k * Math.max(0, C) ** n;
}

/** A rate typed as a formula in C, such as 2*C/(1 + 0.5*C). It is parsed by core/expr, never run as code. */
export function typedRate(source: string): Rate {
  const parsed = tryParse(source);
  need(parsed.ok, 'reactors.errors.formula');
  const at = (C: number) => {
    const out = evaluate(source, { variables: { C } });
    if (!out.ok) throw new CivilError('reactors.errors.formula');
    return out.value;
  };
  const probe = at(1);
  need(Number.isFinite(probe), 'reactors.errors.formula');
  return at;
}

export type ReactorKind = 'cstr' | 'pfr' | 'batch';

/** The outlet (or final) concentration after a space time or batch time τ. */
export function outlet(kind: ReactorKind, rate: Rate, C0: number, tau: number): number {
  need(C0 > 0, 'errors.positive', { name: '~reactors.f.C0' });
  need(tau >= 0, 'errors.nonNegative', { name: '~reactors.f.tau' });
  if (tau === 0) return C0;
  if (kind === 'cstr') {
    // τ = (C0 - C)/r(C). The residual is C0 - τ r(0) at C = 0 and -τ r(C0) at C = C0; when it is already negative
    // at 0, the reactant runs out.
    const f = (C: number) => C0 - C - tau * rate(C);
    need(rate(C0) >= 0, 'reactors.errors.rateSign');
    return f(0) <= 0 ? 0 : brent(f, 0, C0, 1e-14);
  }
  const sol = dopri45((_t, y) => [-rate(Math.max(0, y[0]!))], [0, tau], [C0], { rtol: 1e-11, atol: 1e-14 * C0 });
  need(sol.status === 'done', 'errors.noConvergence');
  return Math.max(0, sol.y[sol.y.length - 1]![0]!);
}

/** The space time that reaches conversion X. */
export function spaceTime(kind: ReactorKind, rate: Rate, C0: number, X: number): number {
  need(C0 > 0, 'errors.positive', { name: '~reactors.f.C0' });
  need(X > 0 && X < 1, 'reactors.errors.conversion');
  const C = C0 * (1 - X);
  const r = rate(C);
  need(r > 0, 'reactors.errors.rateSign');
  if (kind === 'cstr') return (C0 - C) / r;
  // τ = ∫ dC / r(C) from C to C0 by composite Simpson on many panels (the rate is smooth and positive).
  const N = 4000;
  const h = (C0 - C) / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const c = C + i * h;
    const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2;
    const ri = rate(c);
    need(ri > 0, 'reactors.errors.rateSign');
    sum += w / ri;
  }
  return (sum * h) / 3;
}

/** n equal CSTRs in series with total space time τ: the concentration leaving each tank. */
export function tanksInSeries(rate: Rate, C0: number, tau: number, n: number): number[] {
  need(Number.isInteger(n) && n >= 1 && n <= 100, 'reactors.errors.tanks');
  const out: number[] = [];
  let C = C0;
  for (let i = 0; i < n; i++) {
    C = outlet('cstr', rate, C, tau / n);
    out.push(C);
  }
  return out;
}

/** A first-order PFR with recycle ratio R: kτ/(R + 1) = ln[(C0 + R C)/((R + 1) C)]. */
export function recycleFirstOrder(k: number, tau: number, R: number): number {
  need(k > 0 && tau > 0, 'errors.positive', { name: '~reactors.f.tau' });
  need(R >= 0, 'errors.nonNegative', { name: '~reactors.f.R' });
  const a = (k * tau) / (R + 1);
  // Solve for C/C0 = c: ln((1 + R c)/((R + 1) c)) = a, so c = 1/(e^a (R + 1) - R).
  const c = 1 / (Math.exp(a) * (R + 1) - R);
  return 1 - c;
}

/** Levenspiel areas from (X, -r_A) data: CSTR and PFR volumes for molar feed F_A0. */
export function levenspiel(
  data: readonly (readonly number[])[],
  FA0: number,
): { Vcstr: number; Vpfr: number; X: number; points: [number, number][] } {
  need(FA0 > 0, 'errors.positive', { name: '~reactors.f.FA0' });
  need(data.length >= 2, 'errors.fewPoints', { count: 2 });
  const rows = [...data].map((r) => [r[0]!, r[1]!] as const);
  for (let i = 0; i < rows.length; i++) {
    need(rows[i]![1] > 0, 'reactors.errors.rateData');
    need(rows[i]![0] >= 0 && rows[i]![0] < 1, 'reactors.errors.conversion');
    if (i) need(rows[i]![0] > rows[i - 1]![0], 'reactors.errors.rising');
  }
  const points = rows.map(([x, r]) => [x, FA0 / r] as [number, number]);
  let Vpfr = 0;
  for (let i = 1; i < points.length; i++)
    Vpfr += ((points[i]![1] + points[i - 1]![1]) / 2) * (points[i]![0] - points[i - 1]![0]);
  const last = points[points.length - 1]!;
  return { Vcstr: last[1] * (last[0] - points[0]![0]), Vpfr, X: last[0], points };
}

// ---------------------------------------------------------------------------------------------------------------
// Multiple reactions

/** A → B → C, first order in each step: concentrations after τ in a PFR (or batch) and a CSTR. */
export function seriesReactions(k1: number, k2: number, A0: number, tau: number, kind: 'pfr' | 'cstr') {
  need(k1 > 0 && k2 > 0, 'errors.positive', { name: '~reactors.f.k1' });
  need(A0 > 0, 'errors.positive', { name: '~reactors.f.C0' });
  need(tau >= 0, 'errors.nonNegative', { name: '~reactors.f.tau' });
  let A: number;
  let B: number;
  let tOpt: number;
  if (kind === 'pfr') {
    A = A0 * Math.exp(-k1 * tau);
    B =
      Math.abs(k1 - k2) < 1e-12 * k1
        ? A0 * k1 * tau * Math.exp(-k1 * tau)
        : ((A0 * k1) / (k2 - k1)) * (Math.exp(-k1 * tau) - Math.exp(-k2 * tau));
    tOpt = Math.abs(k1 - k2) < 1e-12 * k1 ? 1 / k1 : Math.log(k2 / k1) / (k2 - k1);
  } else {
    A = A0 / (1 + k1 * tau);
    B = (A0 * k1 * tau) / ((1 + k1 * tau) * (1 + k2 * tau));
    tOpt = 1 / Math.sqrt(k1 * k2);
  }
  return {
    A,
    B,
    C: A0 - A - B,
    tOpt,
    X: 1 - A / A0,
    yieldB: B / A0,
    selectivity: A0 - A - B > 0 ? B / (A0 - A - B) : Infinity,
  };
}

/** Parallel A → B (k1 C^a1) and A → C (k2 C^a2) in a CSTR or PFR taken to conversion X. */
export function parallelReactions(
  k1: number,
  a1: number,
  k2: number,
  a2: number,
  A0: number,
  X: number,
  kind: 'pfr' | 'cstr',
) {
  need(k1 > 0 && k2 > 0, 'errors.positive', { name: '~reactors.f.k1' });
  need(A0 > 0, 'errors.positive', { name: '~reactors.f.C0' });
  need(X > 0 && X < 1, 'reactors.errors.conversion');
  const phi = (C: number) => (k1 * C ** a1) / (k1 * C ** a1 + k2 * C ** a2);
  const A = A0 * (1 - X);
  let B: number;
  if (kind === 'cstr') B = phi(A) * (A0 - A);
  else {
    const N = 2000;
    const h = (A0 - A) / N;
    let sum = 0;
    for (let i = 0; i <= N; i++) sum += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * phi(A + i * h);
    B = (sum * h) / 3;
  }
  const C = A0 - A - B;
  return { A, B, C, yieldB: B / A0, selectivity: C > 0 ? B / C : Infinity, instantaneous: phi(A) };
}

// ---------------------------------------------------------------------------------------------------------------
// Temperature

/** The adiabatic temperature after conversion X: T = T0 + (-ΔH) X C_A0 / (ρ cp). */
export function adiabaticRise(dH: number, CA0: number, rhoCp: number, X: number): number {
  need(rhoCp > 0, 'errors.positive', { name: '~reactors.f.rhoCp' });
  need(CA0 > 0, 'errors.positive', { name: '~reactors.f.C0' });
  need(X >= 0 && X <= 1, 'reactors.errors.conversion');
  return (-dH * X * CA0) / rhoCp;
}

/** The rate constant at T from k at Tref and the activation energy E (J/mol). */
export function arrhenius(kRef: number, Tref: number, E: number, T: number): number {
  need(kRef > 0, 'errors.positive', { name: '~reactors.f.k' });
  need(Tref > 0 && T > 0, 'reactors.errors.kelvin');
  need(E >= 0, 'errors.nonNegative', { name: '~reactors.f.E' });
  return kRef * Math.exp((-E / R_GAS) * (1 / T - 1 / Tref));
}

/** The activation energy (J/mol) from rate constants at two temperatures. */
export function activationEnergy(k1: number, T1: number, k2: number, T2: number): number {
  need(k1 > 0 && k2 > 0, 'errors.positive', { name: '~reactors.f.k' });
  need(T1 > 0 && T2 > 0, 'reactors.errors.kelvin');
  need(T1 !== T2, 'reactors.errors.sameT');
  return (R_GAS * Math.log(k2 / k1)) / (1 / T1 - 1 / T2);
}

export interface SteadyInput {
  T0: number;
  tau: number;
  kRef: number;
  Tref: number;
  E: number;
  dH: number;
  CA0: number;
  rhoCp: number;
  /** UA/(v0 ρ cp) as a dimensionless κ, and the coolant temperature. */
  kappa: number;
  Ta: number;
}

export interface SteadyState {
  T: number;
  X: number;
  stable: boolean;
}

/**
 * Steady states of a first-order CSTR: where heat generated, G(T) = (-ΔH) C_A0 X(T) with X = kτ/(1 + kτ), meets heat
 * removed, R(T) = ρ cp [(T - T0) + κ (T - Ta)]. Both per volume of feed, in kJ/L.
 */
export function steadyStates(input: SteadyInput): {
  states: SteadyState[];
  G: (T: number) => number;
  Rm: (T: number) => number;
  span: [number, number];
} {
  const { T0, tau, kRef, Tref, E, dH, CA0, rhoCp, kappa, Ta } = input;
  need(tau > 0, 'errors.positive', { name: '~reactors.f.tau' });
  need(dH < 0, 'reactors.errors.exothermic');
  need(kappa >= 0, 'errors.nonNegative', { name: '~reactors.f.kappa' });
  need(T0 > 0 && Ta > 0, 'reactors.errors.kelvin');
  const X = (T: number) => {
    const kt = arrhenius(kRef, Tref, E, T) * tau;
    return kt / (1 + kt);
  };
  const G = (T: number) => -dH * CA0 * X(T);
  const Rm = (T: number) => rhoCp * (T - T0 + kappa * (T - Ta));
  need(rhoCp > 0 && CA0 > 0, 'errors.positive', { name: '~reactors.f.rhoCp' });
  const lo = Math.max(1, Math.min(T0, Ta) - 20);
  const hi = Math.max(T0, Ta) + (-dH * CA0) / rhoCp + 50;
  const f = (T: number) => G(T) - Rm(T);
  const states: SteadyState[] = [];
  const N = 4000;
  let prevT = lo;
  let prev = f(lo);
  for (let i = 1; i <= N; i++) {
    const T = lo + ((hi - lo) * i) / N;
    const v = f(T);
    if (prev === 0 || prev * v < 0) {
      const root = prev === 0 ? prevT : brent(f, prevT, T, 1e-10);
      const dT = 1e-4 * root;
      const slope = (f(root + dT) - f(root - dT)) / (2 * dT);
      states.push({ T: root, X: X(root), stable: slope < 0 });
    }
    prevT = T;
    prev = v;
  }
  need(states.length > 0, 'errors.noRoot');
  return { states, G, Rm, span: [lo, hi] };
}

// ---------------------------------------------------------------------------------------------------------------
// Residence-time distributions

export interface Rtd {
  area: number;
  tm: number;
  variance: number;
  /** E(t) and F(t) at the data times. */
  E: number[];
  F: number[];
  /** Tanks in series N = tm² / σ², and the closed-vessel dispersion number D/uL. */
  N: number;
  Dnum: number;
}

/**
 * Moments of a pulse tracer curve read as straight lines between the points, so the integrals are exact for it:
 * area ∫C dt, mean ∫t E dt, variance ∫(t - tm)² E dt.
 */
export function rtd(data: readonly (readonly number[])[]): Rtd {
  need(data.length >= 3, 'errors.fewPoints', { count: 3 });
  const t = data.map((r) => r[0]!);
  const c = data.map((r) => r[1]!);
  for (let i = 0; i < t.length; i++) {
    need(c[i]! >= 0, 'reactors.errors.tracer');
    need(t[i]! >= 0, 'reactors.errors.time');
    if (i) need(t[i]! > t[i - 1]!, 'reactors.errors.rising');
  }
  // ∫ t^m (a + b t) dt over each segment, exactly.
  const moment = (m: number) => {
    let total = 0;
    for (let i = 1; i < t.length; i++) {
      const [t0, t1, c0, c1] = [t[i - 1]!, t[i]!, c[i - 1]!, c[i]!];
      const b = (c1 - c0) / (t1 - t0);
      const a = c0 - b * t0;
      const p = (x: number) => (a * x ** (m + 1)) / (m + 1) + (b * x ** (m + 2)) / (m + 2);
      total += p(t1) - p(t0);
    }
    return total;
  };
  const area = moment(0);
  need(area > 0, 'reactors.errors.tracer');
  const tm = moment(1) / area;
  const variance = moment(2) / area - tm * tm;
  const E = c.map((v) => v / area);
  const F = [0];
  for (let i = 1; i < t.length; i++) F.push(F[i - 1]! + ((E[i]! + E[i - 1]!) / 2) * (t[i]! - t[i - 1]!));
  const s2 = variance / (tm * tm);
  const N = s2 > 0 ? 1 / s2 : Infinity;
  // σ²/tm² = 2D - 2D²(1 - e^(-1/D)) rises from 0 toward 1 with D; solve for D when the curve is spread enough.
  const g = (D: number) => 2 * D - 2 * D * D * (1 - Math.exp(-1 / D)) - s2;
  const Dnum = s2 > 0 && s2 < 0.99 ? brent(g, 1e-9, 1e6, 1e-14) : NaN;
  return { area, tm, variance, E, F, N, Dnum };
}

/** First-order conversion from an RTD by the segregation model, X = 1 - ∫ e^(-kt) E(t) dt (piecewise linear E). */
export function segregationX(data: readonly (readonly number[])[], k: number): number {
  need(k > 0, 'errors.positive', { name: '~reactors.f.k' });
  const r = rtd(data);
  const t = data.map((row) => row[0]!);
  let total = 0;
  for (let i = 1; i < t.length; i++) {
    const [t0, t1, e0, e1] = [t[i - 1]!, t[i]!, r.E[i - 1]!, r.E[i]!];
    const b = (e1 - e0) / (t1 - t0);
    const a = e0 - b * t0;
    // ∫ (a + b t) e^(-kt) dt = -e^(-kt)[(a + b t)/k + b/k²]
    const p = (x: number) => -Math.exp(-k * x) * ((a + b * x) / k + b / (k * k));
    total += p(t1) - p(t0);
  }
  return 1 - total;
}

// ---------------------------------------------------------------------------------------------------------------
// Growth

/** Monod chemostat at dilution rate D, with Pirt maintenance m (0 for none). */
export function chemostat(muMax: number, Ks: number, D: number, S0: number, Y: number, m = 0, kd = 0) {
  need(muMax > 0 && Ks > 0, 'errors.positive', { name: '~reactors.f.muMax' });
  need(D > 0, 'errors.positive', { name: '~reactors.f.D' });
  need(S0 > 0, 'errors.positive', { name: '~reactors.f.S0' });
  need(Y > 0 && Y <= 1.5, 'reactors.errors.yield');
  need(m >= 0 && kd >= 0, 'errors.nonNegative', { name: '~reactors.f.m' });
  const mu = D + kd;
  const Dcrit = (muMax * S0) / (Ks + S0) - kd;
  if (mu >= muMax || D >= Dcrit) return { washout: true as const, Dcrit, S: S0, X: 0, productivity: 0, Yobs: 0 };
  const S = (Ks * mu) / (muMax - mu);
  const Yobs = 1 / (1 / Y + m / mu);
  const X = (D * Yobs * (S0 - S)) / mu;
  return { washout: false as const, Dcrit, S, X, productivity: D * X, Yobs };
}

/** Batch Monod growth: X and S against time until the substrate runs out or t_end. */
export function batchGrowth(muMax: number, Ks: number, X0: number, S0: number, Y: number, tEnd: number) {
  need(muMax > 0 && Ks > 0, 'errors.positive', { name: '~reactors.f.muMax' });
  need(X0 > 0 && S0 > 0, 'errors.positive', { name: '~reactors.f.X0' });
  need(Y > 0 && Y <= 1.5, 'reactors.errors.yield');
  need(tEnd > 0, 'errors.positive', { name: '~reactors.f.tEnd' });
  const sol = dopri45(
    (_t, [X, S]) => {
      const s = Math.max(0, S!);
      const mu = (muMax * s) / (Ks + s);
      return [mu * X!, (-mu * X!) / Y];
    },
    [0, tEnd],
    [X0, S0],
    { rtol: 1e-9, atol: 1e-12, hmax: tEnd / 200 },
  );
  need(sol.status === 'done', 'errors.noConvergence');
  const points = sol.t.map((t, i) => [t, sol.y[i]![0]!, Math.max(0, sol.y[i]![1]!)] as const);
  const final = points[points.length - 1]!;
  // The time when 99% of the substrate is used, if it is reached.
  const used = points.find((p) => p[2] <= 0.01 * S0);
  return { points, X: final[1], S: final[2], t99: used ? used[0] : null, Xmax: X0 + Y * S0 };
}

/** Oxygen demand and the kLa that meets it: OUR = qO₂ X, kLa = OUR / (C* - C_L). */
export function oxygenTransfer(qO2: number, X: number, Csat: number, CL: number) {
  need(qO2 > 0 && X > 0, 'errors.positive', { name: '~reactors.f.qO2' });
  need(Csat > CL && CL >= 0, 'reactors.errors.oxygen');
  const OUR = qO2 * X;
  return { OUR, kLa: OUR / (Csat - CL) };
}

/** Fed batch at constant feed F with substrate S_F, quasi-steady: everything fed becomes biomass at yield Y. */
export function fedBatch(V0: number, X0: number, F: number, SF: number, Y: number, t: number) {
  need(V0 > 0 && F > 0 && SF > 0, 'errors.positive', { name: '~reactors.f.F' });
  need(X0 >= 0 && t >= 0, 'errors.nonNegative', { name: '~reactors.f.t' });
  need(Y > 0 && Y <= 1.5, 'reactors.errors.yield');
  const V = V0 + F * t;
  const XV = X0 * V0 + Y * SF * F * t;
  return { V, XV, X: XV / V, D: F / V };
}

// ---------------------------------------------------------------------------------------------------------------
// Activated sludge (Lawrence and McCarty, complete mix with recycle)

export interface SludgeInput {
  Y: number;
  kd: number;
  k: number;
  Ks: number;
  /** Solids retention time θc and hydraulic retention time θ, d. */
  srt: number;
  hrt: number;
  S0: number;
  /** Flow, m³/d. */
  Q: number;
  /** Effluent substrate; null to use the model's value. */
  S: number | null;
}

export function activatedSludge(input: SludgeInput) {
  const { Y, kd, k, Ks, srt, hrt, S0, Q } = input;
  need(Y > 0 && Y <= 1.5, 'reactors.errors.yield');
  need(kd >= 0, 'errors.nonNegative', { name: '~reactors.f.kd' });
  need(k > 0 && Ks > 0, 'errors.positive', { name: '~reactors.f.kMax' });
  need(srt > 0 && hrt > 0, 'errors.positive', { name: '~reactors.f.srt' });
  need(S0 > 0 && Q > 0, 'errors.positive', { name: '~reactors.f.S0' });
  const denom = srt * (Y * k - kd) - 1;
  const srtMin = 1 / (Y * k - kd);
  need(denom > 0, 'reactors.errors.washoutSrt', { min: Number.isFinite(srtMin) && srtMin > 0 ? srtMin : 0 });
  const Smodel = (Ks * (1 + kd * srt)) / denom;
  const S = input.S ?? Smodel;
  need(S >= 0 && S < S0, 'reactors.errors.effluent');
  const X = (srt * Y * (S0 - S)) / (hrt * (1 + kd * srt));
  const V = hrt * Q;
  const Yobs = Y / (1 + kd * srt);
  // Sludge wasted, kg/d, with mg/L × m³/d / 1000 = kg/d.
  const Px = (Yobs * Q * (S0 - S)) / 1000;
  const O2 = (Q * (S0 - S)) / 1000 - 1.42 * Px;
  const FM = (Q * S0) / (V * X);
  return { S, Smodel, X, V, Yobs, Px, O2, FM, srtMin };
}
