// The lattice the drawing tools snap to is the paper the page draws: every point that snaps lands on a line (or a dot)
// in the SVG path data the renderer makes, on each sheet of a paginated page, below the header, and on the infinite
// canvas, at every zoom.
import { describe, expect, it } from 'vitest';
import { linesArea, snapReach, snapToLattice } from '../../../core/paperLattice';
import type { PaperLattice } from '../../../core/paperLattice';
import { sheetGeometry } from '../pagination/geometry';
import { infinitePaths, paperLattice, paperPaths } from './patterns';
import type { PageBackground, PaperPaths } from './types';

const sheet = sheetGeometry({ width: 816, height: 1056 }, [72, 72, 72, 96]);
const TOLERANCE = 0.01;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The straight segments and the dots of a sheet's path data, moved down by `dy`. */
function parse(paths: PaperPaths, dy = 0): { lines: Segment[]; dots: { x: number; y: number }[] } {
  const lines: Segment[] = [];
  for (const d of [paths.rules, paths.margin]) {
    for (const m of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)) {
      lines.push({ x1: +m[1], y1: +m[2] + dy, x2: +m[3], y2: +m[4] + dy });
    }
  }
  const dots = [...paths.dots.matchAll(/M(-?[\d.]+) (-?[\d.]+)h0/g)].map((m) => ({ x: +m[1], y: +m[2] + dy }));
  return { lines, dots };
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
const within = (v: number, a: number, b: number) => v >= Math.min(a, b) - TOLERANCE && v <= Math.max(a, b) + TOLERANCE;

/** True when a drawn line runs through `p` in the direction the snapped coordinate says. */
function onDrawn(drawn: ReturnType<typeof parse>, p: { x: number; y: number }, axis: 'x' | 'y'): boolean {
  return drawn.lines.some((s) =>
    axis === 'y'
      ? near(s.y1, s.y2) && near(s.y1, p.y) && within(p.x, s.x1, s.x2)
      : near(s.x1, s.x2) && near(s.x1, p.x) && within(p.y, s.y1, s.y2),
  );
}

/** A spread of points over a box, off the lattice by every fraction of a step. */
function samples(x0: number, y0: number, w: number, h: number, n = 23): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i += 1)
    for (let j = 0; j <= n; j += 1) out.push({ x: x0 + (w * i) / n, y: y0 + (h * j) / n });
  return out;
}

const BACKGROUNDS: readonly PageBackground[] = [
  { pattern: 'ruled', spacing: 26.46, marginLine: true },
  { pattern: 'ruled', spacing: 34 },
  { pattern: 'grid', spacing: 18.9 },
  { pattern: 'grid', spacing: 37.8 },
  { pattern: 'dots', spacing: 18.9 },
];

function check(
  lattice: PaperLattice,
  drawn: ReturnType<typeof parse>,
  points: { x: number; y: number }[],
  zoom: number,
) {
  const reach = snapReach(lattice.step, zoom);
  let snapped = 0;
  for (const p of points) {
    const hit = snapToLattice(lattice, p, reach);
    expect(Math.abs(hit.point.x - p.x)).toBeLessThanOrEqual(reach + 1e-9);
    expect(Math.abs(hit.point.y - p.y)).toBeLessThanOrEqual(reach + 1e-9);
    if (lattice.kind === 'dots') {
      if (hit.x) {
        expect(drawn.dots.some((d) => near(d.x, hit.point.x) && near(d.y, hit.point.y))).toBe(true);
        snapped += 1;
      }
      continue;
    }
    if (hit.y) expect(onDrawn(drawn, hit.point, 'y'), `${p.x},${p.y} -> row ${hit.point.y}`).toBe(true);
    if (hit.x) expect(onDrawn(drawn, hit.point, 'x'), `${p.x},${p.y} -> column ${hit.point.x}`).toBe(true);
    if (hit.x || hit.y) snapped += 1;
  }
  expect(snapped).toBeGreaterThan(0);
}

describe('paperLattice against the drawn paper', () => {
  for (const bg of BACKGROUNDS) {
    for (const zoom of [0.5, 1, 2]) {
      it(`snaps onto drawn lines on sheets: ${bg.pattern} ${bg.spacing}, zoom ${zoom}`, () => {
        const from = 72 + 4 * Math.round(bg.spacing ?? 26);
        const lattice = paperLattice(bg, sheet, true, from)!;
        // Sheet 0 is drawn below the header, and the others in full, each at its own top.
        const drawn = { lines: [] as Segment[], dots: [] as { x: number; y: number }[] };
        for (let k = 0; k < 3; k += 1) {
          const part = parse(k === 0 ? paperPaths(bg, sheet, from) : paperPaths(bg, sheet), k * sheet.height);
          drawn.lines.push(...part.lines);
          drawn.dots.push(...part.dots);
        }
        check(lattice, drawn, samples(-10, -10, sheet.width + 20, 3 * sheet.height, 61), zoom);
      });

      it(`snaps onto drawn lines on the infinite canvas: ${bg.pattern} ${bg.spacing}, zoom ${zoom}`, () => {
        const from = 140;
        const tile = { x: 0, y: 0, w: 1600, h: 2000 };
        const lattice = paperLattice(bg, sheet, false, from)!;
        check(lattice, parse(infinitePaths(bg, tile, sheet, from)), samples(5, 5, 1590, 1990, 47), zoom);
      });
    }
  }

  it('has no lattice for paper with no lines to snap to', () => {
    for (const pattern of ['plain', 'cornell', 'staff', 'isometric', 'template', 'unknown']) {
      expect(paperLattice({ pattern }, sheet, true), pattern).toBeNull();
    }
  });

  it('starts the first sheet below the header and the others at their own margins', () => {
    const lattice = paperLattice({ pattern: 'grid', spacing: 20 }, sheet, true, 200)!;
    expect(linesArea(lattice, 0).y).toBe(200);
    expect(linesArea(lattice, 1).y).toBe(sheet.height + 72);
    const ruled = paperLattice({ pattern: 'ruled', spacing: 26 }, sheet, true)!;
    expect(linesArea(ruled, 2)).toEqual({ x: 0, y: 2 * sheet.height + 72 + 26, w: 816, h: 1056 - 72 - 72 - 26 });
  });
});
