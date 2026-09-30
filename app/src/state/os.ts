// The Windows appearance: dark mode, contrast theme, animations, text scale, and the effective zoom. Rust reads
// it and sends changes as events; the web platform fakes it (ARCHITECTURE.md section 5.2).

import type { BootData, OsAppearance, Platform } from '../platform/types';
import { createStore, useStore } from './store';

export const DEFAULT_OS: OsAppearance = { dark: false, contrast: false, animations: true, textScale: 1, zoom: 1 };

export const osStore = createStore<OsAppearance>(DEFAULT_OS, 'os');

let unsubscribe: (() => void) | null = null;

export function useOs<S>(select: (os: OsAppearance) => S): S {
  return useStore(osStore, select);
}

export function initOs(boot: BootData, platform: Platform): void {
  unsubscribe?.();
  osStore.set(boot.os);
  unsubscribe = platform.os.onChange((os) => osStore.set(os));
}
