// The operating system the app runs on (ADR 0055), from the boot payload. Windows is the default, so a plain
// browser and the tests behave as they always have. macOS changes the shortcut modifier to Command and the way
// chords read; macOS and Linux keep their own title bars; and each system lists what it can't do (systemSupport).

import type { HostSystem } from './types';

let current: HostSystem = 'windows';

export function hostSystem(): HostSystem {
  return current;
}

/** Called once at start from the boot payload, and by tests. */
export function setHostSystem(system: HostSystem): void {
  current = system;
}

/** Whether shortcuts use Command where Windows and Linux use Ctrl. */
export function usesCommandKey(system: HostSystem = current): boolean {
  return system === 'macos';
}
