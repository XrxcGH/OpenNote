import { afterEach, describe, expect, it } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';
import type { AppliedFrame, OpenPage } from '../../../services/pages/types';
import type { SyncQueue } from '../sync/queue';
import { shownQueue } from '../sync/shown';
import { adoptPage, entryOf } from './entries';

const entry = (endedNs: number): RecordingEntry =>
  ({ id: 'r1', state: 'complete', started: '', startedNs: 0, endedNs, pauses: [], tracks: [] }) as RecordingEntry;

const frame = (recording: RecordingEntry): AppliedFrame => ({
  blocks: [],
  removed: [],
  page: { view: { recordings: { r1: recording } } as never },
  assets: {},
  ui: null,
  canUndo: false,
  canRedo: true,
});

afterEach(() => shownQueue.set(null));

describe('the recordings of the shown page', () => {
  it('follow an undo in this window, so a split taken back shows the whole recording again', () => {
    const steps: ((frame: AppliedFrame) => void)[] = [];
    const queue = { onStep: (listener: (frame: AppliedFrame) => void) => (steps.push(listener), () => undefined) };
    shownQueue.set(queue as unknown as SyncQueue);
    const page = {
      id: 'undo-page',
      initial: { view: { recordings: { r1: entry(10e9) } } },
      onFrame: () => () => undefined,
    } as unknown as OpenPage;
    adoptPage(page);
    expect(entryOf('r1')?.endedNs).toBe(10e9);
    for (const step of steps) step(frame(entry(15e9)));
    expect(entryOf('r1')?.endedNs).toBe(15e9);
  });
});
