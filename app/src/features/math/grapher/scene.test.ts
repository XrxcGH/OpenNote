// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildScene, sceneToSvg, type SvgStyle } from './scene';
import type { Pixel, Size, Viewport } from './types';
import { toWorld } from './viewport';

const size: Size = { width: 800, height: 400 };
const view: Viewport = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };

// Stand-ins for resolved design tokens: the tests only need distinct, valid values.
const style: SvgStyle = {
  gridMinor: 'var(--minor)',
  gridMajor: 'var(--major)',
  axis: 'var(--axis)',
  text: 'var(--text)',
  curves: ['var(--curve-1)', 'var(--curve-2)'],
  fontFamily: 'var(--font-body)',
  labelSize: 12,
  lineWidth: 1,
  curveWidth: 2,
  title: 'Graph of <y> & "x"',
  description: 'y = x^2',
};

function parsePath(d: string): Pixel[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

describe('a scene', () => {
  it('puts every path vertex on the function, within a pixel', () => {
    const scene = buildScene(view, size, [{ source: 'x^2 / 4 - 2' }, { source: 'a sin(x)', params: { a: 3 } }]);
    const expected = [(x: number) => (x * x) / 4 - 2, (x: number) => 3 * Math.sin(x)];
    scene.curves.forEach((curve, index) => {
      const points = parsePath(curve.d);
      expect(points.length).toBeGreaterThan(50);
      for (const pixel of points) {
        const world = toWorld(view, size, pixel);
        const onCurve = expected[index](world.x);
        // Coordinates are rounded to a hundredth of a pixel, and a pixel is 0.025 units tall here.
        if (Math.abs(onCurve) < 4.9) expect(Math.abs(world.y - onCurve)).toBeLessThan(0.025);
      }
    });
  });

  it('reports a bad expression without stopping the others', () => {
    const scene = buildScene(view, size, [{ source: '2 +' }, { source: 'x' }, { source: 'q x' }]);
    expect(scene.curves[0].error?.position).toBe(3);
    expect(scene.curves[0].d).toBe('');
    expect(scene.curves[1].error).toBeNull();
    expect(scene.curves[1].d).toMatch(/^M/);
    expect(scene.curves[2].error?.message).toMatch(/Unknown name "q"/);
  });

  it('shows the same curve for the same viewport', () => {
    const a = buildScene(view, size, [{ source: 'sin(x)/x' }]);
    const b = buildScene(view, size, [{ source: 'sin(x)/x' }]);
    expect(a.curves[0].d).toBe(b.curves[0].d);
  });

  it('follows a pan and a zoom', () => {
    const base = buildScene(view, size, [{ source: 'x^3' }]);
    const panned = buildScene({ xMin: 2, xMax: 22, yMin: -5, yMax: 5 }, size, [{ source: 'x^3' }]);
    expect(panned.curves[0].d).not.toBe(base.curves[0].d);
    expect(panned.grid.yAxis).toEqual({ pixel: 0, edge: 'min' });
  });
});

describe('the SVG export', () => {
  const scene = buildScene(view, size, [{ source: 'x^2' }, { source: '1/x' }, { source: 'bad(' }]);
  const svg = sceneToSvg(scene, style);

  it('is well-formed SVG with an accessible name and text alternative', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 800 400');
    expect(root.getAttribute('role')).toBe('img');
    expect(doc.querySelector('title')?.textContent).toBe('Graph of <y> & "x"');
    expect(doc.querySelector('desc')?.textContent).toBe('y = x^2');
  });

  it('stays vector: paths and text only, with no images, scripts, or links', () => {
    expect(svg).not.toMatch(/<(image|script|foreignObject|use)\b|href=|data:|url\(/);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const curves = doc.querySelectorAll('path[stroke-linecap="round"]');
    expect(curves).toHaveLength(2);
    expect(curves[0].getAttribute('stroke')).toBe('var(--curve-1)');
    expect(curves[1].getAttribute('stroke')).toBe('var(--curve-2)');
    for (const curve of curves) expect(curve.getAttribute('d')).toMatch(/^M[-\d. ML]+$/);
  });

  it('draws the axes and labels the major ticks', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const labels = [...doc.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toContain('-10');
    expect(labels).toContain('10');
    expect(labels).toContain('4');
    // The x axis labels show the origin, so the y axis skips its own zero.
    expect(labels.filter((label) => label === '0')).toHaveLength(1);
    expect(svg).toContain('M0 200H800M400 0V400');
  });

  it('repeats curve colors when there are more curves than colors', () => {
    const three = buildScene(view, size, [{ source: 'x' }, { source: '2x' }, { source: '3x' }]);
    const doc = new DOMParser().parseFromString(sceneToSvg(three, style), 'image/svg+xml');
    const colors = [...doc.querySelectorAll('path[stroke-linecap="round"]')].map((p) => p.getAttribute('stroke'));
    expect(colors).toEqual(['var(--curve-1)', 'var(--curve-2)', 'var(--curve-1)']);
  });
});
