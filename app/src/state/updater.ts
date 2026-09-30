// The updater status as Rust reports it (ARCHITECTURE.md section 18). The front end only shows it.

import type { BootData, Platform, UpdaterStatus } from '../platform/types';
import { createStore, useStore } from './store';

export const DEFAULT_UPDATER_STATUS: UpdaterStatus = {
  phase: { kind: 'disabled', reason: 'devBuild' },
  lastCheck: null,
  skippedVersion: null,
  previous: null,
};

export const updaterStore = createStore<UpdaterStatus>(DEFAULT_UPDATER_STATUS, 'updater');

let unsubscribe: (() => void) | null = null;

export function useUpdaterStatus<S>(select: (s: UpdaterStatus) => S): S {
  return useStore(updaterStore, select);
}

export function initUpdater(boot: BootData, platform: Platform): void {
  unsubscribe?.();
  updaterStore.set(boot.updater);
  unsubscribe = platform.updater.onStatus((status) => updaterStore.set(status));
}
