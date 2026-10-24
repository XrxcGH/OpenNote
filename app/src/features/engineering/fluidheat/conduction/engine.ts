// Steady one-dimensional conduction as a thermal resistance network: plane walls, cylindrical, and spherical shells,
// contact and convection resistances, linearised radiation, critical radius of insulation, and uniform heat generation.
import { dtemp, fmt, need, nonNegative, positive, SIGMA, temp, type Step } from '../numeric';

export type Geometry = 'plane' | 'cylinder' | 'sphere';

export interface Layer {
  /** Plane: thickness (m). Cylinder and sphere: the layer's outer radius (m); the inner radius is the previous layer's. */
  size: number;
  /** Thermal conductivity (W/m K). */
  k: number;
  label?: string;
  /** Contact resistance between this layer and the next, per unit area at the interface (m2 K/W). */
  contactAfter?: number;
}

export interface WallInput {
  geometry: Geometry;
  /** Plane: area (m2). Cylinder: length (m). Sphere: unused. */
  extent: number;
  /** Inner radius for cylinders and spheres (m). */
  innerRadius?: number;
  layers: Layer[];
  /** Inner and outer fluid temperatures (K or C, the same scale). Omit the h to give a surface temperature instead. */
  tInner: number;
  tOuter: number;
  hInner?: number;
  hOuter?: number;
  samplesPerLayer?: number;
}

export interface ResistanceItem {
  label: string;
  /** Resistance of the whole element (K/W). */
  r: number;
  kind: 'convection' | 'conduction' | 'contact';
}

export interface WallResult {
  items: ResistanceItem[];
  total: number;
  q: number;
  /** Temperature at each node between consecutive resistances, starting with the inner temperature. */
  nodes: number[];
  /** Positions (x or r) and temperatures through the solid layers. */
  profile: { x: number; t: number }[];
  /** Heat flux at the inner surface (W/m2 for plane, W/m2 of the inner surface otherwise). */
  innerFlux: number;
  steps: Step[];
}

/** Resistance of a conduction layer from its inner position a to its outer position b, for the given geometry. */
export function layerResistance(geometry: Geometry, a: number, b: number, k: number, extent: number): number {
  switch (geometry) {
    case 'plane':
      return (b - a) / (k * extent);
    case 'cylinder':
      return Math.log(b / a) / (2 * Math.PI * k * extent);
    case 'sphere':
      return (1 / a - 1 / b) / (4 * Math.PI * k);
  }
}

const surfaceArea = (geometry: Geometry, pos: number, extent: number): number =>
  geometry === 'plane' ? extent : geometry === 'cylinder' ? 2 * Math.PI * pos * extent : 4 * Math.PI * pos * pos;

export function solveWall(inp: WallInput): WallResult {
  need(inp.layers.length > 0, 'layers', 'Add at least one layer.');
  need(Number.isFinite(inp.tInner) && Number.isFinite(inp.tOuter), 'temperature', 'Both temperatures must be numbers.');
  if (inp.geometry !== 'sphere') positive(inp.extent, inp.geometry === 'plane' ? 'The area' : 'The length');
  if (inp.hInner !== undefined) positive(inp.hInner, 'The inner heat transfer coefficient');
  if (inp.hOuter !== undefined) positive(inp.hOuter, 'The outer heat transfer coefficient');
  const plane = inp.geometry === 'plane';
  let pos = plane ? 0 : (inp.innerRadius ?? NaN);
  if (!plane) positive(pos, 'The inner radius');
  const edges: number[] = [pos];
  inp.layers.forEach((l, i) => {
    positive(l.k, `The conductivity of layer ${i + 1}`);
    positive(l.size, plane ? `The thickness of layer ${i + 1}` : `The outer radius of layer ${i + 1}`);
    if (l.contactAfter !== undefined) nonNegative(l.contactAfter, 'The contact resistance');
    const next = plane ? pos + l.size : l.size;
    need(next > pos, 'radius', `The outer radius of layer ${i + 1} must be larger than the radius inside it.`);
    edges.push(next);
    pos = next;
  });
  const items: ResistanceItem[] = [];
  const steps: Step[] = [];
  const A = (p: number) => surfaceArea(inp.geometry, p, inp.extent);
  if (inp.hInner !== undefined) items.push({ label: 'inner', r: 1 / (inp.hInner * A(edges[0]!)), kind: 'convection' });
  inp.layers.forEach((l, i) => {
    items.push({
      label: l.label ?? `layer ${i + 1}`,
      r: layerResistance(inp.geometry, edges[i]!, edges[i + 1]!, l.k, inp.extent),
      kind: 'conduction',
    });
    if (l.contactAfter !== undefined && l.contactAfter > 0 && i < inp.layers.length - 1)
      items.push({ label: `contact ${i + 1}`, r: l.contactAfter / A(edges[i + 1]!), kind: 'contact' });
  });
  if (inp.hOuter !== undefined)
    items.push({ label: 'outer', r: 1 / (inp.hOuter * A(edges.at(-1)!)), kind: 'convection' });
  const total = items.reduce((s, it) => s + it.r, 0);
  need(total > 0, 'noResistance', 'The network has no resistance at all, so the heat rate is not defined.');
  const q = (inp.tInner - inp.tOuter) / total;
  const nodes = [inp.tInner];
  items.forEach((it) => nodes.push(nodes.at(-1)! - q * it.r));
  // profile through the solid layers
  const n = inp.samplesPerLayer ?? 20;
  const profile: { x: number; t: number }[] = [];
  let tStart = inp.hInner !== undefined ? nodes[1]! : inp.tInner;
  let idx = inp.hInner !== undefined ? 1 : 0;
  inp.layers.forEach((l, i) => {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    for (let j = i === 0 ? 0 : 1; j <= n; j++) {
      const x = a + ((b - a) * j) / n;
      const rr = layerResistance(inp.geometry, a, x, l.k, inp.extent);
      profile.push({ x, t: tStart - q * rr });
    }
    tStart -= q * items[idx]!.r;
    idx++;
    if (items[idx]?.kind === 'contact') {
      tStart -= q * items[idx]!.r;
      idx++;
    }
  });
  items.forEach((it, i) =>
    steps.push({
      key: it.kind === 'convection' ? 'fhCondConv' : it.kind === 'contact' ? 'fhCondContact' : 'fhCondLayer',
      vars: { name: it.label, R: fmt(it.r, 5) },
      math: `R_{${i + 1}} = ${fmt(it.r, 5)}\\ \\mathrm{K/W}`,
    }),
  );
  steps.push(
    { key: 'fhCondTotal', vars: { R: fmt(total, 6) }, math: `R_{tot} = \\sum R_i = ${fmt(total, 6)}\\ \\mathrm{K/W}` },
    {
      key: 'fhCondRate',
      vars: { q: fmt(q, 5) },
      math: `q = \\frac{T_{in} - T_{out}}{R_{tot}} = ${fmt(q, 5)}\\ \\mathrm{W}`,
    },
  );
  nodes.forEach((t, i) => {
    if (i > 0 && i < nodes.length - 1)
      steps.push({ key: 'fhCondNode', vars: { n: String(i), T: temp(t) }, math: `T_{${i}} = [[T]]` });
  });
  return { items, total, q, nodes, profile, innerFlux: q / A(edges[0]!), steps };
}

/** Radius beyond which adding insulation stops reducing the heat loss: k/h for a cylinder, 2k/h for a sphere. */
export function criticalRadius(
  geometry: 'cylinder' | 'sphere',
  k: number,
  h: number,
): { radius: number; steps: Step[] } {
  positive(k, 'The conductivity');
  positive(h, 'The outside heat transfer coefficient');
  const r = geometry === 'cylinder' ? k / h : (2 * k) / h;
  return {
    radius: r,
    steps: [
      {
        key: 'fhCondCritical',
        vars: { r: fmt(r) },
        math:
          geometry === 'cylinder'
            ? `r_{cr} = \\frac{k}{h} = ${fmt(r)}\\ \\mathrm{m}`
            : `r_{cr} = \\frac{2k}{h} = ${fmt(r)}\\ \\mathrm{m}`,
      },
    ],
  };
}

/** Linearised radiation coefficient h_r = eps sigma (Ts + Tsurr)(Ts^2 + Tsurr^2), temperatures in kelvin. */
export function radiationCoefficient(emissivity: number, tSurface: number, tSurroundings: number): number {
  need(emissivity >= 0 && emissivity <= 1, 'emissivity', 'The emissivity must be between 0 and 1.');
  need(tSurface > 0 && tSurroundings > 0, 'kelvin', 'Radiation needs absolute temperatures above zero kelvin.');
  return emissivity * SIGMA * (tSurface + tSurroundings) * (tSurface ** 2 + tSurroundings ** 2);
}

export interface GenerationInput {
  geometry: Geometry;
  /** Plane: half thickness L (m), cylinder and sphere: outer radius (m). */
  size: number;
  k: number;
  /** Volumetric heat generation (W/m3). */
  qGen: number;
  /** Surface temperature, or give h and fluid temperature to find it. */
  tSurface?: number;
  h?: number;
  tFluid?: number;
}

export interface GenerationResult {
  tSurface: number;
  tMax: number;
  rise: number;
  profile: { x: number; t: number }[];
  steps: Step[];
}

/** Uniform generation q''' with the surface held at Ts (or cooled by a fluid). Plane wall is cooled on both faces. */
export function generation(inp: GenerationInput): GenerationResult {
  positive(inp.size, 'The size');
  positive(inp.k, 'The conductivity');
  need(Number.isFinite(inp.qGen), 'qGen', 'The generation rate must be a number.');
  const div = inp.geometry === 'plane' ? 2 : inp.geometry === 'cylinder' ? 4 : 6;
  const surfaceFlux = (inp.qGen * inp.size) / (inp.geometry === 'plane' ? 1 : inp.geometry === 'cylinder' ? 2 : 3);
  let ts: number;
  if (inp.tSurface !== undefined) ts = inp.tSurface;
  else {
    need(
      inp.h !== undefined && inp.tFluid !== undefined,
      'surface',
      'Give the surface temperature, or both h and the fluid temperature.',
    );
    positive(inp.h!, 'The heat transfer coefficient');
    ts = inp.tFluid! + surfaceFlux / inp.h!;
  }
  const rise = (inp.qGen * inp.size ** 2) / (div * inp.k);
  const n = 40;
  const profile = Array.from({ length: n + 1 }, (_, i) => {
    const x = (inp.size * i) / n;
    return { x, t: ts + (inp.qGen * (inp.size ** 2 - x ** 2)) / (div * inp.k) };
  });
  return {
    tSurface: ts,
    tMax: ts + rise,
    rise,
    profile,
    steps: [
      {
        key: 'fhCondGeneration',
        vars: { dT: dtemp(rise), Tmax: temp(ts + rise) },
        math:
          inp.geometry === 'plane'
            ? `T_{max} - T_s = \\frac{\\dot q L^2}{2k} = [[dT]]`
            : inp.geometry === 'cylinder'
              ? `T_{max} - T_s = \\frac{\\dot q r_0^2}{4k} = [[dT]]`
              : `T_{max} - T_s = \\frac{\\dot q r_0^2}{6k} = [[dT]]`,
      },
    ],
  };
}
