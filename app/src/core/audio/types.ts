// The shapes that cross between the interface and the Rust media crate (crates/media). They match the serde types
// there, which write camelCase JSON. Times are nanoseconds on the capture clock unless a name says otherwise. A
// double holds a nanosecond count exactly up to 104 days of uptime, and is off by a microsecond or less after that,
// which no stroke or word can notice.

export type TrackKind = 'microphone' | 'systemAudio';

/** The place where a stretch of a track starts: the frame it begins at and the capture time of that frame. */
export interface Anchor {
  frame: number;
  timeNs: number;
}

/** Maps a track's frames to capture times (crates/media/src/audio/timeline.rs). Frames are 1/48,000 s. */
export interface Timeline {
  anchors: Anchor[];
  frames: number;
}

/** One instant read on both clocks, which ties a stroke's Unix start time to the capture clock. */
export interface ClockAnchor {
  unixMs: number;
  captureNs: number;
}

export interface Pause {
  pausedNs: number;
  resumedNs: number;
}

export type RecordingState = 'recording' | 'complete' | 'recovered';

export interface TrackEntry {
  kind: TrackKind;
  asset: string;
  timeline: Timeline;
  silenceFrames: number;
  droppedPackets: number;
}

/** An item of a page's `recordings` array. Fields the screens add, such as flags, ride along untouched. */
export interface RecordingEntry {
  id: string;
  state: RecordingState;
  started: string;
  clock?: ClockAnchor;
  startedNs: number;
  endedNs: number;
  pauses: Pause[];
  tracks: TrackEntry[];
  [extra: string]: unknown;
}

/** A stretch of capture time that has audio, and where it starts in the audio a person can play. */
export interface Span {
  captureStartNs: number;
  captureEndNs: number;
  positionStartNs: number;
}

export interface PositionMapData {
  spans: Span[];
}

export type Direction = 'input' | 'output';

export interface DeviceInfo {
  id: string;
  name: string;
  direction: Direction;
  isDefault: boolean;
  sampleRate: number | null;
  channels: number | null;
}

/** The device a saved choice resolved to. `fellBack` is true when the saved device was gone. */
export interface Resolution {
  device: DeviceInfo;
  fellBack: boolean;
}

export interface StartRequest {
  assetsDir: string;
  microphone: string | null;
  systemAudio: boolean;
  systemDevice: string | null;
}

/** What the page must save before recording begins. `assets` are asset table entries as page.json writes them. */
export interface Prepared {
  entry: RecordingEntry;
  assets: Record<string, unknown>[];
  microphone: Resolution;
  systemAudio: Resolution | null;
}

/** The `recordings` entry and the asset table entries of a recording that never began, for the page to remove. */
export interface Discard {
  entry: string;
  assets: string[];
}

export interface Level {
  peak: number;
  rms: number;
  clipped: boolean;
  silentMs: number;
  idleMs: number;
}

export interface TrackLevel extends Level {
  kind: TrackKind;
}

export type Warning =
  | { type: 'microphoneSilent'; seconds: number }
  | { type: 'deviceStalled'; track: TrackKind; seconds: number }
  | { type: 'lowDisk'; minutesLeft: number; freeBytes: number }
  | { type: 'lowBattery'; percent: number; minutesLeft: number | null }
  | { type: 'writerFailed'; track: TrackKind; message: string }
  | { type: 'droppedAudio'; track: TrackKind; packets: number }
  | { type: 'deviceLost'; track: TrackKind }
  | { type: 'notDefaultDevice'; track: TrackKind };

export type StopReason = { type: 'diskFull'; freeBytes: number } | { type: 'writerFailed'; message: string };

export interface ClockReading {
  captureNs: number;
  unixMs: number;
}

export interface RecordingStatus {
  paused: boolean;
  now: ClockReading;
  bytes: number;
  levels: TrackLevel[];
  warnings: Warning[];
  stop: StopReason | null;
}

/** A track whose writer failed while recording. `saved` says whether the audio written before then was kept. */
export interface TrackFailure {
  kind: TrackKind;
  message: string;
  saved: boolean;
}

/** What the page saves when recording ends or is recovered. */
export interface Finished {
  entry: RecordingEntry;
  assets: Record<string, unknown>[];
  summary: unknown;
  /** The tracks whose writer failed. The entry is then marked recovered, and keeps what was written. */
  failures: TrackFailure[];
}

export interface PlaybackInfo {
  recording: string;
  durationNs: number;
  map: PositionMapData;
}

export type PlayState = 'paused' | 'playing' | 'ended';

export interface PlaybackStatus {
  state: PlayState;
  positionNs: number;
  durationNs: number;
  speed: number;
  skipSilence: boolean;
  underruns: number;
  error: string | null;
}

/** What a stamp points at. */
export type Target =
  | { type: 'stroke'; id: string }
  | { type: 'text'; block: string; from: number; to: number }
  | { type: 'item'; id: string }
  | { type: 'flag'; id: string };

/** One thing written at one time of one recording. */
export interface StampEntry {
  recording: string;
  startNs: number;
  endNs: number;
  target: Target;
}

/** A range of text typed during a recording. Offsets are UTF-16 code units. */
export interface TextMark {
  from: number;
  to: number;
  recording: number;
  startNs: number;
  endNs: number;
}

export interface TextMarksData {
  recordings: string[];
  marks: TextMark[];
}
