// Geometry helpers for the drawing tests (docs/BRAND.md section 8). They find points along a shape in its drawing's
// own coordinates and the top of a shelf or desk, and they check that things stand on their line.

import { expect } from 'vitest';

/** The drawing a test rendered. */
export const drawn = (container: HTMLElement) => container.querySelector('svg') as SVGSVGElement;

/** Points along a shape's outline in its own coordinates, before its own transform. */
export const along = (shape: SVGGeometryElement, steps = 400) =>
  Array.from({ length: steps + 1 }, (_, i) =>
    DOMPoint.fromPoint(shape.getPointAtLength((i / steps) * shape.getTotalLength())),
  );

/** Points along a shape's outline in its drawing's own coordinates (the viewBox), after every transform. */
export function outline(shape: SVGGeometryElement, steps = 400): DOMPoint[] {
  const svg = shape.ownerSVGElement as SVGSVGElement;
  const toDrawing = (svg.getScreenCTM() as DOMMatrix).inverse().multiply(shape.getScreenCTM() as DOMMatrix);
  return along(shape, steps).map((p) => p.matrixTransform(toDrawing));
}

/** The outline of one shape, or of every shape in a group. */
export const pointsOf = (thing: Element) =>
  (thing instanceof SVGGeometryElement
    ? [thing]
    : [...thing.querySelectorAll<SVGGeometryElement>('path, circle')]
  ).flatMap((shape) => outline(shape));

/** An empty state's shelf is the first line in its drawing. */
export const shelfOf = (svg: SVGSVGElement) => svg.querySelector('g > path') as SVGGeometryElement;

/** The top of a shelf or desk at a given x, from its outline. */
export function surface(line: SVGGeometryElement): (x: number) => number {
  const points = outline(line, 1000);
  return (x) => Math.min(...points.filter((p) => Math.abs(p.x - x) <= 0.5).map((p) => p.y));
}

/** Things stand on a line: no point dips below it, and the lowest one is within a unit of it, so nothing floats. */
export function expectStandsOn(points: DOMPoint[], at: (x: number) => number) {
  const gaps = points.map((p) => at(p.x) - p.y);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(-0.01);
  expect(Math.min(...gaps)).toBeLessThan(1);
}
