// Where on-device speech jobs run (Phase 12). The Tauri shell runs the Whisper model on this device; the web build
// and tests use a stand-in that "hears" lines it is given, so the screens can be built and tested without a model.
// Nothing here touches a network.
import type { RecordingEntry } from '../core/audio';

export interface SpeechJobRequest {
  /** The page's `assets` folder, which holds the recording's files. */
  assetsDir: string;
  entry: RecordingEntry;
  /** The catalog ID of a downloaded speech model. */
  model: string;
  choices: { language: string | null; vocabulary: string };
}

export interface SpeechLine {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: number;
}

export type SpeechJobUpdate =
  | { kind: 'started'; device: 'cpu' | 'npu' }
  | { kind: 'progress'; fraction: number }
  | { kind: 'line'; line: SpeechLine }
  | { kind: 'done'; language: string | null; lines: SpeechLine[] }
  | { kind: 'failed'; error: { code: string; message: string } }
  | { kind: 'canceled' };

export interface SpeechHost {
  start(request: SpeechJobRequest): Promise<string>;
  cancel(job: string): Promise<boolean>;
  /** Hears every update of every job. The returned function stops listening. */
  listen(handler: (job: string, update: SpeechJobUpdate) => void): () => void;
}

type Handler = (job: string, update: SpeechJobUpdate) => void;

/** What the stand-in hears for a request. Tests replace it. */
export type FakeHearing = (request: SpeechJobRequest) => SpeechLine[] | Error;

const defaultHearing: FakeHearing = (request) => {
  const ms = Math.max(1000, (request.entry.endedNs - request.entry.startedNs) / 1e6);
  return [
    { startMs: 0, endMs: Math.round(ms / 2), text: 'The recording starts here.' },
    { startMs: Math.round(ms / 2), endMs: Math.round(ms), text: 'And it ends here.' },
  ];
};

let hearing: FakeHearing = defaultHearing;
const handlers = new Set<Handler>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** The requests the stand-in received, in order, for tests. */
export const fakeSpeechRequests: SpeechJobRequest[] = [];
let counter = 0;

/** Sets what the stand-in hears; with no argument, puts the default back. */
export function setFakeHearing(next: FakeHearing = defaultHearing): void {
  hearing = next;
  fakeSpeechRequests.length = 0;
}

const send = (job: string, update: SpeechJobUpdate) => [...handlers].forEach((handler) => handler(job, update));

const fakeHost: SpeechHost = {
  start(request) {
    fakeSpeechRequests.push(request);
    const job = `fake-${++counter}`;
    // Like the shell, the updates follow the answer.
    pending.set(
      job,
      setTimeout(() => {
        pending.delete(job);
        const heard = hearing(request);
        send(job, { kind: 'started', device: 'cpu' });
        if (heard instanceof Error)
          return send(job, { kind: 'failed', error: { code: 'engine', message: heard.message } });
        heard.forEach((line) => send(job, { kind: 'line', line }));
        send(job, { kind: 'progress', fraction: 1 });
        send(job, { kind: 'done', language: request.choices.language ?? 'en', lines: heard });
      }, 0),
    );
    return Promise.resolve(job);
  },
  cancel(job) {
    const timer = pending.get(job);
    if (!timer) return Promise.resolve(false);
    clearTimeout(timer);
    pending.delete(job);
    setTimeout(() => send(job, { kind: 'canceled' }), 0);
    return Promise.resolve(true);
  },
  listen(handler) {
    handlers.add(handler);
    return () => void handlers.delete(handler);
  },
};

let host: SpeechHost | null = null;

export function speechHost(): SpeechHost {
  if (host) return host;
  if (import.meta.env.VITE_PLATFORM === 'web') return (host = fakeHost);
  const lazy = import('./tauri/intelSpeech');
  host = {
    start: async (request) => (await lazy).tauriSpeech.start(request),
    cancel: async (job) => (await lazy).tauriSpeech.cancel(job),
    listen(handler) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void lazy.then((loaded) => {
        if (!stopped) stop = loaded.tauriSpeech.listen(handler);
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
  return host;
}
