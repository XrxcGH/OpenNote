// First-order spacecraft sizing. It covers the rocket equation with staging and its optimum; delta-v and mass budgets;
// solar arrays and batteries; radiative equilibrium; attitude disturbance torques; radio link budgets; and passive
// RFID read range. Everything is in SI units, with decibels as plain numbers.
import { C, G0, K_B, SIGMA } from '../kit/constants';
import { fail } from '../kit/read';

/** Mean total solar irradiance at 1 AU, W/m² (Kopp and Lean, 2011). */
export const SOLAR_CONSTANT = 1361;
/** Earth's gravitational parameter (m³/s²) and equatorial radius (m), WGS 84. */
export const MU_EARTH = 3.986004418e14;
export const R_EARTH = 6_378_137;
/** Earth's magnetic moment times the permeability over 4 pi, T·m³, as used for disturbance estimates. */
export const EARTH_DIPOLE = 7.8e15;

/** Delta-v from the rocket equation: Isp g0 ln(m0 / mf). */
export function rocketDeltaV(isp: number, m0: number, mf: number): number {
  if (!(m0 > mf)) fail('kitPhysics.spacecraft.errors.massOrder');
  return isp * G0 * Math.log(m0 / mf);
}

/** The propellant a dry mass needs for a delta-v: m_dry (e^(dv / (Isp g0)) - 1). */
export const propellantFor = (isp: number, dry: number, dv: number): number => dry * Math.expm1(dv / (isp * G0));

export interface Stage {
  isp: number;
  /** Structural coefficient: empty mass over empty plus propellant. */
  epsilon: number;
  /** Payload ratio: what the stage carries over its empty plus propellant mass. */
  lambda: number;
}

export interface StageResult {
  /** Mass ratio m0 / mf. */
  n: number;
  dv: number;
  /** When a payload mass is given: the stage's empty, propellant, and lift-off (with everything above) masses. */
  empty?: number;
  propellant?: number;
  gross?: number;
}

/** Each stage's mass ratio (1 + lambda) / (epsilon + lambda) and delta-v, and the masses when the payload is known. */
export function staging(stages: readonly Stage[], payload: number | null): StageResult[] {
  const out: StageResult[] = stages.map((stage) => {
    if (!(stage.epsilon > 0 && stage.epsilon < 1)) fail('kitPhysics.spacecraft.errors.epsilon');
    if (!(stage.lambda > 0)) fail('kitPhysics.spacecraft.errors.lambda');
    const n = (1 + stage.lambda) / (stage.epsilon + stage.lambda);
    return { n, dv: stage.isp * G0 * Math.log(n) };
  });
  if (payload === null) return out;
  // From the top stage down: each stage carries everything above it.
  let above = payload;
  for (let i = stages.length - 1; i >= 0; i--) {
    const body = above / stages[i].lambda;
    out[i].empty = stages[i].epsilon * body;
    out[i].propellant = (1 - stages[i].epsilon) * body;
    const gross = above + body;
    out[i].gross = gross;
    above = gross;
  }
  return out;
}

export interface OptimalStage {
  n: number;
  dv: number;
  /** Empty plus propellant mass of the stage. */
  mass: number;
  empty: number;
  propellant: number;
}

/**
 * The lightest stack for a total delta-v and payload, by Lagrange multipliers: each stage's mass ratio is
 * n_i = (c_i eta - 1) / (c_i eps_i eta), with eta chosen so the delta-vs add up (solved by bisection on log eta).
 */
export function optimalStaging(stages: readonly { isp: number; epsilon: number }[], dv: number, payload: number) {
  const c = stages.map((stage) => stage.isp * G0);
  stages.forEach((stage) => {
    if (!(stage.epsilon > 0 && stage.epsilon < 1)) fail('kitPhysics.spacecraft.errors.epsilon');
  });
  const most = stages.reduce((total, stage, i) => total + c[i] * Math.log(1 / stage.epsilon), 0);
  if (!(dv > 0)) fail('kitPhysics.spacecraft.errors.deltaV');
  if (dv >= most) fail('kitPhysics.spacecraft.errors.tooMuch', { most: (most / 1000).toFixed(3) });
  const ratios = (eta: number) => stages.map((stage, i) => (c[i] * eta - 1) / (c[i] * stage.epsilon * eta));
  // Each n_i must be at least 1; take n_i = 1 for a stage that would come out below it (it is not worth flying).
  const total = (eta: number) => ratios(eta).reduce((sum, n, i) => sum + c[i] * Math.log(Math.max(n, 1)), 0);
  let low = Math.log(Math.max(...stages.map((stage, i) => 1 / (c[i] * (1 - stage.epsilon)))) * (1 + 1e-12));
  let high = low + 1;
  while (total(Math.exp(high)) < dv) high += 2;
  for (let i = 0; i < 200 && high - low > 1e-15 * Math.abs(high); i++) {
    const mid = (low + high) / 2;
    if (total(Math.exp(mid)) < dv) low = mid;
    else high = mid;
  }
  const eta = Math.exp((low + high) / 2);
  const ns = ratios(eta).map((n) => Math.max(n, 1));
  const result: OptimalStage[] = new Array(stages.length);
  let above = payload;
  for (let i = stages.length - 1; i >= 0; i--) {
    const mass = ((ns[i] - 1) / (1 - ns[i] * stages[i].epsilon)) * above;
    result[i] = {
      n: ns[i],
      dv: c[i] * Math.log(ns[i]),
      mass,
      empty: stages[i].epsilon * mass,
      propellant: (1 - stages[i].epsilon) * mass,
    };
    above += mass;
  }
  return { stages: result, gross: above, eta };
}

export interface PowerInput {
  dayLoad: number;
  eclipseLoad: number;
  period: number;
  eclipse: number;
  /** Path efficiencies from the array to the loads in sunlight and through the battery in eclipse. */
  xDay: number;
  xEclipse: number;
  cellEfficiency: number;
  inherent: number;
  incidence: number;
  degradation: number;
  years: number;
  /** Solar flux at the array, W/m². */
  flux: number;
  depth: number;
  batteryEfficiency: number;
}

/** Solar array and battery sizing, by the method in the SMAD textbook (Wertz and Larson). */
export function powerBudget(input: PowerInput) {
  const day = input.period - input.eclipse;
  if (!(day > 0)) fail('kitPhysics.spacecraft.errors.eclipse');
  const array = ((input.eclipseLoad * input.eclipse) / input.xEclipse + (input.dayLoad * day) / input.xDay) / day;
  const p0 = input.cellEfficiency * input.flux;
  const bol = p0 * input.inherent * Math.cos(input.incidence);
  const life = (1 - input.degradation) ** input.years;
  const eol = bol * life;
  if (!(eol > 0)) fail('kitPhysics.spacecraft.errors.noPower');
  const capacity = (input.eclipseLoad * input.eclipse) / (input.depth * input.batteryEfficiency);
  return { day, array, p0, bol, life, eol, area: array / eol, bolPower: (array / eol) * bol, capacity };
}

export interface ThermalInput {
  alpha: number;
  epsilon: number;
  /** Solar flux at the body, W/m². */
  flux: number;
  /** Area that faces the Sun over the area that radiates. */
  ratio: number;
  /** Radiating area, m², and internal power, W. */
  area: number;
  internal: number;
  /** Planet terms, W/m² of radiating area: absorbed infrared and albedo. */
  planetIr?: number;
  albedo?: number;
}

/** The isothermal equilibrium temperature: absorbed = emitted, eps sigma A T⁴. */
export function equilibrium(input: ThermalInput) {
  const solar = input.alpha * input.flux * input.ratio * input.area;
  const ir = input.epsilon * (input.planetIr ?? 0) * input.area;
  const albedo = input.alpha * (input.albedo ?? 0) * input.area;
  const absorbed = solar + ir + albedo + input.internal;
  const T = (absorbed / (input.epsilon * SIGMA * input.area)) ** 0.25;
  return { solar, ir, albedo, absorbed, T };
}

/** The view factor from a small sphere to a planet of radius R from distance r (center to center). */
export const sphereViewFactor = (R: number, r: number): number => (1 - Math.sqrt(1 - (R / r) ** 2)) / 2;

export interface Disturbance {
  /** Orbit radius, m. */
  r: number;
  iy: number;
  iz: number;
  /** Angle of the z axis from the local vertical. */
  theta: number;
  solarArea: number;
  reflectance: number;
  sunAngle: number;
  solarArm: number;
  flux: number;
  density: number;
  dragCoefficient: number;
  dragArea: number;
  dragArm: number;
  dipole: number;
  /** 1 at the magnetic equator, 2 over the poles. */
  magneticFactor: number;
}

/** The four worst-case disturbance torques (Wertz and Larson), with the circular orbit's speed and period. */
export function disturbances(d: Disturbance) {
  const gravity = ((3 * MU_EARTH) / (2 * d.r ** 3)) * Math.abs(d.iz - d.iy) * Math.abs(Math.sin(2 * d.theta));
  const solar = (d.flux / C) * d.solarArea * (1 + d.reflectance) * Math.cos(d.sunAngle) * Math.abs(d.solarArm);
  const v = Math.sqrt(MU_EARTH / d.r);
  const drag = 0.5 * d.density * d.dragCoefficient * d.dragArea * v * v * Math.abs(d.dragArm);
  const field = (d.magneticFactor * EARTH_DIPOLE) / d.r ** 3;
  const magnetic = d.dipole * field;
  const period = 2 * Math.PI * Math.sqrt(d.r ** 3 / MU_EARTH);
  return { gravity, solar, drag, magnetic, field, v, period, total: gravity + solar + drag + magnetic };
}

/** Momentum a wheel stores against a torque: cyclic over a quarter orbit (times 0.707 for the sine), or secular. */
export const cyclicMomentum = (torque: number, period: number): number => torque * (period / 4) * Math.SQRT1_2;

export const db = (ratio: number): number => 10 * Math.log10(ratio);
export const fromDb = (decibels: number): number => 10 ** (decibels / 10);

/** Free-space path loss, dB: 20 log10(4 pi d f / c). */
export const freeSpaceLoss = (distance: number, frequency: number): number =>
  20 * Math.log10((4 * Math.PI * distance * frequency) / C);

/** A parabolic dish's gain, dBi: eta (pi D f / c)². */
export const dishGain = (diameter: number, frequency: number, efficiency: number): number =>
  db(efficiency * ((Math.PI * diameter * frequency) / C) ** 2);

/** Boltzmann's constant in dBW/(K·Hz): -228.6. */
export const BOLTZMANN_DB = db(K_B);

export interface LinkInput {
  frequency: number;
  power: number;
  txGain: number;
  txLoss: number;
  distance: number;
  otherLoss: number;
  rxGain: number;
  noiseTemperature: number;
  rate: number;
  required: number;
}

export function linkBudget(input: LinkInput) {
  const powerDb = db(input.power);
  const eirp = powerDb + input.txGain - input.txLoss;
  const path = freeSpaceLoss(input.distance, input.frequency);
  const received = eirp - path - input.otherLoss + input.rxGain;
  const gOverT = input.rxGain - db(input.noiseTemperature);
  const cn0 = eirp - path - input.otherLoss + gOverT - BOLTZMANN_DB;
  const ebn0 = cn0 - db(input.rate);
  return { powerDb, eirp, path, received, gOverT, cn0, ebn0, margin: ebn0 - input.required };
}

/** Passive tag read range: the forward link, and the reverse link when the reader's sensitivity is given. */
export function rfidRange(input: {
  frequency: number;
  eirp: number;
  tagGain: number;
  tagSensitivity: number;
  loss: number;
  readerGain?: number;
  readerSensitivity?: number;
  backscatterLoss?: number;
}) {
  const lambda = C / input.frequency;
  const forward =
    (lambda / (4 * Math.PI)) * 10 ** ((input.eirp + input.tagGain - input.loss - input.tagSensitivity) / 20);
  if (input.readerGain === undefined || input.readerSensitivity === undefined)
    return { lambda, forward, range: forward };
  const budget =
    input.eirp +
    2 * input.tagGain +
    input.readerGain -
    2 * input.loss -
    (input.backscatterLoss ?? 0) -
    input.readerSensitivity;
  const reverse = (lambda / (4 * Math.PI)) * 10 ** (budget / 40);
  return { lambda, forward, reverse, range: Math.min(forward, reverse) };
}
