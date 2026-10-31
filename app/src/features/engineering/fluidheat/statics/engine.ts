// Fluid statics, buoyancy, and the Bernoulli equation. Everything is in SI; the window converts units.
import { CalcError, fmt, G0, need, nonNegative, positive, sq, type Step } from '../numeric';

export type PlateShape = 'rectangle' | 'circle' | 'triangleApexUp' | 'triangleBaseUp';

export interface PlateInput {
  shape: PlateShape;
  /** Width of the rectangle or base of the triangle, or diameter of the circle (m). */
  width: number;
  /** Extent of the plate along its slope (m); ignored for the circle. */
  height: number;
  /** Vertical depth of the plate's top edge below the free surface (m). */
  topDepth: number;
  /** Plate angle from the horizontal in degrees, 90 for a vertical gate. */
  angleDeg: number;
  density: number;
  g?: number;
  /** Gauge pressure on the free surface (Pa), default 0. */
  surfacePressure?: number;
}

export interface PlateResult {
  area: number;
  centroidDepth: number;
  force: number;
  /** Distance from the free surface to the center of pressure, measured vertically (m). */
  pressureCenterDepth: number;
  /** Distance of the center of pressure below the centroid, along the plate (m). */
  offsetAlongPlate: number;
  /** Distance of the center of pressure from the top edge, along the plate (m). */
  fromTopEdge: number;
  steps: Step[];
}

function plateGeometry(shape: PlateShape, width: number, height: number) {
  switch (shape) {
    case 'rectangle':
      return { area: width * height, ixc: (width * height ** 3) / 12, extent: height, toCentroid: height / 2 };
    case 'circle':
      return {
        area: (Math.PI * width ** 2) / 4,
        ixc: (Math.PI * width ** 4) / 64,
        extent: width,
        toCentroid: width / 2,
      };
    case 'triangleApexUp':
      return {
        area: (width * height) / 2,
        ixc: (width * height ** 3) / 36,
        extent: height,
        toCentroid: (2 * height) / 3,
      };
    case 'triangleBaseUp':
      return { area: (width * height) / 2, ixc: (width * height ** 3) / 36, extent: height, toCentroid: height / 3 };
  }
}

/** Hydrostatic force on a plane plate: F = (p0 + rho g h_c) A, line of action from the second moment of area. */
export function planeForce(inp: PlateInput): PlateResult {
  const g = inp.g ?? G0;
  const p0 = inp.surfacePressure ?? 0;
  positive(inp.density, 'The density');
  positive(inp.width, inp.shape === 'circle' ? 'The diameter' : 'The width');
  if (inp.shape !== 'circle') positive(inp.height, 'The height');
  nonNegative(inp.topDepth, 'The depth of the top edge');
  need(
    inp.angleDeg > 0 && inp.angleDeg <= 90,
    'angle',
    'The plate angle must be above 0 and at most 90 degrees from the horizontal.',
  );
  const sin = Math.sin((inp.angleDeg * Math.PI) / 180);
  const { area, ixc, extent, toCentroid } = plateGeometry(inp.shape, inp.width, inp.height);
  const hc = inp.topDepth + toCentroid * sin;
  const gaugeAtCentroid = p0 + inp.density * g * hc;
  const force = gaugeAtCentroid * area;
  // y is measured along the slope from the line where the plate plane meets the free surface (or its extension)
  const yc = hc / sin;
  // an equivalent extra depth of liquid p0/(rho g) moves the effective surface up
  const yEff = yc + p0 / (inp.density * g * sin);
  const offset = ixc / (yEff * area);
  const fromTop = toCentroid + offset;
  const hcp = inp.topDepth + fromTop * sin;
  const steps: Step[] = [
    { key: 'fhStaticsArea', vars: { A: fmt(area) }, math: `A = ${fmt(area)}\\ \\mathrm{m^2}` },
    {
      key: 'fhStaticsCentroid',
      vars: { hc: fmt(hc) },
      math: `h_c = h_{top} + c\\sin\\theta = ${fmt(hc)}\\ \\mathrm{m}`,
    },
    {
      key: 'fhStaticsForce',
      vars: { F: fmt(force) },
      math:
        `F = (p_0 + \\rho g h_c)A = (${fmt(p0)} ` +
        `+ ${fmt(inp.density)}\\cdot${fmt(g)}\\cdot${fmt(hc)})\\cdot${fmt(area)} ` +
        `= ${fmt(force)}\\ \\mathrm{N}`,
    },
    {
      key: 'fhStaticsCenter',
      vars: { y: fmt(offset) },
      math: `y_{cp} - y_c = \\frac{I_{xc}}{y_c A} = \\frac{${fmt(ixc)}}{${fmt(yEff)}\\cdot${fmt(area)}} = ${fmt(offset)}\\ \\mathrm{m}`,
    },
    { key: 'fhStaticsCenterDepth', vars: { h: fmt(hcp) }, math: `h_{cp} = ${fmt(hcp)}\\ \\mathrm{m}` },
  ];
  void extent;
  return {
    area,
    centroidDepth: hc,
    force,
    pressureCenterDepth: hcp,
    offsetAlongPlate: offset,
    fromTopEdge: fromTop,
    steps,
  };
}

export interface CurvedInput {
  /** quarter circle of radius R, fluid on the side that includes the quarter disk, or on the side that does not. */
  orientation: 'quarterDisk' | 'quarterComplement';
  radius: number;
  width: number;
  /** Depth of the top of the arc below the free surface (m). */
  topDepth: number;
  density: number;
  g?: number;
}

export interface CurvedResult {
  horizontal: number;
  vertical: number;
  resultant: number;
  /** Angle of the resultant below (+) the horizontal, degrees. */
  angleDeg: number;
  volume: number;
  steps: Step[];
}

/** Quarter-circle surface: horizontal force from the vertical projection, vertical force from the weight of liquid above. */
export function curvedForce(inp: CurvedInput): CurvedResult {
  const g = inp.g ?? G0;
  positive(inp.radius, 'The radius');
  positive(inp.width, 'The width');
  nonNegative(inp.topDepth, 'The depth of the top of the arc');
  positive(inp.density, 'The density');
  const proj = inp.radius * inp.width;
  const hc = inp.topDepth + inp.radius / 2;
  const fh = inp.density * g * hc * proj;
  const shape = inp.orientation === 'quarterDisk' ? Math.PI / 4 : 1 - Math.PI / 4;
  const volume = inp.width * (inp.radius * inp.topDepth + shape * inp.radius ** 2);
  const fv = inp.density * g * volume;
  const resultant = Math.hypot(fh, fv);
  const angleDeg = (Math.atan2(fv, fh) * 180) / Math.PI;
  const steps: Step[] = [
    {
      key: 'fhStaticsHorizontal',
      vars: { F: fmt(fh) },
      math: `F_H = \\rho g h_c A_{proj} = ${fmt(inp.density)}\\cdot${fmt(g)}\\cdot${fmt(hc)}\\cdot${fmt(proj)} = ${fmt(fh)}\\ \\mathrm{N}`,
    },
    {
      key: 'fhStaticsVertical',
      vars: { V: fmt(volume), F: fmt(fv) },
      math: `F_V = \\rho g V = ${fmt(inp.density)}\\cdot${fmt(g)}\\cdot${fmt(volume)} = ${fmt(fv)}\\ \\mathrm{N}`,
    },
    {
      key: 'fhStaticsResultant',
      vars: { F: fmt(resultant), a: fmt(angleDeg) },
      math: `F = \\sqrt{F_H^2 + F_V^2} = ${fmt(resultant)}\\ \\mathrm{N},\\ \\tan\\alpha = F_V/F_H`,
    },
  ];
  return { horizontal: fh, vertical: fv, resultant, angleDeg, volume, steps };
}

export interface ManometerSegment {
  /** Density of the fluid in this leg (kg/m3). */
  density: number;
  /** Height change when moving along the chain from the previous point: positive down, negative up (m). */
  down: number;
}

export interface ManometerResult {
  pressure: number;
  terms: number[];
  steps: Step[];
}

/** p_end = p_start + sum(rho_i g dh_i), moving down adds pressure and moving up subtracts it. */
export function manometer(startPressure: number, chain: ManometerSegment[], g = G0): ManometerResult {
  need(chain.length > 0, 'chain', 'Add at least one leg to the manometer.');
  need(Number.isFinite(startPressure), 'pressure', 'The starting pressure must be a number.');
  let p = startPressure;
  const terms: number[] = [];
  const steps: Step[] = [];
  chain.forEach((seg, i) => {
    positive(seg.density, `The density of leg ${i + 1}`);
    need(Number.isFinite(seg.down), 'height', `The height of leg ${i + 1} must be a number.`);
    const term = seg.density * g * seg.down;
    terms.push(term);
    p += term;
    steps.push({
      key: 'fhStaticsLeg',
      vars: { n: String(i + 1), dp: fmt(term), p: fmt(p) },
      math: `p_{${i + 1}} = p_{${i}} + \\rho g\\,\\Delta h = ${fmt(term)}\\ \\mathrm{Pa} \\Rightarrow ${fmt(p)}\\ \\mathrm{Pa}`,
    });
  });
  return { pressure: p, terms, steps };
}

export interface BuoyancyInput {
  fluidDensity: number;
  objectDensity: number;
  volume: number;
  g?: number;
}

export interface BuoyancyResult {
  floats: boolean;
  fractionSubmerged: number;
  buoyantForce: number;
  weight: number;
  /** Tension needed to hold the object fully submerged (positive) or apparent weight when it sinks, N. */
  holdingForce: number;
  steps: Step[];
}

export function buoyancy(inp: BuoyancyInput): BuoyancyResult {
  const g = inp.g ?? G0;
  positive(inp.fluidDensity, 'The fluid density');
  positive(inp.objectDensity, 'The object density');
  positive(inp.volume, 'The volume');
  const floats = inp.objectDensity < inp.fluidDensity;
  const frac = Math.min(1, inp.objectDensity / inp.fluidDensity);
  const weight = inp.objectDensity * g * inp.volume;
  const fb = inp.fluidDensity * g * inp.volume * frac;
  const hold = Math.abs(inp.fluidDensity * g * inp.volume - weight);
  const steps: Step[] = [
    { key: 'fhStaticsWeight', vars: { W: fmt(weight) }, math: `W = \\rho_o g V = ${fmt(weight)}\\ \\mathrm{N}` },
    {
      key: floats ? 'fhStaticsFloats' : 'fhStaticsSinks',
      vars: { f: fmt(frac * 100) },
      math: `F_B = \\rho_f g V_{sub} = ${fmt(fb)}\\ \\mathrm{N},\\ V_{sub}/V = \\rho_o/\\rho_f = ${fmt(frac)}`,
    },
  ];
  return { floats, fractionSubmerged: frac, buoyantForce: fb, weight, holdingForce: hold, steps };
}

export interface BargeInput {
  /** Beam (width) of the waterline rectangle (m). */
  beam: number;
  /** Length (m); it cancels out of GM. */
  length: number;
  draft: number;
  /** Height of the center of gravity above the keel (m). */
  kg: number;
  density: number;
}

export interface BargeResult {
  displacement: number;
  kb: number;
  bm: number;
  gm: number;
  stable: boolean;
  steps: Step[];
}

/** Metacentric height of a box-shaped hull rolling about its long axis: GM = KB + BM - KG with BM = I/V. */
export function barge(inp: BargeInput): BargeResult {
  positive(inp.beam, 'The beam');
  positive(inp.length, 'The length');
  positive(inp.draft, 'The draft');
  positive(inp.kg, 'KG');
  positive(inp.density, 'The density');
  const volume = inp.beam * inp.length * inp.draft;
  const inertia = (inp.length * inp.beam ** 3) / 12;
  const bm = inertia / volume;
  const kb = inp.draft / 2;
  const gm = kb + bm - inp.kg;
  const steps: Step[] = [
    { key: 'fhStaticsKB', vars: { v: fmt(kb) }, math: `KB = d/2 = ${fmt(kb)}\\ \\mathrm{m}` },
    {
      key: 'fhStaticsBM',
      vars: { v: fmt(bm) },
      math: `BM = \\frac{I}{V} = \\frac{L B^3/12}{L B d} = ${fmt(bm)}\\ \\mathrm{m}`,
    },
    {
      key: gm > 0 ? 'fhStaticsStable' : 'fhStaticsUnstable',
      vars: { v: fmt(gm) },
      math: `GM = KB + BM - KG = ${fmt(kb)} + ${fmt(bm)} - ${fmt(inp.kg)} = ${fmt(gm)}\\ \\mathrm{m}`,
    },
  ];
  return { displacement: inp.density * volume, kb, bm, gm, stable: gm > 0, steps };
}

export interface BernoulliPoint {
  /** Gauge or absolute pressure (Pa); use the same basis at both points. */
  p?: number;
  V?: number;
  z?: number;
}

export type BernoulliUnknown = 'p1' | 'V1' | 'z1' | 'p2' | 'V2' | 'z2' | 'hL';

export interface BernoulliInput {
  density: number;
  one: BernoulliPoint;
  two: BernoulliPoint;
  /** Head loss from 1 to 2 (m); leave undefined to solve for it. */
  headLoss?: number;
  /** Pump head added between 1 and 2 (m), default 0. */
  pumpHead?: number;
  g?: number;
}

export interface BernoulliResult {
  unknown: BernoulliUnknown;
  value: number;
  steps: Step[];
}

/**
 * p1/(rho g) + V1^2/(2g) + z1 + hp = p2/(rho g) + V2^2/(2g) + z2 + hL.
 * Exactly one of p1, V1, z1, p2, V2, z2, hL is left undefined, and is solved for.
 */
export function bernoulli(inp: BernoulliInput): BernoulliResult {
  const g = inp.g ?? G0;
  positive(inp.density, 'The density');
  const hp = inp.pumpHead ?? 0;
  const vals: Record<BernoulliUnknown, number | undefined> = {
    p1: inp.one.p,
    V1: inp.one.V,
    z1: inp.one.z,
    p2: inp.two.p,
    V2: inp.two.V,
    z2: inp.two.z,
    hL: inp.headLoss,
  };
  const missing = (Object.keys(vals) as BernoulliUnknown[]).filter((k) => vals[k] === undefined);
  if (missing.length !== 1)
    throw new CalcError(
      'unknown',
      missing.length === 0
        ? 'Leave one quantity empty so there is something to solve for.'
        : 'Leave only one quantity empty.',
    );
  for (const k of Object.keys(vals) as BernoulliUnknown[]) {
    const v = vals[k];
    need(v === undefined || Number.isFinite(v), 'number', `${k} must be a number.`);
  }
  const unknown = missing[0]!;
  const rg = inp.density * g;
  // total head terms; the unknown contributes through its own coefficient
  const head = (k: BernoulliUnknown): number => {
    const v = vals[k]!;
    if (k === 'p1' || k === 'p2') return v / rg;
    if (k === 'V1' || k === 'V2') return (v * v) / (2 * g);
    return v;
  };
  const side1 = (['p1', 'V1', 'z1'] as const).filter((k) => k !== unknown).reduce((s, k) => s + head(k), 0) + hp;
  const side2 =
    (['p2', 'V2', 'z2'] as const).filter((k) => k !== unknown).reduce((s, k) => s + head(k), 0) +
    (unknown === 'hL' ? 0 : vals.hL!);
  let value: number;
  if (unknown === 'hL') value = side1 - side2;
  else {
    const sign = unknown.endsWith('1') ? 1 : -1;
    // side1 - side2 = 0 => unknown head = sign * (rest of side2 - rest of side1) with sign for sides
    const restHead = sign === 1 ? side2 - side1 : side1 - side2;
    if (unknown === 'p1' || unknown === 'p2') value = restHead * rg;
    else if (unknown === 'z1' || unknown === 'z2') value = restHead;
    else {
      need(
        restHead >= 0,
        'impossible',
        'No real speed satisfies the energy balance: the other terms leave a negative kinetic head.',
      );
      value = Math.sqrt(2 * g * restHead);
    }
  }
  if (unknown === 'hL')
    need(
      value >= -1e-12,
      'negativeLoss',
      'The head loss comes out negative, which would make energy: check the inputs or add a pump head.',
    );
  const steps: Step[] = [
    {
      key: 'fhStaticsBernoulli',
      math: String.raw`\frac{p_1}{\rho g} + \frac{V_1^2}{2g} + z_1 + h_p = \frac{p_2}{\rho g} + \frac{V_2^2}{2g} + z_2 + h_L`,
    },
    { key: 'fhStaticsBernoulliSolved', vars: { name: unknown, v: fmt(value) }, math: `${unknown} = ${fmt(value)}` },
  ];
  return { unknown, value, steps };
}

export interface PitotInput {
  density: number;
  /** Stagnation minus static pressure (Pa). */
  dp: number;
}

export interface FlowMeterResult {
  value: number;
  steps: Step[];
}

/** Pitot-static tube: V = sqrt(2 dp / rho). */
export function pitot(inp: PitotInput): FlowMeterResult {
  positive(inp.density, 'The density');
  need(
    Number.isFinite(inp.dp) && inp.dp >= 0,
    'dp',
    'The pressure difference must be zero or more: the stagnation pressure is the larger one.',
  );
  const v = Math.sqrt((2 * inp.dp) / inp.density);
  return {
    value: v,
    steps: [
      {
        key: 'fhStaticsPitot',
        vars: { V: fmt(v) },
        math:
          `V = \\sqrt{\\frac{2\\,\\Delta p}{\\rho}} ` +
          `= \\sqrt{\\frac{2\\cdot${fmt(inp.dp)}}{${fmt(inp.density)}}} = ${fmt(v)}\\ \\mathrm{m/s}`,
      },
    ],
  };
}

/** Differential pressure read from a U-tube of a heavier fluid: dp = (rho_m - rho) g h. */
export function manometerDifference(manometerDensity: number, fluidDensity: number, h: number, g = G0): number {
  positive(manometerDensity, 'The manometer fluid density');
  positive(fluidDensity, 'The flowing fluid density');
  need(Number.isFinite(h), 'height', 'The reading must be a number.');
  return (manometerDensity - fluidDensity) * g * h;
}

export interface VenturiInput {
  density: number;
  dp: number;
  upstreamDiameter: number;
  throatDiameter: number;
  /** Discharge coefficient, default 1 (ideal). */
  cd?: number;
}

export interface VenturiResult {
  flow: number;
  throatVelocity: number;
  beta: number;
  steps: Step[];
}

/** Venturi meter: Q = Cd A2 sqrt(2 dp / (rho (1 - beta^4))). */
export function venturi(inp: VenturiInput): VenturiResult {
  positive(inp.density, 'The density');
  positive(inp.upstreamDiameter, 'The pipe diameter');
  positive(inp.throatDiameter, 'The throat diameter');
  need(inp.throatDiameter < inp.upstreamDiameter, 'beta', 'The throat must be narrower than the pipe.');
  need(Number.isFinite(inp.dp) && inp.dp >= 0, 'dp', 'The pressure difference must be zero or more.');
  const cd = inp.cd ?? 1;
  need(cd > 0 && cd <= 1.05, 'cd', 'The discharge coefficient is normally between 0.9 and 1.');
  const beta = inp.throatDiameter / inp.upstreamDiameter;
  const a2 = (Math.PI * sq(inp.throatDiameter)) / 4;
  const v2 = cd * Math.sqrt((2 * inp.dp) / (inp.density * (1 - beta ** 4)));
  const q = a2 * v2;
  return {
    flow: q,
    throatVelocity: v2,
    beta,
    steps: [
      { key: 'fhStaticsBeta', vars: { b: fmt(beta) }, math: `\\beta = d/D = ${fmt(beta)}` },
      {
        key: 'fhStaticsVenturi',
        vars: { Q: fmt(q) },
        math: `Q = C_d A_2\\sqrt{\\frac{2\\Delta p}{\\rho(1-\\beta^4)}} = ${fmt(q)}\\ \\mathrm{m^3/s}`,
      },
    ],
  };
}
