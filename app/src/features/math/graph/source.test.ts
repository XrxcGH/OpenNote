// The text of a graph (Phase 10): functions, slider values, and the view it is looking at.
import { describe, expect, it } from 'vitest';
import { readGraph, writeGraph } from './source';

describe('graph source', () => {
  it('reads functions, slider values, and the view', () => {
    const graph = readGraph('y = sin(a x)\n# a note\n\na = 2.5\n@view -10 10 -4 4\nf(x) = x^2');
    expect(graph.functions).toEqual(['y = sin(a x)', 'f(x) = x^2']);
    expect(graph.params).toEqual({ a: 2.5 });
    expect(graph.view).toEqual({ xMin: -10, xMax: 10, yMin: -4, yMax: 4 });
  });

  it('keeps y and x as functions, not slider names, and ignores a view that makes no sense', () => {
    const graph = readGraph('y = 3\n@view 5 -5 0 1');
    expect(graph.functions).toEqual(['y = 3']);
    expect(graph.view).toBeNull();
  });

  it('writes what it reads', () => {
    const text = 'y = a x\na = 3\n@view -8 8 -4.5 4.5';
    expect(writeGraph(readGraph(text))).toBe(text);
  });
});
