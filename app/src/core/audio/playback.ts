// Playback from the interface's side: open a recording, move around in it, and tell the page what was being
// written at the moment that plays.
//
// The host sends the recording's stretches when it opens, so turning a stroke into a position, and a position into
// the strokes and words to highlight, needs no round trip. Only the commands to the player cross to the host.

import { browserScheduler } from './host';
import type { AudioHost, Scheduler } from './host';
import { PositionMap } from './positions';
import { isFlag } from './stamps';
import type { StampIndex } from './stamps';
import type { PlaybackStatus, RecordingEntry, StampEntry, Target } from './types';

/** How far the skip keys jump. */
export const SKIP_NS = 10_000_000_000;
/** How long a stroke or word stays highlighted after it was written, so a quick one is still seen. */
export const HIGHLIGHT_TAIL_NS = 400_000_000;

export interface PlaybackView {
  status: PlaybackStatus;
  /** The strokes, words, and objects written at the moment that plays, newest first. */
  highlight: StampEntry[];
}

export class PlaybackSession {
  private readonly host: AudioHost;
  private readonly scheduler: Scheduler;
  private map = new PositionMap([]);
  private recording: string | null = null;
  private index: StampIndex | null = null;
  private last: PlaybackStatus | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(host: AudioHost, scheduler: Scheduler = browserScheduler) {
    this.host = host;
    this.scheduler = scheduler;
  }

  /** Where each stretch of the open recording falls in the audio. */
  get positions(): PositionMap {
    return this.map;
  }

  /** The position where listening stopped, for the page to remember. */
  get listenedNs(): number {
    return this.last?.positionNs ?? 0;
  }

  /** Opens a recording, paused. `resumeAtNs` is where listening stopped last time. */
  async open(assetsDir: string, entry: RecordingEntry, device: string | null = null, resumeAtNs = 0): Promise<void> {
    await this.close();
    const info = await this.host.openPlayback(assetsDir, entry, device);
    this.map = PositionMap.fromData(info.map);
    this.recording = info.recording;
    if (resumeAtNs > 0) await this.host.seek(Math.min(resumeAtNs, info.durationNs));
  }

  /** Gives the session the strokes, words, and flags of the page, for taps and highlights. */
  setIndex(index: StampIndex): void {
    this.index = index;
  }

  /** Polls the player and calls `onView` with the state and what to highlight. Returns a function that stops. */
  watch(onView: (view: PlaybackView) => void, intervalMs = 100): () => void {
    this.stopWatching?.();
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await this.host.playbackStatus();
        this.last = status;
        onView({ status, highlight: this.highlightAt(status.positionNs) });
      } finally {
        busy = false;
      }
    };
    const cancel = this.scheduler.every(() => void poll().catch(() => undefined), intervalMs);
    this.stopWatching = cancel;
    return cancel;
  }

  /** What was being written at a position. */
  highlightAt(positionNs: number): StampEntry[] {
    const captureNs = this.map.captureAt(positionNs);
    if (this.recording === null || this.index === null || captureNs === null) return [];
    return this.index.activeAt(this.recording, captureNs, HIGHLIGHT_TAIL_NS);
  }

  /** Plays or pauses, whichever the player is not doing. */
  async toggle(): Promise<void> {
    const status = this.last ?? (await this.host.playbackStatus());
    await (status.state === 'playing' ? this.host.pausePlayback() : this.host.play());
  }

  /** Tap a stroke or a word: seek to the moment it was written, and play. Returns false if it has no audio. */
  async playFrom(target: Target): Promise<boolean> {
    const recording = this.recording;
    const seek = this.index?.seekFor(target, (id) => (id === recording ? this.map : undefined));
    if (!seek) return false;
    await this.host.seek(seek.positionNs);
    await this.host.play();
    return true;
  }

  seek(positionNs: number): Promise<void> {
    return this.host.seek(positionNs);
  }

  skipBack(): Promise<void> {
    return this.host.skip(-SKIP_NS);
  }

  skipForward(): Promise<void> {
    return this.host.skip(SKIP_NS);
  }

  /** Jumps to the next or previous flag. Returns false if there is none that way. */
  async jumpToFlag(direction: 'next' | 'previous'): Promise<boolean> {
    const status = this.last ?? (await this.host.playbackStatus());
    const captureNs = this.map.captureAt(status.positionNs);
    if (this.recording === null || this.index === null || captureNs === null) return false;
    const found =
      direction === 'next'
        ? this.index.nextAfter(this.recording, captureNs, isFlag)
        : this.index.previousBefore(this.recording, captureNs, isFlag);
    if (!found) return false;
    await this.host.seek(this.map.locate(found.startNs).positionNs);
    return true;
  }

  /** Sets the speed, from 0.5 to 3, without changing the pitch. */
  setSpeed(speed: number): Promise<void> {
    return this.host.setSpeed(Math.min(Math.max(speed, 0.5), 3));
  }

  setSkipSilence(on: boolean): Promise<void> {
    return this.host.setSkipSilence(on);
  }

  async close(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = null;
    if (this.recording !== null) await this.host.closePlayback();
    this.recording = null;
    this.last = null;
  }
}
