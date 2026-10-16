// The commands the interface sends to the host. Each method here is a method of AudioService in
// crates/media/src/service, and each becomes one Tauri command when the app wires the media crate in. The
// interface code depends on this shape and never on Tauri, so tests and the web build use a fake.

import type {
  ClockReading,
  DeviceInfo,
  Finished,
  PlaybackInfo,
  PlaybackStatus,
  Prepared,
  RecordingEntry,
  RecordingStatus,
  Resolution,
  StartRequest,
} from './types';

export interface AudioHost {
  /** The input and output devices that are present now. */
  devices(): Promise<DeviceInfo[]>;
  /** Both clocks, read together. */
  clock(): Promise<ClockReading>;
  /** Chooses devices and IDs. The page saves the result before `begin`. */
  prepare(request: StartRequest): Promise<Prepared>;
  /** Opens the devices and creates the files that `prepare` planned. */
  begin(): Promise<RecordingEntry>;
  recordingStatus(): Promise<RecordingStatus>;
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  switchMicrophone(id: string | null): Promise<Resolution>;
  /** Records another output device's sound. Null follows the default output. */
  switchSystemAudio(id: string | null): Promise<Resolution>;
  stop(): Promise<Finished>;
  recover(assetsDir: string, entry: RecordingEntry): Promise<Finished>;
  openPlayback(assetsDir: string, entry: RecordingEntry, device: string | null): Promise<PlaybackInfo>;
  play(): Promise<void>;
  pausePlayback(): Promise<void>;
  seek(positionNs: number): Promise<void>;
  skip(deltaNs: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  setSkipSilence(on: boolean): Promise<void>;
  playbackStatus(): Promise<PlaybackStatus>;
  closePlayback(): Promise<void>;
}

/** Something that calls a Tauri command by name. platform/tauri passes `invoke` from @tauri-apps/api/core. */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The host over Tauri commands, whose names are the methods' names in snake case with an `audio_` prefix. */
export function hostOver(invoke: Invoke): AudioHost {
  const call = <T>(command: string, args?: Record<string, unknown>) => invoke(`audio_${command}`, args) as Promise<T>;
  return {
    devices: () => call('devices'),
    clock: () => call('clock'),
    prepare: (request) => call('prepare', { request }),
    begin: () => call('begin'),
    recordingStatus: () => call('recording_status'),
    pauseRecording: () => call('pause_recording'),
    resumeRecording: () => call('resume_recording'),
    switchMicrophone: (id) => call('switch_microphone', { id }),
    switchSystemAudio: (id) => call('switch_system_audio', { id }),
    stop: () => call('stop'),
    recover: (assetsDir, entry) => call('recover', { assetsDir, entry }),
    openPlayback: (assetsDir, entry, device) => call('open_playback', { assetsDir, entry, device }),
    play: () => call('play'),
    pausePlayback: () => call('pause_playback'),
    seek: (positionNs) => call('seek', { positionNs }),
    skip: (deltaNs) => call('skip', { deltaNs }),
    setSpeed: (speed) => call('set_speed', { speed }),
    setSkipSilence: (on) => call('set_skip_silence', { on }),
    playbackStatus: () => call('playback_status'),
    closePlayback: () => call('close_playback'),
  };
}

/** Calls `callback` every `ms` milliseconds until the function it returns is called. Tests replace it. */
export interface Scheduler {
  every(callback: () => void, ms: number): () => void;
}

export const browserScheduler: Scheduler = {
  every(callback, ms) {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
  },
};
