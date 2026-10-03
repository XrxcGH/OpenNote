import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsBounds } from '../../geometry/bounds';
import type { Bounds } from '../../geometry/types';
import { backgroundBudget, hiddenCacheBytes, tileBudget } from './budget';
import {
  BYTES_PER_TILE,
  eachTile,
  rangeCount,
  scaleChanged,
  settledScale,
  tileBounds,
  tileId,
  tilesIn,
  tileSpan,
} from './grid';
import { dirtyRect, invalidate } from './invalidate';
import { planTiles } from './planner';
import type { PlanInput, TileInfo } from './planner';

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });

function grown(b: Bounds, by: number): Bounds {
  return box(b.minX - by, b.minY - by, b.maxX + by, b.maxY + by);
}

function tile(scale: number, tx: number, ty: number, extra: Partial<TileInfo> = {}): [string, TileInfo] {
  return [tileId(scale, tx, ty), { scale, tx, ty, status: 'ready', revision: 0, lastUsed: 0, ...extra }];
}

const plan = (extra: Partial<PlanInput> = {}) =>
  planTiles({
    viewport: box(0, 0, 500, 500),
    zoom: 1,
    devicePixelRatio: 1,
    zoomStill: true,
    shownScale: null,
    tiles: new Map(),
    revision: 0,
    penDown: false,
    budget: { maxTiles: 100 },
    frame: 1,
    ...extra,
  });

/** Every tile of the viewport at a scale, as fresh tiles. */
function fresh(scale: number, viewport: Bounds, extra: Partial<TileInfo> = {}): Map<string, TileInfo> {
  const tiles = new Map<string, TileInfo>();
  eachTile(tilesIn(viewport, scale), (tx, ty) => tiles.set(...tile(scale, tx, ty, extra)));
  return tiles;
}

describe('the tile grid', () => {
  it('covers 256 device pixels, so 256 page units at scale 1 and half that at scale 2', () => {
    expect(tileSpan(1)).toBe(256);
    expect(tileSpan(2)).toBe(128);
    expect(tileBounds(-1, 2, 1)).toEqual(box(-256, 512, 0, 768));
  });

  it('finds the tiles a rectangle touches, and stops at an edge', () => {
    expect(tilesIn(box(0, 0, 256, 256), 1)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(tilesIn(box(0, 0, 256.5, 256), 1)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
    expect(tilesIn(box(-1, -1, 1, 1), 1)).toEqual({ x0: -1, y0: -1, x1: 0, y1: 0 });
    expect(rangeCount(tilesIn(box(0, 0, 1000, 700), 1))).toBe(4 * 3);
  });

  it('covers every point of a rectangle with the tiles it reports', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0.0625, max: 8, noNaN: true }),
        (x, y, w, h, scale) => {
          const rect = box(x, y, x + w, y + h);
          const range = tilesIn(rect, scale);
          const first = tileBounds(range.x0, range.y0, scale);
          const last = tileBounds(range.x1, range.y1, scale);
          const union = box(first.minX, first.minY, last.maxX, last.maxY);
          expect(containsBounds(grown(union, 1e-6), rect)).toBe(true);
        },
      ),
    );
  });

  it('settles at the zoom times the pixel ratio, kept between 1/16 and 8', () => {
    expect(settledScale(1.5, 1.25)).toBeCloseTo(1.875, 9);
    expect(settledScale(0.01, 1)).toBe(1 / 16);
    expect(settledScale(20, 2)).toBe(8);
  });

  it('redraws only when the scale moved by more than 7 percent', () => {
    expect(scaleChanged(1, 1.06)).toBe(false);
    expect(scaleChanged(1, 1.08)).toBe(true);
    expect(scaleChanged(1, 0.94)).toBe(false);
    expect(scaleChanged(1, 0.9)).toBe(true);
  });
});

describe('planning tiles for a view', () => {
  it('draws the visible tiles first, then the ring, nearest to the center first', () => {
    const p = plan();
    expect(p.scale).toBe(1);
    expect(p.jobs.filter((j) => j.priority === 1)).toHaveLength(4);
    expect(p.jobs.slice(0, 4).every((j) => j.priority === 1)).toBe(true);
    expect(p.jobs.filter((j) => j.priority === 2)).toHaveLength(12);
    expect(p.overview).toBe(true);
    expect(p.visible).toEqual([]);
  });

  it('plans nothing for a view whose tiles are all fresh', () => {
    const tiles = fresh(1, box(-256, -256, 768, 768));
    const p = plan({ tiles, shownScale: 1 });
    expect(p.jobs).toEqual([]);
    expect(p.overview).toBe(false);
    expect(p.visible).toHaveLength(4);
    expect(p.evict).toEqual([]);
  });

  it('marks tiles with no ink empty, and shows no overview for them', () => {
    const p = plan({ hasInk: (rect) => rect.minX < 256 && rect.minY < 256 });
    expect(p.jobs.filter((j) => j.priority === 1)).toHaveLength(1);
    expect(p.empty.length).toBeGreaterThan(3);
    const nothing = plan({ hasInk: () => false });
    expect(nothing.jobs).toEqual([]);
    expect(nothing.overview).toBe(false);
  });

  it('starts no jobs at a new scale during a zoom gesture, and sharpens after a big zoom in', () => {
    const tiles = fresh(1, box(-256, -256, 768, 768));
    const during = plan({ tiles, shownScale: 1, zoom: 1.5, zoomStill: false });
    expect(during.scale).toBe(1);
    expect(during.jobs).toEqual([]);
    const big = plan({ tiles, shownScale: 1, zoom: 3, zoomStill: false });
    expect(big.scale).toBe(1);
    expect(big.jobs.length).toBeGreaterThan(0);
    expect(big.jobs.every((j) => j.priority === 2 && j.scale === 3)).toBe(true);
    expect(big.evict).toEqual([]);
  });

  it('switches scale once the zoom is still and the scale moved enough', () => {
    const tiles = fresh(1, box(-256, -256, 768, 768));
    expect(plan({ tiles, shownScale: 1, zoom: 1.05 }).scale).toBe(1);
    const changed = plan({ tiles, shownScale: 1, zoom: 2 });
    expect(changed.scale).toBe(2);
    expect(changed.jobs.length).toBeGreaterThan(0);
    expect(changed.evict).toEqual([]);
    expect(changed.overview).toBe(true);
  });

  it('gives the old tiles back once the new set covers the view', () => {
    const both = new Map([...fresh(1, box(-256, -256, 768, 768)), ...fresh(2, box(-128, -128, 640, 640))]);
    const p = plan({ tiles: both, shownScale: 1, zoom: 2 });
    expect(p.scale).toBe(2);
    expect(p.evict).toHaveLength(16);
    expect(p.evict.every((id) => id.startsWith('1.0000'))).toBe(true);
  });

  it('pauses the ring while a pen is down', () => {
    const p = plan({ penDown: true });
    expect(p.jobs.every((j) => j.priority === 1)).toBe(true);
    expect(p.jobs).toHaveLength(4);
  });

  it('draws rows ahead of a fast scroll, in the direction of travel', () => {
    const calm = plan({ velocity: { x: 0, y: 0.1 } });
    const down = plan({ velocity: { x: 0, y: 2 } });
    const up = plan({ velocity: { x: 0, y: -2 } });
    expect(down.jobs.length).toBeGreaterThan(calm.jobs.length);
    expect(Math.max(...down.jobs.map((j) => j.ty))).toBeGreaterThan(Math.max(...calm.jobs.map((j) => j.ty)));
    expect(Math.min(...up.jobs.map((j) => j.ty))).toBeLessThan(Math.min(...calm.jobs.map((j) => j.ty)));
  });

  it('redraws stale tiles: visible ones first, hidden ones last', () => {
    const old = fresh(1, box(-256, -256, 1024, 1024));
    old.set(...tile(1, 10, 10));
    const p = plan({ tiles: old, shownScale: 1, revision: 1 });
    expect(p.jobs.filter((j) => j.priority === 1)).toHaveLength(4);
    expect(p.jobs.some((j) => j.priority === 3 && j.tx === 10)).toBe(true);
    const priorities = p.jobs.map((j) => j.priority);
    expect(priorities).toEqual([...priorities].sort());
    expect(p.overview).toBe(true);
  });
});

describe('the tile budget', () => {
  it('keeps the visible tiles whatever the budget, and trims the ring first', () => {
    const p = plan({ budget: { maxTiles: 6 } });
    expect(p.jobs.filter((j) => j.priority === 1)).toHaveLength(4);
    expect(p.jobs.length).toBeLessThanOrEqual(6);
    expect(plan({ budget: { maxTiles: 1 } }).jobs).toHaveLength(4);
  });

  it('gives back the least recently used tiles nothing wants when over budget', () => {
    const tiles = fresh(1, box(-256, -256, 768, 768), { lastUsed: 9 });
    for (let k = 0; k < 6; k++) tiles.set(...tile(1, 20 + k, 20, { lastUsed: k }));
    const p = plan({ tiles, shownScale: 1, budget: { maxTiles: 19 } });
    expect(p.evict.sort()).toEqual([tileId(1, 20, 20), tileId(1, 21, 20), tileId(1, 22, 20)].sort());
  });

  it('sizes the hidden cache from what the split leaves', () => {
    expect(hiddenCacheBytes({ visibleTiles: 30 })).toBe(6 * 1024 * 1024);
    expect(hiddenCacheBytes({ visibleTiles: 60 })).toBe(0);
    expect(hiddenCacheBytes({ visibleTiles: 40 })).toBe(1 * 1024 * 1024);
    expect(tileBudget({ visibleTiles: 30 }).maxTiles).toBe(30 + 12);
    expect(backgroundBudget(30).maxTiles).toBe(30);
    expect(BYTES_PER_TILE).toBe(262_144);
  });
});

describe('planning under random cameras', () => {
  const camera = fc.record({
    x: fc.integer({ min: -3000, max: 3000 }),
    y: fc.integer({ min: -3000, max: 3000 }),
    w: fc.integer({ min: 100, max: 1500 }),
    h: fc.integer({ min: 100, max: 1500 }),
    zoom: fc.double({ min: 0.1, max: 6, noNaN: true }),
    still: fc.boolean(),
    pen: fc.boolean(),
    budget: fc.integer({ min: 1, max: 60 }),
    vy: fc.double({ min: -3, max: 3, noNaN: true }),
  });

  it('covers every visible tile, repeats no job, and keeps the visible tiles', () => {
    fc.assert(
      fc.property(camera, (c) => {
        const viewport = box(c.x, c.y, c.x + c.w, c.y + c.h);
        const p = plan({
          viewport,
          zoom: c.zoom,
          zoomStill: c.still,
          penDown: c.pen,
          budget: { maxTiles: c.budget },
          velocity: { x: 0, y: c.vy },
        });
        expect(new Set(p.jobs.map((j) => j.id)).size).toBe(p.jobs.length);
        const planned = new Set([...p.jobs, ...p.empty].map((j) => j.id));
        eachTile(tilesIn(viewport, p.scale), (tx, ty) => expect(planned.has(tileId(p.scale, tx, ty))).toBe(true));
        if (p.jobs.some((j) => j.priority > 1)) expect(p.retained).toBeLessThanOrEqual(c.budget);
        const priorities = p.jobs.map((j) => j.priority);
        expect(priorities).toEqual([...priorities].sort());
      }),
      { numRuns: 120 },
    );
  });
});

describe('invalidating tiles', () => {
  const tiles = fresh(1, box(-256, -256, 768, 768));

  it('grows the box by a device pixel, snaps it outward, and clips it to the tile', () => {
    expect(dirtyRect(box(10.3, 20.6, 30.2, 40.1), 1, 0, 0)).toEqual({ x: 9, y: 19, width: 23, height: 23 });
    expect(dirtyRect(box(-50, -50, 400, 400), 1, 0, 0)).toEqual({ x: 0, y: 0, width: 256, height: 256 });
    expect(dirtyRect(box(300, 0, 310, 10), 1, 0, 0)).toBeNull();
    expect(dirtyRect(box(10, 10, 20, 20), 2, 0, 0)).toEqual({ x: 19, y: 19, width: 22, height: 22 });
  });

  it('lists the tiles a change meets', () => {
    const result = invalidate(tiles, 1, [{ kind: 'removed', box: box(250, 250, 270, 270) }]);
    expect(result.dirty.map((d) => [d.tx, d.ty]).sort()).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(result.all).toBe(false);
    expect(result.dirty.every((d) => !d.onTop)).toBe(true);
  });

  it('draws added ink on top, unless a removal shares the tile', () => {
    const added = invalidate(tiles, 1, [{ kind: 'added', box: box(10, 10, 20, 20) }]);
    expect(added.dirty).toHaveLength(1);
    expect(added.dirty[0].onTop).toBe(true);
    const mixed = invalidate(tiles, 1, [
      { kind: 'added', box: box(10, 10, 20, 20) },
      { kind: 'removed', box: box(100, 100, 110, 110) },
    ]);
    expect(mixed.dirty).toHaveLength(1);
    expect(mixed.dirty[0].onTop).toBe(false);
    expect(mixed.dirty[0].rect).toEqual({ x: 9, y: 9, width: 102, height: 102 });
  });

  it('redraws both the old and the new place of a move', () => {
    const moved = { kind: 'transformed', before: box(10, 10, 20, 20), after: box(300, 300, 310, 310) } as const;
    const result = invalidate(tiles, 1, [moved]);
    expect(result.dirty.map((d) => [d.tx, d.ty]).sort()).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('marks every tile stale for a theme change, and skips tiles that do not exist', () => {
    expect(invalidate(tiles, 1, [{ kind: 'theme' }])).toEqual({ dirty: [], all: true });
    expect(invalidate(tiles, 1, [{ kind: 'restyled', box: box(5000, 5000, 5100, 5100) }]).dirty).toEqual([]);
    expect(invalidate(tiles, 2, [{ kind: 'restyled', box: box(0, 0, 10, 10) }]).dirty).toEqual([]);
  });

  it('flags an empty tile that gains ink', () => {
    const map = new Map([tile(1, 0, 0, { status: 'empty' })]);
    expect(invalidate(map, 1, [{ kind: 'added', box: box(5, 5, 9, 9) }]).dirty[0].wasEmpty).toBe(true);
  });
});

describe('invalidation under random changes', () => {
  const arbitrary = fc.record({
    x: fc.double({ min: -200, max: 600, noNaN: true }),
    y: fc.double({ min: -200, max: 600, noNaN: true }),
    w: fc.double({ min: 0, max: 400, noNaN: true }),
    h: fc.double({ min: 0, max: 400, noNaN: true }),
    scale: fc.constantFrom(0.5, 1, 1.5, 2),
  });

  it('returns whole-pixel rectangles inside the tile that cover the box', () => {
    fc.assert(
      fc.property(arbitrary, ({ x, y, w, h, scale }) => {
        const all = fresh(scale, box(-512, -512, 1024, 1024));
        const change = box(x, y, x + w, y + h);
        const { dirty } = invalidate(all, scale, [{ kind: 'removed', box: change }]);
        for (const d of dirty) {
          expect(Number.isInteger(d.rect.x) && Number.isInteger(d.rect.width)).toBe(true);
          expect(d.rect.x + d.rect.width).toBeLessThanOrEqual(256);
          expect(d.rect.y + d.rect.height).toBeLessThanOrEqual(256);
        }
        const covered = (px: number, py: number) =>
          dirty.some((d) => {
            const t = tileBounds(d.tx, d.ty, scale);
            const [dx, dy] = [(px - t.minX) * scale, (py - t.minY) * scale];
            const inX = dx >= d.rect.x - 1e-9 && dx <= d.rect.x + d.rect.width + 1e-9;
            return inX && dy >= d.rect.y - 1e-9 && dy <= d.rect.y + d.rect.height + 1e-9;
          });
        const mid = [(change.minX + change.maxX) / 2, (change.minY + change.maxY) / 2];
        for (const [px, py] of [[change.minX, change.minY], [change.maxX, change.maxY], mid]) {
          expect(covered(px, py)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
