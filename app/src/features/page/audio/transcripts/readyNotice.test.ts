// "The transcript is ready" must not cover the transcript it announces (VB-183): it is said, not shown as a toast.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordingEntry } from '../../../../core/audio';
import type { BlockJson } from '../../../../services/pages/types';
import { toastStore } from '../../../../state/toasts';
import { announcements } from '../../../../ui/announce';
import { makeTranscript } from './actions';
import { registerTranscriptEngine } from './engine';

vi.mock('../controller', () => ({
  platformAudio: () => ({ assetsDir: async () => 'dir' }),
  describeError: (error: unknown) => String(error),
}));
vi.mock('./store', async (original) => ({
  ...(await original<typeof import('./store')>()),
  transcriptOf: () => null,
  addTranscript: vi.fn(async () => undefined),
}));
vi.mock('../../../intel', () => ({ loadApi: () => Promise.reject(new Error('no intel here')) }));

const entry = {
  id: 'r1',
  state: 'complete',
  started: '',
  startedNs: 0,
  endedNs: 5e9,
  pauses: [],
  tracks: [],
} as unknown as RecordingEntry;
const holder = { id: 'b1', type: 'recording', order: 'a', created: '', modified: '', data: {} } as BlockJson;

afterEach(() => toastStore.set({ current: null, queue: [] }));

describe('a finished transcript', () => {
  it('is announced, and no toast is left over the transcript', async () => {
    const stop = registerTranscriptEngine({
      id: 'fake',
      transcribe: async (request) => {
        request.onStart?.();
        return { language: null, segments: [{ startMs: 0, endMs: 1000, text: 'Hello there.' }] };
      },
    });
    expect(await makeTranscript(holder, entry)).toBe(true);
    const shown = [toastStore.get().current, ...toastStore.get().queue].filter(Boolean);
    expect(shown).toEqual([]);
    expect(announcements().some((said) => /transcript is ready/i.test(said))).toBe(true);
    stop();
  });
});
