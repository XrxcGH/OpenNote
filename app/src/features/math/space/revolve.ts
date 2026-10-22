// Volumes of solids of revolution: the region between y = f(x) and y = g(x) for a ≤ x ≤ b, turned about a horizontal
// line y = k (disks or washers) or a vertical line x = k (cylindrical shells), with the steps a calculus course
// writes. The integral is worked numerically by adaptive Simpson's rule, and a volume that is a simple fraction of π
// is also given exactly.
import type { ExpressionProblem } from '../grapher/evaluate';
import { compileMulti } from './multivar';
import type { RevolveSpec } from './source3d';

export type RevolveMethod = 'auto' | 'disk' | 'shell';

/** A step of the working: a message id and the values it fills in. The screen words it. */
export interface RevolveStep {
  readonly id:
    | 'diskSetup'
    | 'shellSetup'
    | 'radii'
    | 'shellParts'
    | 'diskFormula'
    | 'shellFormula'
    | 'integral'
    | 'volume'
    | 'exact'
    | 'verticalDisk'
    | 'horizontalShell';
  readonly values: Readonly<Record<string, string>>;
}

export type RevolveResult =
  | {
      readonly ok: true;
      readonly method: 'disk' | 'shell';
      readonly volume: number;
      /** The integral before the factor π (disks) or 2π (shells). */
      readonly integral: number;
      /** The volume as a multiple of π, such as "8π/15", when it is one. */
      readonly exact: string | null;
      readonly steps: readonly RevolveStep[];
    }
  | { readonly ok: false; readonly error: ExpressionProblem };

/** Adaptive Simpson's rule. Accurate to about `tolerance` for smooth integrands, and stops splitting at `depth`. */
export function integrate(f: (x: number) => number, a: number, b: number, tolerance = 1e-11, depth = 48): number {
  const simpson = (fa: number, fm: number, fb: number, width: number) => (width / 6) * (fa + 4 * fm + fb);
  const step = (
    lo: number,
    hi: number,
    flo: number,
    fmid: number,
    fhi: number,
    whole: number,
    eps: number,
    d: number,
  ): number => {
    const mid = (lo + hi) / 2;
    const [lm, rm] = [(lo + mid) / 2, (mid + hi) / 2];
    const [flm, frm] = [f(lm), f(rm)];
    const left = simpson(flo, flm, fmid, mid - lo);
    const right = simpson(fmid, frm, fhi, hi - mid);
    if (d <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
    return step(lo, mid, flo, flm, fmid, left, eps / 2, d - 1) + step(mid, hi, fmid, frm, fhi, right, eps / 2, d - 1);
  };
  // Split the interval first, so a curve with a narrow feature is not missed by the first few points.
  const pieces = 16;
  let sum = 0;
  for (let i = 0; i < pieces; i++) {
    const lo = a + ((b - a) * i) / pieces;
    const hi = a + ((b - a) * (i + 1)) / pieces;
    const [flo, fmid, fhi] = [f(lo), f((lo + hi) / 2), f(hi)];
    sum += step(lo, hi, flo, fmid, fhi, simpson(flo, fmid, fhi, hi - lo), tolerance / pieces, depth);
  }
  return sum;
}

/** The fraction p/q nearest `value` with q up to `limit`, by continued fractions, or null when none is that close. */
export function nearFraction(value: number, limit = 400, tolerance = 1e-8): [number, number] | null {
  if (!Number.isFinite(value)) return null;
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  let x = value;
  for (let i = 0; i < 32; i++) {
    const a = Math.floor(x);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > limit) return null;
    if (Math.abs(h1 / k1 - value) <= tolerance * Math.max(1, Math.abs(value))) return [h1, k1];
    const rest = x - a;
    if (rest < 1e-15) break;
    x = 1 / rest;
  }
  return Math.abs(h1 / k1 - value) <= tolerance * Math.max(1, Math.abs(value)) ? [h1, k1] : null;
}

/** A multiple of π as text: "8π", "8π/15", "π/2". */
export function piText([p, q]: [number, number]): string {
  if (p === 0) return '0';
  const top = p === 1 ? 'π' : p === -1 ? '−π' : `${p}π`;
  return q === 1 ? top : `${top}/${q}`;
}

const show = (value: number) => String(Number(value.toPrecision(8)));

/** The volume of the solid, with the working. */
export function revolveVolume(
  spec: RevolveSpec,
  method: RevolveMethod = 'auto',
  params: Record<string, number> = {},
): RevolveResult {
  const names = Object.keys(params);
  const outer = compileMulti(spec.outer, ['x'], names);
  if (!outer.ok) return outer;
  const inner = compileMulti(spec.inner, ['x'], names);
  if (!inner.ok) return inner;
  const f = (x: number) => outer.expression.evaluate({ ...params, x });
  const g = (x: number) => inner.expression.evaluate({ ...params, x });
  const k = spec.axis.at;
  const [a, b] = [show(spec.from), show(spec.to)];
  const steps: RevolveStep[] = [];
  const natural = spec.axis.kind === 'y' ? 'disk' : 'shell';
  const used = natural;
  if (method !== 'auto' && method !== natural)
    steps.push({ id: natural === 'shell' ? 'verticalDisk' : 'horizontalShell', values: {} });

  let integral: number;
  if (used === 'disk') {
    // Washers: the region may straddle the axis, in which case the solid is full there (inner radius 0).
    const integrand = (x: number) => {
      const [p, q] = [f(x) - k, g(x) - k];
      const outerR = Math.max(Math.abs(p), Math.abs(q));
      const innerR = p * q <= 0 ? 0 : Math.min(Math.abs(p), Math.abs(q));
      return outerR * outerR - innerR * innerR;
    };
    integral = integrate(integrand, spec.from, spec.to);
    const shift = (text: string) => (k === 0 ? text : `(${text}) − ${show(k)}`);
    steps.push({ id: 'diskSetup', values: { k: show(k) } });
    steps.push({ id: 'radii', values: { outer: shift(spec.outer), inner: shift(spec.inner) } });
    steps.push({ id: 'diskFormula', values: { a, b } });
  } else {
    integral = integrate((x) => Math.abs(x - k) * Math.abs(f(x) - g(x)), spec.from, spec.to);
    steps.push({ id: 'shellSetup', values: { k: show(k) } });
    const radius = k === 0 ? 'x' : `x − ${show(k)}`;
    const height = spec.inner.trim() === '0' ? spec.outer : `(${spec.outer}) − (${spec.inner})`;
    steps.push({ id: 'shellParts', values: { radius, height } });
    steps.push({ id: 'shellFormula', values: { a, b } });
  }
  if (!Number.isFinite(integral)) {
    return {
      ok: false,
      error: { message: 'The curves are not defined over the whole interval.', position: 0, length: 1 },
    };
  }
  const factor = used === 'disk' ? Math.PI : 2 * Math.PI;
  const volume = factor * integral;
  steps.push({ id: 'integral', values: { integral: show(integral) } });
  steps.push({
    id: 'volume',
    values: { factor: used === 'disk' ? 'π' : '2π', integral: show(integral), volume: show(volume) },
  });
  const fraction = nearFraction(volume / Math.PI);
  const exact = fraction ? piText(fraction) : null;
  if (fraction && exact) {
    steps.push({
      id: 'exact',
      values: { ratio: fraction[1] === 1 ? `${fraction[0]}` : `${fraction[0]}/${fraction[1]}`, exact },
    });
  }
  return { ok: true, method: used, volume, integral, exact, steps };
}
