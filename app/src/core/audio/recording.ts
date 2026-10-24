// Recording from the interface's side: start it the safe way, watch it, and stamp text while it runs.

import { HostClock } from './clock';
import { browserScheduler } from './host';
import type { AudioHost, Scheduler } from './host';
import { advance, QUIET } from './meter';
import type { MeterState } from './meter';
import type { Stamp } from './stamps';
import type {
  Discard,
  Finished,
  Prepared,
  RecordingEntry,
  RecordingStatus,
  Resolution,
  StartRequest,
  StopReason,
  TrackKind,
} from './types';

/** What a screen shows about a recording that is running. */
export interface RecordingView {
  status: RecordingStatus;
  /** The meters, one for each track, with the fall-off and the held peak applied. */
  meters: Partial<Record<TrackKind, MeterState>>;
}

export interface WatchHandlers {
  onView: (view: RecordingView) => void;
  /** Called once when the host says recording must stop. The screen then calls `stop` and shows a notice. */
  onStop?: (reason: StopReason) => void;
  /** Called when a status call fails. Watching goes on, since the next call may work. */
  onError?: (error: unknown) => void;
}

/** What to remove from the page when a prepared recording never begins. The twin of `Prepared::discard`. */
export function discardOf(prepared: Prepared): Discard {
  return { entry: prepared.entry.id, assets: prepared.entry.tracks.map((track) => track.asset) };
}

export class RecordingSession {
  private readonly host: AudioHost;
  private readonly clock: HostClock;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private recording: string | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(
    host: AudioHost,
    clock: HostClock = new HostClock(),
    scheduler: Scheduler = browserScheduler,
    now: () => number = () => performance.now(),
  ) {
    this.host = host;
    this.clock = clock;
    this.scheduler = scheduler;
    this.now = now;
  }

  /** The ID of the recording that is running, or null. */
  get recordingId(): string | null {
    return this.recording;
  }

  /**
   * Starts a recording so that a crash can't lose it. The host chooses the IDs and the page saves them through
   * `save` before any audio file exists. Only then does the host open the devices. If they don't open, `discard`
   * removes what `save` added, and the error goes on to the caller.
   */
  async start(
    request: StartRequest,
    save: (prepared: Prepared) => Promise<void>,
    discard: (removed: Discard) => Promise<void>,
  ): Promise<RecordingEntry> {
    const prepared = await this.host.prepare(request);
    await save(prepared);
    let entry: RecordingEntry;
    try {
      entry = await this.host.begin();
    } catch (error) {
      await discard(discardOf(prepared));
      throw error;
    }
    this.recording = entry.id;
    await this.clock.calibrate(() => this.host.clock());
    return entry;
  }

  /** The recording and capture time to stamp an edit with, now. Pass it to `TextMarks.edit`. */
  stamp(): Stamp {
    if (!this.recording) throw new Error('No recording is running.');
    return { recording: this.recording, captureNs: this.clock.nowNs() };
  }

  /** Polls the host for levels and warnings, and returns a function that stops. */
  watch(handlers: WatchHandlers, intervalMs = 200): () => void {
    this.stopWatching?.();
    let meters: RecordingView['meters'] = {};
    let last = this.now();
    let busy = false;
    let stopped = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const sent = this.now();
        const status = await this.host.recordingStatus();
        const received = this.now();
        this.clock.observe(status.now, sent, received);
        meters = this.advanceMeters(meters, status, received - last);
        last = received;
        handlers.onView({ status, meters });
        if (status.stop && !stopped) {
          stopped = true;
          handlers.onStop?.(status.stop);
        }
      } catch (error) {
        handlers.onError?.(error);
      } finally {
        busy = false;
      }
    };
    const cancel = this.scheduler.every(() => void poll(), intervalMs);
    this.stopWatching = cancel;
    return cancel;
  }

  private advanceMeters(
    meters: RecordingView['meters'],
    status: RecordingStatus,
    elapsedMs: number,
  ): RecordingView['meters'] {
    const next: RecordingView['meters'] = {};
    for (const level of status.levels) {
      next[level.kind] = advance(meters[level.kind] ?? QUIET, status.paused ? undefined : level, elapsedMs);
    }
    return next;
  }

  pause(): Promise<void> {
    return this.host.pauseRecording();
  }

  resume(): Promise<void> {
    return this.host.resumeRecording();
  }

  /** Records from another microphone from now on, without stopping. Null follows the default. */
  switchMicrophone(id: string | null): Promise<Resolution> {
    return this.host.switchMicrophone(id);
  }

  /** Records another output device's sound from now on, as when a `notDefaultDevice` warning comes. */
  switchSystemAudio(id: string | null): Promise<Resolution> {
    return this.host.switchSystemAudio(id);
  }

  /** Stops recording and returns what the page saves. */
  async stop(): Promise<Finished> {
    this.stopWatching?.();
    this.stopWatching = null;
    try {
      return await this.host.stop();
    } finally {
      this.recording = null;
    }
  }
}
