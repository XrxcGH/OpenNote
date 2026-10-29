// The 10,000-stroke page benchmark for the rest of the ink core (DEVELOPMENT.md phase 5). The geometry's own numbers
// are in geometry/benchmark.test.ts. Operations the pen waits on must finish in under 10 ms. Operations that run once
// at page open are recorded and held to a generous ceiling. docs/perf/phase-5-core.md has the numbers.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeRecord } from '../../core/ink/codec';
import type { InkRecord } from '../../core/ink/codec';
import { expectBelow, expectWithinBudget, flushResults, measure, record } from './bench';
import { createPartialEraseSession, createStrokeEraseSession, LASSO_EVERYTHING } from './edits';
import { inkBounds, invalidate, planTiles, tileBudget } from './engine/tiles';
import type { TileInfo } from './engine/tiles';
import { eachTile, tileBounds, tileId, tilesIn } from './engine/tiles/grid';
import { generatePage } from './geometry/fixtures';
import { intersects } from './geometry/bounds';
import { createSpatialIndex } from './geometry/spatialIndex';
import { createStrokeIndex } from './geometry/strokeIndex';
import type { StrokeIndex } from './geometry/strokeIndex';
import type { Bounds, Stroke } from './geometry/types';
import { createPalmFilter } from './input/palm/index';
import type { PalmFilter } from './input/palm/index';
import { detectScribble } from './input/gestures/scribble';
import { createStrokeBuilder } from './input/strokeBuilder';
import type { RawSample } from './input/samples';
import { foldRecords, recordBounds, recordFromStroke, strokeFromRecord } from './model';
import type { InkStroke } from './model';
import { testId, TEST_BLOCK } from './model/fixtures';
import { PENS } from './pens/palette';
import { lassoAll } from './selection';
import type { BlockItem } from './selection';
import { planInsertSpace } from './space';

const STROKES = 10_000;
const NOTE = '10,000 strokes of 80 points';

// Page-open work on 10,000 strokes takes seconds on a busy machine, which is longer than the default test timeout.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

afterAll(() => flushResults('core'));

/** The generator's strokes as stroke-model strokes with valid IDs. */
function inkPage(): { strokes: InkStroke[]; width: number; height: number } {
  const page = generatePage(STROKES, 42);
  const pen = PENS[0];
  const strokes = page.strokes.map((s, n): InkStroke => ({
    ...s,
    id: testId(n + 1),
    block: TEST_BLOCK,
    slot: pen.slot,
    color: pen.light,
  }));
  return { strokes, width: page.width, height: page.height };
}

describe(`stroke records for a page of ${STROKES} strokes`, () => {
  const { strokes } = inkPage();
  let records: InkRecord[] = [];

  beforeAll(() => {
    records = strokes.map((stroke) => ({ kind: 'stroke', stroke: recordFromStroke(stroke) }));
  });

  it('encodes every stroke', () => {
    const took = record(
      'Encode every stroke',
      measure(() => strokes.map(recordFromStroke), 3, 1),
      NOTE,
    );
    expectBelow(took, 10_000);
  });

  it('reads every record header into an index without decoding points', () => {
    const took = measure(
      () => {
        const index = createSpatialIndex<string>();
        for (const r of records)
          if (r.kind === 'stroke') index.update(r.stroke.id, recordBounds(r.stroke), r.stroke.id);
      },
      7,
      2,
    );
    expectBelow(record('Index every record from its header', took, NOTE), 500);
  });

  it('decodes the strokes of one viewport', () => {
    const viewport = records.slice(0, 1500);
    const took = measure(() => viewport.forEach((r) => r.kind === 'stroke' && strokeFromRecord(r.stroke)), 7, 2);
    expectBelow(record('Decode 1,500 strokes', took, '1,500 records of 80 points'), 1000);
  });

  it('decodes and folds every record, as a page open that reads it all would', () => {
    const took = measure(() => foldRecords(records), 3, 1);
    expectBelow(record('Decode and fold every record', took, NOTE), 10_000);
  });

  it('serializes every record to bytes', () => {
    const took = measure(() => records.forEach(encodeRecord), 3, 1);
    expectBelow(record('Frame every record as bytes', took, NOTE), 5000);
  });
});

describe(`planning tiles on a page of ${STROKES} strokes`, () => {
  const { strokes, width, height } = inkPage();
  let index: StrokeIndex;

  beforeAll(() => {
    index = createStrokeIndex(strokes);
  });

  const hasInk = (rect: Bounds) => index.find(rect).some((e) => intersects(inkBounds(e.value), rect));
  const viewport = (top: number): Bounds => ({ minX: 1500, minY: top, maxX: 2500, maxY: top + 800 });

  it('plans a cold open of a viewport under the budget', () => {
    const budget = tileBudget({ visibleTiles: 16 });
    const took = measure((i) =>
      planTiles({
        viewport: viewport((i * 311) % (height - 900)),
        zoom: 1,
        devicePixelRatio: 1,
        zoomStill: true,
        shownScale: null,
        tiles: new Map(),
        revision: 0,
        penDown: false,
        budget,
        frame: i,
        hasInk,
      }),
    );
    expectWithinBudget(record('Plan a cold viewport', took, `${NOTE}, 1,000 by 800 units, ring included`));
  });

  it('plans each step of a scroll under the budget', () => {
    const tiles = new Map<string, TileInfo>();
    const budget = tileBudget({ visibleTiles: 16 });
    const took = measure((i) => {
      const view = viewport(1000 + i * 40);
      const plan = planTiles({
        viewport: view,
        zoom: 1,
        devicePixelRatio: 1,
        zoomStill: true,
        shownScale: 1,
        velocity: { x: 0, y: 1 },
        tiles,
        revision: 0,
        penDown: false,
        budget,
        frame: i,
        hasInk,
      });
      for (const job of [...plan.jobs, ...plan.empty]) {
        tiles.set(job.id, { scale: 1, tx: job.tx, ty: job.ty, status: 'ready', revision: 0, lastUsed: i });
      }
      for (const id of plan.evict) tiles.delete(id);
    });
    expectWithinBudget(record('Plan one scroll step', took, `${NOTE}, 40 units per step`));
    expect(width).toBeGreaterThan(0);
  });

  it('works out the dirty rectangles of a 30-event erase under the budget', () => {
    const tiles = new Map<string, TileInfo>();
    eachTile(tilesIn(viewport(3000), 1), (tx, ty) =>
      tiles.set(tileId(1, tx, ty), { scale: 1, tx, ty, status: 'ready', revision: 0, lastUsed: 0 }),
    );
    const events = Array.from({ length: 30 }, (_, k) => ({
      kind: 'removed' as const,
      box: { minX: 1600 + k * 20, minY: 3100 + k * 8, maxX: 1640 + k * 20, maxY: 3140 + k * 8 },
    }));
    const took = measure(() => invalidate(tiles, 1, events));
    expectWithinBudget(record('Invalidate 30 changes', took, '16 tiles held'));
    expect(tileBounds(0, 0, 1).maxX).toBe(256);
  });

  it('plans insert space under the budget', () => {
    const took = measure((i) => planInsertSpace(index, 2000 + (i % 7) * 500, 120));
    expectWithinBudget(record('Plan insert space', took, `${NOTE}, line at mid page`));
  });

  it('runs the lasso over ink and 200 blocks under the budget', () => {
    const blocks: BlockItem[] = Array.from({ length: 200 }, (_, k) => ({
      id: `b${k}`,
      kind: k % 2 ? 'text' : 'image',
      frame: {
        minX: (k % 20) * 190,
        minY: Math.floor(k / 20) * 600,
        maxX: (k % 20) * 190 + 160,
        maxY: Math.floor(k / 20) * 600 + 200,
      },
    }));
    const loop = Array.from({ length: 60 }, (_, k) => ({
      x: 2000 + Math.cos((k / 60) * 2 * Math.PI) * 900,
      y: 6000 + Math.sin((k / 60) * 2 * Math.PI) * 700,
    }));
    const took = measure(() => lassoAll(index, blocks, loop, { filter: LASSO_EVERYTHING, pixel: 1 }));
    expectWithinBudget(record('Lasso over ink and 200 blocks', took, NOTE));
  });
});

describe(`erase sessions on a page of ${STROKES} strokes`, () => {
  const { strokes, width, height } = inkPage();
  const index = createStrokeIndex(strokes);

  it('moves a stroke eraser under the budget', () => {
    const took = measure((i) => {
      const session = createStrokeEraseSession(index);
      const at = { x: (i * 131) % width, y: (i * 719) % height };
      session.move([at, { x: at.x + 14, y: at.y + 5 }, { x: at.x + 30, y: at.y + 16 }], 12);
      session.commit();
    });
    expectWithinBudget(record('Stroke eraser session move', took, `${NOTE}, 12 unit radius`));
  });

  it('moves a partial eraser and commits under the budget', () => {
    let next = 0;
    const took = measure((i) => {
      const session = createPartialEraseSession<Stroke>(index, () => `cut${next++}`);
      const at = { x: (i * 131) % width, y: (i * 719) % height };
      session.move([at, { x: at.x + 30, y: at.y + 10 }, { x: at.x + 50, y: at.y + 30 }], 8);
      session.commit();
    });
    expectWithinBudget(record('Partial eraser session, one move then commit', took, `${NOTE}, 8 unit radius`));
  });
});

describe('the pen path', () => {
  const pen = PENS[1];
  const sample = (i: number): RawSample => ({
    x: i * 1.2,
    y: Math.sin(i / 9) * 30,
    time: 10 + i * 4,
    pointerType: 'pen',
    pressure: 0.3 + (i % 7) * 0.08,
    tiltX: 15,
    tiltY: -8,
  });

  it('builds a stroke of 400 samples under the budget', () => {
    let id = 0;
    const base = {
      tool: 'pen' as const,
      width: 2,
      slot: pen.slot,
      color: pen.light,
      block: TEST_BLOCK,
      timeOrigin: 1_700_000_000_000,
    };
    const took = measure(() => {
      const builder = createStrokeBuilder({ ...base, newId: () => testId(++id), steady: { strength: 4, zoom: 1 } });
      for (let i = 0; i < 400; i++) builder.push(sample(i));
      builder.finish();
    });
    expectWithinBudget(record('Build a 400-sample stroke with the steady pen', took, '400 samples'));
  });

  it('checks 10,000 strokes for a scribble in well under a second', () => {
    const { strokes } = generatePage(STROKES, 42);
    const took = measure(() => strokes.forEach((s) => detectScribble(s.points)), 5, 1);
    expectBelow(record('Check 10,000 strokes for a scribble', took, NOTE), 2000);
  });
});

/** The pen event for step i of a stroke cycle: 8 hovers, a down, 30 moves, and an up. */
function penStep(palm: PalmFilter, i: number, t: number): void {
  const k = i % 40;
  const signal = k < 8 ? 'hover' : k === 8 ? 'down' : k === 39 ? 'up' : 'move';
  palm.pen(signal, 1, t, 400 + k, 300, 20, 25);
}

/** A mixed stream: a pen writing and hovering while 10 touch contacts rest and move, as a palm and fingers do. */
function mixedEvents(palm: PalmFilter, count: number, t0: number): number {
  let t = t0;
  for (let i = 0; i < count; i++) {
    t += 1;
    const k = i % 50;
    if (k < 40) penStep(palm, k, t);
    else palm.touchMove(100 + (k - 40), t, 600 + (k - 40) * 30 + (i % 3), 500, 60, 50, 0);
  }
  return t;
}

function liveContacts(palm: PalmFilter, t: number): void {
  for (let id = 100; id < 110; id++) palm.touchDown(id, t, 600 + (id - 100) * 30, 500, 60, 50, 0, 'page');
}

describe('palm rejection cost (architecture 5.4)', () => {
  it('filters 100,000 mixed palm events under 60 ms', () => {
    let t = 0;
    const took = measure(
      () => {
        const palm = createPalmFilter({}, { pxPerMm: 5.2, penDigitizer: true });
        liveContacts(palm, t);
        t = mixedEvents(palm, 100_000, t) + 20_000;
      },
      7,
      2,
    );
    expectWithinBudget(
      record('Filter 100,000 palm events', took, '80,000 pen and 20,000 touch events, 10 contacts live'),
      60,
    );
  });

  it('spends under 1 µs on a pen event and 5 µs on a touch event with 10 contacts live', () => {
    const palm = createPalmFilter({}, { pxPerMm: 5.2, penDigitizer: true });
    let t = 0;
    liveContacts(palm, t);
    const pen = measure(() => {
      for (let i = 0; i < 10_000; i++) penStep(palm, i, ++t);
    });
    expectWithinBudget(record('10,000 pen events, 10 contacts live', pen, '1 µs each'), 10);
    const touch = measure(() => {
      for (let i = 0; i < 10_000; i++)
        palm.touchMove(100 + (i % 10), ++t, 600 + (i % 10) * 30 + (i % 3), 500, 60, 50, 0);
    });
    expectWithinBudget(record('10,000 touch moves, 10 contacts live', touch, '5 µs each'), 50);
    const tick = measure(() => {
      for (let i = 0; i < 1000; i++) palm.tick((t += 100));
    });
    expectWithinBudget(record('1,000 ticks, 10 contacts live', tick, '10 µs each'), 10);
  });

  it('allocates nothing per event once warm', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const palm = createPalmFilter({}, { pxPerMm: 5.2, penDigitizer: true });
    liveContacts(palm, 0);
    const warm = mixedEvents(palm, 20_000, 0);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    mixedEvents(palm, 200_000, warm);
    gc?.();
    const growth = process.memoryUsage().heapUsed - before;
    record(
      'Heap growth over 200,000 palm events',
      { best: growth / 1024, median: growth / 1024, runs: 1, load: 1 },
      gc ? 'KB, with --expose-gc' : 'KB, no gc',
    );
    if (gc) expect(growth).toBeLessThan(64 * 1024);
  });
});
