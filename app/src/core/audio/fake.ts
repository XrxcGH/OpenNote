// Stand-ins for the host and the clock, for the tests of the recording and playback sessions.

import { PositionMap } from './positions';
import type { AudioHost, Scheduler } from './host';
import type { PlaybackStatus, Prepared, RecordingEntry, RecordingStatus } from './types';

/** A scheduler the test runs by hand. */
export function manualScheduler() {
  const callbacks = new Set<() => void>();
  const scheduler: Scheduler = {
    every(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  return {
    scheduler,
    count: () => callbacks.size,
    async tick() {
      for (const callback of [...callbacks]) callback();
      // Let the polls finish.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

export const entry = (id = 'r1'): RecordingEntry => ({
  id,
  state: 'recording',
  started: '2026-10-02T10:00:00.000Z',
  startedNs: 0,
  endedNs: 0,
  pauses: [],
  tracks: [],
});

export function recordingStatus(overrides: Partial<RecordingStatus> = {}): RecordingStatus {
  return {
    paused: false,
    now: { captureNs: 50_000_000_000, unixMs: 0 },
    bytes: 100,
    levels: [{ kind: 'microphone', peak: 0.5, rms: 0.2, clipped: false, silentMs: 0, idleMs: 0 }],
    warnings: [],
    stop: null,
    ...overrides,
  };
}

/** A host that records the calls it gets. */
export function fakeHost(overrides: Partial<AudioHost> = {}): { host: AudioHost; calls: string[] } {
  const calls: string[] = [];
  const note =
    <T>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };
  const playback: PlaybackStatus = {
    state: 'paused',
    positionNs: 0,
    durationNs: 7_000_000_000,
    speed: 1,
    skipSilence: false,
    underruns: 0,
    error: null,
  };
  const host: AudioHost = {
    devices: note('devices', []),
    clock: note('clock', { captureNs: 50_000_000_000, unixMs: 0 }),
    prepare: async () => {
      calls.push('prepare');
      return { entry: entry(), assets: [], microphone: {} as never, systemAudio: null } satisfies Prepared;
    },
    begin: note('begin', entry()),
    recordingStatus: note('recordingStatus', recordingStatus()),
    pauseRecording: note('pauseRecording', undefined),
    resumeRecording: note('resumeRecording', undefined),
    switchMicrophone: note('switchMicrophone', {} as never),
    switchSystemAudio: note('switchSystemAudio', {} as never),
    stop: note('stop', { entry: entry(), assets: [], summary: null, failures: [] }),
    recover: note('recover', { entry: entry(), assets: [], summary: null, failures: [] }),
    openPlayback: async () => {
      calls.push('openPlayback');
      return {
        recording: 'r1',
        durationNs: 7_000_000_000,
        map: { spans: PositionMap.fromRanges([[100_000_000_000, 107_000_000_000]]).spans.slice() },
      };
    },
    play: note('play', undefined),
    pausePlayback: note('pausePlayback', undefined),
    seek: async (positionNs) => {
      calls.push(`seek ${positionNs}`);
    },
    skip: async (deltaNs) => {
      calls.push(`skip ${deltaNs}`);
    },
    setSpeed: async (speed) => {
      calls.push(`speed ${speed}`);
    },
    setSkipSilence: note('setSkipSilence', undefined),
    playbackStatus: note('playbackStatus', playback),
    closePlayback: note('closePlayback', undefined),
    ...overrides,
  };
  return { host, calls };
}

/** A playback status of a recording that is playing at a position. */
export function playingAt(positionNs: number): PlaybackStatus {
  return {
    state: 'playing',
    positionNs,
    durationNs: 7_000_000_000,
    speed: 1,
    skipSilence: false,
    underruns: 0,
    error: null,
  };
}
