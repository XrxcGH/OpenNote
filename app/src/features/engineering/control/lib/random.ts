// A seeded random number generator, so a simulation gives the same paths every time it runs with the same seed:
// xoshiro128** (Blackman and Vigna), seeded by SplitMix32, with normal draws by the Box-Muller transform.

export interface Random {
  /** A uniform number in [0, 1). */
  uniform(): number;
  /** A standard normal number. */
  normal(): number;
}

/** SplitMix32: spreads one seed over the four words of the state. */
function splitMix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function seeded(seed: number): Random {
  const mix = splitMix32(Math.trunc(seed));
  const s = [mix(), mix(), mix(), mix()];
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) s[0] = 1;
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  };
  let spare: number | null = null;
  const uniform = () => next() / 4294967296;
  return {
    uniform,
    normal() {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      // 1 − u is in (0, 1], so the logarithm is finite.
      const r = Math.sqrt(-2 * Math.log(1 - uniform()));
      const theta = 2 * Math.PI * uniform();
      spare = r * Math.sin(theta);
      return r * Math.cos(theta);
    },
  };
}
