// Sync through the shell's one command, `sync_call` (app/src-tauri/src/e2e_sync.rs). A refusal comes back with a
// fixed code, which this turns into the SyncFailure the Sync page reads. It calls Tauri directly, so adding sync
// never edits the shared command table in invoke.ts.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { ERROR_CODES, SyncFailure } from '../../features/sync';
import type { SyncClient } from '../../features/sync';
import { toIpcError } from './invoke';

async function call<T>(name: string, args: unknown = null): Promise<T> {
  try {
    return await tauriInvoke<T>('sync_call', { name, args });
  } catch (error) {
    const { code, message } = toIpcError(error);
    throw new SyncFailure(ERROR_CODES.find((known) => known === code) ?? 'unknown', message);
  }
}

export function createTauriSync(): SyncClient {
  return {
    status: () => call('status'),
    setUp: (input) => call('setUp', input),
    join: (input) => call('join', input),
    syncNow: () => call('syncNow'),
    preview: () => call('preview'),
    setPaused: (paused) => call('setPaused', { paused }),
    devices: () => call('devices'),
    removeDevice: (tag) => call('removeDevice', { tag }),
    pairingCode: () => call('pairingCode'),
    trustStorage: () => call('trustStorage'),
    turnOff: () => call('turnOff'),
  };
}
