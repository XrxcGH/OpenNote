// Finding where a function of one number is zero, for Solve on an equation and for live solving on page lines. It
// scans for sign changes and narrows each by halving, and finds a root the curve only touches (as (x - 1)^2 does) by
// narrowing toward the smallest value. A jump across a gap, as 1/x has at 0, is not taken for a root.

export interface RootOptions {
  /** Looks between -range and range. Default 1000. */
  range?: number;
  /** How many slices the range is scanned in. Default 20,000. */
  steps?: number;
  /** At most this many roots. Default all found. */
  limit?: number;
}

const TOUCH_TOLERANCE = 1e-7;

/** Where `f` crosses or touches zero, smallest first. Never throws: a value that throws counts as no value. */
export function findRoots(fn: (x: number) => number, options: RootOptions = {}): number[] {
  const range = options.range ?? 1000;
  const steps = options.steps ?? 20_000;
  const f = (x: number) => {
    try {
      return fn(x);
    } catch {
      return NaN;
    }
  };
  const found: number[] = [];
  const add = (x: number) => {
    const clean = Math.abs(x) < 1e-12 ? 0 : x;
    if (!found.some((other) => Math.abs(other - clean) < 1e-6 * Math.max(1, Math.abs(clean)))) found.push(clean);
  };
  const step = (2 * range) / steps;
  let previousX = -range;
  let previous = f(previousX);
  let beforePrevious = NaN;
  for (let i = 1; i <= steps && found.length < (options.limit ?? Infinity); i += 1) {
    const x = -range + i * step;
    const value = f(x);
    if (Number.isFinite(previous) && Number.isFinite(value)) {
      if (previous === 0) add(previousX);
      else if (previous * value < 0) {
        let [low, high] = [previousX, x];
        for (let k = 0; k < 80; k += 1) {
          const mid = (low + high) / 2;
          if (f(mid) * f(low) <= 0) high = mid;
          else low = mid;
        }
        const at = (low + high) / 2;
        if (Math.abs(f(at)) < 1e-6 * (1 + Math.abs(previous) + Math.abs(value))) add(at);
      } else if (
        Number.isFinite(beforePrevious) &&
        Math.abs(previous) < Math.abs(beforePrevious) &&
        Math.abs(previous) <= Math.abs(value) &&
        Math.abs(previous) < 1e-4
      ) {
        let [low, high] = [previousX - step, x];
        for (let k = 0; k < 100; k += 1) {
          const a = low + (high - low) / 3;
          const b = high - (high - low) / 3;
          if (Math.abs(f(a)) < Math.abs(f(b))) high = b;
          else low = a;
        }
        const at = (low + high) / 2;
        if (Math.abs(f(at)) < TOUCH_TOLERANCE) add(at);
      }
    }
    beforePrevious = previous;
    previousX = x;
    previous = value;
  }
  if (Number.isFinite(previous) && previous === 0) add(previousX);
  return found.sort((a, b) => a - b);
}

/** A root rounded where it is a whole number or a simple fraction away from one, so 3.9999999999 reads as 4. */
export function tidyRoot(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-7) return rounded === 0 ? 0 : rounded;
  return Number(value.toPrecision(10));
}
