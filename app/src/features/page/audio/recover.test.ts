import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ids = vi.hoisted(() => ({ current: 'r1' }));
const recover = vi.fn();
const removeBlock = vi.fn(async () => undefined);
const writeEntry = vi.fn(async () => undefined);
vi.mock('./blocks', () => ({
  activeNs: () => 1e9,
  recordingBlocks: () => [{ id: 'b1' }],
  removeBlock: (...args: unknown[]) => removeBlock(...(args as [])),
  writeEntry: (...args: unknown[]) => writeEntry(...(args as [])),
}));
vi.mock('./controller', () => ({
  platformAudio: () => ({ assetsDir: async () => 'dir', host: { recover } }),
  runningRecording: () => null,
}));
vi.mock('./entry', () => ({ recordingIdOf: () => ids.current }));
vi.mock('../mount', () => ({ shownLayer: { get: () => ({ block: () => ({}) }) } }));
vi.mock('../../../ui', () => ({ announce: () => undefined, showToast: () => undefined }));

const { recoverEntries } = await import('./recover');
const page = { id: 'p' } as never;
const cut = { id: 'r1', state: 'recording', clock: 5 };

beforeEach(() => {
  vi.useFakeTimers();
  recover.mockReset();
  removeBlock.mockClear();
  writeEntry.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('recovering a cut-off recording', () => {
  it('keeps the entry and tries again after a passing error, then recovers', async () => {
    recover.mockRejectedValueOnce({ code: 'io' }).mockResolvedValueOnce({ entry: { state: 'recovered' } });
    await recoverEntries(page, [cut as never]);
    expect(writeEntry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5100);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(writeEntry).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few tries, still recording', async () => {
    recover.mockRejectedValue({ code: 'audioDevice' });
    ids.current = 'r2';
    await recoverEntries(page, [{ ...cut, id: 'r2' } as never]);
    await vi.advanceTimersByTimeAsync(5000 + 15000 + 45000 + 200000);
    expect(recover).toHaveBeenCalledTimes(4);
    expect(writeEntry).not.toHaveBeenCalled();
  });

  it('marks it recovered at once for an error that will not pass', async () => {
    recover.mockRejectedValue({ code: 'audioCorrupt' });
    ids.current = 'r3';
    await recoverEntries(page, [{ ...cut, id: 'r3' } as never]);
    expect(writeEntry).toHaveBeenCalledTimes(1);
  });
});
