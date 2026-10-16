// Audio recording and playback over the media crate's commands (Phase 9). The commands are named audio_<method>
// in snake case, so hostOver maps the interface's AudioHost onto them; the few commands that edit a finished
// recording, and the one that names a page's folder, are called here.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { hostOver } from '../../core/audio';
import type { AudioClient, AudioEdit } from '../types';
import { toIpcError } from './invoke';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw toIpcError(error);
  }
}

export function createTauriAudio(): AudioClient {
  return {
    host: hostOver(call),
    keepsAssets: true,
    assetsDir: (page) => call<string>('audio_assets_dir', { page }),
    adoptTracks: (assetsDir, entry, growing) =>
      call<null>('audio_adopt_tracks', { assetsDir, entry, growing }).then(() => undefined),
    trimSilence: (assetsDir, entry) => call<AudioEdit | null>('audio_trim_silence', { assetsDir, entry }),
    removePart: (assetsDir, entry, startNs, endNs) =>
      call<AudioEdit>('audio_remove_part', { assetsDir, entry, startNs, endNs }),
    deleteFiles: (assetsDir, entry) => call<number>('audio_delete_files', { assetsDir, entry }),
  };
}
