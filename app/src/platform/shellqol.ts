// Where the quality-of-life features reach the shell. The build picks one, like platform/index.ts: the Tauri shell
// answers every call, and the web build answers from a small in-memory fake, so the interface runs in a browser
// and in tests. A call the fake doesn't know resolves to null.

export type ShellEvent = { kind: string } & Record<string, unknown>;

export interface ShellQolHost {
  call<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Listens for the shell's events. The returned function stops listening. */
  listen(handler: (event: ShellEvent) => void): () => void;
}

type Fake = (name: string, args: Record<string, unknown>) => unknown;

/** The web host. It keeps the choices in memory; tests give it other answers with `setFakeShell`. */
const memory: Record<string, unknown> = {};
const memoryAnswer: Fake = (name, args) => {
  if (name === 'prefs.get') return { ...memory };
  if (name === 'prefs.set') {
    for (const [key, value] of Object.entries((args.patch ?? {}) as Record<string, unknown>)) {
      if (value === null) delete memory[key];
      else memory[key] = value;
    }
    return { ...memory };
  }
  return null;
};
let fake: Fake = memoryAnswer;

/** Puts the web host back as it started, for tests. */
export function resetFakeShell(): void {
  for (const key of Object.keys(memory)) delete memory[key];
  fake = memoryAnswer;
}
const listeners = new Set<(event: ShellEvent) => void>();

export function setFakeShell(answer: Fake): void {
  fake = answer;
}

/** Delivers an event as the shell would, for tests. */
export function emitFakeShellEvent(event: ShellEvent): void {
  [...listeners].forEach((listener) => listener(event));
}

const webHost: ShellQolHost = {
  call: <T>(name: string, args: Record<string, unknown> = {}) => Promise.resolve(fake(name, args) as T),
  listen(handler) {
    listeners.add(handler);
    return () => void listeners.delete(handler);
  },
};

let host: ShellQolHost | null = null;

export function shellHost(): ShellQolHost {
  if (host) return host;
  if (import.meta.env.VITE_PLATFORM === 'web') return (host = webHost);
  const lazy = import('./tauri/shellqol');
  host = {
    call: async <T>(name: string, args?: Record<string, unknown>) => (await lazy).tauriShellCall<T>(name, args),
    listen(handler) {
      let stop: (() => void) | null = null;
      let stopped = false;
      void lazy.then((loaded) => {
        if (!stopped) stop = loaded.tauriShellListen(handler);
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
  return host;
}

/** One call to the shell. */
export function shellCall<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  return shellHost().call<T>(name, args);
}
