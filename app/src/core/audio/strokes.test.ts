import { describe, expect, it } from 'vitest';
import { entry } from './fake';
import { captureOf, strokeEntries, strokeEntry, unixOf } from './strokes';

const clock = { unixMs: 1_000_000, captureNs: 50_000_000_000 };
const recording = { ...entry('r1'), clock, startedNs: 50_000_000_000, endedNs: 80_000_000_000 };

describe('strokes', () => {
  it('converts between the two clocks', () => {
    expect(captureOf(clock, 1_002_500)).toBe(52_500_000_000);
    expect(unixOf(clock, 52_500_999_999)).toBe(1_002_500);
    expect(captureOf(clock, 0)).toBe(0);
  });

  it('gives a stroke the capture times it was drawn at', () => {
    expect(strokeEntry(recording, { id: 's', startMs: 1_010_000, durationMs: 800 })).toEqual({
      recording: 'r1',
      startNs: 60_000_000_000,
      endNs: 60_800_000_000,
      target: { type: 'stroke', id: 's' },
    });
  });

  it('leaves out strokes that began outside the recording, and recordings with no anchor', () => {
    expect(strokeEntry(recording, { id: 's', startMs: 999_999, durationMs: 1 })).toBeNull();
    expect(strokeEntry(recording, { id: 's', startMs: 1_030_001, durationMs: 1 })).toBeNull();
    expect(strokeEntry({ ...recording, clock: undefined }, { id: 's', startMs: 1_010_000, durationMs: 1 })).toBeNull();
    // Still going when the recording ended: it keeps its start.
    expect(strokeEntry(recording, { id: 's', startMs: 1_029_000, durationMs: 5_000 })?.startNs).toBe(79_000_000_000);
  });

  it('finds a stroke in every recording that was running', () => {
    const second = {
      ...recording,
      id: 'r2',
      startedNs: 70_000_000_000,
      endedNs: 90_000_000_000,
      clock: { unixMs: 1_020_000, captureNs: 70_000_000_000 },
    };
    const found = strokeEntries([recording, second], [{ id: 'a', startMs: 1_025_000, durationMs: 10 }]);
    expect(found.map((e) => e.recording)).toEqual(['r1', 'r2']);
  });
});
