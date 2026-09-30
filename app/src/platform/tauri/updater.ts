// The updater: its status from the boot payload and updater://status events, and the updater_* commands.
// Rust's scheduler may send a status before this listener is ready, so the client also asks for the status once.

import type { UpdaterClient, UpdaterStatus } from '../types';
import { invoke, listen } from './invoke';

type Run = 'updater_check' | 'updater_download' | 'updater_restart_to_update' | 'updater_unskip' | 'updater_go_back';

export function createTauriUpdater(initial: UpdaterStatus): UpdaterClient {
  let status = initial;
  const listeners = new Set<(status: UpdaterStatus) => void>();
  const receive = (next: UpdaterStatus) => {
    status = next;
    [...listeners].forEach((listener) => listener(next));
  };
  listen('updater://status', receive);
  invoke('updater_status').then(receive, (error: { message: string }) => console.debug(error.message));
  const run = (command: Run) => async () => void (await invoke(command));
  return {
    status: () => status,
    onStatus: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    check: run('updater_check'),
    download: run('updater_download'),
    restartToUpdate: run('updater_restart_to_update'),
    skip: async (version) => void (await invoke('updater_skip', { version })),
    unskip: run('updater_unskip'),
    goBack: run('updater_go_back'),
  };
}
