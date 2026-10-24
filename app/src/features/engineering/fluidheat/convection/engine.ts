// Convection heat (and mass) transfer coefficients from the standard published correlations, each with its validity range checked.
// Mass transfer uses the same formulas with the Sherwood number in place of Nusselt and the Schmidt number in place of Prandtl.
import { CalcError, fmt, G0, need, positive, type Step } from '../numeric';

export type CorrelationId =
  | 'plateLocal'
  | 'plateLaminar'
  | 'plateMixed'
  | 'plateTurbulent'
  | 'cylinderCross'
  | 'sphereWhitaker'
  | 'sphereRanzMarshall'
  | 'tubeLaminarFlux'
  | 'tubeLaminarTemp'
  | 'tubeEntry'
  | 'dittusBoelter'
  | 'gnielinski'
  | 'siederTate'
  | 'verticalPlateFull'
  | 'verticalPlateLaminar'
  | 'horizontalPlateUp'
  | 'horizontalPlateDown'
  | 'horizontalCylinder'
  | 'sphereNatural';

export interface Fluid {
  /** Conductivity (W/m K), or the diffusivity D_AB (m2/s) in mass mode: only the product Nu k / L is used. */
  k: number;
  nu: number;
  pr: number;
  /** Dynamic viscosity ratio mu_bulk / mu_wall for the correlations that carry it (default 1). */
  muRatio?: number;
}

export interface Geometry {
  /** Characteristic length: plate length, cylinder, or sphere diameter, tube diameter, vertical plate height (m). */
  length: number;
  /** Free-stream or mean velocity (m/s) for forced convection. */
  velocity?: number;
  /** Surface minus fluid temperature difference magnitude (K) for natural convection. */
  deltaT?: number;
  /** Volumetric expansion coefficient (1/K); for an ideal gas 1/T_film with T in kelvin. */
  beta?: number;
  /** Tube length (m), for the entrance-region correlations. */
  tubeLength?: number;
  /** true when the fluid is being heated (for Dittus-Boelter's exponent). */
  heating?: boolean;
  g?: number;
}

export interface CorrelationInfo {
  id: CorrelationId;
  group: 'external' | 'internal' | 'natural';
  /** Name of the correlation for the interface; strings live in the kit namespace under fhConv<Id>. */
  name: string;
  needs: 'forced' | 'natural';
  /** Textual range of validity. */
  range: string;
}

export const CORRELATIONS: readonly CorrelationInfo[] = [
  {
    id: 'plateLocal',
    group: 'external',
    name: 'Flat plate, laminar, local',
    needs: 'forced',
    range: 'Re_x < 5e5, Pr >= 0.6',
  },
  {
    id: 'plateLaminar',
    group: 'external',
    name: 'Flat plate, laminar, average',
    needs: 'forced',
    range: 'Re_L < 5e5, Pr >= 0.6',
  },
  {
    id: 'plateTurbulent',
    group: 'external',
    name: 'Flat plate, turbulent, average',
    needs: 'forced',
    range: '5e5 < Re_L < 1e7, 0.6 < Pr < 60',
  },
  {
    id: 'plateMixed',
    group: 'external',
    name: 'Flat plate, mixed, average',
    needs: 'forced',
    range: '5e5 < Re_L < 1e8, 0.6 < Pr < 60',
  },
  {
    id: 'cylinderCross',
    group: 'external',
    name: 'Cylinder in cross flow (Churchill-Bernstein)',
    needs: 'forced',
    range: 'Re Pr > 0.2',
  },
  {
    id: 'sphereWhitaker',
    group: 'external',
    name: 'Sphere (Whitaker)',
    needs: 'forced',
    range: '3.5 < Re < 7.6e4, 0.7 < Pr < 380',
  },
  {
    id: 'sphereRanzMarshall',
    group: 'external',
    name: 'Sphere (Ranz-Marshall)',
    needs: 'forced',
    range: '0 < Re < 7e4, 0.6 < Pr < 400',
  },
  {
    id: 'tubeLaminarFlux',
    group: 'internal',
    name: 'Tube, fully developed laminar, constant flux',
    needs: 'forced',
    range: 'Re < 2300',
  },
  {
    id: 'tubeLaminarTemp',
    group: 'internal',
    name: 'Tube, fully developed laminar, constant surface temperature',
    needs: 'forced',
    range: 'Re < 2300',
  },
  {
    id: 'tubeEntry',
    group: 'internal',
    name: 'Tube, laminar entry region (Hausen)',
    needs: 'forced',
    range: 'Re < 2300, constant surface temperature',
  },
  {
    id: 'dittusBoelter',
    group: 'internal',
    name: 'Tube, turbulent (Dittus-Boelter)',
    needs: 'forced',
    range: 'Re > 1e4, 0.6 <= Pr <= 160, L/D >= 10',
  },
  {
    id: 'gnielinski',
    group: 'internal',
    name: 'Tube, turbulent (Gnielinski)',
    needs: 'forced',
    range: '3000 <= Re <= 5e6, 0.5 <= Pr <= 2000',
  },
  {
    id: 'siederTate',
    group: 'internal',
    name: 'Tube, turbulent (Sieder-Tate)',
    needs: 'forced',
    range: 'Re > 1e4, 0.7 <= Pr <= 16700, L/D >= 10',
  },
  {
    id: 'verticalPlateFull',
    group: 'natural',
    name: 'Vertical plate, all Ra (Churchill-Chu)',
    needs: 'natural',
    range: 'Ra up to 1e12',
  },
  {
    id: 'verticalPlateLaminar',
    group: 'natural',
    name: 'Vertical plate, laminar (Churchill-Chu)',
    needs: 'natural',
    range: 'Ra < 1e9',
  },
  {
    id: 'horizontalPlateUp',
    group: 'natural',
    name: 'Horizontal plate, hot surface up',
    needs: 'natural',
    range: '1e4 < Ra < 1e11',
  },
  {
    id: 'horizontalPlateDown',
    group: 'natural',
    name: 'Horizontal plate, hot surface down',
    needs: 'natural',
    range: '1e5 < Ra < 1e10',
  },
  {
    id: 'horizontalCylinder',
    group: 'natural',
    name: 'Horizontal cylinder (Churchill-Chu)',
    needs: 'natural',
    range: 'Ra < 1e12',
  },
  {
    id: 'sphereNatural',
    group: 'natural',
    name: 'Sphere (Churchill)',
    needs: 'natural',
    range: 'Ra < 1e11, Pr >= 0.7',
  },
];

export interface CorrelationResult {
  id: CorrelationId;
  nusselt: number;
  /** Heat transfer coefficient h = Nu k / L (W/m2 K), or the mass transfer coefficient in mass mode. */
  h: number;
  re?: number;
  ra?: number;
  /** Petukhov friction factor used by Gnielinski. */
  frictionFactor?: number;
  /** Warning keys (fhConvWarn...) for each validity range that is violated. */
  warnings: string[];
  steps: Step[];
}

const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

export function rayleigh(f: Fluid, g: Geometry): number {
  positive(g.length, 'The length');
  need(
    g.deltaT !== undefined && Number.isFinite(g.deltaT) && g.deltaT > 0,
    'deltaT',
    'The surface-to-fluid temperature difference must be above zero (give its size, not its sign).',
  );
  need(
    g.beta !== undefined && g.beta > 0,
    'beta',
    'The expansion coefficient beta must be above zero (1/T_film in kelvin for a gas).',
  );
  const alpha = f.nu / f.pr;
  return ((g.g ?? G0) * g.beta! * g.deltaT! * g.length ** 3) / (f.nu * alpha);
}

interface Ctx {
  /** Reynolds number (0 for natural convection), Rayleigh number (0 for forced convection). */
  R: number;
  A: number;
  pr: number;
  /** Viscosity ratio mu / mu_s. */
  mu: number;
  g: Geometry;
}

interface Evaluated {
  nu: number;
  math: string;
  warnings: string[];
  frictionFactor?: number;
}

const turbulent = 'fhConvWarnTurbulent';
const range = 'fhConvWarnRange';
const flag = (bad: boolean, key: string): string[] => (bad ? [key] : []);
const shortTube = (g: Geometry): boolean => g.tubeLength !== undefined && g.tubeLength / g.length < 10;

/** Each correlation: the Nusselt number, its equation in LaTeX, and the warnings for the ranges it is outside. */
const FORMS: Record<CorrelationId, (c: Ctx) => Evaluated> = {
  plateLocal: ({ R, pr }) => ({
    nu: 0.332 * R ** 0.5 * pr ** (1 / 3),
    math: 'Nu_x = 0.332\\,Re_x^{1/2}Pr^{1/3}',
    warnings: [...flag(R >= 5e5, turbulent), ...flag(pr < 0.6, 'fhConvWarnPr')],
  }),
  plateLaminar: ({ R, pr }) => ({
    nu: 0.664 * R ** 0.5 * pr ** (1 / 3),
    math: '\\overline{Nu}_L = 0.664\\,Re_L^{1/2}Pr^{1/3}',
    warnings: [...flag(R >= 5e5, turbulent), ...flag(pr < 0.6, 'fhConvWarnPr')],
  }),
  plateTurbulent: ({ R, pr }) => ({
    nu: 0.037 * R ** 0.8 * pr ** (1 / 3),
    math: '\\overline{Nu}_L = 0.037\\,Re_L^{4/5}Pr^{1/3}',
    warnings: flag(!inRange(R, 5e5, 1e7) || !inRange(pr, 0.6, 60), range),
  }),
  plateMixed: ({ R, pr }) => ({
    nu: (0.037 * R ** 0.8 - 871) * pr ** (1 / 3),
    math: '\\overline{Nu}_L = (0.037\\,Re_L^{4/5} - 871)Pr^{1/3}',
    warnings: flag(!inRange(R, 5e5, 1e8) || !inRange(pr, 0.6, 60), range),
  }),
  cylinderCross: ({ R, pr }) => ({
    nu:
      0.3 +
      ((0.62 * R ** 0.5 * pr ** (1 / 3)) / (1 + (0.4 / pr) ** (2 / 3)) ** 0.25) *
        (1 + (R / 282000) ** (5 / 8)) ** (4 / 5),
    math:
      'Nu_D = 0.3 + \\frac{0.62\\,Re^{1/2}Pr^{1/3}}{[1+(0.4/Pr)^{2/3}]^{1/4}}\\left[1 ' +
      '+ \\left(\\frac{Re}{282000}\\right)^{5/8}\\right]^{4/5}',
    warnings: flag(R * pr <= 0.2, range),
  }),
  sphereWhitaker: ({ R, pr, mu }) => ({
    nu: 2 + (0.4 * R ** 0.5 + 0.06 * R ** (2 / 3)) * pr ** 0.4 * mu ** 0.25,
    math: 'Nu_D = 2 + (0.4\\,Re^{1/2} + 0.06\\,Re^{2/3})Pr^{0.4}(\\mu/\\mu_s)^{1/4}',
    warnings: flag(!inRange(R, 3.5, 7.6e4) || !inRange(pr, 0.7, 380) || !inRange(mu, 1, 3.2), range),
  }),
  sphereRanzMarshall: ({ R, pr }) => ({
    nu: 2 + 0.6 * R ** 0.5 * pr ** (1 / 3),
    math: 'Nu_D = 2 + 0.6\\,Re^{1/2}Pr^{1/3}',
    warnings: flag(!inRange(R, 0, 7e4) || !inRange(pr, 0.6, 400), range),
  }),
  tubeLaminarFlux: ({ R }) => ({ nu: 4.36, math: 'Nu_D = 4.36', warnings: flag(R >= 2300, turbulent) }),
  tubeLaminarTemp: ({ R }) => ({ nu: 3.66, math: 'Nu_D = 3.66', warnings: flag(R >= 2300, turbulent) }),
  tubeEntry: ({ R, pr, g }) => {
    positive(g.tubeLength ?? NaN, 'The tube length');
    const gz = (g.length / g.tubeLength!) * R * pr;
    return {
      nu: 3.66 + (0.0668 * gz) / (1 + 0.04 * gz ** (2 / 3)),
      math: `Nu_D = 3.66 + \\frac{0.0668\\,Gz}{1 + 0.04\\,Gz^{2/3}},\\ Gz = \\frac{D}{L}Re\\,Pr = ${fmt(gz, 5)}`,
      warnings: flag(R >= 2300, turbulent),
    };
  },
  dittusBoelter: ({ R, pr, g }) => {
    const n = (g.heating ?? true) ? 0.4 : 0.3;
    return {
      nu: 0.023 * R ** 0.8 * pr ** n,
      math: `Nu_D = 0.023\\,Re^{4/5}Pr^{${n}}`,
      warnings: flag(R < 1e4 || !inRange(pr, 0.6, 160) || shortTube(g), range),
    };
  },
  gnielinski: ({ R, pr }) => {
    const ff = (0.79 * Math.log(R) - 1.64) ** -2;
    return {
      nu: ((ff / 8) * (R - 1000) * pr) / (1 + 12.7 * (ff / 8) ** 0.5 * (pr ** (2 / 3) - 1)),
      math:
        'Nu_D = \\frac{(f/8)(Re - 1000)Pr}{1 + 12.7\\sqrt{f/8}\\,(Pr^{2/3} - 1)},\\ ' +
        `f = (0.790\\ln Re - 1.64)^{-2} = ${fmt(ff, 5)}`,
      warnings: flag(!inRange(R, 3000, 5e6) || !inRange(pr, 0.5, 2000), range),
      frictionFactor: ff,
    };
  },
  siederTate: ({ R, pr, mu, g }) => ({
    nu: 0.027 * R ** 0.8 * pr ** (1 / 3) * mu ** 0.14,
    math: 'Nu_D = 0.027\\,Re^{4/5}Pr^{1/3}(\\mu/\\mu_s)^{0.14}',
    warnings: flag(R < 1e4 || !inRange(pr, 0.7, 16700) || shortTube(g), range),
  }),
  verticalPlateFull: ({ A, pr }) => ({
    nu: (0.825 + (0.387 * A ** (1 / 6)) / (1 + (0.492 / pr) ** (9 / 16)) ** (8 / 27)) ** 2,
    math: 'Nu_L = \\left[0.825 + \\frac{0.387\\,Ra^{1/6}}{[1 + (0.492/Pr)^{9/16}]^{8/27}}\\right]^2',
    warnings: flag(A > 1e12, range),
  }),
  verticalPlateLaminar: ({ A, pr }) => ({
    nu: 0.68 + (0.67 * A ** 0.25) / (1 + (0.492 / pr) ** (9 / 16)) ** (4 / 9),
    math: 'Nu_L = 0.68 + \\frac{0.670\\,Ra^{1/4}}{[1 + (0.492/Pr)^{9/16}]^{4/9}}',
    warnings: flag(A >= 1e9, range),
  }),
  horizontalPlateUp: ({ A }) => ({
    nu: A < 1e7 ? 0.54 * A ** 0.25 : 0.15 * A ** (1 / 3),
    math: A < 1e7 ? 'Nu = 0.54\\,Ra^{1/4}' : 'Nu = 0.15\\,Ra^{1/3}',
    warnings: flag(!inRange(A, 1e4, 1e11), range),
  }),
  horizontalPlateDown: ({ A }) => ({
    nu: 0.27 * A ** 0.25,
    math: 'Nu = 0.27\\,Ra^{1/4}',
    warnings: flag(!inRange(A, 1e5, 1e10), range),
  }),
  horizontalCylinder: ({ A, pr }) => ({
    nu: (0.6 + (0.387 * A ** (1 / 6)) / (1 + (0.559 / pr) ** (9 / 16)) ** (8 / 27)) ** 2,
    math: 'Nu_D = \\left[0.60 + \\frac{0.387\\,Ra^{1/6}}{[1 + (0.559/Pr)^{9/16}]^{8/27}}\\right]^2',
    warnings: flag(A > 1e12, range),
  }),
  sphereNatural: ({ A, pr }) => ({
    nu: 2 + (0.589 * A ** 0.25) / (1 + (0.469 / pr) ** (9 / 16)) ** (4 / 9),
    math: 'Nu_D = 2 + \\frac{0.589\\,Ra^{1/4}}{[1 + (0.469/Pr)^{9/16}]^{4/9}}',
    warnings: flag(A > 1e11 || pr < 0.7, range),
  }),
};

export function correlate(id: CorrelationId, f: Fluid, g: Geometry): CorrelationResult {
  positive(f.k, 'The conductivity');
  positive(f.nu, 'The kinematic viscosity');
  positive(f.pr, 'The Prandtl (or Schmidt) number');
  positive(g.length, 'The characteristic length');
  const info = CORRELATIONS.find((c) => c.id === id);
  need(info !== undefined, 'id', 'Unknown correlation.');
  const mu = f.muRatio ?? 1;
  positive(mu, 'The viscosity ratio');
  const steps: Step[] = [];
  let re: number | undefined;
  let ra: number | undefined;
  if (info!.needs === 'forced') {
    need(
      g.velocity !== undefined && Number.isFinite(g.velocity) && g.velocity > 0,
      'velocity',
      'The velocity must be above zero.',
    );
    re = (g.velocity! * g.length) / f.nu;
    steps.push({ key: 'fhConvRe', vars: { Re: fmt(re, 5) }, math: `Re = \\frac{V L}{\\nu} = ${fmt(re, 5)}` });
  } else {
    ra = rayleigh(f, g);
    steps.push({
      key: 'fhConvRa',
      vars: { Ra: fmt(ra, 5) },
      math: `Ra = \\frac{g\\beta\\Delta T L^3}{\\nu\\alpha} = ${fmt(ra, 5)}`,
    });
  }
  const result = FORMS[id]({ R: re ?? 0, A: ra ?? 0, pr: f.pr, mu, g });
  if (!Number.isFinite(result.nu) || result.nu <= 0)
    throw new CalcError(
      'nu',
      'This correlation gives no usable result at these inputs: they are well outside its range of validity. ' +
        'Choose another correlation.',
    );
  const h = (result.nu * f.k) / g.length;
  steps.push(
    {
      key: 'fhConvCorrelation',
      vars: { name: info!.name, range: info!.range },
      math: `${result.math} = ${fmt(result.nu, 5)}`,
    },
    { key: 'fhConvH', vars: { h: fmt(h, 5) }, math: `h = \\frac{Nu\\,k}{L} = ${fmt(h, 5)}\\ \\mathrm{W/m^2 K}` },
  );
  return {
    id,
    nusselt: result.nu,
    h,
    re,
    ra,
    frictionFactor: result.frictionFactor,
    warnings: result.warnings,
    steps,
  };
}

/** Pick the right flat-plate form for the Reynolds number when the user does not choose. */
export function suggestPlate(re: number): CorrelationId {
  return re < 5e5 ? 'plateLaminar' : 'plateMixed';
}

export interface TubeInput {
  diameter: number;
  length: number;
  /** Mass flow rate (kg/s). */
  massFlow: number;
  tIn: number;
  /** Wall condition: fixed surface temperature, or fixed heat flux (W/m2, positive into the fluid). */
  wall: { kind: 'temperature'; value: number } | { kind: 'flux'; value: number };
  correlation: CorrelationId;
  /** Fluid properties at the bulk mean temperature: called with each iterate. */
  propsAt: (tBulk: number) => { fluid: Fluid; cp: number; density: number };
}

export interface TubeResult {
  tOut: number;
  tBulk: number;
  h: number;
  re: number;
  heat: number;
  velocity: number;
  iterations: number;
  correlation: CorrelationResult;
  steps: Step[];
}

/** Heat transfer in a tube with the properties evaluated at the bulk mean temperature, iterated until the outlet temperature settles. */
export function tubeFlow(inp: TubeInput): TubeResult {
  positive(inp.diameter, 'The diameter');
  positive(inp.length, 'The length');
  positive(inp.massFlow, 'The mass flow rate');
  need(Number.isFinite(inp.tIn), 'tin', 'The inlet temperature must be a number.');
  const perimeter = Math.PI * inp.diameter;
  const area = (Math.PI * inp.diameter ** 2) / 4;
  let tOut = inp.tIn;
  let result: CorrelationResult | undefined;
  let cp = 0;
  let vel = 0;
  let iterations = 0;
  let h = 0;
  for (; iterations < 60; iterations++) {
    const tb = (inp.tIn + tOut) / 2;
    const p = inp.propsAt(tb);
    cp = p.cp;
    vel = inp.massFlow / (p.density * area);
    result = correlate(inp.correlation, p.fluid, {
      length: inp.diameter,
      velocity: vel,
      tubeLength: inp.length,
      heating: inp.wall.kind === 'temperature' ? inp.wall.value > inp.tIn : inp.wall.value > 0,
    });
    h = result.h;
    let next: number;
    if (inp.wall.kind === 'flux') next = inp.tIn + (inp.wall.value * perimeter * inp.length) / (inp.massFlow * cp);
    else {
      const ts = inp.wall.value;
      next = ts - (ts - inp.tIn) * Math.exp((-h * perimeter * inp.length) / (inp.massFlow * cp));
    }
    if (Math.abs(next - tOut) < 1e-10 * Math.max(1, Math.abs(next))) {
      tOut = next;
      iterations++;
      break;
    }
    tOut = next;
  }
  const heat = inp.massFlow * cp * (tOut - inp.tIn);
  const re = result!.re!;
  const steps: Step[] = [
    ...result!.steps,
    inp.wall.kind === 'flux'
      ? {
          key: 'fhConvOutletFlux',
          vars: { To: fmt(tOut, 5) },
          math: `T_o = T_i + \\frac{q'' P L}{\\dot m c_p} = ${fmt(tOut, 5)}`,
        }
      : {
          key: 'fhConvOutletTemp',
          vars: { To: fmt(tOut, 5) },
          math: `T_o = T_s - (T_s - T_i)\\exp\\left(-\\frac{\\bar h P L}{\\dot m c_p}\\right) = ${fmt(tOut, 5)}`,
        },
    {
      key: 'fhConvTubeHeat',
      vars: { q: fmt(heat, 5) },
      math: `q = \\dot m c_p (T_o - T_i) = ${fmt(heat, 5)}\\ \\mathrm{W}`,
    },
  ];
  return { tOut, tBulk: (inp.tIn + tOut) / 2, h, re, heat, velocity: vel, iterations, correlation: result!, steps };
}

/** Mass transfer coefficient from a Sherwood number: h_m = Sh D_AB / L. */
export function massCoefficient(sh: number, diffusivity: number, length: number): number {
  positive(sh, 'The Sherwood number');
  positive(diffusivity, 'The diffusivity');
  positive(length, 'The length');
  return (sh * diffusivity) / length;
}

/** Film-temperature average of surface and fluid temperatures. */
export const filmTemperature = (ts: number, tInf: number): number => (ts + tInf) / 2;
