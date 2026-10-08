// The web platform's audio: a recorder and a player made of timers, so the recording and playback screens run in a
// plain browser with no microphone (Phase 9). A recording lasts as long as it ran and makes no sound, and it keeps
// the shape of the real one: an entry with a clock anchor, pauses, and tracks, which the player turns into a
// position map exactly as the media crate does. Editing a recording adds a hole to its entry, as the crate does.

import type {
  AudioHost,
  ClockReading,
  DeviceInfo,
  Finished,
  PlaybackInfo,
  PlaybackStatus,
  Prepared,
  RecordingEntry,
  RecordingStatus,
  Span,
  StartRequest,
  TrackKind,
} from '../../core/audio';
import type { AudioClient, AudioEdit } from '../types';

const SECOND = 1_000_000_000;

const DEVICES: DeviceInfo[] = [
  {
    id: 'mic-built-in',
    name: 'Microphone array (built in)',
    direction: 'input',
    isDefault: true,
    sampleRate: 48000,
    channels: 2,
  },
  {
    id: 'mic-headset',
    name: 'Headset microphone',
    direction: 'input',
    isDefault: false,
    sampleRate: 48000,
    channels: 1,
  },
  {
    id: 'out-speakers',
    name: 'Speakers (built in)',
    direction: 'output',
    isDefault: true,
    sampleRate: 48000,
    channels: 2,
  },
];
const [BUILT_IN, , SPEAKERS] = DEVICES as [DeviceInfo, DeviceInfo, DeviceInfo];

const failure = (code: string, message: string) => ({ code, message });
const notRunning = () => failure('audioFormat', 'No recording is running.');

/** The stretches of capture time that have audio, from the entry: its run minus its pauses and holes. */
export function spansOf(entry: RecordingEntry): Span[] {
  const spans: Span[] = [];
  let at = entry.startedNs;
  let position = 0;
  const close = (end: number) => {
    if (end > at) {
      spans.push({ captureStartNs: at, captureEndNs: end, positionStartNs: position });
      position += end - at;
    }
  };
  for (const hole of [...entry.pauses].sort((a, b) => a.pausedNs - b.pausedNs)) {
    close(Math.min(hole.pausedNs, entry.endedNs));
    at = Math.max(at, hole.resumedNs);
  }
  close(entry.endedNs);
  return spans;
}

function durationOf(entry: RecordingEntry): number {
  return spansOf(entry).reduce((sum, span) => sum + span.captureEndNs - span.captureStartNs, 0);
}

/** The capture time of a position in the audio. */
function captureAt(entry: RecordingEntry, positionNs: number): number {
  const spans = spansOf(entry);
  const span = [...spans].reverse().find((candidate) => candidate.positionStartNs <= positionNs) ?? spans[0];
  return span ? span.captureStartNs + (positionNs - span.positionStartNs) : entry.startedNs;
}

const newTrack = (kind: TrackKind, asset: string) => ({
  kind,
  asset,
  timeline: { anchors: [], frames: 0 },
  silenceFrames: 0,
  droppedPackets: 0,
});

interface Running {
  entry: RecordingEntry;
  pausedAt: number | null;
  bytes: number;
}

type Recorder = Pick<
  AudioHost,
  | 'prepare'
  | 'begin'
  | 'recordingStatus'
  | 'pauseRecording'
  | 'resumeRecording'
  | 'switchMicrophone'
  | 'switchSystemAudio'
  | 'stop'
  | 'recover'
>;

function createRecorder(clock: () => ClockReading): Recorder {
  let counter = 0;
  let tick = 0;
  let prepared: { entry: RecordingEntry; request: StartRequest } | null = null;
  let running: Running | null = null;
  const recorder: Recorder = {
    async prepare(request): Promise<Prepared> {
      counter += 1;
      const id = `web-rec-${counter}-${Date.now().toString(36)}`;
      const kinds: TrackKind[] = request.systemAudio ? ['microphone', 'systemAudio'] : ['microphone'];
      const entry: RecordingEntry = {
        id,
        state: 'recording',
        started: new Date().toISOString(),
        startedNs: 0,
        endedNs: 0,
        pauses: [],
        tracks: kinds.map((kind) => newTrack(kind, `${id}-${kind}`)),
      };
      prepared = { entry, request };
      const pick = DEVICES.find((device) => device.id === request.microphone) ?? BUILT_IN;
      return {
        entry,
        assets: [],
        microphone: { device: pick, fellBack: Boolean(request.microphone) && pick.id !== request.microphone },
        systemAudio: request.systemAudio ? { device: SPEAKERS, fellBack: false } : null,
      };
    },
    async begin() {
      if (!prepared) throw failure('audioFormat', 'Prepare a recording before beginning it.');
      const now = clock();
      const entry = { ...prepared.entry, clock: { ...now }, startedNs: now.captureNs };
      running = { entry, pausedAt: null, bytes: 0 };
      prepared = null;
      return entry;
    },
    async recordingStatus(): Promise<RecordingStatus> {
      if (!running) throw notRunning();
      tick += 1;
      const level = running.pausedAt === null ? 0.2 + 0.15 * Math.sin(tick / 2) : 0;
      if (running.pausedAt === null) running.bytes += 4000;
      return {
        paused: running.pausedAt !== null,
        now: clock(),
        bytes: running.bytes,
        levels: running.entry.tracks.map(({ kind }) => ({
          kind,
          peak: level,
          rms: level / 2,
          clipped: false,
          silentMs: 0,
          idleMs: 0,
        })),
        warnings: [],
        stop: null,
      };
    },
    async pauseRecording() {
      if (running && running.pausedAt === null) running.pausedAt = clock().captureNs;
    },
    async resumeRecording() {
      if (!running || running.pausedAt === null) return;
      const hole = { pausedNs: running.pausedAt, resumedNs: clock().captureNs };
      running.entry = { ...running.entry, pauses: [...running.entry.pauses, hole] };
      running.pausedAt = null;
    },
    async switchMicrophone(id) {
      const device = DEVICES.find((candidate) => candidate.id === id) ?? BUILT_IN;
      return { device, fellBack: id !== null && device.id !== id };
    },
    async switchSystemAudio() {
      return { device: SPEAKERS, fellBack: false };
    },
    async stop(): Promise<Finished> {
      if (!running) throw notRunning();
      if (running.pausedAt !== null) await recorder.resumeRecording();
      const entry: RecordingEntry = { ...running.entry, state: 'complete', endedNs: clock().captureNs };
      const frames = Math.round((durationOf(entry) / SECOND) * 48000);
      entry.tracks = entry.tracks.map((track) => ({
        ...track,
        timeline: { anchors: [{ frame: 0, timeNs: entry.startedNs }], frames },
      }));
      running = null;
      return { entry, assets: [], summary: null, failures: [] };
    },
    async recover(_dir, entry): Promise<Finished> {
      const endedNs = entry.endedNs > entry.startedNs ? entry.endedNs : entry.startedNs + 5 * SECOND;
      return { entry: { ...entry, state: 'recovered', endedNs }, assets: [], summary: null, failures: [] };
    },
  };
  return recorder;
}

type Player = Pick<
  AudioHost,
  | 'openPlayback'
  | 'play'
  | 'pausePlayback'
  | 'seek'
  | 'skip'
  | 'setSpeed'
  | 'setSkipSilence'
  | 'playbackStatus'
  | 'closePlayback'
>;

function createPlayer(): Player {
  let open: { entry: RecordingEntry; duration: number } | null = null;
  const state = { playing: false, ended: false, at: 0, speed: 1, skipSilence: false, since: 0 };
  const closed = () => failure('audioFormat', 'No recording is open for playback.');
  const position = () => {
    const moved = state.playing ? (performance.now() - state.since) * 1e6 * state.speed : 0;
    return Math.min(open?.duration ?? 0, Math.round(state.at + moved));
  };
  /** Folds the time that passed into the position, and ends playback at the end of the audio. */
  const settle = () => {
    state.at = position();
    state.since = performance.now();
    if (open && state.playing && state.at >= open.duration) Object.assign(state, { playing: false, ended: true });
  };
  const player: Player = {
    async openPlayback(_dir, entry): Promise<PlaybackInfo> {
      open = { entry, duration: durationOf(entry) };
      Object.assign(state, { playing: false, ended: false, at: 0, since: performance.now() });
      return { recording: entry.id, durationNs: open.duration, map: { spans: spansOf(entry) } };
    },
    async play() {
      if (!open) throw closed();
      settle();
      if (state.ended || state.at >= open.duration) state.at = 0;
      Object.assign(state, { playing: true, ended: false });
    },
    async pausePlayback() {
      settle();
      state.playing = false;
    },
    async seek(positionNs) {
      if (!open) return;
      state.at = Math.max(0, Math.min(open.duration, positionNs));
      state.since = performance.now();
      state.ended = false;
    },
    async skip(deltaNs) {
      settle();
      await player.seek(state.at + deltaNs);
    },
    async setSpeed(speed) {
      settle();
      state.speed = speed;
    },
    async setSkipSilence(on) {
      state.skipSilence = on;
    },
    async playbackStatus(): Promise<PlaybackStatus> {
      if (!open) throw closed();
      settle();
      return {
        state: state.ended ? 'ended' : state.playing ? 'playing' : 'paused',
        positionNs: state.at,
        durationNs: open.duration,
        speed: state.speed,
        skipSilence: state.skipSilence,
        underruns: 0,
        error: null,
      };
    },
    async closePlayback() {
      open = null;
      state.playing = false;
    },
  };
  return player;
}

/** The entry with a hole added where the audio between two positions was removed. */
function holed(entry: RecordingEntry, from: number, to: number): AudioEdit {
  const next: RecordingEntry = {
    ...entry,
    pauses: [...entry.pauses, { pausedNs: captureAt(entry, from), resumedNs: captureAt(entry, to) }],
  };
  return { entry: next, durationNs: durationOf(next) };
}

export function createWebAudio(): AudioClient {
  const origin = performance.now();
  const clock = (): ClockReading => ({
    captureNs: Math.round(10 * SECOND + (performance.now() - origin) * 1e6),
    unixMs: Date.now(),
  });
  const host: AudioHost = {
    devices: async () => DEVICES,
    clock: async () => clock(),
    ...createRecorder(clock),
    ...createPlayer(),
  };
  return {
    host,
    keepsAssets: false,
    assetsDir: async (page) => `memory://recordings/${page}`,
    adoptTracks: async () => undefined,
    // The fake finds a second of silence at the start of a recording longer than three seconds.
    trimSilence: async (_dir, entry) => (durationOf(entry) < 3 * SECOND ? null : holed(entry, 0, SECOND)),
    removePart: async (_dir, entry, startNs, endNs) => holed(entry, startNs, endNs),
    deleteFiles: async () => 0,
  };
}
