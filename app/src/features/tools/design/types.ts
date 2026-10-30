// Shared shapes for the design kit's engines. An engine is pure: values in, a result with working steps out.

/** One line of worked steps: a key naming the step and the LaTeX of it with the numbers filled in. */
export interface Step {
  key: string;
  latex: string;
}

/** An error an engine returns for impossible input, as a key the UI turns into a sentence. */
export interface Problem {
  ok: false;
  problem: string;
}

export type Outcome<T> = (T & { ok: true }) | Problem;

export const bad = (problem: string): Problem => ({ ok: false, problem });

/** True when every value is a finite number. */
export const finite = (...v: number[]): boolean => v.every((x) => Number.isFinite(x));

function trim(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Formats a number for LaTeX with up to `sig` significant figures and no trailing zeros. */
export function fmt(x: number, sig = 6): string {
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e9 || a < 1e-4) {
    const [m, e] = x.toExponential(sig - 1).split('e');
    return `${trim(m ?? '0')}\\times 10^{${Number(e)}}`;
  }
  return trim(x.toPrecision(sig));
}
