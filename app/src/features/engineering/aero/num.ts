// Two small numerical helpers the aerospace tools need and the math feature does not export: level curves of a
// sampled grid (marching squares) and the complex roots of a real polynomial (Durand-Kerner, then Newton polishing).

export interface Grid2 {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** z[j][i] is the value at (xs[i], ys[j]); NaN where it is not defined. */
  readonly z: readonly (readonly number[])[];
}

export interface LevelCurve {
  readonly level: number;
  /** Segments as [x1, y1, x2, y2]. */
  readonly segments: readonly (readonly [number, number, number, number])[];
}

/** Marching squares: each grid cell a level crosses gives one or two short segments between edge crossings. */
export function levelCurves(grid: Grid2, levels: readonly number[]): LevelCurve[] {
  const { xs, ys, z } = grid;
  return levels.map((level) => {
    const segments: [number, number, number, number][] = [];
    for (let j = 0; j + 1 < ys.length; j += 1) {
      for (let i = 0; i + 1 < xs.length; i += 1) {
        const corners: [number, number, number][] = [
          [xs[i]!, ys[j]!, z[j]![i]!],
          [xs[i + 1]!, ys[j]!, z[j]![i + 1]!],
          [xs[i + 1]!, ys[j + 1]!, z[j + 1]![i + 1]!],
          [xs[i]!, ys[j + 1]!, z[j + 1]![i]!],
        ];
        if (corners.some((c) => !Number.isFinite(c[2]))) continue;
        const hits: [number, number][] = [];
        for (let k = 0; k < 4; k += 1) {
          const a = corners[k]!;
          const b = corners[(k + 1) % 4]!;
          const da = a[2] - level;
          const db = b[2] - level;
          if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
            const f = da / (da - db);
            hits.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
          }
        }
        if (hits.length === 2) segments.push([hits[0]![0], hits[0]![1], hits[1]![0], hits[1]![1]]);
        else if (hits.length === 4) {
          segments.push([hits[0]![0], hits[0]![1], hits[1]![0], hits[1]![1]]);
          segments.push([hits[2]![0], hits[2]![1], hits[3]![0], hits[3]![1]]);
        }
      }
    }
    return { level, segments };
  });
}

export interface Complex {
  readonly re: number;
  readonly im: number;
}

/** Roots of c[0] s^n + c[1] s^(n-1) + ... + c[n], highest power first. Pairs come out conjugate. */
export function polyRoots(coefficients: readonly number[]): Complex[] {
  const lead = coefficients[0]!;
  if (lead === 0) throw new Error('leading coefficient is zero');
  const a = coefficients.map((c) => c / lead);
  const n = a.length - 1;
  const evalAt = (zr: number, zi: number, coef: readonly number[]): [number, number] => {
    let pr = 0;
    let pi = 0;
    for (const c of coef) {
      const nr = pr * zr - pi * zi + c;
      pi = pr * zi + pi * zr;
      pr = nr;
    }
    return [pr, pi];
  };
  const radius = 1 + Math.max(...a.slice(1).map(Math.abs));
  let z: [number, number][] = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4;
    return [0.5 * radius * Math.cos(angle), 0.5 * radius * Math.sin(angle)];
  });
  for (let iteration = 0; iteration < 3000; iteration += 1) {
    let moved = 0;
    z = z.map(([zr, zi], i) => {
      const [pr, pi] = evalAt(zr, zi, a);
      let dr = 1;
      let di = 0;
      z.forEach(([wr, wi], j) => {
        if (j === i) return;
        const xr = zr - wr;
        const xi = zi - wi;
        [dr, di] = [dr * xr - di * xi, dr * xi + di * xr];
      });
      const den = dr * dr + di * di;
      const qr = (pr * dr + pi * di) / den;
      const qi = (pi * dr - pr * di) / den;
      moved = Math.max(moved, Math.hypot(qr, qi));
      return Number.isFinite(qr) && Number.isFinite(qi) ? [zr - qr, zi - qi] : [zr + 1e-3, zi + 1e-3];
    });
    if (moved < 1e-15 * radius) break;
  }
  // Newton polishing on the full polynomial, then snap tiny imaginary parts to the real line.
  const d = a.slice(0, n).map((c, k) => c * (n - k));
  return z.map(([zr, zi]) => {
    for (let k = 0; k < 3; k += 1) {
      const [pr, pi] = evalAt(zr, zi, a);
      const [qr, qi] = evalAt(zr, zi, d);
      const den = qr * qr + qi * qi;
      if (den < 1e-300) break;
      zr -= (pr * qr + pi * qi) / den;
      zi -= (pi * qr - pr * qi) / den;
    }
    return { re: zr, im: Math.abs(zi) < 1e-10 * Math.max(1, Math.abs(zr)) ? 0 : zi };
  });
}
