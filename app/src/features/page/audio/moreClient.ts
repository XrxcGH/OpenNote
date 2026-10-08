// The client of the audio lane's later host commands (core/audio/more.ts). The app's is over Tauri; a window with no
// host, such as the web build, answers every call with "not implemented", which the screens show as a notice. Tests
// set their own.
import { moreOver } from '../../../core/audio';
import type { AudioMore } from '../../../core/audio';

let chosen: AudioMore | null = null;

/** Replaces the client, or restores the real one with null. For tests. */
export function setMoreClient(client: AudioMore | null): void {
  chosen = client;
}

const notImplemented = () => Promise.reject({ code: 'notImplemented', message: 'This needs the OpenNote app.' });

/** A client whose every call fails the way a command that doesn't exist does. */
export const withoutHost: AudioMore = {
  split: notImplemented,
  enhance: notImplemented,
  compress: notImplemented,
  storageScan: notImplemented,
  purgeHistory: notImplemented,
  exportAudio: notImplemented,
  importFile: notImplemented,
  meetingPoll: () => Promise.resolve(null),
  snap: notImplemented,
};

export async function moreClient(): Promise<AudioMore> {
  if (chosen) return chosen;
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return withoutHost;
  const { invoke } = await import('@tauri-apps/api/core');
  chosen = moreOver((command, args, options) => invoke(command, args as never, options as never));
  return chosen;
}

/** Whether the app has a host for these commands. */
export const hasHost = (): boolean =>
  chosen !== null || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
