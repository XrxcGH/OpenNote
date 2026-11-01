// Where the quality-of-life features reach the shell. The build picks one, like platform/index.ts: the Tauri shell
// answers every call, and the web build answers from a small in-memory fake, so the interface runs in a browser
// and in tests. A call the fake doesn't know resolves to null.

import { answerProtect, fakeProtection } from '../services/notes/memory/protection';
import { registerTestHook } from './web/testHooks';

export type ShellEvent = { kind: string } & Record<string, unknown>;

export interface ShellQolHost {
  call<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Listens for the shell's events. The returned function stops listening. */
  listen(handler: (event: ShellEvent) => void): () => void;
}

type Fake = (name: string, args: Record<string, unknown>) => unknown;

/** The web host. It keeps the choices in memory; tests give it other answers with `setFakeShell`. */
const memory: Record<string, unknown> = {};
/** My handwriting's style, held in memory only, as the shell's encrypted file would hold it. */
let handStyle: string | null = null;
function answerHandStyle(name: string, args: Record<string, unknown>): unknown {
  if (name === 'handstyle.load')
    return handStyle === null ? { state: 'none' } : { state: 'ok', doc: JSON.parse(handStyle) };
  if (name === 'handstyle.save') handStyle = JSON.stringify(args.doc ?? null);
  else if (name === 'handstyle.delete') handStyle = null;
  return { ok: true };
}
const memoryAnswer: Fake = (name, args) => {
  if (name === 'prefs.get') return { ...memory };
  if (name === 'prefs.set') {
    for (const [key, value] of Object.entries((args.patch ?? {}) as Record<string, unknown>)) {
      if (value === null) delete memory[key];
      else memory[key] = value;
    }
    return { ...memory };
  }
  if (name.startsWith('handstyle.')) return answerHandStyle(name, args);
  return answerProtect(name, args) ?? null;
};
let fake: Fake = memoryAnswer;

/** Puts the web host back as it started, for tests. */
export function resetFakeShell(): void {
  for (const key of Object.keys(memory)) delete memory[key];
  handStyle = null;
  fakeProtection.clear();
  fake = memoryAnswer;
}
// Test builds only: record every call the interface makes to the shell, and refuse the named ones, so a test can
// check that a window asked the shell to close, and what it does when the shell says no.
let recorded: { name: string; args: Record<string, unknown> }[] = [];
registerTestHook('shellRecord', (refuse: string[] = []) => {
  recorded = [];
  fake = (name, args) => {
    recorded.push({ name, args });
    if (refuse.includes(name)) throw new Error(`The shell refused ${name}.`);
    return memoryAnswer(name, args);
  };
});
registerTestHook('shellCalls', () => recorded);
const listeners = new Set<(event: ShellEvent) => void>();

export function setFakeShell(answer: Fake): void {
  fake = answer;
}

/** Delivers an event as the shell would, for tests. */
export function emitFakeShellEvent(event: ShellEvent): void {
  [...listeners].forEach((listener) => listener(event));
}

const webHost: ShellQolHost = {
  call: <T>(name: string, args: Record<string, unknown> = {}) =>
    new Promise<T>((resolve) => resolve(fake(name, args) as T)),
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
