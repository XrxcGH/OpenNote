// The seeded random source of a run (DESIGN 4.5), so a test or a debug replay gives the same run. It is Marsaglia's
// xorshift32 generator (shifts 13, 17, 5; "Xorshift RNGs", Journal of Statistical Software 8, 2003). It is fast
// and repeatable, not for secrets. The worker puts it in Math.random, and adapters seed their own runtimes from it.

/** A generator of 32-bit unsigned numbers. Seed 0 would give only zeros, so it becomes 1. */
export function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

export interface SeededRandom {
  /** A number in [0, 1). */
  random(): number;
  /** Fills `bytes` from the same sequence. */
  fill(bytes: Uint8Array): void;
}

export function seeded(seed: number): SeededRandom {
  const next = xorshift32(Math.trunc(seed));
  return {
    random: () => next() / 2 ** 32,
    fill(bytes) {
      for (let at = 0; at < bytes.length; at += 4) {
        const value = next();
        for (let k = 0; k < 4 && at + k < bytes.length; k += 1) bytes[at + k] = (value >>> (8 * k)) & 0xff;
      }
    },
  };
}

/** The randomness hook: Math.random in `scope` gives the seeded sequence from now on. */
export function seedMathRandom(source: SeededRandom, scope: { Math: Math } = globalThis): void {
  Object.defineProperty(scope.Math, 'random', { value: source.random, writable: false, configurable: false });
}
