// Water quality and treatment: BOD kinetics and fits, oxygen saturation, the Streeter-Phelps sag, mixing, the
// carbonate system and scaling indices, hardness and softening doses, settling, filter headloss, disinfection, and
// membranes. Concentrations in mg/L, rates per day, temperatures in °C unless a name says otherwise.
import { brent, leastSquares, lineFit } from '../core/num';
import { need } from '../core/types';

export const G = 9.80665;
/** The gas constant in L·bar/(mol·K). */
export const R_BAR = 0.0831446261815324;

export const bod = (L0: number, k: number, t: number) => L0 * (1 - Math.exp(-k * t));

export function rateAt(k20: number, theta: number, T: number): number {
  need(k20 > 0 && theta > 0, 'errors.positive', { name: 'k, θ' });
  return k20 * theta ** (T - 20);
}

/** Ultimate BOD and rate from (t, BOD) data: the Thomas method's straight line, or least squares on the curve. */
export function fitBod(data: readonly (readonly number[])[], method: 'thomas' | 'curve') {
  need(data.length >= 3, 'errors.fewPoints', { count: 3 });
  need(
    data.every(([t, y]) => t! > 0 && y! > 0),
    'water.errors.bodData',
  );
  const line = lineFit(
    data.map(([t]) => t!),
    data.map(([t, y]) => (t! / y!) ** (1 / 3)),
  );
  need(line.intercept > 0 && line.slope > 0, 'water.errors.bodShape');
  const k = (6 * line.slope) / line.intercept;
  const L0 = 1 / (k * line.intercept ** 3);
  if (method === 'thomas') return { L0, k, A: line.intercept, B: line.slope };
  const fit = leastSquares(
    (p) => data.map(([t, y]) => bod(Math.exp(p[0]!), Math.exp(p[1]!), t!) - y!),
    [Math.log(L0), Math.log(k)],
  );
  return { L0: Math.exp(fit.p[0]!), k: Math.exp(fit.p[1]!), A: line.intercept, B: line.slope };
}

/**
 * Dissolved-oxygen saturation (mg/L) by the Benson and Krause fit in Standard Methods, with the salinity term
 * (salinity in g/kg) and the pressure correction (pressure in atm).
 */
export function oxygenSaturation(Tc: number, salinity: number, P: number) {
  need(Tc >= 0 && Tc <= 50, 'water.errors.temperature');
  need(salinity >= 0, 'errors.nonNegative', { name: 'S' });
  need(P > 0, 'errors.positive', { name: 'P' });
  const T = Tc + 273.15;
  const lnFresh = -139.34411 + 1.575701e5 / T - 6.642308e7 / T ** 2 + 1.2438e10 / T ** 3 - 8.621949e11 / T ** 4;
  const lnSalt = lnFresh - salinity * (1.7674e-2 - 10.754 / T + 2140.7 / T ** 2);
  const atOneAtm = Math.exp(lnSalt);
  const pwv = Math.exp(11.8571 - 3840.7 / T - 216961 / T ** 2);
  const theta = 0.000975 - 1.426e-5 * Tc + 6.436e-8 * Tc ** 2;
  const value = (atOneAtm * P * (1 - pwv / P) * (1 - theta * P)) / ((1 - pwv) * (1 - theta));
  return { fresh: Math.exp(lnFresh), atOneAtm, value, pwv };
}

/** The Streeter-Phelps oxygen sag: the deficit over time and its critical point. */
export function streeterPhelps(kd: number, ka: number, L0: number, D0: number) {
  need(kd > 0 && ka > 0, 'errors.positive', { name: 'k_d, k_a' });
  need(L0 >= 0 && D0 >= 0, 'errors.nonNegative', { name: 'L₀, D₀' });
  const same = Math.abs(ka - kd) < 1e-12 * ka;
  const deficit = (t: number) =>
    same
      ? (kd * L0 * t + D0) * Math.exp(-kd * t)
      : ((kd * L0) / (ka - kd)) * (Math.exp(-kd * t) - Math.exp(-ka * t)) + D0 * Math.exp(-ka * t);
  let tc: number;
  if (same) tc = L0 > 0 ? (1 - D0 / L0) / kd : 0;
  else {
    const inside = (ka / kd) * (1 - (D0 * (ka - kd)) / (kd * L0));
    tc = L0 > 0 && inside > 0 ? Math.log(inside) / (ka - kd) : 0;
  }
  tc = Math.max(tc, 0);
  return { tc, Dc: tc > 0 ? (kd / ka) * L0 * Math.exp(-kd * tc) : D0, deficit, same };
}

/** Flow-weighted mixing of streams: each row is a flow and the values it carries. */
export function mix(streams: readonly (readonly number[])[]) {
  need(streams.length >= 2, 'water.errors.twoStreams');
  const total = streams.reduce((sum, s) => sum + s[0]!, 0);
  need(total > 0, 'errors.positive', { name: 'Q' });
  const width = streams[0]!.length;
  const mixed = Array.from(
    { length: width - 1 },
    (_, j) => streams.reduce((sum, s) => sum + s[0]! * s[j + 1]!, 0) / total,
  );
  return { total, mixed };
}

/** Carbonate fractions α0 (H2CO3*), α1 (HCO3⁻), α2 (CO3²⁻) at a pH. */
export function alphas(pH: number, pK1: number, pK2: number) {
  const H = 10 ** -pH;
  const K1 = 10 ** -pK1;
  const K2 = 10 ** -pK2;
  const d = H * H + K1 * H + K1 * K2;
  return { a0: (H * H) / d, a1: (K1 * H) / d, a2: (K1 * K2) / d };
}

export interface Carbonate {
  pK1: number;
  pK2: number;
  pKw: number;
}

/** Alkalinity (eq/L) of a closed system with total carbonate CT (mol/L) at a pH. */
export function alkalinity(pH: number, CT: number, k: Carbonate): number {
  const { a1, a2 } = alphas(pH, k.pK1, k.pK2);
  const H = 10 ** -pH;
  return CT * (a1 + 2 * a2) + 10 ** -k.pKw / H - H;
}

/** Buffer intensity β (eq/L per pH unit) of a closed carbonate system. */
export function bufferIntensity(pH: number, CT: number, k: Carbonate): number {
  const { a0, a1, a2 } = alphas(pH, k.pK1, k.pK2);
  const H = 10 ** -pH;
  return Math.LN10 * (H + 10 ** -k.pKw / H + CT * (a0 * a1 + a1 * a2 + 4 * a0 * a2));
}

/** CT from pH and alkalinity. */
export function totalCarbonate(pH: number, alk: number, k: Carbonate): number {
  const { a1, a2 } = alphas(pH, k.pK1, k.pK2);
  const H = 10 ** -pH;
  const CT = (alk - 10 ** -k.pKw / H + H) / (a1 + 2 * a2);
  need(CT > 0, 'water.errors.noCarbonate');
  return CT;
}

/** The pH of a closed system from CT and alkalinity, by Brent's method on 0 to 14. */
export function closedPh(CT: number, alk: number, k: Carbonate): number {
  need(CT > 0, 'errors.positive', { name: 'C_T' });
  return brent((pH) => alkalinity(pH, CT, k) - alk, 0, 14, 1e-12);
}

/** The pH of water open to air: H2CO3* fixed by Henry's law at KH·pCO2, with the given alkalinity. */
export function openPh(pCO2: number, KH: number, alk: number, k: Carbonate) {
  need(pCO2 > 0 && KH > 0, 'errors.positive', { name: 'p_CO₂, K_H' });
  const h2co3 = KH * pCO2;
  const CTat = (pH: number) => h2co3 / alphas(pH, k.pK1, k.pK2).a0;
  const pH = brent((p) => alkalinity(p, CTat(p), k) - alk, 2, 12, 1e-12);
  return { pH, CT: CTat(pH), h2co3 };
}

/** Langelier and Ryznar indices from TDS (mg/L), temperature (°C), calcium hardness and alkalinity (mg/L as CaCO3). */
export function scaling(TDS: number, Tc: number, calcium: number, alk: number, pH: number) {
  need(TDS > 0 && calcium > 0 && alk > 0, 'errors.positive', { name: 'TDS, Ca, Alk' });
  const A = (Math.log10(TDS) - 1) / 10;
  const B = -13.12 * Math.log10(Tc + 273.15) + 34.55;
  const C = Math.log10(calcium) - 0.4;
  const D = Math.log10(alk);
  const pHs = 9.3 + A + B - (C + D);
  return { A, B, C, D, pHs, lsi: pH - pHs, rsi: 2 * pHs - pH };
}

const EQ_CACO3 = 50.04;
const EQ_CA = 20.04;
const EQ_MG = 12.15;

/** Hardness as CaCO3 and lime-soda doses (excess-lime softening) from Ca, Mg (mg/L), alkalinity and CO2 as CaCO3. */
export function softening(spec: { Ca: number; Mg: number; alk: number; co2: number; excess: number }) {
  const { Ca, Mg, alk, co2, excess } = spec;
  need(Ca >= 0 && Mg >= 0 && alk >= 0 && co2 >= 0 && excess >= 0, 'errors.nonNegative', { name: 'Ca, Mg, Alk, CO₂' });
  const caMeq = Ca / EQ_CA;
  const mgMeq = Mg / EQ_MG;
  const alkMeq = alk / EQ_CACO3;
  const co2Meq = co2 / EQ_CACO3;
  const total = caMeq + mgMeq;
  const carbonate = Math.min(total, alkMeq);
  const noncarbonate = total - carbonate;
  const limeMeq = co2Meq + alkMeq + mgMeq + excess;
  const sodaMeq = noncarbonate;
  return {
    caH: caMeq * EQ_CACO3,
    mgH: mgMeq * EQ_CACO3,
    total: total * EQ_CACO3,
    carbonate: carbonate * EQ_CACO3,
    noncarbonate: noncarbonate * EQ_CACO3,
    limeMeq,
    sodaMeq,
    lime: limeMeq * 28.04,
    soda: sodaMeq * 53.0,
  };
}

/** Stokes settling velocity (m/s) of a sphere, with its particle Reynolds number. */
export function stokes(d: number, rhoP: number, rhoW: number, mu: number) {
  need(d > 0 && mu > 0 && rhoW > 0, 'errors.positive', { name: 'd, μ, ρ' });
  need(rhoP > rhoW, 'water.errors.floats');
  const v = (G * (rhoP - rhoW) * d * d) / (18 * mu);
  return { v, Re: (rhoW * v * d) / mu };
}

/** An ideal settling basin: overflow rate, the removed fraction of particles that settle at vs, and detention time. */
export function basin(Q: number, area: number, depth: number, vs: number) {
  need(Q > 0 && area > 0 && depth > 0, 'errors.positive', { name: 'Q, A, h' });
  const v0 = Q / area;
  return { v0, removal: Math.min(1, vs / v0), td: (area * depth) / Q };
}

/** Clean-bed headloss of a filter by Carman-Kozeny or Ergun. */
export function headloss(
  model: 'carman' | 'ergun',
  bed: { L: number; d: number; eps: number; phi: number; v: number; rho: number; mu: number },
) {
  const { L, d, eps, phi, v, rho, mu } = bed;
  need(L > 0 && d > 0 && v > 0 && rho > 0 && mu > 0, 'errors.positive', { name: 'L, d, v, ρ, μ' });
  need(eps > 0 && eps < 1, 'errors.fraction', { name: 'ε' });
  need(phi > 0 && phi <= 1, 'errors.fraction', { name: 'φ' });
  const Re = (phi * rho * d * v) / mu;
  const viscous = (150 * mu * (1 - eps) ** 2 * v) / (eps ** 3 * (phi * d) ** 2);
  const inertial = (1.75 * rho * (1 - eps) * v * v) / (eps ** 3 * phi * d);
  const gradient = model === 'carman' ? ((180 / 150) * viscous) / (rho * G) : (viscous + inertial) / (rho * G);
  return { h: gradient * L, gradient, Re };
}

/** Chick-Watson inactivation: log10 removal = k Cⁿ t / ln 10, and the CT. */
export function chickWatson(C: number, t: number, k: number, n: number) {
  need(C > 0 && t >= 0 && k > 0 && n > 0, 'errors.positive', { name: 'C, k, n' });
  return { logs: (k * C ** n * t) / Math.LN10, CT: C * t, survive: Math.exp(-k * C ** n * t) };
}

export const timeForLogs = (logs: number, C: number, k: number, n: number) => (logs * Math.LN10) / (k * C ** n);

/** Osmotic pressure (bar) by van 't Hoff: π = i C R T, with C in mol/L and T in °C. */
export function osmotic(i: number, C: number, Tc: number): number {
  need(i > 0 && C >= 0, 'errors.positive', { name: 'i, C' });
  return i * C * R_BAR * (Tc + 273.15);
}

/** Membrane flux from resistances in series: J = (ΔP - Δπ)/(μ (R_m + R_f)), in m/s with pressures in Pa. */
export function seriesFlux(dP: number, dPi: number, mu: number, Rm: number, Rf: number) {
  need(mu > 0 && Rm > 0 && Rf >= 0, 'errors.positive', { name: 'μ, R_m' });
  const net = dP - dPi;
  need(net > 0, 'water.errors.netPressure');
  return { net, J: net / (mu * (Rm + Rf)) };
}
