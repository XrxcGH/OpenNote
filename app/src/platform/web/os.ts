// The Windows appearance in a browser. In development it follows the browser's dark mode, and tests set it
// through the setOs hook, as a Windows setting change would.

import type { OsAppearance, OsClient } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

export function createWebOs(
  initial: OsAppearance,
  followBrowser: boolean,
): OsClient & { set(os: Partial<OsAppearance>): void } {
  let current = initial;
  const changed = emitter<[OsAppearance]>();
  const set = (next: Partial<OsAppearance>) => {
    current = { ...current, ...next };
    changed.emit(current);
  };
  const dark = followBrowser ? globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  dark?.addEventListener('change', (event) => set({ dark: event.matches }));
  registerTestHook('setOs', set);
  return { current: () => current, onChange: changed.on, set };
}
