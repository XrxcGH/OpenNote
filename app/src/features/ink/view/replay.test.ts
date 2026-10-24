import { describe, expect, it } from 'vitest';
import { InkReplay } from '../../../core/audio/replay';
import type { InkStroke } from '../model/types';
import { partialStroke, replayEntries } from './replay';

const stroke = (id: string, startTime: number, times: number[], extra: Partial<InkStroke> = {}): InkStroke =>
  ({
    id,
    tool: 'pen',
    width: 2,
    startTime,
    points: times.map((time, i) => ({ x: i * 10, y: 0, time })),
    block: 'layer',
    slot: 1,
    color: [0, 0, 0, 255],
    ...extra,
  }) as InkStroke;

describe('ink replay on the page', () => {
  it('times each stroke by when it began and how long it took, and plays ink with no clock after it', () => {
    const entries = replayEntries([
      stroke('a', 1000, [0, 100, 400]),
      stroke('b', 5000, [0, 50], { startUnknown: true }),
      stroke('c', 9000, []),
      stroke('d', 0, [], {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b', 'd']);
    expect(entries[0]).toEqual({ id: 'a', startMs: 1000, durationMs: 400 });
    // Untimed ink follows the timed ink, one stroke after another.
    expect(entries[1].startMs).toBeGreaterThanOrEqual(1400);
    expect(entries[2].startMs).toBeGreaterThan(entries[1].startMs);
  });

  it('plays shapes that carry no times, which used to leave Replay with nothing to show', () => {
    const shape = stroke('s', 0, [], {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 0 },
      ],
    });
    const entries = replayEntries([shape]);
    expect(entries).toHaveLength(1);
    expect(new InkReplay(entries).durationMs).toBeGreaterThan(0);
    const half = partialStroke(shape, 0.5);
    expect(half.points.length).toBeGreaterThan(1);
    expect(half.points.length).toBeLessThan(shape.points.length + 1);
    expect(partialStroke(shape, 1).points).toHaveLength(4);
    expect(partialStroke(shape, 0).points).toHaveLength(1);
  });

  it('keeps a very quick stroke on screen long enough to see', () => {
    expect(replayEntries([stroke('a', 0, [0, 20])])[0].durationMs).toBeGreaterThanOrEqual(300);
  });

  it('draws a stroke as far as it has come', () => {
    const half = partialStroke(stroke('a', 0, [0, 100, 200, 300, 400]), 0.5);
    expect(half.points.map((p) => p.time)).toEqual([0, 100, 200]);
    expect(partialStroke(stroke('a', 0, [0, 100]), 0).points).toHaveLength(1);
    expect(half.id).not.toBe('a');
  });

  it('shortens a long pause between strokes, and keeps it when asked', () => {
    const entries = replayEntries([stroke('a', 0, [0, 500]), stroke('b', 60_000, [0, 500])]);
    expect(new InkReplay(entries, { maxGapMs: 1000 }).durationMs).toBeLessThan(3000);
    expect(new InkReplay(entries, { maxGapMs: null }).durationMs).toBeGreaterThan(60_000);
  });
});
