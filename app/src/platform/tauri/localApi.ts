// App permissions through the shell: one `api_call` command carries every method, and the shell's questions and
// changes arrive on `api://event`. It calls Tauri directly, so the shared command table in invoke.ts stays as it is.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { toIpcError } from './invoke';

export async function tauriApiCall<T>(method: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>('api_call', { method, args });
  } catch (error) {
    const { code, message } = toIpcError(error);
    throw Object.assign(new Error(message), { code });
  }
}

export type LocalApiEvent = { kind: string } & Record<string, unknown>;

export function tauriApiListen(handler: (event: LocalApiEvent) => void): Promise<() => void> {
  return listen<LocalApiEvent>('api://event', (event) => handler(event.payload));
}

/** Takes the shares waiting in the shell's share inbox ("Share to OpenNote"). */
export async function tauriShareTake<T>(): Promise<T[]> {
  try {
    return await invoke<T[]>('share_take');
  } catch (error) {
    const { code, message } = toIpcError(error);
    throw Object.assign(new Error(message), { code });
  }
}
