// The pen library's stroke geometry (flag ink.penLibrary): golden outlines for each pen, and the properties that make
// each pen what it is. A golden file changes only when the shape of a pen changes on purpose.
import { describe, expect, it } from 'vitest';
import { boundsOf } from '../geometry/bounds';
import { speedPressures, strokeOutline, strokeShapes } from '../geometry/outline';
import type { InkPoint, InkTool, Vec } from '../geometry/types';
import { codeOfTool, isKnownToolCode, toolFromCode, WIDTH_PRESETS_MM } from './tools';

const wave = (speed: number, pressure = 0.5): InkPoint[] =>
  Array.from({ length: 24 }, (_, i) => ({
    x: i * 4,
    y: Math.sin(i / 3) * 10,
    pressure: i < 12 ? pressure : pressure + 0.3,
    time: (i * 4) / speed,
  }));

const round = (shape: readonly Vec[]) => shape.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
const shapesOf = (tool: InkTool, points = wave(1)) => strokeShapes(points, { tool, width: 3 }).map(round);
const heightOf = (shape: readonly Vec[]) => {
  const b = boundsOf(shape);
  return b.maxY - b.minY;
};

describe('the pen library: golden outlines', () => {
  for (const tool of ['fountain', 'brush', 'calligraphy', 'dashed', 'dotted'] as const) {
    it(`draws the ${tool} pen the same way`, async () => {
      await expect(JSON.stringify(shapesOf(tool))).toMatchFileSnapshot(`./golden/${tool}.txt`);
    });
  }
});

describe('the pen library: what each pen does', () => {
  it('draws a fountain pen and a brush wider when slow than fast', () => {
    for (const tool of ['fountain', 'brush'] as const) {
      const slow = strokeOutline(wave(0.2, 0.4), { tool, width: 3 });
      const fast = strokeOutline(wave(3, 0.4), { tool, width: 3 });
      expect(heightOf(slow)).toBeGreaterThan(heightOf(fast));
    }
  });

  it('keeps the speed in the pressure and ignores it for points without a time', () => {
    const timed = speedPressures(wave(0.2));
    const quick = speedPressures(wave(3));
    expect(timed[5]).toBeGreaterThan(quick[5]);
    expect(
      speedPressures([
        { x: 0, y: 0, pressure: 0.7 },
        { x: 9, y: 0, pressure: 0.7 },
      ]),
    ).toEqual([0.7, 0.7]);
  });

  it('makes the fountain pen draw with pressure alone, even for a mouse stroke at a steady speed', () => {
    const steady = Array.from({ length: 10 }, (_, i) => ({ x: i * 4, y: 0, time: i * 4 }));
    expect(strokeOutline(steady, { tool: 'fountain', width: 3 }).length).toBeGreaterThan(4);
  });

  it('holds the calligraphy nib at a fixed angle: thick across the nib, thin along it', () => {
    const across: InkPoint[] = Array.from({ length: 10 }, (_, i) => ({ x: i * 3, y: i * 3 })); // down-right
    const along: InkPoint[] = Array.from({ length: 10 }, (_, i) => ({ x: i * 3, y: -i * 3 })); // up-right, with the nib
    const thick = strokeOutline(across, { tool: 'calligraphy', width: 6 });
    const thin = strokeOutline(along, { tool: 'calligraphy', width: 6 });
    const area = (shape: readonly Vec[]) =>
      Math.abs(
        shape.reduce(
          (sum, p, i) => sum + p.x * shape[(i + 1) % shape.length].y - shape[(i + 1) % shape.length].x * p.y,
          0,
        ),
      ) / 2;
    expect(area(thick)).toBeGreaterThan(area(thin) * 2.5);
  });

  it('breaks a dashed line into dashes with gaps, and a dotted line into round dots', () => {
    const line: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ];
    // As a pen's samples: one polygon for each dash.
    const dashes = strokeShapes(line, { tool: 'dashed', width: 3, exact: false });
    expect(dashes.length).toBe(Math.ceil(120 / (3 * 7)));
    const [first, second] = dashes.map((d) => boundsOf(d));
    expect(second.minX - first.maxX).toBeGreaterThan(5);
    const dots = strokeShapes(line, { tool: 'dotted', width: 3, exact: false });
    expect(dots.length).toBe(Math.floor(120 / (3 * 2.2)) + 1);
    expect(dots.every((d) => d.length === 16)).toBe(true);
    expect(strokeShapes(line, { tool: 'pen', width: 3, exact: false }).length).toBe(1);
    // As exact geometry (a dashed shape): the same dashes, each filled by the pieces of an even-width line.
    const spans = strokeShapes(line, { tool: 'dashed', width: 3, exact: true })
      .map((piece) => boundsOf(piece))
      .sort((a, b) => a.minX - b.minX)
      .reduce<{ minX: number; maxX: number }[]>((runs, box) => {
        const last = runs[runs.length - 1];
        if (last && box.minX <= last.maxX) last.maxX = Math.max(last.maxX, box.maxX);
        else runs.push({ minX: box.minX, maxX: box.maxX });
        return runs;
      }, []);
    expect(spans.length).toBe(Math.ceil(120 / (3 * 7)));
    expect(spans[1].minX - spans[0].maxX).toBeGreaterThan(5);
  });

  it('still fills a one-point stroke', () => {
    for (const tool of ['fountain', 'brush', 'calligraphy', 'dashed', 'dotted'] as const) {
      const shapes = strokeShapes([{ x: 5, y: 5 }], { tool, width: 3 });
      expect(shapes.length).toBe(1);
      expect(shapes[0].length).toBeGreaterThan(1);
    }
  });
});

describe('the pen library: the stroke record', () => {
  it('stores each pen as its own tool byte and reads it back', () => {
    for (const tool of [
      'pen',
      'pencil',
      'highlighter',
      'marker',
      'brush',
      'fountain',
      'calligraphy',
      'dashed',
      'dotted',
    ] as const) {
      expect(isKnownToolCode(codeOfTool(tool))).toBe(true);
      expect(toolFromCode(codeOfTool(tool))).toBe(tool);
      expect(WIDTH_PRESETS_MM[tool].length).toBeGreaterThan(3);
    }
    expect(toolFromCode(99)).toBe('pen');
  });
});
