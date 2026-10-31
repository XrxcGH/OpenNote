// A seeded random number generator, so a bootstrap, a permutation test, a split, or a simulation gives the same
// result for the same seed on any device. It is mulberry32: small, fast, and good enough for resampling; it is not
// for anything secret.

export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** A standard normal draw. */
  normal(): number;
}

export function makeRng(seed: number): Rng {
  let state = (Math.floor(Math.abs(seed)) % 4294967296) >>> 0;
  let spare: number | null = null;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.min(n - 1, Math.floor(next() * n)),
    normal: () => {
      if (spare !== null) {
        const out = spare;
        spare = null;
        return out;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
  };
}

/** A shuffled copy, by Fisher-Yates. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** n indexes drawn with replacement from 0..n-1. */
export const resample = (n: number, rng: Rng): number[] => Array.from({ length: n }, () => rng.int(n));
