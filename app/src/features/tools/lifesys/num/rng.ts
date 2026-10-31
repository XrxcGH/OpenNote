// A seeded random number generator (mulberry32), so every simulation, rarefaction curve and random layout in the
// kit comes back the same for the same seed on any device. The seed is always shown next to the result.

export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number in [0, n). */
  int(n: number): number;
  /** A standard normal draw (Box-Muller). */
  normal(): number;
  /** Shuffles a copy of the list (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

/** A generator for a whole-number seed; the same seed gives the same stream. */
export function createRng(seed: number): Rng {
  let state = Math.trunc(seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    normal() {
      let u = next();
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
