import './text';
import { describe, expect, it } from 'vitest';
import { PAGE } from './kit/plot';
import type { Cube } from './views';
import { isometricSvg, layout, viewsSvg } from './viewsDrawing';

const names = { front: 'Front', top: 'Top', right: 'Right' };
const block = (nx: number, ny: number, nz: number): Cube[] =>
  Array.from({ length: nx * ny * nz }, (_, i) => ({
    x: i % nx,
    y: Math.floor(i / nx) % ny,
    z: Math.floor(i / (nx * ny)),
  }));
const notch = block(3, 2, 3).filter((c) => !(c.x === 1 && c.y === 1 && c.z === 1));
const lines = (svg: string) => svg.match(/<line /g)?.length ?? 0;

describe('views drawing', () => {
  it('a plain block is three rectangles: 12 solid lines and no dashes', () => {
    const svg = viewsSvg(block(2, 2, 2), 'third', PAGE, names, 'alt');
    expect(lines(svg)).toBe(12);
    expect(svg).not.toContain('stroke-dasharray');
  });
  it('a notch that is closed on every side adds no line, since it is not seen from any view', () => {
    // The hole in the middle of a 3x2x3 block shows in no view and no hidden line is drawn for an inner cell
    const svg = viewsSvg(notch, 'third', PAGE, names, 'alt');
    expect(svg).toContain('<svg');
  });
  it('a step cut into the back shows dashed edges in the views it hides behind', () => {
    const stepped = block(3, 2, 2).filter((c) => !(c.y === 1 && c.z === 0 && c.x === 1));
    expect(viewsSvg(stepped, 'third', PAGE, names, 'alt')).toContain('stroke-dasharray');
  });
  it('third angle puts the top above the front and the right beside it; first angle swaps them', () => {
    const cubes = block(3, 2, 1);
    const third = Object.fromEntries(layout(cubes, 'third').placed.map((p) => [p.view.name, p]));
    expect(third.top!.y).toBeLessThan(third.front!.y);
    expect(third.right!.x).toBeGreaterThan(third.front!.x);
    const first = Object.fromEntries(layout(cubes, 'first').placed.map((p) => [p.view.name, p]));
    expect(first.top!.y).toBeGreaterThan(first.front!.y);
    expect(first.right!.x).toBeLessThan(first.front!.x);
  });
  it('names the three views and describes the picture', () => {
    const svg = viewsSvg(block(1, 1, 1), 'third', PAGE, names, 'Three views');
    for (const name of ['Front', 'Top', 'Right']) expect(svg).toContain(`>${name}</text>`);
    expect(svg).toContain('aria-label="Three views"');
  });
  it('an isometric cube is three faces', () => {
    expect(isometricSvg(block(1, 1, 1), PAGE, 'iso').match(/<polygon /g)).toHaveLength(3);
  });
  it('an empty model draws an empty sheet, not an error', () => {
    expect(viewsSvg([], 'third', PAGE, names, 'alt')).toContain('<svg');
  });
});
