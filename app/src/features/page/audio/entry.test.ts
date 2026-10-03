import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingEntry } from '../../../core/audio';
import { createWebAudio, spansOf } from '../../../platform/web/audio';
import type { BlockJson } from '../../../services/pages/types';
import { entriesOf, recordingEntries } from './entries';
import { activeNs, dataOf, fallbackFor } from './entry';
import { clock, clockNs } from './format';
import { RECORDING_TYPE } from './state';

const SECOND = 1_000_000_000;

const entry = (more: Partial<RecordingEntry> = {}): RecordingEntry => ({
  id: 'r1',
  state: 'complete',
  started: '2026-10-03T10:00:00.000Z',
  startedNs: 10 * SECOND,
  endedNs: 70 * SECOND,
  pauses: [],
  tracks: [],
  ...more,
});

const block = (data: Record<string, unknown>): BlockJson => ({
  id: 'b1',
  type: RECORDING_TYPE,
  order: 'a',
  created: '',
  modified: '',
  data,
});

describe('times', () => {
  it('shows minutes and seconds, and hours when there are some', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65_000)).toBe('1:05');
    expect(clock(3_725_000)).toBe('1:02:05');
    expect(clockNs(90 * SECOND)).toBe('1:30');
    expect(clock(-5)).toBe('0:00');
  });

  it('counts the recorded time without pauses and removed parts', () => {
    expect(activeNs(entry())).toBe(60 * SECOND);
    const paused = entry({ pauses: [{ pausedNs: 20 * SECOND, resumedNs: 30 * SECOND }] });
    expect(activeNs(paused)).toBe(50 * SECOND);
    expect(activeNs(entry({ endedNs: 0 }))).toBe(0);
  });

  it('names the recording for a reader that does not know the block', () => {
    expect(fallbackFor().markdown).toBe('Audio recording');
  });
});

describe('a recording block', () => {
  afterEach(() => recordingEntries.set(new Map()));

  it('names its recording, and the entry comes from the page', () => {
    recordingEntries.set(new Map([['r1', entry()]]));
    expect(dataOf(block({ recording: 'r1' }))?.entry.id).toBe('r1');
    expect(dataOf(block({ recording: 'gone' }))).toBeNull();
    expect(dataOf(block({}))).toBeNull();
  });

  it('reads the entries a page view holds, and ignores what is not one', () => {
    const view = { recordings: { r1: entry(), r2: entry({ id: 'r2' }), bad: { state: 'complete' }, none: null } };
    expect(entriesOf(view).map((found) => found.id)).toEqual(['r1', 'r2']);
    expect(entriesOf({})).toEqual([]);
    expect(entriesOf(undefined)).toEqual([]);
  });
});

describe('the web platform recorder', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  async function record(seconds: number, pauseFor = 0) {
    const { host } = createWebAudio();
    await host.prepare({ assetsDir: 'x', microphone: null, systemAudio: false, systemDevice: null });
    await host.begin();
    vi.advanceTimersByTime(seconds * 1000);
    if (pauseFor > 0) {
      await host.pauseRecording();
      vi.advanceTimersByTime(pauseFor * 1000);
      await host.resumeRecording();
      vi.advanceTimersByTime(seconds * 1000);
    }
    return { host, finished: await host.stop() };
  }

  it('keeps the time it ran, less the pauses, in the entry', async () => {
    const { finished } = await record(4, 3);
    expect(finished.entry.state).toBe('complete');
    expect(finished.entry.pauses).toHaveLength(1);
    expect(activeNs(finished.entry)).toBe(8 * SECOND);
    expect(spansOf(finished.entry)).toHaveLength(2);
  });

  it('plays from where it is told, at the speed it is told', async () => {
    const { host, finished } = await record(10);
    const info = await host.openPlayback('x', finished.entry, null);
    expect(info.durationNs).toBe(10 * SECOND);
    await host.setSpeed(2);
    await host.seek(2 * SECOND);
    await host.play();
    vi.advanceTimersByTime(1000);
    expect((await host.playbackStatus()).positionNs).toBe(4 * SECOND);
    await host.skip(-10 * SECOND);
    expect((await host.playbackStatus()).positionNs).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect((await host.playbackStatus()).state).toBe('ended');
  });

  it('trims by adding a hole, and removes a part the same way', async () => {
    const audio = createWebAudio();
    const { finished } = await (async () => {
      await audio.host.prepare({ assetsDir: 'x', microphone: null, systemAudio: false, systemDevice: null });
      await audio.host.begin();
      vi.advanceTimersByTime(10_000);
      return { finished: await audio.host.stop() };
    })();
    expect(await audio.trimSilence('x', { ...finished.entry, endedNs: finished.entry.startedNs + SECOND })).toBeNull();
    const trimmed = await audio.trimSilence('x', finished.entry);
    expect(trimmed?.durationNs).toBe(9 * SECOND);
    const removed = await audio.removePart('x', trimmed!.entry, 2 * SECOND, 5 * SECOND);
    expect(removed.durationNs).toBe(6 * SECOND);
    expect(spansOf(removed.entry).length).toBeGreaterThan(1);
  });

  it('recovers a recording that never stopped', async () => {
    const audio = createWebAudio();
    const cut = entry({ state: 'recording', endedNs: 0 });
    const recovered = await audio.host.recover('x', cut);
    expect(recovered.entry.state).toBe('recovered');
    expect(activeNs(recovered.entry)).toBeGreaterThan(0);
  });
});
