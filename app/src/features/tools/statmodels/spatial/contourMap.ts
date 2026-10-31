// A contour map of an interpolated surface: level curves by marching squares, each labeled with its value, over
// axes in the data's coordinates, with the data points marked. Each grid cell a level crosses gives a short segment
// between the crossings on its edges, found by linear interpolation along the edge; a saddle cell (the level
// crossing all 4 edges) joins the corners the cell's center value sides with.
import { numberText } from '../kit/format';
import { escapeXml, frame, marker, svg, ticks, type DrawContext } from '../kit/picture';
import type { Point } from './engine';

export interface MapGrid {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** `z[j][i]` is the value at (xs[i], ys[j]). */
  readonly z: readonly (readonly number[])[];
}

export type Segment = readonly [number, number, number, number];

/** Round levels strictly inside the grid's range, about 5 of them. */
export function mapLevels(z: readonly (readonly number[])[]): number[] {
  const all = z.flat().filter(Number.isFinite);
  if (all.length === 0) return [];
  const [lo, hi] = [Math.min(...all), Math.max(...all)];
  if (!(hi > lo)) return [];
  return ticks(lo, hi).filter((t) => t > lo && t < hi);
}

/** The segments [x1, y1, x2, y2] of the level curve z = level. */
export function levelSegments(grid: MapGrid, level: number): Segment[] {
  const { xs, ys, z } = grid;
  const out: Segment[] = [];
  const cross = (a: number, b: number, za: number, zb: number) => a + ((level - za) / (zb - za)) * (b - a);
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const c = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]];
      if (!c.every(Number.isFinite)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      // Edges in order: bottom, right, top, left.
      const edges: [number, number, number, number, number, number][] = [
        [c[0], c[1], x0, y0, x1, y0],
        [c[1], c[2], x1, y0, x1, y1],
        [c[2], c[3], x1, y1, x0, y1],
        [c[3], c[0], x0, y1, x0, y0],
      ];
      const hits: [number, number][] = [];
      for (const [za, zb, ax, ay, bx, by] of edges) {
        if (za < level === zb < level) continue;
        hits.push([cross(ax, bx, za, zb), cross(ay, by, za, zb)]);
      }
      if (hits.length === 2) out.push([...hits[0], ...hits[1]]);
      else if (hits.length === 4) {
        const center = (c[0] + c[1] + c[2] + c[3]) / 4;
        const pairs = center < level === c[0] < level ? [0, 1, 2, 3] : [0, 3, 1, 2];
        out.push([...hits[pairs[0]], ...hits[pairs[1]]], [...hits[pairs[2]], ...hits[pairs[3]]]);
      }
    }
  }
  return out;
}

const levelCurves = (grid: MapGrid, levels: readonly number[]) =>
  levels.map((level) => ({ level, segments: levelSegments(grid, level) }));

/** Draws the map; `labels` are the plot strings' ids for the axes. */
export function contourMap(grid: MapGrid, points: readonly Point[], labels: { x: string; y: string }) {
  return (ctx: DrawContext): string => {
    const p = ctx.palette;
    const say = (id: string) => ctx.say(`${ctx.prefix}.plot.${id}`);
    const xr = [grid.xs[0], grid.xs[grid.xs.length - 1]] as const;
    const yr = [grid.ys[0], grid.ys[grid.ys.length - 1]] as const;
    const f = frame(xr, yr, { x: say(labels.x), y: say(labels.y) }, p);
    const parts = [...f.parts];
    for (const curve of levelCurves(grid, mapLevels(grid.z))) {
      if (curve.segments.length === 0) continue;
      const d = curve.segments
        .map(
          ([x1, y1, x2, y2]) =>
            `M${f.px(x1).toFixed(1)} ${f.py(y1).toFixed(1)}L${f.px(x2).toFixed(1)} ${f.py(y2).toFixed(1)}`,
        )
        .join('');
      parts.push(`<path d="${d}" fill="none" stroke="${p.pens[0]}" stroke-width="1.25"/>`);
      const [x1, y1, x2, y2] = curve.segments[Math.floor(curve.segments.length / 2)];
      const [lx, ly] = [f.px((x1 + x2) / 2), f.py((y1 + y2) / 2)];
      parts.push(
        `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" fill="${p.text}" font-size="11" text-anchor="middle" ` +
          `stroke="${p.surface}" stroke-width="3" paint-order="stroke">${escapeXml(numberText(curve.level, 4))}</text>`,
      );
    }
    for (const q of points) parts.push(marker(f.px(q.x), f.py(q.y), 1, p.pens[1]));
    return svg(parts, p);
  };
}
