// A plan view of a Gaussian plume: the ground-level concentration over distance downwind (x) and crosswind (y),
// sampled on a grid with the Briggs sigmas at each x, and drawn as level curves at fixed fractions of the map's peak.
import '../text';
import { t } from '../../../../strings/t';
import { contourSegments } from '../core/contour';
import type { Grid } from '../core/contour';
import { fmt } from '../core/format';
import type { Figure, Mark, Role } from '../core/figure';
import { linePlot } from '../core/plot';
import { plume, sigmas } from './quality';
import type { Stability } from './quality';

export interface PlumeMapInput {
  q: number;
  u: number;
  stability: Stability;
  urban: boolean;
  /** Effective height at a distance downwind, so a rising plume can be mapped. */
  heightAt: (x: number) => number;
  /** The far edge of the map downwind, in m. */
  xMax: number;
  nx?: number;
  ny?: number;
}

/** Ground-level concentration (g/m³) on a grid: x from just past the source to xMax, y across ±3σy at xMax. */
export function plumeGrid(input: PlumeMapInput): Grid & { yMax: number } {
  const nx = input.nx ?? 60;
  const ny = input.ny ?? 41;
  const yMax = 3 * sigmas(input.stability, input.xMax, input.urban).sy;
  const xs = Array.from({ length: nx }, (_, i) => (input.xMax * (i + 1)) / nx);
  const ys = Array.from({ length: ny }, (_, j) => -yMax + (2 * yMax * j) / (ny - 1));
  const z = ys.map((y) =>
    xs.map((x) => {
      const s = sigmas(input.stability, x, input.urban);
      return plume(input.q, input.u, s.sy, s.sz, input.heightAt(x), y, 0);
    }),
  );
  return { xs, ys, z, yMax };
}

const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
const ROLES: readonly Role[] = ['s0', 's1', 's2', 's3', 's4'];

/** The map as a figure, with one legend entry per level in µg/m³. */
export function plumeMapFigure(input: PlumeMapInput): Figure {
  const grid = plumeGrid(input);
  let peak = 0;
  let peakX = grid.xs[0];
  grid.z.forEach((row) =>
    row.forEach((v, i) => {
      if (v > peak) {
        peak = v;
        peakX = grid.xs[i];
      }
    }),
  );
  const levels = FRACTIONS.map((f) => f * peak);
  const curves = peak > 0 ? levels.map((level) => contourSegments(grid, level)) : [];
  return linePlot({
    title: t('kitEarth.air.plot.mapTitle'),
    description: t('kitEarth.air.plot.mapText', {
      stability: input.stability,
      peak: fmt(peak * 1e9, 4),
      x: fmt(peakX, 4),
    }),
    xLabel: t('kitEarth.air.plot.downwind'),
    yLabel: t('kitEarth.air.plot.crosswind'),
    x: [0, input.xMax],
    y: [-grid.yMax, grid.yMax],
    height: 260,
    series: FRACTIONS.map((f, i) => ({
      points: [],
      role: ROLES[i],
      label: t('kitEarth.air.plot.level', { pct: f * 100, value: fmt(levels[i] * 1e9, 3) }),
    })),
    extra: (sx, sy) =>
      curves.map((curve, i): Mark => ({
        kind: 'path',
        d: curve
          .map(
            ([x1, y1, x2, y2]) =>
              `M${sx(x1).toFixed(1)} ${sy(y1).toFixed(1)}L${sx(x2).toFixed(1)} ${sy(y2).toFixed(1)}`,
          )
          .join(''),
        role: ROLES[i],
        width: 1.5,
      })),
  });
}
