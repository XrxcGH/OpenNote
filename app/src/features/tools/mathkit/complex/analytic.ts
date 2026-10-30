// Analytic functions and Laurent series: the Cauchy-Riemann equations checked on a grid by central differences, and the
// Laurent coefficients on a circle by the trapezoid rule, which is exact up to rounding for a function analytic on an
// annulus around the circle.
import { fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import { ZERO, abs, add, c, evaluateTree, formatC, latexC, mul, readComplex, scale, sub, type C } from './cmath';

export interface CauchyRiemannRow {
  x: number;
  y: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** Whether u_x = v_y and u_y = -v_x here, to the accuracy of the differences. */
  holds: boolean;
}

export interface CauchyRiemannResult {
  rows: CauchyRiemannRow[];
  /** Every defined grid point satisfies the equations. */
  analytic: boolean;
  /** f'(z) = u_x + i v_x at the middle of the grid, when the equations hold there. */
  derivative: C | null;
  steps: KitStep[];
}

/** u + iv = f(x + iy); u_x, u_y, v_x, v_y on an n by n grid in the box, and where the equations hold. */
export function cauchyRiemann(text: string, box: readonly number[], n = 5): CauchyRiemannResult {
  if (box.length !== 4 || !(box[0] < box[1]) || !(box[2] < box[3])) throw new KitError('badRegion');
  const tree = readComplex(text, ['z']);
  const f = (x: number, y: number) => evaluateTree(tree, { z: c(x, y) });
  const [x0, x1, y0, y1] = box;
  const rows: CauchyRiemannRow[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      const y = y0 + ((y1 - y0) * (j + 0.5)) / n;
      const h = 1e-5 * (1 + Math.hypot(x, y));
      const dx = sub(f(x + h, y), f(x - h, y));
      const dy = sub(f(x, y + h), f(x, y - h));
      const [ux, vx, uy, vy] = [dx.re / (2 * h), dx.im / (2 * h), dy.re / (2 * h), dy.im / (2 * h)];
      if (![ux, uy, vx, vy].every(Number.isFinite)) continue;
      const size = 1 + Math.abs(ux) + Math.abs(uy) + Math.abs(vx) + Math.abs(vy);
      const holds = Math.abs(ux - vy) < 1e-6 * size && Math.abs(uy + vx) < 1e-6 * size;
      rows.push({ x, y, ux, uy, vx, vy, holds });
    }
  }
  if (rows.length === 0) throw new KitError('undefinedValue', text);
  const analytic = rows.every((r) => r.holds);
  const middle = rows.reduce(
    (best, r) => {
      const d = Math.hypot(r.x - (x0 + x1) / 2, r.y - (y0 + y1) / 2);
      return d < best.d ? { d, r } : best;
    },
    { d: Infinity, r: rows[0] },
  ).r;
  const derivative = middle.holds ? c(middle.ux, middle.vx) : null;
  const steps: KitStep[] = [
    step('cxCRSetup', `f(x+iy)=u(x,y)+i\\,v(x,y),\\quad f(z)=${text}`),
    step('cxCREquations', 'u_x=v_y,\\qquad u_y=-v_x'),
    step('cxCRGrid', undefined, { n: String(rows.length) }),
    step(analytic ? 'cxCRHold' : 'cxCRFail', undefined, {
      held: String(rows.filter((r) => r.holds).length),
      n: String(rows.length),
    }),
  ];
  if (derivative) {
    steps.push(
      step('cxCRDerivative', `f'(z)=u_x+i\\,v_x=${latexC(derivative, 8)}`, {
        at: formatC(c(middle.x, middle.y), 4),
        value: formatC(derivative, 8),
      }),
    );
  }
  return { rows, analytic, derivative, steps };
}

export interface LaurentResult {
  /** The coefficients a_k for k = -order .. order. */
  coefficients: { k: number; a: C }[];
  /** The principal part (the negative powers) as LaTeX, or '0'. */
  principal: string;
  /** The series as LaTeX, to the order asked for. */
  series: string;
  residue: C;
  /** False when the coefficients differ between two nearby circles: a singularity lies between them. */
  steady: boolean;
  steps: KitStep[];
}

const SAMPLES = 512;

function laurentAt(f: (z: C) => C, center: C, radius: number, order: number): C[] {
  const values: C[] = [];
  for (let m = 0; m < SAMPLES; m++) {
    const angle = (2 * Math.PI * m) / SAMPLES;
    const w = c(Math.cos(angle), Math.sin(angle));
    values.push(f(add(center, scale(w, radius))));
  }
  const out: C[] = [];
  for (let k = -order; k <= order; k++) {
    // a_k = (1 / 2 pi) integral of f(z0 + r e^{it}) (r e^{it})^(-k) dt, a mean over equally spaced points.
    let total = ZERO;
    for (let m = 0; m < SAMPLES; m++) {
      const angle = (-2 * Math.PI * m * k) / SAMPLES;
      total = add(total, mul(values[m], c(Math.cos(angle), Math.sin(angle))));
    }
    out.push(scale(total, 1 / (SAMPLES * radius ** k)));
  }
  return out;
}

const clean = (a: C): C => c(Math.abs(a.re) < 1e-10 ? 0 : a.re, Math.abs(a.im) < 1e-10 ? 0 : a.im);

/** The Laurent coefficients a_k, k from -order to order, of f about `center`, on the circle |z - center| = radius. */
export function laurent(text: string, centerText: string, radius: number, order: number): LaurentResult {
  if (!(radius > 0)) throw new KitError('badContour');
  if (!Number.isInteger(order) || order < 1 || order > 20) throw new KitError('badOrder');
  const center = evaluateTree(readComplex(centerText, []), {});
  if (!Number.isFinite(center.re) || !Number.isFinite(center.im)) throw new KitError('unreadable', centerText);
  const tree = readComplex(text, ['z']);
  const f = (z: C) => evaluateTree(tree, { z });
  if (!Number.isFinite(f(add(center, c(radius))).re)) throw new KitError('undefinedValue', text);
  const a = laurentAt(f, center, radius, order).map(clean);
  const b = laurentAt(f, center, radius * 0.9, order);
  // Inside one annulus of analyticity the coefficients do not depend on the radius.
  const steady = a.every((v, i) => abs(sub(v, b[i])) < 1e-7 * (1 + abs(v)));
  const coefficients = a.map((v, i) => ({ k: i - order, a: v }));
  const shift = center.re === 0 && center.im === 0 ? 'z' : `(z-${formatC(center, 4)})`;
  const term = (k: number, v: C) => {
    const coefficient = v.im === 0 ? fmt(v.re, 8) : `\\left(${latexC(v, 8)}\\right)`;
    return `${coefficient}${k === 0 ? '' : `${shift}^{${k}}`}`;
  };
  const live = coefficients.filter((p) => abs(p.a) > 1e-9);
  const join = (items: { k: number; a: C }[]) =>
    items.length
      ? items
          .map((p) => term(p.k, p.a))
          .join('+')
          .replace(/\+-/g, '-')
      : '0';
  const principal = join(live.filter((p) => p.k < 0));
  const series = `${join(live)}+\\cdots`;
  const residue = a[order - 1];
  const steps: KitStep[] = [
    step('cxLaurentSetup', `f(z)=${text}=\\sum_{k=-\\infty}^{\\infty} a_k (z-z_0)^k`, {
      center: formatC(center, 6),
      radius: fmt(radius, 6),
    }),
    step('cxLaurentFormula', 'a_k=\\frac{1}{2\\pi i}\\oint \\frac{f(z)}{(z-z_0)^{k+1}}\\,dz'),
    step('cxLaurentPrincipal', `\\text{principal part}=${principal}`),
    step('cxLaurentResidue', `\\operatorname{Res}=a_{-1}=${latexC(residue, 10)}`, { residue: formatC(residue, 10) }),
  ];
  if (!steady) steps.push(step('cxLaurentUnsteady'));
  return { coefficients, principal, series, residue, steady, steps };
}
