// External flow: boundary layers on a flat plate, plate drag, sphere drag, and terminal velocity.
import { brent, CalcError, fmt, G0, need, positive, type Step } from '../numeric';

export const DEFAULT_TRANSITION_RE = 5e5;

export type PlateRegime = 'laminar' | 'turbulent' | 'mixed';

export interface PlateInput {
  /** Free-stream speed (m/s). */
  speed: number;
  /** Plate length in the flow direction (m); also where the local results are reported. */
  length: number;
  /** Kinematic viscosity (m2/s). */
  nu: number;
  /** Plate width, default 1 m. */
  width?: number;
  /** Density, needed for the drag force and shear stress. */
  density?: number;
  transitionRe?: number;
  /** Treat the whole plate as turbulent (a tripped boundary layer). */
  tripped?: boolean;
}

export interface PlateResult {
  reL: number;
  regime: PlateRegime;
  /** Boundary-layer thickness at x = L (m), for the regime at the plate's end. */
  delta: number;
  displacement: number;
  momentum: number;
  /** Local skin friction coefficient at x = L. */
  cfLocal: number;
  /** Average skin friction coefficient over 0 to L (the drag coefficient). */
  cfAverage: number;
  /** Drag on one side of the plate (N), if the density is given. */
  drag?: number;
  wallShear?: number;
  /** Position of transition (m), if it happens on the plate. */
  transitionAt?: number;
  warnings: string[];
  steps: Step[];
}

/**
 * Blasius similarity solution of f''' + 0.5 * f * f'' = 0 with f(0) = f'(0) = 0 and f'(inf) = 1, by RK4 from
 * f''(0) = 0.332057336215.
 */
export function blasius(etaMax = 10, n = 400): { eta: number[]; uOverU: number[] } {
  const fpp0 = 0.332057336215;
  let f = 0;
  let fp = 0;
  let fpp = fpp0;
  const h = etaMax / n;
  const eta = [0];
  const u = [0];
  const d = (y: number[]) => [y[1]!, y[2]!, (-y[0]! * y[2]!) / 2];
  for (let i = 0; i < n; i++) {
    const y = [f, fp, fpp];
    const k1 = d(y);
    const k2 = d(y.map((v, j) => v + (h / 2) * k1[j]!));
    const k3 = d(y.map((v, j) => v + (h / 2) * k2[j]!));
    const k4 = d(y.map((v, j) => v + h * k3[j]!));
    [f, fp, fpp] = y.map((v, j) => v + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!)) as [
      number,
      number,
      number,
    ];
    eta.push((i + 1) * h);
    u.push(fp);
  }
  return { eta, uOverU: u };
}

/** Local and integral boundary-layer quantities for flow along a flat plate. */
export function flatPlate(inp: PlateInput): PlateResult {
  positive(inp.speed, 'The free-stream speed');
  positive(inp.length, 'The plate length');
  positive(inp.nu, 'The kinematic viscosity');
  const rec = inp.transitionRe ?? DEFAULT_TRANSITION_RE;
  positive(rec, 'The transition Reynolds number');
  const width = inp.width ?? 1;
  positive(width, 'The plate width');
  const reL = (inp.speed * inp.length) / inp.nu;
  const warnings: string[] = [];
  const steps: Step[] = [
    { key: 'fhExtReL', vars: { Re: fmt(reL, 5) }, math: `Re_L = \\frac{UL}{\\nu} = ${fmt(reL, 5)}` },
  ];
  const tripped = inp.tripped ?? false;
  const transitions = !tripped && reL > rec;
  const regime: PlateRegime = tripped ? 'turbulent' : transitions ? 'mixed' : 'laminar';
  let delta: number;
  let dispT: number;
  let momT: number;
  let cfLocal: number;
  let cfAvg: number;
  if (regime === 'laminar') {
    const s = Math.sqrt(reL);
    delta = (5 * inp.length) / s;
    dispT = (1.7208 * inp.length) / s;
    momT = (0.664 * inp.length) / s;
    cfLocal = 0.664 / s;
    cfAvg = 1.328 / s;
    steps.push(
      {
        key: 'fhExtLaminar',
        vars: { d: fmt(delta) },
        math: `\\delta = \\frac{5x}{\\sqrt{Re_x}} = ${fmt(delta)}\\ \\mathrm{m}`,
      },
      { key: 'fhExtCfLaminar', vars: { cf: fmt(cfAvg) }, math: `C_f = \\frac{1.328}{\\sqrt{Re_L}} = ${fmt(cfAvg)}` },
    );
  } else {
    delta = 0.37 * inp.length * reL ** -0.2;
    dispT = delta / 8;
    momT = (7 * delta) / 72;
    cfLocal = 0.0576 * reL ** -0.2;
    if (regime === 'turbulent') {
      cfAvg = 0.074 * reL ** -0.2;
      steps.push(
        {
          key: 'fhExtTurbulent',
          vars: { d: fmt(delta) },
          math: `\\delta = 0.37\\,x\\,Re_x^{-1/5} = ${fmt(delta)}\\ \\mathrm{m}`,
        },
        { key: 'fhExtCfTurbulent', vars: { cf: fmt(cfAvg) }, math: `C_f = 0.074\\,Re_L^{-1/5} = ${fmt(cfAvg)}` },
      );
    } else {
      // the textbook constant 1742 is the rounded value for the usual transition at Re = 5e5
      const a = rec === DEFAULT_TRANSITION_RE ? 1742 : 0.074 * rec ** 0.8 - 1.328 * rec ** 0.5;
      cfAvg = 0.074 * reL ** -0.2 - a / reL;
      steps.push(
        { key: 'fhExtMixed', vars: { x: fmt((rec * inp.nu) / inp.speed) } },
        {
          key: 'fhExtCfMixed',
          vars: { cf: fmt(cfAvg) },
          math: `C_f = 0.074\\,Re_L^{-1/5} - \\frac{A}{Re_L},\\ A = 0.074\\,Re_c^{4/5} - 1.328\\,Re_c^{1/2} = ${fmt(a)}`,
        },
      );
    }
    if (reL > 1e9) warnings.push('fhExtWarnHighRe');
  }
  if (reL < 100 && regime === 'laminar') warnings.push('fhExtWarnLowRe');
  let drag: number | undefined;
  let wallShear: number | undefined;
  if (inp.density !== undefined) {
    positive(inp.density, 'The density');
    drag = cfAvg * 0.5 * inp.density * inp.speed ** 2 * inp.length * width;
    wallShear = cfLocal * 0.5 * inp.density * inp.speed ** 2;
    steps.push({
      key: 'fhExtDrag',
      vars: { D: fmt(drag) },
      math: `D = C_f\\,\\tfrac12\\rho U^2 L w = ${fmt(drag)}\\ \\mathrm{N}`,
    });
  }
  return {
    reL,
    regime,
    delta,
    displacement: dispT,
    momentum: momT,
    cfLocal,
    cfAverage: cfAvg,
    drag,
    wallShear,
    transitionAt: transitions ? (rec * inp.nu) / inp.speed : undefined,
    warnings,
    steps,
  };
}

/**
 * The Reynolds number where the Schiller-Naumann coefficient 24/Re (1 + 0.15 Re^0.687) falls to the constant 0.44 of the
 * Newton regime. Switching here keeps the drag continuous, so the drag always rises with speed and a sphere has one
 * terminal speed (the usual switch at 800 steps from 0.474 to 0.44 and gives some spheres two).
 */
export const SN_SWITCH = 988.9478531195837;

export type SphereModel = 'stokes' | 'schillerNaumann' | 'fixed';

/** Sphere drag coefficient; the correlation named in the tool, valid up to its stated Reynolds number. */
export function sphereCd(re: number, model: SphereModel = 'schillerNaumann', fixedCd = 0.44): number {
  positive(re, 'The Reynolds number');
  if (model === 'stokes') return 24 / re;
  if (model === 'fixed') return fixedCd;
  return re < SN_SWITCH ? (24 / re) * (1 + 0.15 * re ** 0.687) : 0.44;
}

export interface SphereInput {
  diameter: number;
  sphereDensity: number;
  fluidDensity: number;
  viscosity: number;
  model?: SphereModel;
  fixedCd?: number;
  g?: number;
}

export interface SphereResult {
  /** Terminal speed (m/s), always positive; see `rises`. */
  velocity: number;
  rises: boolean;
  re: number;
  cd: number;
  drag: number;
  warnings: string[];
  steps: Step[];
}

/** Terminal velocity of a sphere: weight less buoyancy equals drag. */
export function terminalVelocity(inp: SphereInput): SphereResult {
  const g = inp.g ?? G0;
  positive(inp.diameter, 'The diameter');
  positive(inp.sphereDensity, 'The sphere density');
  positive(inp.fluidDensity, 'The fluid density');
  positive(inp.viscosity, 'The viscosity');
  const model = inp.model ?? 'schillerNaumann';
  const fixedCd = inp.fixedCd ?? 0.44;
  if (model === 'fixed') positive(fixedCd, 'The drag coefficient');
  const drho = inp.sphereDensity - inp.fluidDensity;
  need(
    drho !== 0,
    'neutral',
    'The sphere and the fluid have the same density, so the sphere is neutrally buoyant and has no terminal speed.',
  );
  const net = (Math.abs(drho) * g * Math.PI * inp.diameter ** 3) / 6;
  const area = (Math.PI * inp.diameter ** 2) / 4;
  const dragAt = (v: number) => {
    const re = (inp.fluidDensity * v * inp.diameter) / inp.viscosity;
    return sphereCd(re, model, fixedCd) * 0.5 * inp.fluidDensity * v * v * area;
  };
  let v: number;
  if (model === 'stokes') v = (Math.abs(drho) * g * inp.diameter ** 2) / (18 * inp.viscosity);
  else if (model === 'fixed') v = Math.sqrt((2 * net) / (fixedCd * inp.fluidDensity * area));
  else {
    let hi = 1e-6;
    let guard = 0;
    while (dragAt(hi) < net) {
      hi *= 2;
      if (++guard > 100) throw new CalcError('range', 'No terminal speed was found.');
    }
    v = brent((x) => dragAt(x) - net, hi / 2, hi, 1e-14);
  }
  const re = (inp.fluidDensity * v * inp.diameter) / inp.viscosity;
  const cd = sphereCd(re, model, fixedCd);
  const warnings: string[] = [];
  if (model === 'stokes' && re > 1) warnings.push('fhExtWarnStokes');
  if (model === 'schillerNaumann' && re > 2e5) warnings.push('fhExtWarnDragCrisis');
  const steps: Step[] = [
    {
      key: 'fhExtBalance',
      math: String.raw`(\rho_s - \rho)\,g\,\frac{\pi d^3}{6} = C_D\,\tfrac12\rho v^2\,\frac{\pi d^2}{4}`,
    },
    {
      key: model === 'stokes' ? 'fhExtStokes' : model === 'fixed' ? 'fhExtFixedCd' : 'fhExtSchiller',
      vars: { v: fmt(v), Re: fmt(re), cd: fmt(cd) },
      math:
        model === 'stokes'
          ? `v = \\frac{(\\rho_s-\\rho)g d^2}{18\\mu} = ${fmt(v)}\\ \\mathrm{m/s}`
          : `v = ${fmt(v)}\\ \\mathrm{m/s},\\ Re = ${fmt(re)},\\ C_D = ${fmt(cd)}`,
    },
  ];
  return { velocity: v, rises: drho < 0, re, cd, drag: net, warnings, steps };
}

export interface BodyDragInput {
  cd: number;
  density: number;
  speed: number;
  /** Reference (frontal) area, m2. */
  area: number;
}

/** F = CD (1/2) rho V^2 A and the power needed to hold the speed. */
export function bodyDrag(inp: BodyDragInput): { drag: number; power: number; steps: Step[] } {
  positive(inp.cd, 'The drag coefficient');
  positive(inp.density, 'The density');
  positive(inp.area, 'The area');
  need(Number.isFinite(inp.speed) && inp.speed >= 0, 'speed', 'The speed must be zero or more.');
  const drag = inp.cd * 0.5 * inp.density * inp.speed ** 2 * inp.area;
  return {
    drag,
    power: drag * inp.speed,
    steps: [
      {
        key: 'fhExtBodyDrag',
        vars: { F: fmt(drag) },
        math: `F_D = C_D\\,\\tfrac12\\rho V^2 A = ${fmt(drag)}\\ \\mathrm{N}`,
      },
    ],
  };
}
