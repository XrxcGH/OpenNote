// Semiconductor devices at course level. Carrier statistics use Boltzmann statistics with charge neutrality solved
// by Brent's method, including incomplete ionization; junctions use the depletion approximation; the solar cell is
// the single-diode model, solved exactly with the Lambert W function. Densities are in m⁻³ and energies in eV.
import { brent } from '../../kits/num/roots';
import { auto, fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { C } from '../shared/constants';
import { fail, nonNegative, positive } from '../shared/errors';
import { fmt, prefixed, tex } from '../shared/format';
import type { SolidKey } from './bands';

export interface Material {
  /** Effective densities of states at 300 K (m⁻³), Varshni Eg(0) (eV), α (eV/K), β (K), εr, mobilities (m²/Vs). */
  nc: number;
  nv: number;
  eg0: number;
  alpha: number;
  beta: number;
  epsR: number;
  mun: number;
  mup: number;
}

/** Presets: densities of states and mobilities from Sze and Ng, Varshni parameters from Thurmond. */
export const MATERIALS: Record<'si' | 'ge' | 'gaas', Material> = {
  si: { nc: 2.8e25, nv: 1.04e25, eg0: 1.17, alpha: 4.73e-4, beta: 636, epsR: 11.7, mun: 0.14, mup: 0.045 },
  ge: { nc: 1.04e25, nv: 6.0e24, eg0: 0.7437, alpha: 4.774e-4, beta: 235, epsR: 16.0, mun: 0.39, mup: 0.19 },
  gaas: { nc: 4.7e23, nv: 7.0e24, eg0: 1.519, alpha: 5.405e-4, beta: 204, epsR: 12.9, mun: 0.85, mup: 0.04 },
};

export const DEVICE_SOURCES = [
  'Sze and Ng (2007), Physics of Semiconductor Devices, Appendix G: densities of states and mobilities.',
  'Neamen (2012), Semiconductor Physics and Devices, 4th ed., Appendix B: relative permittivities (Si 11.7, Ge 16.0, GaAs 12.9).',
  'Thurmond (1975), J. Electrochem. Soc. 122, 1133: Varshni band-gap parameters.',
] as const;

const kT = (t: number) => (C.kB * t) / C.e;

/** The Varshni band gap Eg(T) = Eg(0) − αT²/(T + β). */
export const varshni = (m: Material, t: number) => m.eg0 - (m.alpha * t * t) / (t + m.beta);

/** n_i = √(Nc Nv) exp(−Eg / 2kT). */
export const intrinsic = (nc: number, nv: number, eg: number, t: number) =>
  Math.sqrt(nc * nv) * Math.exp(-eg / (2 * kT(t)));

export interface Doping {
  /** Donor and acceptor densities (m⁻³) and their ionization energies below Ec and above Ev (eV). */
  nd: number;
  na: number;
  ed: number;
  ea: number;
}

/** Electron and hole densities, the Fermi level, and ionized fractions by charge neutrality at temperature T. */
export function carriers(m: Material, t: number, dop: Doping, egTyped?: number): Calc<SolidKey> {
  positive(t, 'temperature');
  nonNegative(dop.nd, 'donors');
  nonNegative(dop.na, 'acceptors');
  nonNegative(dop.ed, 'ionization');
  nonNegative(dop.ea, 'ionization');
  const eg = egTyped ?? varshni(m, t);
  positive(eg, 'gapEnergy');
  const vt = kT(t);
  const nc = m.nc * (t / 300) ** 1.5;
  const nv = m.nv * (t / 300) ** 1.5;
  const ni = intrinsic(nc, nv, eg, t);
  // Energies from the valence band edge: Ev = 0, Ec = Eg.
  const n = (ef: number) => nc * Math.exp((ef - eg) / vt);
  const p = (ef: number) => nv * Math.exp(-ef / vt);
  const ndPlus = (ef: number) => (dop.ed === 0 ? dop.nd : dop.nd / (1 + 2 * Math.exp((ef - (eg - dop.ed)) / vt)));
  const naMinus = (ef: number) => (dop.ea === 0 ? dop.na : dop.na / (1 + 4 * Math.exp((dop.ea - ef) / vt)));
  // Charge balance in log form keeps the function smooth over many decades.
  const balance = (ef: number) => Math.log(p(ef) + ndPlus(ef) + 1e-300) - Math.log(n(ef) + naMinus(ef) + 1e-300);
  const ef = brent(balance, -1, eg + 1, 1e-13).x;
  const ei = eg / 2 + (vt / 2) * Math.log(nv / nc);
  const items: Item<SolidKey>[] = [
    { key: 'n', value: n(ef), unit: 'cm⁻³', text: `${fmt(n(ef) / 1e6, 5)} cm⁻³` },
    { key: 'p', value: p(ef), unit: 'cm⁻³', text: `${fmt(p(ef) / 1e6, 5)} cm⁻³` },
    { key: 'ni', value: ni, unit: 'cm⁻³', text: `${fmt(ni / 1e6, 5)} cm⁻³` },
    fixed('fermiLevel', ef - ei, 'eV', 5),
    fixed('fermiBelowCb', eg - ef, 'eV', 5),
    fixed('gapEnergy', eg, 'eV', 5),
  ];
  if (dop.nd > 0) items.push(fixed('ionizedDonors', ndPlus(ef) / dop.nd, '', 4));
  if (dop.na > 0) items.push(fixed('ionizedAcceptors', naMinus(ef) / dop.na, '', 4));
  const steps: Step<SolidKey>[] = [
    {
      key: 'gapEnergy',
      text:
        egTyped === undefined
          ? `Eg(T) = Eg(0) − αT²/(T + β) = ${fmt(m.eg0)} − ${fmt(m.alpha)} × ${fmt(t)}² / (${fmt(t)} + ${fmt(m.beta)}) = ${fmt(eg, 5)} eV`
          : `Eg = ${fmt(eg, 5)} eV as typed`,
      tex: `E_g(T) = E_g(0) - \\frac{\\alpha T^2}{T + \\beta}`,
    },
    {
      key: 'ni',
      text:
        `n_i = √(Nc Nv) exp(−Eg/2kT) with Nc = ${fmt(nc / 1e6)} cm⁻³, Nv = ${fmt(nv / 1e6)} cm⁻³ at ${fmt(t)} K: ` +
        `${fmt(ni / 1e6, 5)} cm⁻³`,
      tex: `n_i = \\sqrt{N_c N_v}\\,e^{-E_g/2kT} = ${tex(ni / 1e6, 5)}\\ \\mathrm{cm^{-3}}`,
    },
    {
      key: 'fermiLevel',
      text:
        `Charge neutrality p + N_D⁺ = n + N_A⁻ puts E_F ${fmt(ef - ei, 5)} eV from midgap (E_i) and ` +
        `${fmt(eg - ef, 5)} eV below Ec`,
      tex: `p + N_D^+ = n + N_A^-`,
    },
  ];
  return { items, steps };
}

/** Conductivity, drift and diffusion currents, Einstein diffusion constants, and the Hall coefficient. */
export function transport(
  n: number,
  p: number,
  mun: number,
  mup: number,
  t: number,
  field: number,
  gradient: number,
): Calc<SolidKey> {
  nonNegative(n, 'electrons');
  nonNegative(p, 'holes');
  if (n + p === 0) fail('noCarriers');
  positive(mun, 'mobility');
  positive(mup, 'mobility');
  positive(t, 'temperature');
  const sigma = C.e * (n * mun + p * mup);
  const dn = mun * kT(t);
  const dp = mup * kT(t);
  const hall = (p * mup * mup - n * mun * mun) / (C.e * (p * mup + n * mun) ** 2);
  return {
    items: [
      fixed('conductivity', sigma, 'S/m', 6),
      fixed('resistivity', 100 / sigma, 'Ω cm', 6),
      fixed('drift', (sigma * field) / 1e4, 'A/cm²', 6),
      fixed('diffusionN', dn * 1e4, 'cm²/s', 5),
      fixed('diffusionP', dp * 1e4, 'cm²/s', 5),
      fixed('diffusionCurrent', (C.e * dn * gradient) / 1e4, 'A/cm²', 6),
      fixed('hall', hall * 1e6, 'cm³/C', 5),
    ],
    steps: [
      {
        key: 'conductivity',
        text: `σ = q(nμn + pμp) = ${fmt(sigma, 6)} S/m; J_drift = σE = ${fmt((sigma * field) / 1e4, 6)} A/cm²`,
        tex: `\\sigma = q(n\\mu_n + p\\mu_p) = ${tex(sigma, 6)}\\ \\mathrm{S/m}`,
      },
      {
        key: 'diffusionN',
        text:
          `Einstein: D = μkT/q with kT/q = ${fmt(kT(t), 6)} V: Dn = ${fmt(dn * 1e4, 5)}, Dp = ${fmt(dp * 1e4, 5)} ` +
          `cm²/s; J = qDn dn/dx`,
        tex: `D = \\frac{\\mu k T}{q}`,
      },
      {
        key: 'hall',
        text: `R_H = (pμp² − nμn²) / (q(pμp + nμn)²) = ${fmt(hall * 1e6, 5)} cm³/C`,
        tex: `R_H = \\frac{p\\mu_p^2 - n\\mu_n^2}{q(p\\mu_p + n\\mu_n)^2}`,
      },
    ],
  };
}

export interface Junction {
  na: number;
  nd: number;
  ni: number;
  t: number;
  epsR: number;
  /** Applied bias (V, forward positive), area (m²), saturation current (A), ideality. */
  v: number;
  area: number;
  i0: number;
  ideality: number;
}

/** An abrupt p-n junction in the depletion approximation, with the ideal diode current. */
export function junction(j: Junction): Calc<SolidKey> {
  positive(j.na, 'acceptors');
  positive(j.nd, 'donors');
  positive(j.ni, 'intrinsic');
  positive(j.t, 'temperature');
  positive(j.epsR, 'permittivity');
  positive(j.area, 'area');
  nonNegative(j.i0, 'saturation');
  positive(j.ideality, 'ideality');
  const vt = kT(j.t);
  const vbi = vt * Math.log((j.na * j.nd) / j.ni ** 2);
  if (!(vbi > 0)) fail('noJunction');
  if (j.v >= vbi) fail('pastBuiltIn');
  const eps = j.epsR * C.eps0;
  const w = Math.sqrt((2 * eps * (vbi - j.v) * (j.na + j.nd)) / (C.e * j.na * j.nd));
  const xn = (w * j.na) / (j.na + j.nd);
  const xp = (w * j.nd) / (j.na + j.nd);
  const emax = (C.e * j.nd * xn) / eps;
  const cap = (eps / w) * j.area;
  const diode = (v: number) => j.i0 * Math.expm1(v / (j.ideality * vt));
  const curve: [number, number][] = Array.from({ length: 121 }, (_, i) => {
    const v = -0.2 + (Math.min(vbi, 1) * 0.9 + 0.2) * (i / 120);
    return [v, diode(v)];
  });
  const items: Item<SolidKey>[] = [
    fixed('vbi', vbi, 'V', 6),
    { key: 'width', value: w, unit: 'm', sig: 6 },
    { key: 'xn', value: xn, unit: 'm', sig: 5 },
    { key: 'xp', value: xp, unit: 'm', sig: 5 },
    fixed('peakField', emax / 1e5, 'kV/cm', 5),
    { key: 'capacitance', value: cap, unit: 'F', sig: 5 },
  ];
  if (j.i0 > 0) items.push({ key: 'current', value: diode(j.v), unit: 'A', sig: 5 });
  return {
    items,
    steps: [
      {
        key: 'vbi',
        text:
          `V_bi = (kT/q) ln(N_A N_D / n_i²) = ${fmt(vt, 6)} V × ln(${fmt((j.na * j.nd) / j.ni ** 2)}) = ` +
          `${fmt(vbi, 6)} V`,
        tex: `V_{bi} = \\frac{kT}{q}\\ln\\frac{N_A N_D}{n_i^2} = ${tex(vbi, 6)}\\ \\mathrm{V}`,
      },
      {
        key: 'width',
        text:
          `W = √(2ε(V_bi − V)(N_A + N_D)/(q N_A N_D)) = ${prefixed(w, 'm', 6)}; x_n = W N_A/(N_A + N_D) = ` +
          `${prefixed(xn, 'm')}`,
        tex: `W = \\sqrt{\\frac{2\\varepsilon (V_{bi} - V)(N_A + N_D)}{q N_A N_D}}`,
      },
      {
        key: 'capacitance',
        text: `E_max = q N_D x_n / ε = ${fmt(emax / 1e5, 5)} kV/cm; C = εA/W = ${prefixed(cap, 'F')}`,
      },
    ],
    ...(j.i0 > 0
      ? {
          plot: {
            title: 'ivPlot' as const,
            xLabel: 'voltAxis' as const,
            yLabel: 'currentAxis' as const,
            series: [{ points: curve, kind: 'line' as const, tone: 0 }],
          },
        }
      : {}),
  };
}

export interface Mos {
  na: number;
  ni: number;
  t: number;
  tox: number;
  epsOx: number;
  epsS: number;
  /** Metal-semiconductor work-function difference (V) and fixed oxide charge (C/m²). */
  phiMs: number;
  qox: number;
}

/** An MOS capacitor on p-type silicon: flat-band and threshold voltages and the ideal high-frequency C-V curve. */
export function mos(m: Mos): Calc<SolidKey> {
  positive(m.na, 'acceptors');
  positive(m.ni, 'intrinsic');
  positive(m.t, 'temperature');
  positive(m.tox, 'oxide');
  positive(m.epsOx, 'permittivity');
  positive(m.epsS, 'permittivity');
  const vt = kT(m.t);
  const phiF = vt * Math.log(m.na / m.ni);
  if (!(phiF > 0)) fail('noJunction');
  const es = m.epsS * C.eps0;
  const cox = (m.epsOx * C.eps0) / m.tox;
  const vfb = m.phiMs - m.qox / cox;
  const qdep = Math.sqrt(2 * es * C.e * m.na * 2 * phiF);
  const vth = vfb + 2 * phiF + qdep / cox;
  const wmax = Math.sqrt((2 * es * 2 * phiF) / (C.e * m.na));
  const cmin = 1 / (1 / cox + wmax / es);
  const cOf = (v: number) => {
    if (v <= vfb) return 1;
    if (v >= vth) return cmin / cox;
    return 1 / Math.sqrt(1 + (2 * cox * cox * (v - vfb)) / (C.e * es * m.na));
  };
  const lo = vfb - 2;
  const hi = vth + 2;
  const curve: [number, number][] = Array.from({ length: 201 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / 200;
    return [v, cOf(v)];
  });
  return {
    items: [
      fixed('vt', vth, 'V', 5),
      fixed('vfb', vfb, 'V', 5),
      fixed('phiF', phiF, 'V', 5),
      fixed('cox', (cox * 1e9) / 1e4, 'nF/cm²', 5),
      fixed('cmin', cmin / cox, 'C_ox', 4),
      { key: 'wmax', value: wmax, unit: 'm', sig: 5 },
    ],
    steps: [
      {
        key: 'vfb',
        text: `C_ox = ε_ox/t_ox = ${fmt((cox * 1e9) / 1e4, 5)} nF/cm²; V_FB = φ_ms − Q_ox/C_ox = ${fmt(vfb, 5)} V`,
        tex: `V_{FB} = \\phi_{ms} - \\frac{Q_{ox}}{C_{ox}}`,
      },
      {
        key: 'vt',
        text:
          `φ_F = (kT/q) ln(N_A/n_i) = ${fmt(phiF, 5)} V; V_T = V_FB + 2φ_F + √(2ε_s q N_A 2φ_F)/C_ox = ${fmt(vth, 5)} ` +
          `V`,
        tex:
          `V_T = V_{FB} + 2\\phi_F + \\frac{\\sqrt{2\\varepsilon_s q N_A (2\\phi_F)}}{C_{ox}} = ` +
          `${tex(vth, 5)}\\ \\mathrm{V}`,
      },
      {
        key: 'cmin',
        text:
          `In depletion C/C_ox = 1/√(1 + 2C_ox²(V − V_FB)/(qε_s N_A)); past V_T the high-frequency curve stays at ` +
          `${fmt(cmin / cox, 4)} C_ox`,
      },
    ],
    plot: {
      title: 'cvPlot',
      xLabel: 'voltAxis',
      yLabel: 'cAxis',
      series: [{ points: curve, kind: 'line', tone: 0 }],
      y: [0, 1.1],
    },
  };
}

/** W(e^x), the Lambert W of an exponential, without overflow, by Newton's method on w + ln w = x. */
export function lambertWExp(x: number): number {
  let w = x < 1 ? Math.exp(x) / (1 + Math.exp(x)) + 0.5 : x - Math.log(x);
  if (x < -30) return Math.exp(x);
  for (let k = 0; k < 100; k += 1) {
    const step = (w + Math.log(w) - x) / (1 + 1 / w);
    w = Math.max(w - step, w / 10);
    if (Math.abs(step) < 1e-15 * Math.max(1, w)) break;
  }
  return w;
}

export interface Cell {
  il: number;
  i0: number;
  ideality: number;
  t: number;
  /** Series and shunt resistance (Ω); a shunt of 0 means none. Irradiance (W/m²) and area (m²) for efficiency. */
  rs: number;
  rsh: number;
  irradiance: number;
  area: number;
}

/** The single-diode current I(V), exact with the Lambert W function when there is series resistance. */
export function cellCurrent(c: Cell, v: number): number {
  const a = c.ideality * kT(c.t);
  const g = c.rsh === 0 ? 0 : 1 / c.rsh;
  if (c.rs === 0) return c.il - c.i0 * Math.expm1(v / a) - v * g;
  if (g === 0) {
    // I = IL + I0 − (a/Rs) W((Rs I0 / a) exp((V + Rs(IL + I0)) / a)).
    const x = Math.log((c.rs * c.i0) / a) + (v + c.rs * (c.il + c.i0)) / a;
    return c.il + c.i0 - (a / c.rs) * lambertWExp(x);
  }
  const rsh = c.rsh;
  const x =
    Math.log((c.rs * c.i0 * rsh) / (a * (c.rs + rsh))) + (rsh * (c.rs * (c.il + c.i0) + v)) / (a * (c.rs + rsh));
  return (rsh * (c.il + c.i0) - v) / (c.rs + rsh) - (a / c.rs) * lambertWExp(x);
}

/** Isc, Voc, the maximum power point, fill factor, and efficiency of a solar cell, with its I-V curve. */
export function solarCell(c: Cell): Calc<SolidKey> {
  positive(c.il, 'photocurrent');
  positive(c.i0, 'saturation');
  positive(c.ideality, 'ideality');
  positive(c.t, 'temperature');
  nonNegative(c.rs, 'resistance');
  nonNegative(c.rsh, 'resistance');
  nonNegative(c.irradiance, 'irradiance');
  const a = c.ideality * kT(c.t);
  const isc = cellCurrent(c, 0);
  if (!(isc > 0)) fail('noPower');
  const ideal = a * Math.log1p(c.il / c.i0);
  const voc = brent((v) => cellCurrent(c, v), 0, ideal * 1.0001 + 1e-9, 1e-14).x;
  // Golden-section search for the maximum of P = V I(V).
  let lo = 0;
  let hi = voc;
  const power = (v: number) => v * cellCurrent(c, v);
  for (let k = 0; k < 120; k += 1) {
    const m1 = hi - (hi - lo) * 0.618033988749895;
    const m2 = lo + (hi - lo) * 0.618033988749895;
    if (power(m1) < power(m2)) lo = m1;
    else hi = m2;
  }
  const vmp = (lo + hi) / 2;
  const imp = cellCurrent(c, vmp);
  const pmax = vmp * imp;
  const items: Item<SolidKey>[] = [
    fixed('voc', voc, 'V', 6),
    auto('isc', isc, 'A', 6),
    auto('pmax', pmax, 'W', 5),
    fixed('vmp', vmp, 'V', 5),
    auto('imp', imp, 'A', 5),
    fixed('fillFactor', pmax / (voc * isc), '', 4),
  ];
  if (c.irradiance > 0 && c.area > 0) items.push(fixed('efficiency', (100 * pmax) / (c.irradiance * c.area), '%', 4));
  const curve: [number, number][] = Array.from({ length: 121 }, (_, i) => {
    const v = (voc * 1.02 * i) / 120;
    return [v, cellCurrent(c, v)];
  });
  return {
    items,
    steps: [
      {
        key: 'voc',
        text:
          `Ideal V_oc = nV_t ln(I_L/I₀ + 1) = ${fmt(a, 6)} V × ln(${fmt(c.il / c.i0 + 1)}) = ${fmt(ideal, 6)} V; with ` +
          `resistances, I(V_oc) = 0 gives ${fmt(voc, 6)} V`,
        tex: `V_{oc} = n V_t \\ln\\left(\\frac{I_L}{I_0} + 1\\right)`,
      },
      {
        key: 'pmax',
        text:
          `I(V) = I_L − I₀(e^((V + IR_s)/nV_t) − 1) − (V + IR_s)/R_sh, solved with the Lambert W function; P_max = ` +
          `${fmt(pmax, 5)} W at ${fmt(vmp, 5)} V`,
        tex: `I = I_L - I_0\\left(e^{(V + IR_s)/nV_t} - 1\\right) - \\frac{V + IR_s}{R_{sh}}`,
      },
      { key: 'fillFactor', text: `FF = P_max / (V_oc I_sc) = ${fmt(pmax / (voc * isc), 4)}` },
    ],
    plot: {
      title: 'ivPlot',
      xLabel: 'voltAxis',
      yLabel: 'currentAxis',
      series: [{ points: curve, kind: 'line', tone: 0 }],
    },
  };
}
