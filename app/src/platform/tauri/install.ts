// Where the app lives and the notes folder: status, the Windows folder picker, folder checks, and the move to
// the user's Programs folder.

import type { InstallClient } from '../types';
import { invoke } from './invoke';

export function createTauriInstall(): InstallClient {
  return {
    status: () => invoke('install_status'),
    pickNotesFolder: (initial) => invoke('install_pick_folder', { initial }),
    checkNotesFolder: (path) => invoke('install_check_folder', { path }),
    moveToUserPrograms: async () => void (await invoke('install_move_to_user_programs')),
  };
}
