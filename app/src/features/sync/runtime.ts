// The Sync page's state: the last view from the host, refreshed after every action, every 15 seconds while
// Settings > Sync shows, and every minute for the title bar notice. Nothing runs before either asks.

import { useEffect } from 'react';
import { commandContext } from '../../commands/registry';
import { createStore, useStore } from '../../state/store';
import type { SyncClient, SyncView } from './types';

export const syncStore = createStore<SyncView | null>(null, 'sync view');

/** Whether Settings > Sync shows the Change passphrase form; the palette command opens it. */
export const passphraseAsked = createStore<boolean>(false, 'sync passphrase form');

export function syncClient(): SyncClient {
  return commandContext('menu').platform.sync;
}

/** Reads the view again. A failure keeps the last one. */
export async function refreshSync(): Promise<SyncView | null> {
  try {
    const view = await syncClient().status();
    syncStore.set(view);
    return view;
  } catch {
    return syncStore.get();
  }
}

export function setView(view: SyncView): void {
  syncStore.set({ ...view, recoveryKey: undefined });
}

const same = <T>(value: T) => value;

export function useSyncView(): SyncView | null {
  return useStore(syncStore, same);
}

/** Refreshes now and every `every` milliseconds while mounted, unless `enabled` is false. */
export function useSyncPolling(every: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    void refreshSync();
    const timer = window.setInterval(() => void refreshSync(), every);
    return () => window.clearInterval(timer);
  }, [every, enabled]);
}
