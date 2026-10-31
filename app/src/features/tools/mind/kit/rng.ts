// A seeded random source for simulations, so the same seed gives the same run on any device. It is the
// mulberry32 generator: 32 bits of state, fast, and plenty for teaching simulations (it is not for cryptography).

export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** A standard normal draw, by the Box-Muller method. */
  normal(): number;
  /** A whole number from 0 to n - 1. */
  int(n: number): number;
  /** The number of successes in n trials with chance p each. */
  binomial(n: number, p: number): number;
  /** A draw from the beta distribution with both shapes above 0. */
  beta(a: number, b: number): number;
}

export function makeRng(seed: number): Rng {
  let state = Math.floor(Math.abs(seed)) >>> 0 || 0x9e3779b9;
  let spare: number | null = null;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = next();
    while (u === 0) u = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * next();
    spare = r * Math.sin(angle);
    return r * Math.cos(angle);
  };
  const gamma = (shape: number): number => {
    // Marsaglia and Tsang, with the boost for shapes below 1.
    if (shape < 1) return gamma(shape + 1) * next() ** (1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = normal();
      const v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      const u = next();
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  };
  return {
    next,
    normal,
    int: (n) => Math.min(n - 1, Math.floor(next() * n)),
    binomial: (n, p) => {
      let k = 0;
      for (let i = 0; i < n; i += 1) if (next() < p) k += 1;
      return k;
    },
    beta: (a, b) => {
      const x = gamma(a);
      return x / (x + gamma(b));
    },
  };
}
