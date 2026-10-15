import { describe, expect, it } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';
import { momentOf, momentsFor, positionSeconds } from './exportPlayer';

const SECOND = 1_000_000_000;
const entry: RecordingEntry = {
  id: 'r1',
  state: 'complete',
  started: '2026-10-03T10:00:00.000Z',
  startedNs: 10 * SECOND,
  endedNs: 70 * SECOND,
  pauses: [{ pausedNs: 20 * SECOND, resumedNs: 30 * SECOND }],
  tracks: [],
};
const marks = (startNs: number, recording = 'r1') => ({ recordings: [recording], marks: [{ recording: 0, startNs }] });

describe('moments for the exported player', () => {
  it('counts seconds from the start, less the pauses before it', () => {
    expect(positionSeconds(entry, 15 * SECOND)).toBe(5);
    expect(positionSeconds(entry, 25 * SECOND)).toBe(10);
    expect(positionSeconds(entry, 40 * SECOND)).toBe(20);
    expect(positionSeconds(entry, 1 * SECOND)).toBe(0);
  });

  it('finds the first write of a block and ignores other recordings', () => {
    expect(momentOf(entry, marks(40 * SECOND))).toBe(20);
    expect(momentOf(entry, marks(40 * SECOND, 'other'))).toBeNull();
    expect(momentOf(entry, undefined)).toBeNull();
  });

  it('collects only text blocks that have marks', () => {
    const found = momentsFor(entry, [
      { id: 'a', type: 'text', data: { marks: marks(15 * SECOND) } },
      { id: 'b', type: 'text', data: {} },
      { id: 'c', type: 'image', data: { marks: marks(15 * SECOND) } },
    ]);
    expect([...found]).toEqual([['a', 5]]);
  });
});
