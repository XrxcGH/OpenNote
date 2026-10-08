import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineStroke, makeStroke } from '../geometry/fixtures';
import { rectanglePath } from '../geometry/lasso';
import { createStrokeIndex } from '../geometry/strokeIndex';
import type { Bounds } from '../geometry/types';
import { LASSO_EVERYTHING } from '../edits/filters';
import { frameGrid, lassoAll, lassoBlocks, selectionFrame } from './lassoItems';
import type { BlockItem } from './lassoItems';

const frame = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });
const block = (id: string, f: Bounds, kind: BlockItem['kind'] = 'text'): BlockItem => ({ id, frame: f, kind });
const lasso = rectanglePath({ x: 0, y: 0 }, { x: 100, y: 100 });

describe('the lasso over blocks', () => {
  const items = [
    block('inside', frame(10, 10, 60, 60)),
    block('half', frame(50, 10, 150, 60)),
    block('mostly', frame(20, 20, 118, 60)),
    block('outside', frame(200, 200, 300, 300)),
  ];

  it('selects a block that is mostly inside by default', () => {
    expect(lassoBlocks(lasso, items).sort()).toEqual(['inside', 'mostly']);
  });

  it('selects any block that touches the lasso, or only blocks wholly inside', () => {
    expect(lassoBlocks(lasso, items, { mode: 'any' }).sort()).toEqual(['half', 'inside', 'mostly']);
    expect(lassoBlocks(lasso, items, { mode: 'all' })).toEqual(['inside']);
  });

  it('selects a big block when the lasso lies inside it, in any-part mode', () => {
    const big = [block('big', frame(-500, -500, 500, 500))];
    const small = rectanglePath({ x: 10, y: 10 }, { x: 20, y: 20 });
    expect(lassoBlocks(small, big, { mode: 'any' })).toEqual(['big']);
    expect(lassoBlocks(small, big)).toEqual([]);
  });

  it('returns nothing for a path that is not an area', () => {
    expect(
      lassoBlocks(
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        items,
      ),
    ).toEqual([]);
  });

  it('lays a grid of 64 points over a frame', () => {
    const grid = frameGrid(frame(0, 0, 80, 80));
    expect(grid).toHaveLength(64);
    expect(grid[0]).toEqual({ x: 5, y: 5 });
    expect(grid[63]).toEqual({ x: 75, y: 75 });
  });

  it('keeps the modes nested: all within mostly within any', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -50, max: 200 }),
            y: fc.integer({ min: -50, max: 200 }),
            w: fc.integer({ min: 5, max: 150 }),
            h: fc.integer({ min: 5, max: 150 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        fc.array(fc.record({ x: fc.integer({ min: -20, max: 220 }), y: fc.integer({ min: -20, max: 220 }) }), {
          minLength: 3,
          maxLength: 8,
        }),
        (rects, path) => {
          const list = rects.map((r, i) => block(`b${i}`, frame(r.x, r.y, r.x + r.w, r.y + r.h)));
          const all = new Set(lassoBlocks(path, list, { mode: 'all' }));
          const mostly = new Set(lassoBlocks(path, list, { mode: 'mostly' }));
          const any = new Set(lassoBlocks(path, list, { mode: 'any' }));
          for (const id of all) expect(mostly.has(id)).toBe(true);
          for (const id of mostly) expect(any.has(id)).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe('the lasso over ink and blocks', () => {
  const shape = makeStroke(
    'shape',
    [
      { x: 10, y: 80 },
      { x: 80, y: 80 },
    ],
    { bare: true },
  );
  const index = createStrokeIndex([
    lineStroke('ink', { x: 10, y: 20 }, { x: 80, y: 20 }),
    lineStroke('hl', { x: 10, y: 40 }, { x: 80, y: 40 }, 10, { tool: 'highlighter' }),
    shape,
  ]);
  const blocks = [
    block('words', frame(10, 50, 60, 70)),
    block('photo', frame(10, 55, 60, 75), 'image'),
    block('misc', frame(60, 50, 90, 70), 'other'),
  ];

  it('picks up everything with the default filter', () => {
    const picked = lassoAll(index, blocks, lasso, { filter: LASSO_EVERYTHING });
    expect(picked.strokes.sort()).toEqual(['hl', 'ink', 'shape']);
    expect(picked.blocks.sort()).toEqual(['misc', 'photo', 'words']);
  });

  it('leaves out the kinds the filter turns off', () => {
    const filter = { ink: false, highlighter: true, shapes: false, text: false, images: true };
    const picked = lassoAll(index, blocks, lasso, { filter });
    expect(picked.strokes).toEqual(['hl']);
    expect(picked.blocks.sort()).toEqual(['misc', 'photo']);
  });

  it('adds the caller skip to the filter', () => {
    const picked = lassoAll(index, blocks, lasso, { filter: LASSO_EVERYTHING, skip: (s) => s.id === 'ink' });
    expect(picked.strokes).not.toContain('ink');
  });

  it('frames strokes and blocks together', () => {
    expect(selectionFrame([], [])).toBeNull();
    const box = selectionFrame([index.get('ink')!], [block('far', frame(100, 100, 200, 300))])!;
    expect(box).toEqual({ minX: 10, minY: 20, maxX: 200, maxY: 300 });
  });
});
