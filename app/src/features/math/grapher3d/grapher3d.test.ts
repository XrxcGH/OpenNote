// The 3D grapher's engine: reading lines, sampling surfaces and curves, the camera, and the SVG it writes.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  boundsOf,
  buildScene3d,
  isPlot3d,
  plotParameters,
  plotShape,
  rotateCamera,
  samplePlot,
  sceneToSvg3d,
  usesXandY,
  zoomCamera,
} from '.';
import { readGraph, writeGraph } from '../graph/source';

const SIZE = { width: 640, height: 360 };
const STYLE = {
  paper: '#fff',
  box: '#ccc',
  axis: '#333',
  text: '#555',
  curves: ['#00f', '#f00'],
  fontFamily: 'sans-serif',
  labelSize: 12,
  title: '3D graph',
  description: 'A <test> & "quote"',
};

describe('3D lines', () => {
  it('reads surfaces, curves, and parametric surfaces, and leaves 2D lines alone', () => {
    expect(plotShape('z = sin(x)*cos(y)')).toEqual({ kind: 'surface', parts: ['sin(x)*cos(y)'] });
    expect(plotShape('f(x, y) = x^2 - y^2')?.kind).toBe('surface');
    expect(plotShape('(cos(t), sin(t), t/5)')).toEqual({ kind: 'curve', parts: ['cos(t)', 'sin(t)', 't/5'] });
    expect(plotShape('r(t) = (t, t^2, t^3)')?.kind).toBe('curve');
    expect(plotShape('(cos(u) sin(v), sin(u) sin(v), cos(v))')?.kind).toBe('parametricSurface');
    expect(plotShape('(max(1, t), 2, 3)')?.parts).toEqual(['max(1, t)', '2', '3']);
    expect(isPlot3d('y = x^2')).toBe(false);
    expect(isPlot3d('(1, 2)')).toBe(false);
    expect(isPlot3d('z == 2')).toBe(false);
  });

  it('finds the letters that need sliders, but never the axes or t, u, and v', () => {
    expect(plotParameters('z = a sin(x) + b y')).toEqual(['a', 'b']);
    expect(plotParameters('(r cos(t), r sin(t), t)')).toEqual(['r']);
  });

  it('tells a function of x and y from a function of x alone', () => {
    expect(usesXandY('sin(x) cos(y)')).toBe(true);
    expect(usesXandY('x^2 + 1')).toBe(false);
    expect(usesXandY('2y')).toBe(false);
  });
});

describe('3D sampling', () => {
  it('samples z = sin(x)*cos(y) on a grid over the domain', () => {
    const plot = samplePlot(
      { source: 'z = sin(x)*cos(y)' },
      { domain: { xMin: -3, xMax: 3, yMin: -2, yMax: 2 }, grid: 6 },
    );
    expect(plot.error).toBeNull();
    expect(plot.rows).toHaveLength(7);
    expect(plot.rows[0]).toHaveLength(7);
    expect(plot.rows[0][0]).toEqual({ x: -3, y: -2, z: Math.sin(-3) * Math.cos(-2) });
    expect(plot.rows[6][6].x).toBe(3);
    expect(plot.rows[6][6].y).toBe(2);
  });

  it('uses slider values, and leaves NaN where the surface is not defined', () => {
    const plot = samplePlot({ source: 'z = a sqrt(x)', params: { a: 2 } }, { grid: 4 });
    expect(plot.rows[0][0].z).toBeNaN();
    expect(plot.rows[0][4].z).toBeCloseTo(2 * Math.sqrt(5));
  });

  it('samples a curve over t and a surface over u and v', () => {
    const curve = samplePlot({ source: '(cos(t), sin(t), t)' }, { steps: 8, ranges: { t: { min: 0, max: 8 } } });
    expect(curve.rows).toHaveLength(1);
    expect(curve.rows[0]).toHaveLength(9);
    expect(curve.rows[0][8].z).toBe(8);
    const sphere = samplePlot({ source: '(cos(u) sin(v), sin(u) sin(v), cos(v))' }, { grid: 8 });
    for (const row of sphere.rows) for (const p of row) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1);
  });

  it('reports a line it cannot read, keeps the grid in bounds, and never throws', () => {
    expect(samplePlot({ source: 'z = sin(' }).error).not.toBeNull();
    expect(samplePlot({ source: 'y = x' }).error).not.toBeNull();
    expect(samplePlot({ source: 'z = x' }, { grid: 10_000 }).rows).toHaveLength(97);
  });
});

describe('3D scene', () => {
  const plots = [samplePlot({ source: 'z = sin(x)*cos(y)' }, { grid: 10 })];

  it('fits the box to the domain and the values, and trims a pole', () => {
    const bounds = boundsOf(plots, { xMin: -5, xMax: 5, yMin: -5, yMax: 5 });
    expect(bounds.x).toEqual([-5, 5]);
    expect(bounds.z[0]).toBeGreaterThanOrEqual(-1);
    expect(bounds.z[1]).toBeLessThanOrEqual(1);
    const pole = boundsOf([samplePlot({ source: 'z = 1/(x^2 + y^2)' }, { grid: 20 })]);
    expect(pole.z[1]).toBeLessThan(10);
  });

  it('draws one face per cell, back to front, inside the picture', () => {
    const scene = buildScene3d(plots, DEFAULT_CAMERA, SIZE);
    expect(scene.faces).toHaveLength(100);
    for (let i = 1; i < scene.faces.length; i += 1)
      expect(scene.faces[i].depth).toBeGreaterThanOrEqual(scene.faces[i - 1].depth);
    for (const face of scene.faces) {
      for (const pair of face.points.split(' ')) {
        const [x, y] = pair.split(',').map(Number);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(SIZE.width);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(SIZE.height);
      }
    }
    expect(scene.labels.map((label) => label.text)).toContain('z');
  });

  it('turns, tilts, and zooms within limits, and a turn moves the picture', () => {
    const turned = rotateCamera(DEFAULT_CAMERA, Math.PI / 4, 10);
    expect(turned.pitch).toBeLessThan(Math.PI / 2);
    expect(rotateCamera(DEFAULT_CAMERA, 4 * Math.PI, 0).yaw).toBeCloseTo(DEFAULT_CAMERA.yaw);
    expect(zoomCamera(DEFAULT_CAMERA, 1000).zoom).toBe(8);
    const before = buildScene3d(plots, DEFAULT_CAMERA, SIZE).faces[0].points;
    const after = buildScene3d(plots, rotateCamera(DEFAULT_CAMERA, 0.5, 0), SIZE).faces[0].points;
    expect(after).not.toBe(before);
  });

  it('writes a standalone, escaped SVG with a title and a polygon per face', () => {
    const svg = sceneToSvg3d(buildScene3d(plots, DEFAULT_CAMERA, SIZE), STYLE);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title id="g3t">3D graph</title>');
    expect(svg).toContain('A &lt;test&gt; &amp; &quot;quote&quot;');
    expect(svg.match(/<polygon /g)).toHaveLength(100);
    expect(svg).not.toMatch(/<script|href=/);
  });
});

describe('3D graph text', () => {
  it('reads and writes the camera and ranges, and knows a 3D graph by its lines', () => {
    const graph = readGraph('z = x y\n@camera 30 20 1.5\n@range t 0 12');
    expect(graph.three).toBe(true);
    expect(graph.camera?.zoom).toBe(1.5);
    expect(graph.camera?.yaw).toBeCloseTo(Math.PI / 6);
    expect(graph.ranges).toEqual({ t: { min: 0, max: 12 } });
    expect(writeGraph(graph)).toBe('z = x y\n@camera 30 20 1.5\n@range t 0 12');
    expect(readGraph('y = x').three).toBeUndefined();
    expect(writeGraph({ functions: [], params: {}, view: null, three: true })).toBe('@3d');
    expect(readGraph('@3d').three).toBe(true);
  });
});
