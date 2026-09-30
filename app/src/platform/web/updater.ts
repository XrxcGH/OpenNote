// The updater in a browser. Tests move it through every phase with the setUpdaterStatus hook; the commands only
// record that they were called.

import type { UpdaterClient, UpdaterStatus } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

export function createWebUpdater(initial: UpdaterStatus): UpdaterClient & { readonly calls: string[] } {
  let status = initial;
  const changed = emitter<[UpdaterStatus]>();
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  registerTestHook('setUpdaterStatus', (next: UpdaterStatus) => {
    status = next;
    changed.emit(status);
  });
  registerTestHook('updaterCalls', () => calls);
  return {
    calls,
    status: () => status,
    onStatus: changed.on,
    check: record('check'),
    download: record('download'),
    restartToUpdate: record('restartToUpdate'),
    skip: (version) => record(`skip ${version}`)(),
    unskip: record('unskip'),
    goBack: record('goBack'),
  };
}
