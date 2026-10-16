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
  it('times each stroke by when it began and how long it took, and skips imported ink with no clock', () => {
    const entries = replayEntries([
      stroke('a', 1000, [0, 100, 400]),
      stroke('b', 5000, [0, 50], { startUnknown: true }),
      stroke('c', 9000, []),
    ]);
    expect(entries).toEqual([{ id: 'a', startMs: 1000, durationMs: 400 }]);
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
