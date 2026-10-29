// A worked step: a message key under solvers.step in the strings, the values it names, and the math it shows. The
// engines never write sentences, so every step reads in the interface's language.
import type { en } from '../../../strings/en';

export type StepKey = keyof (typeof en)['solvers']['step'];

export interface Step {
  readonly key: StepKey;
  readonly vars?: Readonly<Record<string, string>>;
  /** The math line under the words, as plain text. */
  readonly math?: string;
}

export const step = (key: StepKey, math?: string, vars?: Record<string, string>): Step => ({
  key,
  ...(math === undefined ? {} : { math }),
  ...(vars ? { vars } : {}),
});

/** A point on a plot, in the plot's own coordinates. */
export interface XY {
  readonly x: number;
  readonly y: number;
}

/** Samples f over [a, b]. Where it is not finite or too large to draw, y is NaN, and a plot breaks the line there. */
export function samples(f: (x: number) => number, a: number, b: number, count = 200, clip = 1e6): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= count; i += 1) {
    const x = a + ((b - a) * i) / count;
    const y = f(x);
    out.push({ x, y: Number.isFinite(y) && Math.abs(y) <= clip ? y : NaN });
  }
  return out;
}
