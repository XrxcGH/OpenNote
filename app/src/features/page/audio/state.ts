// What the recording screens read, in a module light enough for start-up (Phase 9): the indicator in the title bar
// and the record control in the command bar render from these stores, and the controller (controller.ts), which
// loads on first use, writes them.
import type { MeterState, TrackKind, Warning } from '../../../core/audio';
import { createStore } from '../../../state/store';

export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface RecordingUi {
  phase: RecordingPhase;
  /** The page and block that hold the recording that is running. */
  page: string | null;
  block: string | null;
  recording: string | null;
  /** Recorded time without the pauses, in milliseconds. */
  elapsedMs: number;
  meters: Partial<Record<TrackKind, MeterState>>;
  warnings: readonly Warning[];
  bytes: number;
  /** The microphone's name. */
  source: string | null;
}

export const IDLE: RecordingUi = {
  phase: 'idle',
  page: null,
  block: null,
  recording: null,
  elapsedMs: 0,
  meters: {},
  warnings: [],
  bytes: 0,
  source: null,
};

export const recordingUi = createStore<RecordingUi>(IDLE, 'audio recording');

export const isBusy = (ui: RecordingUi) => ui.phase !== 'idle';
export const isRunning = (ui: RecordingUi) => ui.phase === 'recording' || ui.phase === 'paused';

/** Whether a recording is open for playback, so the page view knows to close it when another page opens. */
export const playbackOpen = createStore<boolean>(false, 'audio playback open');

/** What the person chose for the next recording, kept on this device. */
export interface RecordingChoices {
  microphone: string | null;
  systemAudio: boolean;
  /** How small "Compress" makes a saved recording. */
  quality: 'smaller' | 'smallest';
  /** Whether OpenNote offers to record when another app starts using the microphone. Off until the person asks. */
  meetingPrompt: boolean;
}

const CHOICES_KEY = 'opennote.audio.choices';
export const DEFAULT_CHOICES: RecordingChoices = {
  microphone: null,
  systemAudio: false,
  quality: 'smaller',
  meetingPrompt: false,
};

function readChoices(): RecordingChoices {
  try {
    const saved = JSON.parse(localStorage.getItem(CHOICES_KEY) ?? 'null') as Partial<RecordingChoices> | null;
    return {
      microphone: typeof saved?.microphone === 'string' ? saved.microphone : null,
      systemAudio: saved?.systemAudio === true,
      quality: saved?.quality === 'smallest' ? 'smallest' : 'smaller',
      meetingPrompt: saved?.meetingPrompt === true,
    };
  } catch {
    return DEFAULT_CHOICES;
  }
}

export const recordingChoices = createStore<RecordingChoices>(readChoices(), 'audio recording choices');

export function chooseRecording(patch: Partial<RecordingChoices>): void {
  const next = { ...recordingChoices.get(), ...patch };
  recordingChoices.set(next);
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(next));
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

/** The recording block types the page uses. */
export const RECORDING_TYPE = 'ext:org.opennote/recording';
