// Parametric, polar, vector field, and slope field lines in a graph block.
import { describe, expect, it } from 'vitest';
import { tokens } from '../../../theme/tokens';
import { readGraph, writeGraph } from '../graph/source';
import { classifyLine, compileSpecial, curvePoint, lineParameters, sampleCurve, splitTuple } from './curves';
import { buildScene, sceneToSvg } from './scene';

const VIEW = { xMin: -3, xMax: 3, yMin: -2, yMax: 2 };
const SIZE = { width: 600, height: 400 };

describe('curve kinds', () => {
  it('tells the kinds apart', () => {
    expect(classifyLine('(cos t, sin t)').kind).toBe('parametric');
    expect(classifyLine('c(t) = (t^2, t^3)').kind).toBe('parametric');
    expect(classifyLine('r = 1 + cos theta').kind).toBe('polar');
    expect(classifyLine('r(θ) = 2 sin(3θ)').kind).toBe('polar');
    expect(classifyLine('F = (-y, x)').kind).toBe('field');
    expect(classifyLine('F(x, y) = (y, -x)').kind).toBe('field');
    expect(classifyLine('dy/dx = x - y').kind).toBe('slope');
    expect(classifyLine("y' = y").kind).toBe('slope');
    expect(classifyLine('y = (x + 1)(x - 1)').kind).toBe('function');
    expect(classifyLine('(x+1)^2').kind).toBe('function');
  });

  it('splits only one bracketed tuple at its top-level commas', () => {
    expect(splitTuple('(max(t, 1), sin t)')).toEqual(['max(t, 1)', 'sin t']);
    expect(splitTuple('(a)(b)')).toBeNull();
    expect(splitTuple('(a)')).toBeNull();
  });

  it('gives sliders only for letters that are not the curve’s own variables', () => {
    expect(lineParameters('(a cos t, b sin t)')).toEqual(['a', 'b']);
    expect(lineParameters('r = k cos θ')).toEqual(['k']);
    expect(lineParameters('F = (-y, x)')).toEqual([]);
    expect(lineParameters('dy/dx = c x y')).toEqual(['c']);
    expect(lineParameters('y = a x^2')).toEqual(['a']);
  });

  it('puts a polar point where x = r cos θ and y = r sin θ', () => {
    const special = compileSpecial('r = 2', {});
    if (!special.ok) throw new Error(special.error.message);
    const point = curvePoint(special.kind, special.parts, Math.PI / 2, {})!;
    expect(point.x).toBeCloseTo(0, 12);
    expect(point.y).toBeCloseTo(2, 12);
  });

  it('samples the unit circle into one closed run', () => {
    const special = compileSpecial('(cos t, sin t)', {});
    if (!special.ok) throw new Error(special.error.message);
    const runs = sampleCurve(special.kind, special.parts, [0, 2 * Math.PI], VIEW, {});
    expect(runs).toHaveLength(1);
    for (const point of runs[0]) expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 10);
    expect(runs[0][0].x).toBeCloseTo(runs[0].at(-1)!.x, 10);
  });

  it('breaks a curve where it is not defined', () => {
    const special = compileSpecial('(t, sqrt(t))', {});
    if (!special.ok) throw new Error(special.error.message);
    const runs = sampleCurve(special.kind, special.parts, [-1, 1], VIEW, {});
    expect(runs).toHaveLength(1);
    expect(runs[0][0].x).toBeGreaterThanOrEqual(0);
  });

  it('reports a mistake at its place in the line', () => {
    const special = compileSpecial('(cos t, sin(t +))', {});
    expect(special.ok).toBe(false);
    if (!special.ok) expect(special.error.position).toBeGreaterThanOrEqual(8);
  });

  it('draws fields and curves in the scene and its SVG', () => {
    const scene = buildScene(VIEW, SIZE, [
      { source: '(cos t, sin t)' },
      { source: 'F = (-y, x)' },
      { source: 'dy/dx = x' },
      { source: 'r = 1 + cos θ' },
    ]);
    for (const curve of scene.curves) {
      expect(curve.error).toBeNull();
      expect(curve.d.length).toBeGreaterThan(20);
    }
    expect(scene.curves.map((curve) => curve.kind)).toEqual(['parametric', 'field', 'slope', 'polar']);
    const c = tokens.color.light;
    const svg = sceneToSvg(scene, {
      gridMinor: c.border.subtle,
      gridMajor: c.border.control,
      axis: c.text.primary,
      text: c.text.secondary,
      curves: [c.accent.primary],
      fontFamily: tokens.font.ui,
      labelSize: 12,
      lineWidth: 1,
      curveWidth: 2,
      title: 'Test',
    });
    expect(svg.match(/<path/g)!.length).toBeGreaterThanOrEqual(7);
  });

  it('keeps the t range in the block’s text', () => {
    const graph = readGraph('(cos t, sin t)\n@t 0 4pi');
    expect(graph.t![1]).toBeCloseTo(4 * Math.PI, 12);
    expect(graph.functions).toEqual(['(cos t, sin t)']);
    expect(writeGraph(graph)).toBe('(cos t, sin t)\n@t 0 12.5664');
    expect(readGraph('r = 2').functions).toEqual(['r = 2']);
  });
});
