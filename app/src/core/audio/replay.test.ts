import { describe, expect, it } from 'vitest';
import { entry } from './fake';
import { PositionMap } from './positions';
import { InkReplay, type ReplayStroke } from './replay';

const stroke = (id: string, startMs: number, durationMs: number): ReplayStroke => ({ id, startMs, durationMs });

describe('InkReplay', () => {
  it('replays strokes in the order they were written, whatever order they arrive in', () => {
    const replay = new InkReplay([stroke('b', 2_000, 500), stroke('a', 1_000, 500)], { maxGapMs: null });
    expect(replay.strokes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(replay.durationMs).toBe(1_500);
    expect(replay.frameAt(0)).toEqual({ done: [], drawing: [{ id: 'a', progress: 0 }] });
    expect(replay.frameAt(250).drawing).toEqual([{ id: 'a', progress: 0.5 }]);
    expect(replay.frameAt(700)).toEqual({ done: ['a'], drawing: [] });
    expect(replay.frameAt(1_250)).toEqual({ done: ['a'], drawing: [{ id: 'b', progress: 0.5 }] });
    expect(replay.frameAt(1_500)).toEqual({ done: ['a', 'b'], drawing: [] });
    expect(replay.frameAt(99_999).done).toEqual(['a', 'b']);
  });

  it('shortens a long pause and leaves short ones alone', () => {
    const replay = new InkReplay([stroke('a', 0, 500), stroke('b', 600, 400), stroke('c', 61_000, 500)]);
    // One second of writing and a short pause, one second kept of the minute, and half a second more.
    expect(replay.durationMs).toBe(1_000 + 1_000 + 500);
    expect(replay.replayTimeOf(600)).toBe(600);
    expect(replay.replayTimeOf(61_000)).toBe(2_000);
    expect(replay.realTimeOf(2_000)).toBe(61_000);
    expect(replay.realTimeOf(1_500)).toBeCloseTo(31_000, 6);
    expect(replay.frameAt(1_900).done).toEqual(['a', 'b']);
    expect(replay.frameAt(2_250).drawing).toEqual([{ id: 'c', progress: 0.5 }]);
  });

  it('keeps every pause when asked to', () => {
    const replay = new InkReplay([stroke('a', 0, 100), stroke('b', 60_000, 100)], { maxGapMs: null });
    expect(replay.durationMs).toBe(60_100);
  });

  it('treats overlapping strokes as one busy stretch', () => {
    const replay = new InkReplay([stroke('a', 0, 5_000), stroke('b', 1_000, 500), stroke('c', 5_200, 100)]);
    expect(replay.durationMs).toBe(5_300);
    expect(replay.frameAt(1_200).drawing.map((d) => d.id)).toEqual(['a', 'b']);
    expect(replay.frameAt(1_600)).toMatchObject({ done: ['b'] });
  });

  it('steps from stroke to stroke', () => {
    const replay = new InkReplay([stroke('a', 0, 500), stroke('b', 10_000, 500), stroke('c', 20_000, 500)]);
    expect(replay.nextStrokeStart(0)).toBe(1_500);
    expect(replay.nextStrokeStart(1_500)).toBe(3_000);
    expect(replay.nextStrokeStart(3_000)).toBeNull();
    expect(replay.previousStrokeStart(3_000)).toBe(1_500);
    expect(replay.previousStrokeStart(1_500)).toBe(0);
    expect(replay.previousStrokeStart(0)).toBeNull();
  });

  it('has nothing to replay without strokes', () => {
    const replay = new InkReplay([]);
    expect(replay.durationMs).toBe(0);
    expect(replay.frameAt(10)).toEqual({ done: [], drawing: [] });
    expect(replay.nextStrokeStart(0)).toBeNull();
  });

  it('says where the audio belongs for a moment of the replay', () => {
    const recording = { ...entry('r1'), clock: { unixMs: 1_000_000, captureNs: 50_000_000_000 } };
    const map = PositionMap.fromRanges([[50_000_000_000, 80_000_000_000]]);
    const replay = new InkReplay([stroke('a', 1_002_000, 500), stroke('b', 1_010_000, 500)], { maxGapMs: null });
    expect(replay.audioSeekFor(recording, map, 0)).toEqual({ positionNs: 2_000_000_000, exact: true });
    expect(replay.audioSeekFor(recording, map, 8_000)).toEqual({ positionNs: 10_000_000_000, exact: true });
    expect(replay.audioSeekFor({ ...recording, clock: undefined }, map, 0)).toBeNull();
  });
});
