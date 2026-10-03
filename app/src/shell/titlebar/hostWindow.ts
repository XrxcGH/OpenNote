// The host window, for the title bar and the window title: the window client from the platform the commands were
// given at start-up, so the title bar and the window commands share it.

import { commandContext } from '../../commands/registry';
import type { WindowClient } from '../../platform/types';

/** The window client, or null before start-up has configured the commands. */
export function hostWindow(): WindowClient | null {
  try {
    return commandContext('titleBar').platform.window;
  } catch {
    return null;
  }
}
