// Opens allowlisted external targets, such as the release page or the logs folder. Never a raw URL.

import type { ShellClient } from '../types';
import { invoke } from './invoke';

export function createTauriShell(): ShellClient {
  return { openExternal: async (target) => void (await invoke('shell_open_external', { target })) };
}
