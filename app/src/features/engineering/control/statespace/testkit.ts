// Small independent helpers for the state-space tests, written apart from the kit's polynomial code so the tests do
// not check the engine against itself.
export interface Cx {
  readonly re: number;
  readonly im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });

/** The monic polynomial with the given roots, lowest power first; the imaginary parts must cancel. */
export function polyFromRoots(rs: readonly Cx[]): number[] {
  let re = [1];
  let im = [0];
  for (const r of rs) {
    const nre = new Array<number>(re.length + 1).fill(0);
    const nim = new Array<number>(re.length + 1).fill(0);
    re.forEach((_, i) => {
      // (s − r)(re + i im): shift up by one, then subtract r times the old coefficient.
      nre[i + 1] += re[i];
      nim[i + 1] += im[i];
      nre[i] -= r.re * re[i] - r.im * im[i];
      nim[i] -= r.re * im[i] + r.im * re[i];
    });
    re = nre;
    im = nim;
  }
  if (im.some((x) => Math.abs(x) > 1e-9)) throw new Error('roots are not conjugate-closed');
  return re;
}

/** The product of two polynomials by direct convolution, in whatever order the inputs share. */
export function pmulCheck(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)));
  return out;
}
