// checks-disable-file brand-consistency: the test data holds color values to check how they are written
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHANNEL_PRESSURE, encodePoints, type InkRecord, type Stroke } from '../../../core/ink/codec';
import { strokesByBlock } from './blocks';
import { drawingOrder, inkExtent, inkShapes, inkSvg, shapesInBand, strokeShape, type InkShape } from './ink';
import { exportStrokes, liveStrokes, toExportStroke } from './inkSource';
import type { ExportStroke } from './source';

const stroke = (id: string, more: Partial<ExportStroke> = {}): ExportStroke => ({
  id,
  block: 'b1',
  start: 0,
  tool: 0,
  color: [43, 37, 33, 255],
  width: 2,
  x: [10, 60],
  y: [20, 20],
  pressure: null,
  transform: null,
  ...more,
});

describe('a stroke as a filled shape', () => {
  it('outlines a line with round caps at its width', () => {
    const shape = strokeShape(stroke('s'))!;
    expect(shape.fill).toBe('#2b2521');
    expect(shape.opacity).toBe(1);
    expect(shape.d.startsWith('M')).toBe(true);
    expect(shape.d.endsWith('Z')).toBe(true);
    expect(shape.bbox.x).toBeCloseTo(9, 0);
    expect(shape.bbox.x + shape.bbox.w).toBeCloseTo(61, 0);
    expect(shape.bbox.y).toBeCloseTo(19, 0);
    expect(shape.bbox.h).toBeCloseTo(2, 0);
  });

  it('draws one point as a dot and nothing for no points', () => {
    const dot = strokeShape(stroke('d', { x: [5], y: [5], width: 4 }))!;
    expect(dot.bbox.w).toBeCloseTo(4, 0);
    expect(dot.bbox.h).toBeCloseTo(4, 0);
    expect(strokeShape(stroke('n', { x: [], y: [] }))).toBeNull();
    expect(strokeShape(stroke('m', { x: [1, 2], y: [1] }))).toBeNull();
  });

  it('follows pressure for pens, and ignores it for markers and highlighters', () => {
    const pressure = [0.2, 1];
    const pen = strokeShape(stroke('p', { pressure, width: 10 }))!;
    const marker = strokeShape(stroke('m', { pressure, width: 10, tool: 3 }))!;
    const flat = strokeShape(stroke('f', { width: 10 }))!;
    expect(pen.bbox.h).toBeGreaterThan(2);
    expect(pen.bbox.h).toBeLessThan(10.5);
    expect(marker.bbox.h).toBeCloseTo(flat.bbox.h, 1);
  });

  it('moves and scales with the transform and the block origin', () => {
    const moved = strokeShape(stroke('t', { transform: [2, 0, 0, 2, 5, 7] }), 100, 200)!;
    expect(moved.bbox.x).toBeCloseTo(100 + 5 + 20 - 2, 0);
    expect(moved.bbox.y).toBeCloseTo(200 + 7 + 40 - 2, 0);
    expect(moved.bbox.h).toBeCloseTo(4, 0);
  });

  it('writes the alpha of translucent ink as opacity', () => {
    const shape = strokeShape(stroke('h', { color: [242, 207, 74, 102], tool: 2 }))!;
    expect(shape.fill).toBe('#f2cf4a');
    expect(shape.opacity).toBe(0.4);
  });

  it('never produces a path with a number that is not finite', () => {
    const point = fc.record({
      x: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
      y: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 1, maxLength: 40 }),
        fc.double({ min: 0.1, max: 40, noNaN: true }),
        (pts, width) => {
          const shape = strokeShape(stroke('r', { x: pts.map((p) => p.x), y: pts.map((p) => p.y), width }))!;
          expect(shape.d).not.toMatch(/NaN|Infinity/);
          expect(Number.isFinite(shape.bbox.w + shape.bbox.h)).toBe(true);
        },
      ),
    );
  });
});

describe('drawing order and bands', () => {
  it('draws ink blocks in order, and in each block highlighters first, then by start and ID', () => {
    const strokes = [
      stroke('c', { block: 'b2', start: 1 }),
      stroke('b', { block: 'b1', start: 5 }),
      stroke('a', { block: 'b1', start: 5 }),
      stroke('h', { block: 'b1', start: 9, tool: 2 }),
      stroke('z', { block: 'unknown', start: 0 }),
    ];
    expect(drawingOrder(strokes, ['b1', 'b2']).map((s) => s.id)).toEqual(['h', 'a', 'b', 'c', 'z']);
  });

  it('places ink blocks by their origin and finds the shapes in a band of the page', () => {
    const strokes = [stroke('a'), stroke('b', { block: 'b2' })];
    const shapes = inkShapes(strokes, ['b1', 'b2'], new Map([['b2', { x: 0, y: 1100 }]]));
    expect(shapesInBand(shapes, 0, 1056)).toHaveLength(1);
    expect(shapesInBand(shapes, 1056, 1056)).toHaveLength(1);
    expect(shapesInBand(shapes, 2000, 100)).toHaveLength(0);
    expect(inkExtent(shapes)!.h).toBeGreaterThan(1100);
    expect(inkExtent([])).toBeNull();
  });

  it('handles a long handwritten page in linear time and without an argument limit', () => {
    // 60,000 strokes in one block took about 40 seconds when each stroke copied the block's list.
    const strokes = Array.from({ length: 60_000 }, (_, i) => stroke(`s${i}`));
    const started = performance.now();
    expect(strokesByBlock(strokes).get('b1')).toHaveLength(60_000);
    expect(performance.now() - started).toBeLessThan(2000);
    // Spreading 300,000 values into Math.min throws a RangeError.
    const shapes = Array.from({ length: 300_000 }, (_, i): InkShape => ({
      d: '',
      fill: '#000000',
      opacity: 1,
      highlighter: false,
      bbox: { x: i, y: -i, w: 1, h: 1 },
    }));
    expect(inkExtent(shapes)).toEqual({ x: 0, y: -299_999, w: 300_000, h: 300_000 });
  });

  it('writes an svg whose group moves the page band to the top', () => {
    const shapes = inkShapes([stroke('a', { y: [1100, 1100] })], ['b1'], new Map());
    const svg = inkSvg(shapes, 1056, 816, 1056);
    expect(svg).toContain('viewBox="0 0 816 1056"');
    expect(svg).toContain('<g transform="translate(0 -1056)">');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(inkSvg([], 0, 10, 10, 'A "sketch"')).toContain('role="img" aria-label="A &#34;sketch&#34;"');
  });
});

describe('the strokes of a page from its ink records', () => {
  const channels = CHANNEL_PRESSURE;
  const record = (id: string, extra: Partial<Stroke> = {}): InkRecord => {
    const { bytes, bbox } = encodePoints(
      [
        { x: 640, y: 1280, pressure: 65535, tiltX: 0, tiltY: 0, t: 0 },
        { x: 1280, y: 1280, pressure: 32768, tiltX: 0, tiltY: 0, t: 0 },
      ],
      channels,
    );
    return {
      kind: 'stroke',
      stroke: {
        id,
        block: 'blk',
        start: 1000,
        startUnknown: false,
        style: { tool: 0, palette: 1, color: [1, 2, 3, 255], width: 2 },
        bbox,
        channels,
        pointCount: 2,
        transform: null,
        origin: null,
        points: bytes,
        ...extra,
      },
    };
  };

  it('applies stroke, property, and remove records in order', () => {
    const records: InkRecord[] = [
      record('a'),
      record('b'),
      record('c'),
      { kind: 'props', props: { id: 'a', style: null, transform: [1, 0, 0, 1, 5, 5], block: 'other' } },
      {
        kind: 'props',
        props: {
          id: 'b',
          style: { tool: 2, palette: 0, color: [9, 9, 9, 100], width: 8 },
          transform: null,
          block: null,
        },
      },
      { kind: 'remove', id: 'c' },
      { kind: 'remove', id: 'missing' },
      { kind: 'props', props: { id: 'missing', style: null, transform: 'remove', block: null } },
    ];
    const live = liveStrokes(records);
    expect(live.map((s) => s.id)).toEqual(['a', 'b']);
    expect(live[0]).toMatchObject({ block: 'other', transform: [1, 0, 0, 1, 5, 5] });
    expect(live[1].style).toMatchObject({ tool: 2, width: 8 });
    const cleared = liveStrokes([
      ...records,
      { kind: 'props', props: { id: 'a', style: null, transform: 'remove', block: null } },
    ]);
    expect(cleared[0].transform).toBeNull();
  });

  it('replaces a stroke that is written again', () => {
    const live = liveStrokes([
      record('a'),
      record('a', { style: { tool: 1, palette: 0, color: [0, 0, 0, 255], width: 3 } }),
    ]);
    expect(live).toHaveLength(1);
    expect(live[0].style.tool).toBe(1);
  });

  it('decodes points into page units and pressure into 0 to 1', () => {
    const s = toExportStroke((record('a') as { stroke: Stroke }).stroke)!;
    expect(Array.from(s.x)).toEqual([10, 20]);
    expect(Array.from(s.y)).toEqual([20, 20]);
    expect(s.pressure![0]).toBe(1);
    expect(s.pressure![1]).toBeCloseTo(0.5, 3);
    expect(exportStrokes([record('a')])).toHaveLength(1);
  });

  it('leaves out a stroke whose points cannot be read', () => {
    const broken = record('x', { points: new Uint8Array([1, 2, 3]) });
    expect(exportStrokes([broken, record('ok')]).map((s) => s.id)).toEqual(['ok']);
  });
});
