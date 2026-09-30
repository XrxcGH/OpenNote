// Opening external targets in a browser only records them, so tests never leave the page.

import type { ExternalTarget, ShellClient } from '../types';
import { registerTestHook } from './testHooks';

export function createWebShell(): ShellClient & { readonly opened: ExternalTarget[] } {
  const opened: ExternalTarget[] = [];
  registerTestHook('openedExternal', () => opened);
  return {
    opened,
    openExternal: (target) => {
      opened.push(target);
      return Promise.resolve();
    },
  };
}
