// Electric and magnetic fields in SI units: point charges by superposition, Gauss's law for symmetric charge,
// capacitors, the Biot-Savart law for straight segments, Ampere's-law sources (wires, loops, solenoids, toroids), the
// Lorentz force, and Faraday's law with inductance. Vectors are [x, y, z] arrays.
import { EPS0, K_E, MU0 } from '../kit/constants';
import { fail } from '../kit/read';

export type Vec = [number, number, number];

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);

export interface Charge {
  x: number;
  y: number;
  q: number;
}

export interface Contribution {
  /** Distance from the charge to the point, and the charge's field and potential there. */
  r: number;
  E: [number, number];
  V: number;
}

/** The field and potential of point charges in a plane at (x, y), with each charge's share. */
export function superpose(charges: readonly Charge[], x: number, y: number) {
  const parts: Contribution[] = charges.map((charge) => {
    const dx = x - charge.x;
    const dy = y - charge.y;
    const r = Math.hypot(dx, dy);
    if (r === 0) fail('kitPhysics.fields.errors.onCharge');
    const k = (K_E * charge.q) / (r * r * r);
    return { r, E: [k * dx, k * dy], V: (K_E * charge.q) / r };
  });
  const E: [number, number] = [
    parts.reduce((sum, part) => sum + part.E[0], 0),
    parts.reduce((sum, part) => sum + part.E[1], 0),
  ];
  return { parts, E, V: parts.reduce((sum, part) => sum + part.V, 0), magnitude: Math.hypot(E[0], E[1]) };
}

/** The field only, with no checks, for tracing lines; null at a charge. */
function fieldAt(charges: readonly Charge[], x: number, y: number): [number, number] | null {
  let ex = 0;
  let ey = 0;
  for (const charge of charges) {
    const dx = x - charge.x;
    const dy = y - charge.y;
    const r2 = dx * dx + dy * dy;
    if (r2 === 0) return null;
    const k = (K_E * charge.q) / (r2 * Math.sqrt(r2));
    ex += k * dx;
    ey += k * dy;
  }
  return [ex, ey];
}

/** The potential only, for the equipotential grid. */
export function potentialAt(charges: readonly Charge[], x: number, y: number): number {
  return charges.reduce((sum, charge) => sum + (K_E * charge.q) / Math.hypot(x - charge.x, y - charge.y), 0);
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A square view around the charges and the field point, with room to spare. */
export function viewBox(charges: readonly Charge[], point: [number, number]): Box {
  const xs = [...charges.map((c) => c.x), point[0]];
  const ys = [...charges.map((c) => c.y), point[1]];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9) * 0.9 + 1e-12;
  return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
}

/**
 * Field lines by fourth-order Runge-Kutta along the field's direction: from seeds around each positive charge going
 * with the field (or around each negative charge going against it when there are no positive charges), each charge
 * getting lines in proportion to its charge. A line stops at another charge, at the edge of the view, or after
 * 2000 steps.
 */
export function fieldLines(charges: readonly Charge[], box: Box, perMost = 12): [number, number][][] {
  const span = box.x1 - box.x0;
  const ds = span / 300;
  const near = span / 60;
  const most = Math.max(...charges.map((c) => Math.abs(c.q)));
  const sources = charges.some((c) => c.q > 0) ? charges.filter((c) => c.q > 0) : charges.filter((c) => c.q < 0);
  const sign = sources[0]?.q > 0 ? 1 : -1;
  const margin = 0.15 * span;
  const inside = (x: number, y: number) =>
    x > box.x0 - margin && x < box.x1 + margin && y > box.y0 - margin && y < box.y1 + margin;
  const direction = (x: number, y: number): [number, number] | null => {
    const E = fieldAt(charges, x, y);
    if (!E) return null;
    const m = Math.hypot(E[0], E[1]);
    return m === 0 ? null : [(sign * E[0]) / m, (sign * E[1]) / m];
  };
  const lines: [number, number][][] = [];
  for (const source of sources) {
    const count = Math.max(2, Math.round((perMost * Math.abs(source.q)) / most));
    for (let k = 0; k < count; k++) {
      const angle = (2 * Math.PI * (k + 0.5)) / count;
      let x = source.x + near * Math.cos(angle);
      let y = source.y + near * Math.sin(angle);
      const line: [number, number][] = [[x, y]];
      for (let step = 0; step < 2000; step++) {
        const k1 = direction(x, y);
        const k2 = k1 && direction(x + (ds / 2) * k1[0], y + (ds / 2) * k1[1]);
        const k3 = k2 && direction(x + (ds / 2) * k2[0], y + (ds / 2) * k2[1]);
        const k4 = k3 && direction(x + ds * k3[0], y + ds * k3[1]);
        if (!k1 || !k2 || !k3 || !k4) break;
        x += (ds / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        y += (ds / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        line.push([x, y]);
        if (!inside(x, y)) break;
        if (charges.some((c) => c !== source && Math.hypot(x - c.x, y - c.y) < near)) break;
      }
      lines.push(line);
    }
  }
  return lines;
}

export type Symmetry = 'point' | 'shell' | 'solidSphere' | 'line' | 'solidCylinder' | 'sheet' | 'conductor';

/**
 * Gauss's law: the field at distance r for symmetric charge. `amount` is the total charge (point, shell, solid
 * sphere), the charge per length (line, solid cylinder), or the charge per area (sheet, conductor surface); R is the
 * radius of a shell, sphere, or cylinder. Returns the field, the charge enclosed (per length or area where the charge
 * is), and the potential where one is defined against infinity.
 */
export function gauss(symmetry: Symmetry, amount: number, r: number, R: number) {
  const k = 1 / (4 * Math.PI * EPS0);
  switch (symmetry) {
    case 'point':
      return { E: (k * amount) / (r * r), enclosed: amount, V: (k * amount) / r };
    case 'shell':
      return r < R
        ? { E: 0, enclosed: 0, V: (k * amount) / R }
        : { E: (k * amount) / (r * r), enclosed: amount, V: (k * amount) / r };
    case 'solidSphere': {
      if (r >= R) return { E: (k * amount) / (r * r), enclosed: amount, V: (k * amount) / r };
      const enclosed = amount * (r / R) ** 3;
      return { E: (k * amount * r) / R ** 3, enclosed, V: ((k * amount) / (2 * R)) * (3 - (r / R) ** 2) };
    }
    case 'line':
      return { E: amount / (2 * Math.PI * EPS0 * r), enclosed: amount, V: null };
    case 'solidCylinder': {
      const enclosed = r < R ? amount * (r / R) ** 2 : amount;
      return { E: r === 0 ? 0 : enclosed / (2 * Math.PI * EPS0 * r), enclosed, V: null };
    }
    case 'sheet':
      return { E: amount / (2 * EPS0), enclosed: amount, V: null };
    default:
      return { E: amount / EPS0, enclosed: amount, V: null };
  }
}

export type Capacitor = 'plates' | 'coax' | 'spheres' | 'sphere';

/** Capacitance of a capacitor filled with a dielectric of constant kappa (dims.a inner radius, dims.b outer). */
export function capacitance(
  kind: Capacitor,
  kappa: number,
  dims: { A?: number; d?: number; a?: number; b?: number; L?: number },
) {
  const e = kappa * EPS0;
  if (kind === 'plates') return (e * (dims.A ?? NaN)) / (dims.d ?? NaN);
  const a = dims.a ?? NaN;
  const b = dims.b ?? NaN;
  if (kind === 'sphere') return 4 * Math.PI * e * a;
  if (!(b > a)) fail('kitPhysics.fields.errors.outerRadius');
  if (kind === 'coax') return (2 * Math.PI * e * (dims.L ?? NaN)) / Math.log(b / a);
  return (4 * Math.PI * e * a * b) / (b - a);
}

/** Capacitors in series or in parallel. */
export function combine(values: readonly number[], how: 'series' | 'parallel'): number {
  if (values.some((v) => !(v > 0))) fail('kitPhysics.fields.errors.positiveParts');
  return how === 'parallel' ? values.reduce((a, b) => a + b, 0) : 1 / values.reduce((a, b) => a + 1 / b, 0);
}

/**
 * The Biot-Savart field at point P of a straight segment carrying I from A to B, exactly. With L = B - A,
 * r1 = P - A and r2 = P - B, it is B = mu0 I / (4 pi) (L x r1) / |L x r1|² (L·r1 / |r1| - L·r2 / |r2|). The field
 * is zero on the segment's own line.
 */
export function segmentField(a: Vec, b: Vec, current: number, p: Vec): Vec {
  const L = sub(b, a);
  const r1 = sub(p, a);
  const r2 = sub(p, b);
  const c = cross(L, r1);
  const c2 = dot(c, c);
  const length = norm(L);
  if (length === 0) fail('kitPhysics.fields.errors.zeroSegment');
  if (c2 <= 1e-24 * length ** 2 * Math.max(dot(r1, r1), 1e-300)) return [0, 0, 0];
  const k = ((MU0 * current) / (4 * Math.PI)) * (dot(L, r1) / norm(r1) - dot(L, r2) / norm(r2));
  return scale(c, k / c2);
}

export type Source = 'wire' | 'loop' | 'solenoid' | 'toroid';

/** Magnetic fields of the standard current sources by Ampere's law and Biot-Savart. */
export function sourceField(
  source: Source,
  input: { I: number; r: number; R: number; N: number; length: number; z: number },
) {
  const { I, r, R, N, length, z } = input;
  switch (source) {
    case 'wire':
      // A long straight wire; inside a solid wire of radius R the current enclosed grows as r².
      return R > 0 && r < R ? (MU0 * I * r) / (2 * Math.PI * R * R) : (MU0 * I) / (2 * Math.PI * r);
    case 'loop':
      return (N * MU0 * I * R * R) / (2 * (R * R + z * z) ** 1.5);
    case 'solenoid': {
      // On the axis of a finite solenoid, z from its center: B = mu0 n I (cos a1 - cos a2) / 2.
      const n = N / length;
      const top = (z + length / 2) / Math.hypot(z + length / 2, R);
      const bottom = (z - length / 2) / Math.hypot(z - length / 2, R);
      return (MU0 * n * I * (top - bottom)) / 2;
    }
    default:
      return (MU0 * N * I) / (2 * Math.PI * r);
  }
}

/** The Lorentz force q (E + v x B), and for a charge with mass in B alone, its gyration radius and frequency. */
export function lorentz(q: number, v: Vec, E: Vec, B: Vec, m: number | null) {
  const magnetic = scale(cross(v, B), q);
  const force = add(scale(E, q), magnetic);
  const b = norm(B);
  if (m === null || b === 0) return { force, magnetic, radius: null, frequency: null, pitch: null };
  const along = b === 0 ? 0 : dot(v, B) / b;
  const across = Math.sqrt(Math.max(dot(v, v) - along * along, 0));
  const omega = (Math.abs(q) * b) / m;
  return {
    force,
    magnetic,
    radius: across / omega,
    frequency: omega / (2 * Math.PI),
    pitch: (along * 2 * Math.PI) / omega,
  };
}

/** Self-inductance of a long solenoid, mu0 N² A / length (with a core of relative permeability mu). */
export const solenoidInductance = (N: number, area: number, length: number, mu = 1): number =>
  (mu * MU0 * N * N * area) / length;
