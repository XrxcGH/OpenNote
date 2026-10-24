// Import and export over the app's interop commands (Phase 11). The commands are the ones in
// app/src-tauri/src/interop; progress arrives as interop://progress events named by job.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import type { InteropClient, JobEvent } from '../interop';
import { toIpcError } from './invoke';

const PROGRESS = 'interop://progress';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw toIpcError(error);
  }
}

export function createTauriInterop(): InteropClient {
  return {
    pick: (kind, initial) => call('interop_pick', { kind, initial: initial ?? null }),
    detect: (path) => call('interop_detect', { path }),
    localSources: () => call('interop_local_sources'),
    preview: (job, path, choices) => call('interop_preview', { job, path, choices }),
    importFrom: (job, path, choices) => call('interop_import', { job, path, choices }),
    // The notes folder holds the imported notebook, so its pages are the tree's own: there is nothing to adopt.
    adopt: () => Promise.resolve(),
    exportTo: (job, request) => call('interop_export', { job, request }),
    cancel: (job) => void call('interop_cancel', { job }).catch(() => undefined),
    reveal: (path) => call('interop_reveal', { path }),
    more: <T>(op: string, args?: Record<string, unknown>) => call<T>('interop_more', { op, args: args ?? {} }),
    onProgress(listener) {
      let stopped = false;
      let stop: (() => void) | null = null;
      tauriListen<JobEvent>(PROGRESS, ({ payload }) => listener(payload))
        .then((unlisten) => (stopped ? unlisten() : (stop = unlisten)))
        .catch((error: unknown) => console.debug(`${PROGRESS}: ${String(error)}`));
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}
