// Review findings on the tile planner: a zoom gesture that goes out never trims what it plans (high), and the
// eviction room counted ring tiles that the trim drops, so a scale switch gave back the old tiles still on screen.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Bounds } from '../../geometry/types';
import { tileBudget } from './budget';
import { eachTile, tileId, tilesIn } from './grid';
import { planTiles, visibleTileCount } from './planner';
import type { PlanInput, TileInfo } from './planner';

/** A 1500 by 900 view at a zoom, in page units, from the origin. */
const view = (zoom: number): Bounds => ({ minX: 0, minY: 0, maxX: 1500 / zoom, maxY: 900 / zoom });

function held(scale: number, viewport: Bounds): Map<string, TileInfo> {
  const tiles = new Map<string, TileInfo>();
  eachTile(tilesIn(viewport, scale), (tx, ty) =>
    tiles.set(tileId(scale, tx, ty), { scale, tx, ty, status: 'ready', revision: 0, lastUsed: 0 }),
  );
  return tiles;
}

const input = (zoom: number, extra: Partial<PlanInput>): PlanInput => ({
  viewport: view(zoom),
  zoom,
  devicePixelRatio: 2,
  zoomStill: false,
  shownScale: 4,
  tiles: held(4, view(2)),
  revision: 0,
  penDown: false,
  budget: tileBudget({ visibleTiles: visibleTileCount(view(2), 4) }),
  frame: 2,
  ...extra,
});

describe('the tile planner during a zoom out', () => {
  it('never plans more tiles than the budget holds', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 1.9, noNaN: true }), (zoom) => {
        const budget = tileBudget({ visibleTiles: visibleTileCount(view(2), 4) });
        const plan = planTiles(input(zoom, { budget }));
        expect(plan.retained).toBeLessThanOrEqual(budget.maxTiles);
        expect(plan.jobs.length).toBeLessThanOrEqual(budget.maxTiles);
        expect(plan.empty.length).toBeLessThanOrEqual(budget.maxTiles);
      }),
      { numRuns: 40 },
    );
  });

  it('plans quickly even at a tenth of the zoom', () => {
    const started = performance.now();
    planTiles(input(0.1, {}));
    expect(performance.now() - started).toBeLessThan(20);
  });
});

describe('the tile planner at a scale switch with the real budget', () => {
  it('keeps the old tiles on screen until the new ones cover the view', () => {
    const viewport = view(1);
    const old = held(4, view(2));
    const budget = tileBudget({ visibleTiles: visibleTileCount(viewport, 2) });
    const plan = planTiles({
      viewport,
      zoom: 1,
      devicePixelRatio: 2,
      zoomStill: true,
      shownScale: 4,
      tiles: old,
      revision: 0,
      penDown: false,
      budget,
      frame: 3,
    });
    expect(plan.scale).toBe(2);
    expect(plan.overview).toBe(true);
    const onScreen = [...old.values()].filter((info) => info.tx * 64 < 1500 && info.ty * 64 < 900);
    const evicted = new Set(plan.evict);
    expect(onScreen.filter((info) => evicted.has(tileId(info.scale, info.tx, info.ty)))).toEqual([]);
  });
});
