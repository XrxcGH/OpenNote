// The shell's extra commands for the quality-of-life features: one `shellqol_call` command carries each by name, so
// the command list stays short (like `search_call`). The shell also sends its events on one channel,
// `shellqol://event`, as `{ kind, ... }`.
import { invoke, listen } from './invoke';
import type { Events } from './invoke';

type Call = (command: string, args?: unknown) => Promise<unknown>;
type Listen = (event: string, handler: (payload: unknown) => void) => () => void;

export function tauriShellCall<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return (invoke as unknown as Call)('shellqol_call', { name, args }) as Promise<T>;
}

export function tauriShellListen(handler: (event: { kind: string } & Record<string, unknown>) => void): () => void {
  const channel = 'shellqol://event' as keyof Events;
  return (listen as unknown as Listen)(channel, (payload) =>
    handler(payload as { kind: string } & Record<string, unknown>),
  );
}
