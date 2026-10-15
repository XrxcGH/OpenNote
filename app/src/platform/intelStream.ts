// Where live speech runs (A2-24 dictation, A2-25 live captions). The Tauri shell opens the microphone and runs the
// Whisper model on this device; the web build and tests use a stand-in that sends the updates it is told to send.
// Nothing here touches a network, and no audio ever reaches this side: only words do.

export type StreamPurpose = 'dictation' | 'captions';

export interface StreamRequest {
  purpose: StreamPurpose;
  /** The catalog ID of a downloaded speech model. */
  model: string;
  language?: string | null;
  vocabulary?: string;
}

export type StreamUpdate =
  | { kind: 'listening' }
  | { kind: 'speaking' }
  | { kind: 'partial'; text: string; behindMs: number }
  | { kind: 'final'; text: string; startMs: number; endMs: number; behindMs: number }
  | { kind: 'ended'; error: string | null };

export interface StreamHost {
  start(request: StreamRequest): Promise<string>;
  stop(session: string): Promise<boolean>;
  /** Hears every update of every session. The returned function stops listening. */
  listen(handler: (session: string, update: StreamUpdate) => void): () => void;
}

type Handler = (session: string, update: StreamUpdate) => void;

const handlers = new Set<Handler>();
/** The requests the stand-in received, in order, for tests. */
export const fakeStreamRequests: StreamRequest[] = [];
/** Sessions the stand-in has open. */
export const fakeStreamOpen = new Set<string>();
let counter = 0;

/** Sends an update as if the shell had, for tests and the web build. */
export function sendFakeStreamUpdate(session: string, update: StreamUpdate): void {
  [...handlers].forEach((handler) => handler(session, update));
}

export function resetFakeStream(): void {
  fakeStreamRequests.length = 0;
  fakeStreamOpen.clear();
  handlers.clear();
  counter = 0;
}

const fakeHost: StreamHost = {
  start(request) {
    fakeStreamRequests.push(request);
    const session = `fake-stream-${++counter}`;
    fakeStreamOpen.add(session);
    setTimeout(() => sendFakeStreamUpdate(session, { kind: 'listening' }), 0);
    return Promise.resolve(session);
  },
  stop(session) {
    const was = fakeStreamOpen.delete(session);
    if (was) setTimeout(() => sendFakeStreamUpdate(session, { kind: 'ended', error: null }), 0);
    return Promise.resolve(was);
  },
  listen(handler) {
    handlers.add(handler);
    return () => void handlers.delete(handler);
  },
};

let host: StreamHost | null = null;

export function streamHost(): StreamHost {
  if (host) return host;
  if (import.meta.env.VITE_PLATFORM === 'web') return (host = fakeHost);
  const lazy = import('./tauri/intelStream');
  host = {
    start: async (request) => (await lazy).tauriStream.start(request),
    stop: async (session) => (await lazy).tauriStream.stop(session),
    listen(handler) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void lazy.then((loaded) => {
        if (!stopped) stop = loaded.tauriStream.listen(handler);
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
  return host;
}

/** Replaces the host, for tests. Pass nothing to put the stand-in back. */
export function setStreamHostForTests(next: StreamHost = fakeHost): void {
  host = next;
}
