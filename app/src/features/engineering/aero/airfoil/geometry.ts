// NACA four- and five-digit sections: the thickness polynomial, the camber lines, and the surface coordinates, all
// per unit chord. The five-digit camber lines use the constants NACA tabulated (Report 537 and its successors), so
// the coordinates match the published ones; the tests check those constants against their first-principles
// definitions.
import { AeroError, finite } from '../common';

/** A section's camber line and thickness, per unit chord. */
export interface Section {
  /** What the section is called, such as "NACA 2412", or the typed parameters. */
  readonly name: string;
  readonly family: 'four' | 'five' | 'custom';
  /** Maximum thickness over chord. */
  readonly t: number;
  /** Maximum camber over chord, and where it sits. */
  readonly m: number;
  readonly p: number;
  /** Where the camber line's formula changes, the one place its slope has a kink (0 when it has none). */
  readonly kink: number;
  /** Design lift coefficient, for a five-digit section. */
  readonly cli?: number;
  readonly reflex?: boolean;
  camber(x: number): number;
  slope(x: number): number;
}

const flat = { m: 0, p: 0, kink: 0, camber: () => 0, slope: () => 0 };

/** The four-digit camber line: two parabolas meeting at the point of maximum camber. */
function fourDigitLine(m: number, p: number) {
  if (m === 0) return flat;
  return {
    m,
    p,
    kink: p,
    camber: (x: number) =>
      x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x),
    slope: (x: number) => (x < p ? ((2 * m) / (p * p)) * (p - x) : ((2 * m) / ((1 - p) * (1 - p))) * (p - x)),
  };
}

/** Five-digit constants for a design lift coefficient of 0.3, by the second and third digits. */
const STANDARD: Readonly<Record<number, { r: number; k1: number }>> = {
  1: { r: 0.058, k1: 361.4 },
  2: { r: 0.126, k1: 51.64 },
  3: { r: 0.2025, k1: 15.957 },
  4: { r: 0.29, k1: 6.643 },
  5: { r: 0.391, k1: 3.23 },
};

const REFLEX: Readonly<Record<number, { r: number; k1: number; k21: number }>> = {
  2: { r: 0.13, k1: 51.99, k21: 0.000764 },
  3: { r: 0.217, k1: 15.793, k21: 0.00677 },
  4: { r: 0.318, k1: 6.52, k21: 0.0303 },
  5: { r: 0.441, k1: 3.191, k21: 0.1355 },
};

/** The five-digit camber line, scaled from the tabulated design lift coefficient of 0.3 to `cli`. */
function fiveDigitLine(P: number, reflex: boolean, cli: number) {
  const scale = cli / 0.3;
  if (!reflex) {
    const { r, k1 } = STANDARD[P]!;
    const k = (scale * k1) / 6;
    return {
      kink: r,
      camber: (x: number) => (x < r ? k * (x ** 3 - 3 * r * x * x + r * r * (3 - r) * x) : k * r ** 3 * (1 - x)),
      slope: (x: number) => (x < r ? k * (3 * x * x - 6 * r * x + r * r * (3 - r)) : -k * r ** 3),
    };
  }
  const { r, k1, k21 } = REFLEX[P]!;
  const k = (scale * k1) / 6;
  const tail = k21 * (1 - r) ** 3 + r ** 3;
  return {
    kink: r,
    camber: (x: number) =>
      x < r ? k * ((x - r) ** 3 - tail * x + r ** 3) : k * (k21 * (x - r) ** 3 - tail * x + r ** 3),
    slope: (x: number) => (x < r ? k * (3 * (x - r) ** 2 - tail) : k * (3 * k21 * (x - r) ** 2 - tail)),
  };
}

/** The camber line's highest point, found on a fine grid and polished by a parabola through its neighbors. */
function peak(camber: (x: number) => number): { m: number; p: number } {
  let best = 0;
  let at = 0;
  const n = 2000;
  for (let i = 1; i < n; i += 1) {
    const y = camber(i / n);
    if (y > best) [best, at] = [y, i];
  }
  if (at === 0) return { m: 0, p: 0 };
  const [a, b, c] = [camber((at - 1) / n), best, camber((at + 1) / n)];
  const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
  return { m: b - 0.25 * (a - c) * shift, p: (at + shift) / n };
}

const thicknessRange = (t: number) => {
  if (!(t >= 0 && t <= 0.4)) throw new AeroError('thicknessRange');
};

/** A section from its NACA designation, such as "2412", "NACA 23012", or "23112" (reflexed). */
export function parseNaca(text: string): Section {
  const digits = text.replace(/naca/i, '').replace(/[\s-]/g, '');
  if (!/^\d{4}$|^\d{5}$/.test(digits)) throw new AeroError('nacaCode', { code: text.trim() });
  const d = [...digits].map(Number);
  const name = `NACA ${digits}`;
  if (digits.length === 4) {
    const m = d[0]! / 100;
    const p = d[1]! / 10;
    const t = (10 * d[2]! + d[3]!) / 100;
    if (m > 0 && p === 0) throw new AeroError('camberAtNose');
    if (m === 0 && p > 0) throw new AeroError('positionWithoutCamber');
    thicknessRange(t);
    return { name, family: 'four', t, ...fourDigitLine(m, p) };
  }
  const [L, P, Q] = [d[0]!, d[1]!, d[2]!];
  const t = (10 * d[3]! + d[4]!) / 100;
  if (L === 0) throw new AeroError('fiveDigitLift');
  if (Q > 1 || P < 1 || P > 5 || (Q === 1 && P === 1))
    throw new AeroError('fiveDigitLine', { code: digits.slice(0, 3) });
  thicknessRange(t);
  const cli = 0.15 * L;
  const line = fiveDigitLine(P, Q === 1, cli);
  return { name, family: 'five', t, cli, reflex: Q === 1, ...line, ...peak(line.camber) };
}

/** A four-digit-style section from typed fractions of the chord. */
export function customSection(m: number, p: number, t: number): Section {
  finite(m, 'm');
  finite(p, 'p');
  finite(t, 't');
  if (!(m >= 0 && m <= 0.1)) throw new AeroError('camberRange');
  if (m > 0 && !(p > 0 && p < 1)) throw new AeroError('positionRange');
  thicknessRange(t);
  return { name: `m = ${m}, p = ${p}, t = ${t}`, family: 'custom', t, ...fourDigitLine(m, m > 0 ? p : 0) };
}

/** Half thickness over chord at x/c; a closed trailing edge changes the last coefficient so y_t(1) = 0. */
export function halfThickness(x: number, t: number, closed: boolean): number {
  const a4 = closed ? -0.1036 : -0.1015;
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 + a4 * x ** 4);
}

export interface SurfacePoint {
  readonly x: number;
  readonly xU: number;
  readonly yU: number;
  readonly xL: number;
  readonly yL: number;
}

/** The upper and lower surface points at x/c, with the thickness laid off normal to the camber line. */
export function surfaceAt(section: Section, x: number, closed: boolean): SurfacePoint {
  const yt = halfThickness(x, section.t, closed);
  const theta = Math.atan(section.slope(x));
  const yc = section.camber(x);
  const [s, c] = [Math.sin(theta), Math.cos(theta)];
  return { x, xU: x - yt * s, yU: yc + yt * c, xL: x + yt * s, yL: yc - yt * c };
}

/**
 * Panel nodes with cosine spacing: from the trailing edge along the lower surface to the nose, then back along the
 * upper surface (clockwise), `panels` panels in all.
 */
export function panelNodes(section: Section, panels: number, closed: boolean): { X: number[]; Y: number[] } {
  const half = panels / 2;
  const points = Array.from({ length: half + 1 }, (_, i) =>
    surfaceAt(section, 0.5 * (1 - Math.cos((Math.PI * i) / half)), closed),
  );
  const lower = [...points].reverse();
  const upper = points.slice(1);
  return {
    X: [...lower.map((q) => q.xL), ...upper.map((q) => q.xU)],
    Y: [...lower.map((q) => q.yL), ...upper.map((q) => q.yU)],
  };
}

/** The stations NACA reports tabulate coordinates at. */
export const STATIONS = [
  0, 0.0125, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1,
] as const;
