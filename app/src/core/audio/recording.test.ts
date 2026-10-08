// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { HostClock } from './clock';
import { entry, fakeHost, manualScheduler, recordingStatus } from './fake';
import { hostOver } from './host';
import type { Invoke } from './host';
import { RecordingSession } from './recording';
import type { Discard, StopReason, TrackKind } from './types';

describe('hostOver', () => {
  it('sends each method as an audio_ command with its arguments in camel case', async () => {
    const invoke = vi.fn<Invoke>(async () => undefined);
    const host = hostOver(invoke);
    await host.seek(5);
    await host.openPlayback('C:\\assets', entry(), null);
    await host.recordingStatus();
    await host.switchSystemAudio(null);
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      'audio_seek',
      'audio_open_playback',
      'audio_recording_status',
      'audio_switch_system_audio',
    ]);
    expect(invoke.mock.calls[3]?.[1]).toEqual({ id: null });
    expect(invoke.mock.calls[0]?.[1]).toEqual({ positionNs: 5 });
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({ assetsDir: 'C:\\assets', device: null });
  });
});

describe('RecordingSession starting', () => {
  it('saves the page before the host creates any file', async () => {
    const { host, calls } = fakeHost();
    const session = new RecordingSession(host, new HostClock(() => 0));
    const saved = vi.fn(async () => {
      calls.push('save');
    });
    await session.start(
      { assetsDir: 'a', microphone: null, systemAudio: false, systemDevice: null },
      saved,
      async () => {},
    );
    expect(calls.slice(0, 3)).toEqual(['prepare', 'save', 'begin']);
    expect(session.recordingId).toBe('r1');
  });

  it('removes what it saved when the devices do not open', async () => {
    const prepared = entry('r2');
    prepared.tracks = [
      { kind: 'microphone', asset: 'a1', timeline: { anchors: [], frames: 0 }, silenceFrames: 0, droppedPackets: 0 },
    ];
    const { host, calls } = fakeHost({
      prepare: async () => ({ entry: prepared, assets: [], microphone: {} as never, systemAudio: null }),
      begin: async () => {
        throw new Error('The microphone is gone.');
      },
    });
    const session = new RecordingSession(host, new HostClock(() => 0));
    const discarded: Discard[] = [];
    await expect(
      session.start(
        { assetsDir: 'a', microphone: null, systemAudio: false, systemDevice: null },
        async () => {},
        async (removed) => {
          discarded.push(removed);
        },
      ),
    ).rejects.toThrow('microphone is gone');
    expect(discarded).toEqual([{ entry: 'r2', assets: ['a1'] }]);
    expect(calls).toEqual([]);
    expect(session.recordingId).toBeNull();
  });

  it('does not begin when the page could not save', async () => {
    const { host, calls } = fakeHost();
    const session = new RecordingSession(host, new HostClock(() => 0));
    await expect(
      session.start(
        { assetsDir: 'a', microphone: null, systemAudio: false, systemDevice: null },
        async () => {
          throw new Error('disk full');
        },
        async () => {
          calls.push('discard');
        },
      ),
    ).rejects.toThrow('disk full');
    expect(calls).toEqual(['prepare']);
    expect(session.recordingId).toBeNull();
  });

  it('stamps text on the capture clock once the host has been read', async () => {
    let local = 1_000;
    const { host } = fakeHost();
    const session = new RecordingSession(host, new HostClock(() => local), manualScheduler().scheduler, () => local);
    await session.start(
      { assetsDir: 'a', microphone: null, systemAudio: false, systemDevice: null },
      async () => {},
      async () => {},
    );
    // The fake host reads 50 s whenever it is asked, so the clock learned an offset from that.
    local += 250;
    const stamp = session.stamp();
    expect(stamp.recording).toBe('r1');
    expect(stamp.captureNs).toBeGreaterThan(50_000_000_000);
  });
});

describe('RecordingSession watching', () => {
  it('polls levels with fall-off and reports a stop once', async () => {
    let status = recordingStatus();
    const { host } = fakeHost({ recordingStatus: async () => status });
    const timer = manualScheduler();
    let local = 0;
    const clock = new HostClock(() => local);
    const session = new RecordingSession(host, clock, timer.scheduler, () => local);
    const views: number[] = [];
    const stops: StopReason[] = [];
    session.watch({
      onView: (view) => views.push(view.meters.microphone?.barDb ?? NaN),
      onStop: (reason) => stops.push(reason),
    });
    local = 100;
    await timer.tick();
    status = recordingStatus({
      levels: [{ kind: 'microphone', peak: 0, rms: 0, clipped: false, silentMs: 0, idleMs: 0 }],
      stop: { type: 'diskFull', freeBytes: 5 },
    });
    local = 600;
    await timer.tick();
    local = 1_100;
    await timer.tick();
    expect(views[0]).toBeCloseTo(-6.02, 1);
    expect(views[1]).toBeLessThan(views[0]!);
    expect(stops).toEqual([{ type: 'diskFull', freeBytes: 5 }]);
    expect(clock.isCalibrated).toBe(true);
  });

  it('keeps watching after a failed poll', async () => {
    let fail = true;
    const { host } = fakeHost({
      recordingStatus: async () => {
        if (fail) throw new Error('busy');
        return recordingStatus();
      },
    });
    const timer = manualScheduler();
    const session = new RecordingSession(host, new HostClock(() => 0), timer.scheduler, () => 0);
    const errors: unknown[] = [];
    const meters: Partial<Record<TrackKind, unknown>>[] = [];
    session.watch({ onView: (view) => meters.push(view.meters), onError: (error) => errors.push(error) });
    await timer.tick();
    fail = false;
    await timer.tick();
    expect(errors).toHaveLength(1);
    expect(meters).toHaveLength(1);
  });

  it('stops watching when recording stops', async () => {
    const { host, calls } = fakeHost();
    const timer = manualScheduler();
    const session = new RecordingSession(host, new HostClock(() => 0), timer.scheduler, () => 0);
    session.watch({ onView: () => {} });
    expect(timer.count()).toBe(1);
    await session.stop();
    expect(timer.count()).toBe(0);
    expect(calls).toContain('stop');
    expect(session.recordingId).toBeNull();
  });
});
