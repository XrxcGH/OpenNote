import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineStroke } from '../geometry/fixtures';
import { createStrokeIndex } from '../geometry/strokeIndex';
import type { Vec } from '../geometry/types';
import { circle, scribble } from '../input/gestures/corpus';
import type { InkStroke } from '../model/types';
import { CIRCLE_WAIT_MS, createGestures } from './gestures';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

const inkStroke = (id: string, from: Vec, to: Vec): InkStroke =>
  ({ ...lineStroke(id, from, to), block: 'layer', slot: 1, color: [0, 0, 0, 255] }) as InkStroke;

function setup() {
  const index = createStrokeIndex();
  // Three short strokes of a word, inside the shapes the tests draw around them.
  for (const [i, x] of [-30, 0, 30].entries()) index.put(inkStroke(`word${i}`, { x, y: -4 }, { x: x + 20, y: 4 }));
  const calls = { remove: [] as string[][], add: [] as InkStroke[][], preview: 0, selected: [] as string[][] };
  const surface = {
    readOnly: false,
    index,
    cameraNow: () => ({ zoom: 1 }),
    remove: (ids: string[]) => {
      calls.remove.push(ids);
      return Promise.resolve(true);
    },
    add: (strokes: InkStroke[]) => {
      calls.add.push(strokes);
      return Promise.resolve(true);
    },
    preview: () => void calls.preview++,
    endPreview: () => undefined,
    clearLive: () => undefined,
  } as unknown as InkSurface;
  const host = {
    layer: { get: () => null },
    queue: { get: () => null },
    selection: { get: () => ({ blocks: [], strokes: [] }) },
    select: (next: { strokes: string[] }) => void calls.selected.push(next.strokes),
  } as unknown as InkHost;
  return { surface, host, calls, gestures: createGestures(host) };
}

const asStroke = (points: ReturnType<typeof circle>): InkStroke =>
  ({ id: 'drawn', tool: 'pen', points, block: 'layer', slot: 1, color: [0, 0, 0, 255] }) as unknown as InkStroke;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the pen gestures', () => {
  it('erases the ink under a scribble and keeps the scribble out of the page', async () => {
    const { gestures, surface, calls } = setup();
    const taken = await gestures.ended(
      {
        strokes: [asStroke(scribble(1, 7, 100, 30).map((p) => ({ ...p, x: p.x - 40, y: p.y - 15 })))],
        tool: 'pen',
        endAt: 500,
        downAt: 0,
        travelPx: 90,
      },
      surface,
    );
    expect(taken).toBe(true);
    expect(calls.remove).toHaveLength(1);
    expect(calls.remove[0].length).toBeGreaterThan(0);
    expect(calls.add).toHaveLength(0);
  });

  it('selects what a circle holds when a quick tap lands inside it', async () => {
    const { gestures, surface, calls } = setup();
    const loop = asStroke(circle(2, 80, { x: 0, y: 0 }));
    expect(await gestures.ended({ strokes: [loop], tool: 'pen', endAt: 1000, downAt: 0, travelPx: 300 }, surface)).toBe(
      true,
    );
    expect(calls.add).toHaveLength(0);
    const tap = asStroke([{ x: 2, y: 2 }]);
    expect(await gestures.ended({ strokes: [tap], tool: 'pen', endAt: 1300, downAt: 1250, travelPx: 0 }, surface)).toBe(
      true,
    );
    expect(calls.selected).toHaveLength(1);
    expect(calls.selected[0].length).toBeGreaterThan(0);
    expect(calls.add).toHaveLength(0);
  });

  it('turns a circle into ink when no tap comes in a second', async () => {
    const { gestures, surface, calls } = setup();
    const loop = asStroke(circle(2, 80, { x: 0, y: 0 }));
    await gestures.ended({ strokes: [loop], tool: 'pen', endAt: 1000, downAt: 0, travelPx: 300 }, surface);
    await vi.advanceTimersByTimeAsync(CIRCLE_WAIT_MS + 10);
    expect(calls.add).toEqual([[loop]]);
    expect(calls.selected).toHaveLength(0);
  });

  it('adds the circle when the next contact lands outside it', async () => {
    const { gestures, surface, calls } = setup();
    const loop = asStroke(circle(2, 80, { x: 0, y: 0 }));
    await gestures.ended({ strokes: [loop], tool: 'pen', endAt: 1000, downAt: 0, travelPx: 300 }, surface);
    gestures.down({ x: 400, y: 400 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.add).toEqual([[loop]]);
  });

  it('leaves ordinary strokes alone', async () => {
    const { gestures, surface } = setup();
    const word = asStroke([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(await gestures.ended({ strokes: [word], tool: 'pen', endAt: 100, downAt: 0, travelPx: 20 }, surface)).toBe(
      false,
    );
  });
});
