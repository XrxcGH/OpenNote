// Installation in a browser: the status comes from the boot payload, and the folder picker returns a folder a
// test chooses with the pickFolder hook.

import type { FolderCheck, InstallClient, InstallStatus } from '../types';
import { registerTestHook } from './testHooks';

export function createWebInstall(status: InstallStatus): InstallClient {
  let picked: string | null = 'C:\\Users\\Ada\\Documents\\OpenNote';
  let check: FolderCheck = { kind: 'willCreate' };
  registerTestHook('pickFolder', (folder: string | null) => (picked = folder));
  registerTestHook('folderCheck', (next: FolderCheck) => (check = next));
  return {
    status: () => Promise.resolve(status),
    pickNotesFolder: (initial) => Promise.resolve(picked ?? initial),
    checkNotesFolder: () => Promise.resolve(check),
    moveToUserPrograms: () => Promise.resolve(),
  };
}
