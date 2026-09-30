// The updater status as Rust reports it (ARCHITECTURE.md section 18). The front end only shows it and sends
// commands. The boot payload's update notices (updated, rolled back, rollback unavailable) wait here until the
// updates feature shows them.

import type { BootData, Notice, Platform, UpdaterStatus } from '../platform/types';
import { createStore, useStore } from './store';

export const DEFAULT_UPDATER_STATUS: UpdaterStatus = {
  phase: { kind: 'disabled', reason: 'devBuild' },
  lastCheck: null,
  skippedVersion: null,
  previous: null,
};

export const updaterStore = createStore<UpdaterStatus>(DEFAULT_UPDATER_STATUS, 'updater');

/** A notice about an update, from the boot payload. */
export type UpdaterNotice = Extract<Notice, { kind: 'updated' | 'rolledBack' | 'rollbackUnavailable' }>;

/** Update notices from the boot payload that haven't been shown yet. */
export const updaterNoticesStore = createStore<readonly UpdaterNotice[]>([], 'updater notices');

/** The running version, from the boot payload. */
export const appVersionStore = createStore<string>('', 'app version');

export function useAppVersion(): string {
  return useStore(appVersionStore, (version) => version);
}

const isUpdaterNotice = (notice: Notice): notice is UpdaterNotice =>
  notice.kind === 'updated' || notice.kind === 'rolledBack' || notice.kind === 'rollbackUnavailable';

let unsubscribe: (() => void) | null = null;

export function useUpdaterStatus<S>(select: (s: UpdaterStatus) => S): S {
  return useStore(updaterStore, select);
}

export function getUpdaterStatus(): UpdaterStatus {
  return updaterStore.get();
}

export function initUpdater(boot: BootData, platform: Platform): void {
  unsubscribe?.();
  updaterStore.set(boot.updater);
  appVersionStore.set(boot.version);
  updaterNoticesStore.set(boot.notices.filter(isUpdaterNotice));
  unsubscribe = platform.updater.onStatus((status) => updaterStore.set(status));
}
