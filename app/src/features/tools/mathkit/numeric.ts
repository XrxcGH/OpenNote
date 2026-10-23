// Small numerical tools the kit's engines share: Gauss-Legendre rules, a quadrature that doubles its panels until
// two answers agree, number text, and recognizing a nice closed form for a number.

const cache = new Map<number, { x: number[]; w: number[] }>();

/** The nodes and weights of the n-point Gauss-Legendre rule on [-1, 1]. */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const hit = cache.get(n);
  if (hit) return hit;
  const x: number[] = new Array<number>(n);
  const w: number[] = new Array<number>(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 1;
    for (let iteration = 0; iteration < 100; iteration++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const next = z - p1 / dp;
      if (Math.abs(next - z) < 1e-16) {
        z = next;
        break;
      }
      z = next;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * dp * dp);
    w[n - 1 - i] = w[i];
  }
  const rule = { x, w };
  cache.set(n, rule);
  return rule;
}

/** One panel of the n-point rule on [a, b]. */
export function glPanel(f: (x: number) => number, a: number, b: number, n = 10): number {
  const { x, w } = gaussLegendre(n);
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += w[i] * f(mid + half * x[i]);
  return sum * half;
}

/** The integral of f from a to b: panels double until two answers agree to `tol` (relative to the size). */
export function integrate(f: (x: number) => number, a: number, b: number, tol = 1e-12): number {
  if (a === b) return 0;
  let previous = glPanel(f, a, b);
  for (let panels = 2; panels <= 2048; panels *= 2) {
    let total = 0;
    const h = (b - a) / panels;
    for (let k = 0; k < panels; k++) total += glPanel(f, a + k * h, a + (k + 1) * h);
    if (Number.isFinite(total) && Math.abs(total - previous) <= tol * Math.max(1, Math.abs(total))) return total;
    previous = total;
  }
  return previous;
}

/** A number as text with up to `digits` significant figures and no trailing zeros. */
export function fmt(value: number, digits = 8): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'undefined' : value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs < 1e-4 || abs >= 1e9) {
    const [m, e] = value.toExponential(Math.max(0, digits - 1)).split('e');
    return `${m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m}e${Number(e)}`.replace('-', '−');
  }
  const text = Number(value.toPrecision(digits)).toString();
  return text.replace('-', '−');
}

/** Whether two numbers agree to a relative tolerance. */
export const close = (a: number, b: number, tol = 1e-9): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** The simplest fraction p/q (q up to `maxDen`) within `tol` of the value, or null. */
export function toFraction(value: number, maxDen = 60, tol = 1e-9): [number, number] | null {
  if (!Number.isFinite(value)) return null;
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(value * q);
    if (Math.abs(value - p / q) <= tol * Math.max(1, Math.abs(value))) return [p, q];
  }
  return null;
}

/** A known closed form for a positive number, as LaTeX, or null. */
export function closedForm(value: number, tol = 1e-8): string | null {
  const known: [number, string][] = [
    [Math.PI, '\\pi'],
    [Math.PI * Math.PI, '\\pi^{2}'],
    [Math.E, 'e'],
    [Math.LN2, '\\ln 2'],
    [Math.sqrt(2), '\\sqrt{2}'],
    [Math.sqrt(3), '\\sqrt{3}'],
    [Math.sqrt(Math.PI), '\\sqrt{\\pi}'],
    [Math.log(3), '\\ln 3'],
    [Math.PI / Math.sqrt(3), '\\pi/\\sqrt{3}'],
  ];
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  const direct = toFraction(v, 60, tol);
  if (direct) return `${sign}${direct[1] === 1 ? direct[0] : `\\frac{${direct[0]}}{${direct[1]}}`}`;
  for (const [base, tex] of known) {
    const ratio = toFraction(v / base, 48, tol);
    if (ratio && ratio[0] !== 0) {
      const [p, q] = ratio;
      const top = p === 1 ? tex : `${p}${tex.startsWith('\\') || /[a-z]/i.test(tex) ? ' ' : ''}${tex}`;
      return `${sign}${q === 1 ? top : `\\frac{${top}}{${q}}`}`;
    }
  }
  return null;
}

/** The limit of a sequence u(n) as n grows, by Richardson extrapolation in 1/n on n, 2n, 4n, 8n. */
export function sequenceLimit(u: (n: number) => number, from = 64): number {
  const t1 = [u(from), u(from * 2), u(from * 4), u(from * 8)];
  if (!t1.every(Number.isFinite)) return NaN;
  let row = t1;
  let factor = 2;
  for (let level = 0; level < 3; level++) {
    row = row.slice(1).map((v, i) => (factor * v - row[i]) / (factor - 1));
    factor *= 2;
  }
  return row[0];
}
