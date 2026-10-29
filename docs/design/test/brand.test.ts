// The logo mark and the app icon, checked by the numbers (docs/BRAND.md section 8): the page sits in the middle of
// its tile, and the ink stroke with its pen tip in the middle of the page. Run with: npm run test:design

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { type El, outlineOf, parseSvg, walk } from './geometry.ts';

const BRAND = join(import.meta.dirname, '..', '..', '..', 'brand');

/** The box a shape covers, its line included. */
function extent(el: El) {
  const half = Number(el.attrs['stroke-width'] ?? 0) / 2;
  const pts = outlineOf(el).flatMap((run) => run.pts);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x0: Math.min(...xs) - half,
    x1: Math.max(...xs) + half,
    y0: Math.min(...ys) - half,
    y1: Math.max(...ys) + half,
  };
}

const union = (boxes: ReturnType<typeof extent>[]) => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});

const middle = (b: ReturnType<typeof extent>) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

describe('the logo', () => {
  for (const file of ['app-icon.svg', 'logo-mark.svg']) {
    const svg = [...walk(parseSvg(readFileSync(join(BRAND, file), 'utf8')))].find((e) => e.tag === 'svg') as El;
    const [, , width, height] = (svg.attrs.viewBox ?? '').split(' ').map(Number);
    const shapes = [...walk(svg)].filter((e) => e.tag === 'path' || e.tag === 'circle');
    // The page is the first path; the ink is the stroke without a fill and the pen tip at its end.
    const page = extent(shapes[0]);
    const ink = union(shapes.filter((e) => e.attrs.fill === 'none' || e.tag === 'circle').map(extent));

    it(`centers the page in the ${file} tile`, () => {
      // The page's own outline, without its line, is what the tile frames.
      const outline = outlineOf(shapes[0]).flatMap((run) => run.pts);
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - width / 2) <= 0.5, `${file}: page x ${xs}`);
      assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - height / 2) <= 0.5, `${file}: page y`);
    });

    it(`centers the ink across the page in ${file}`, () => {
      assert.ok(
        Math.abs(middle(ink).x - middle(page).x) <= 0.5,
        `${file}: ink ${middle(ink).x}, page ${middle(page).x}`,
      );
      // Lower than the middle, where a line of writing sits, and inside the page.
      assert.ok(middle(ink).y > middle(page).y && ink.y1 < page.y1, file);
    });
  }
});
