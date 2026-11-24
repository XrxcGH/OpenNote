// Splitting a recording is one change, so one undo brings the whole recording back (B1-B01-3). The original's files
// stay on disk: undo lists them in the page again, and a save checks that every listed file is there.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';
import type { EditBatch } from '../../../services/pages/types';

const SECOND = 1_000_000_000;
const track = (asset: string) => ({
  kind: 'microphone',
  asset,
  timeline: { anchors: [] },
  silenceFrames: 0,
  droppedPackets: 0,
});
const entry = (id: string, asset: string, startedNs: number, endedNs: number) =>
  ({
    id,
    state: 'finished',
    started: '',
    startedNs,
    endedNs,
    pauses: [],
    tracks: [track(asset)],
  }) as unknown as RecordingEntry;
const whole = entry('r1', 'a-old', 0, 31 * SECOND);
const first = entry('r1', 'a-one', 0, 10 * SECOND);
const second = entry('r2', 'a-two', 10 * SECOND, 31 * SECOND);

const sent: EditBatch[] = [];
const send = vi.fn(async (batch: EditBatch) => {
  sent.push(batch);
  return { seq: sent.length, orderKeys: {}, canUndo: true, canRedo: false };
});
const deleteFiles = vi.fn(async () => 0);
const audio = {
  keepsAssets: true,
  assetsDir: async () => 'dir',
  adoptTracks: vi.fn(async () => undefined),
  deleteFiles,
};

vi.mock('../../../ui', () => ({ announce: () => undefined, confirm: vi.fn(), showToast: () => undefined }));
vi.mock('../../../commands/registry', () => ({ commandContext: () => ({ platform: { audio } }) }));
vi.mock('./controller', () => ({ describeError: String, platformAudio: () => audio }));
vi.mock('./playback', () => ({ closePlayback: async () => undefined }));
vi.mock('./moreClient', () => ({
  moreClient: async () => ({
    split: async () => ({
      first: { entry: first, durationNs: 10 * SECOND },
      second: { entry: second, durationNs: 21 * SECOND },
    }),
  }),
}));
vi.mock('./stamps', () => ({ marksOf: () => null }));
vi.mock('../history/shown', () => ({ shownPage: { get: () => ({ id: 'p', saveNow: async () => undefined }) } }));
const transcriptBlock = { id: 't1', type: 'ext:org.opennote/transcript', order: 'b', data: { recording: 'r1' } };
const layerBlocks: unknown[] = [];
vi.mock('../mount', () => ({
  shownLayer: {
    get: () => ({
      blocks: () => layerBlocks,
      block: (id: string) => (id === 't1' ? transcriptBlock : { id }),
      view: () => null,
      upsert: () => undefined,
      remove: () => undefined,
    }),
  },
}));
vi.mock('../pool/shown', () => ({ shownPool: { get: () => null } }));
vi.mock('../runtime', () => ({ pagesClient: vi.fn() }));
vi.mock('../sync/shown', () => ({ shownQueue: { get: () => ({ send }) } }));
const flags = vi.hoisted(() => ({ transcripts: false }));
vi.mock('../../../app/flags', () => ({ isEnabled: (flag: string) => flag === 'transcripts.block' && flags.transcripts }));

const { splitRecording } = await import('./edits');
const { hold } = await import('./transcripts/store');

beforeEach(() => {
  sent.length = 0;
  send.mockClear();
  deleteFiles.mockClear();
  flags.transcripts = false;
  layerBlocks.length = 0;
});

describe('splitting a recording', () => {
  it('sends the whole split as one change, so one undo takes it back', async () => {
    await splitRecording('b1', 'p', whole, 10 * SECOND);
    expect(sent).toHaveLength(1);
    const edits = sent[0]!.edits;
    expect(edits).toContainEqual({ edit: 'removeAsset', asset: 'a-old' });
    expect(edits).toContainEqual({ edit: 'addAsset', asset: 'a-one' });
    expect(edits).toContainEqual({ edit: 'addAsset', asset: 'a-two' });
    expect(edits.some((edit) => edit.edit === 'insertBlock')).toBe(true);
  });

  it('keeps the original files, which an undo lists again', async () => {
    await splitRecording('b1', 'p', whole, 10 * SECOND);
    expect(deleteFiles).not.toHaveBeenCalled();
  });

  it('moves the transcript in the same undo step as the split (T4-C05-4)', async () => {
    flags.transcripts = true;
    layerBlocks.push(transcriptBlock);
    const line = (id: string, startMs: number) => ({ id, startMs, endMs: startMs + 1000, text: id });
    hold([
      {
        recording: 'r1',
        language: null,
        summary: '',
        lines: [line('early', 2_000), line('late', 20_000)],
        speakers: {},
        chapters: [],
        source: 'imported',
      } as never,
    ]);
    await splitRecording('b1', 'p', whole, 10 * SECOND);
    // The split, the first half's transcript, and the second half's new transcript.
    expect(sent.length).toBeGreaterThanOrEqual(3);
    const key = sent[0]!.coalesce;
    expect(key).toBeDefined();
    for (const batch of sent) expect(batch.coalesce).toEqual(key);
  });
});
