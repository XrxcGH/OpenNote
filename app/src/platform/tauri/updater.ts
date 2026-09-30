// The updater: its status from the boot payload and updater://status events, and the updater_* commands.

import type { UpdaterClient, UpdaterStatus } from '../types';
import { invoke, listen } from './invoke';

export function createTauriUpdater(initial: UpdaterStatus): UpdaterClient {
  let status = initial;
  listen('updater://status', (next) => (status = next));
  const run =
    (
      command:
        'updater_check' | 'updater_download' | 'updater_restart_to_update' | 'updater_unskip' | 'updater_go_back',
    ) =>
    async () =>
      void (await invoke(command));
  return {
    status: () => status,
    onStatus: (listener) => listen('updater://status', listener),
    check: run('updater_check'),
    download: run('updater_download'),
    restartToUpdate: run('updater_restart_to_update'),
    skip: async (version) => void (await invoke('updater_skip', { version })),
    unskip: run('updater_unskip'),
    goBack: run('updater_go_back'),
  };
}
