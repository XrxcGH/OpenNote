// Trimming silence shows what it cuts and asks first, since the old audio is deleted for good. Declining keeps the
// recording as it was and removes the new files the trim wrote.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';

const SECOND = 1_000_000_000;
const old = { id: 'r1', startedNs: 0, endedNs: 20 * SECOND, pauses: [], tracks: [] } as unknown as RecordingEntry;
const next = { ...old, endedNs: 17 * SECOND } as RecordingEntry;

const answer = vi.hoisted(() => ({ ok: false }));
const confirm = vi.hoisted(() => vi.fn(async (_options: { body: string }) => answer.ok));
const writeEntry = vi.fn(async () => undefined);
const deleteFiles = vi.fn(async () => 0);
const trimSilence = vi.fn(async () => ({ entry: next, durationNs: 17 * SECOND }));

vi.mock('../../../ui', () => ({ announce: () => undefined, confirm, showToast: () => undefined }));
vi.mock('./blocks', () => ({ insertRecordingBlock: vi.fn(), writeEntry }));
vi.mock('./controller', () => ({
  describeError: String,
  platformAudio: () => ({ assetsDir: async () => 'dir', trimSilence, deleteFiles }),
}));
vi.mock('./playback', () => ({ closePlayback: async () => undefined }));
vi.mock('./moreClient', () => ({ moreClient: vi.fn() }));
vi.mock('./stamps', () => ({ marksOf: () => null }));
vi.mock('../history/shown', () => ({ shownPage: { get: () => ({ saveNow: async () => undefined }) } }));
vi.mock('../mount', () => ({ shownLayer: { get: () => null } }));
vi.mock('../sync/shown', () => ({ shownQueue: { get: () => null } }));
vi.mock('../../../app/flags', () => ({ isEnabled: () => false }));

const { trimSilence: trim } = await import('./edits');

beforeEach(() => {
  answer.ok = false;
  confirm.mockClear();
  writeEntry.mockClear();
  deleteFiles.mockClear();
});

describe('trimming silence', () => {
  it('names the new length and keeps the recording when declined', async () => {
    await trim('b1', 'p', old);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0].body).toContain('0:20 becomes 0:17');
    expect(writeEntry).not.toHaveBeenCalled();
    // Only the new files go: the call names the trimmed entry, never the old one.
    expect(deleteFiles).toHaveBeenCalledOnce();
    expect(deleteFiles).toHaveBeenCalledWith('dir', next);
  });

  it('writes the trimmed entry and deletes the old files when confirmed', async () => {
    answer.ok = true;
    await trim('b1', 'p', old);
    expect(writeEntry).toHaveBeenCalledOnce();
    expect(deleteFiles).toHaveBeenCalledWith('dir', old);
  });
});
