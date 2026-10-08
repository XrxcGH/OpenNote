// Recovering cut-off recordings when a page opens (F5-5): a page open in a second window while the first records it
// sees the live entry, and must leave it alone; a failure that may pass must leave it for the next open.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';
import type { OpenPage } from '../../../services/pages/types';
import { t } from '../../../strings/t';

const host = { recover: vi.fn() };
const log = vi.fn();
const writeEntry = vi.fn((..._args: unknown[]) => Promise.resolve());
const removeBlock = vi.fn((..._args: unknown[]) => Promise.resolve());
const showToast = vi.fn();

vi.mock('./blocks', () => ({
  activeNs: () => 0,
  recordingBlocks: () => [{ id: 'b1', data: { recording: 'r1' } }],
  removeBlock: (...args: unknown[]) => removeBlock(...args),
  writeEntry: (...args: unknown[]) => writeEntry(...args),
}));
vi.mock('../mount', () => ({ shownLayer: { get: () => ({ block: () => ({}) }) } }));
vi.mock('./controller', () => ({
  platformAudio: () => ({ assetsDir: () => Promise.resolve('dir'), host }),
  // This window records nothing: the recording runs in the main window.
  runningRecording: () => null,
}));
vi.mock('../../../commands/registry', () => ({ commandContext: () => ({ platform: { log } }) }));
vi.mock('../../../ui', () => ({ announce: vi.fn(), showToast: (...args: unknown[]) => showToast(...args) }));

const { recoverEntries } = await import('./recover');
const { holdHint, recoveryHolds } = await import('./entries');
const hold = () => recoveryHolds.get().get('r1');

const page = { id: 'p1' } as OpenPage;
const live = (clock: boolean) =>
  ({
    id: 'r1',
    state: 'recording',
    startedNs: 0,
    endedNs: 0,
    pauses: [],
    tracks: [],
    ...(clock ? { clock: { captureNs: 1, unixMs: 1 } } : {}),
  }) as unknown as RecordingEntry;

beforeEach(() => {
  host.recover.mockReset();
  writeEntry.mockClear();
  removeBlock.mockClear();
  showToast.mockClear();
  log.mockClear();
  recoveryHolds.set(new Map());
});

describe('recovering a recording when its page opens', () => {
  it('leaves the entry of a recording another window is running alone, begun or not', async () => {
    host.recover.mockRejectedValue({ code: 'audioRunning', message: 'This recording is still running.' });
    await recoverEntries(page, [live(true)]);
    await recoverEntries(page, [live(false)]);
    expect(host.recover).toHaveBeenCalledTimes(2);
    expect(writeEntry).not.toHaveBeenCalled();
    expect(removeBlock).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    // Its block says another window has it, not "Recovering…" for good.
    expect(hold()).toBe('elsewhere');
    expect(holdHint(hold())).toBe('audio.block.elsewhere');
  });

  it('keeps an entry whose recovery failed for now in `recording`, so the next open tries again', async () => {
    host.recover.mockRejectedValue({ code: 'io', message: 'The file is in use.' });
    await recoverEntries(page, [live(true)]);
    expect(writeEntry).not.toHaveBeenCalled();
    expect(removeBlock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('r1'));
    // The person learns it, in a toast and on the block, instead of a block that says "Recovering…" for good.
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(holdHint(hold())).toBe('audio.block.notRecovered');
    host.recover.mockResolvedValue({ entry: { ...live(true), state: 'recovered' } });
    await recoverEntries(page, [live(true)]);
    expect(hold()).toBeUndefined();
    expect(holdHint(hold())).toBe('audio.block.recovering');
  });

  it('gives up on a recording with no files: missing once begun, gone with its block before', async () => {
    host.recover.mockRejectedValue({ code: 'audioMissing', message: 'There are no audio files.' });
    await recoverEntries(page, [live(true)]);
    expect(writeEntry).toHaveBeenCalledWith('p1', 'b1', expect.objectContaining({ state: 'recovered' }));
    expect(showToast).toHaveBeenCalledOnce();
    await recoverEntries(page, [live(false)]);
    expect(removeBlock).toHaveBeenCalledWith('b1', 'r1');
  });

  // F5-5: a file damaged from its first page was answered like no files, so a recording on disk was called missing.
  it('keeps a begun recording whose file is damaged, and says so instead of calling it missing', async () => {
    host.recover.mockRejectedValue({ code: 'audioCorrupt', message: 'a-mic.ogg has no Opus headers.' });
    await recoverEntries(page, [live(true)]);
    expect(writeEntry).not.toHaveBeenCalled();
    expect(removeBlock).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: t('audio.block.damaged'), tone: 'danger' }),
    );
    expect(holdHint(hold())).toBe('audio.block.damaged');
    // One that never began recorded nothing, so it goes with its block.
    await recoverEntries(page, [live(false)]);
    expect(removeBlock).toHaveBeenCalledWith('b1', 'r1');
  });
});
