// The settings slice: a mirror of settings.json, which Rust owns (ARCHITECTURE.md section 16.7).
// Changes apply to the store at once and go to the platform as a merge patch; a rejection reverts them.

import { applyMergePatch } from '../platform/mergePatch';
import type { BootData, IpcError, Platform, Settings, SettingsPatch } from '../platform/types';
import { createStore, useStore } from './store';

/** Settings schema version 1 (ARCHITECTURE.md section 16.3). A test compares it with Rust's defaults. */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  minWriterSchema: 1,
  appearance: {
    theme: 'system',
    pageColor: 'matchTheme',
    textSize: 100,
    uiScale: 100,
    motion: 'system',
    density: 'auto',
  },
  storage: { notesFolder: null },
  startup: { openLastPage: true },
  shortcuts: {},
  keyboard: { preset: 'default' },
  updates: { install: 'auto', channel: 'stable', skippedVersion: null },
  setup: { completedSteps: [] },
  experimental: { flags: {} },
};

export const settingsStore = createStore<{ settings: Settings; readOnly: boolean }>(
  { settings: DEFAULT_SETTINGS, readOnly: false },
  'settings',
);

let host: Platform | null = null;
let unsubscribe: (() => void) | null = null;

export function useSettings<S>(select: (s: Settings) => S): S {
  return useStore(settingsStore, (state) => select(state.settings));
}

export function getSettings(): Settings {
  return settingsStore.get().settings;
}

export function isIpcError(error: unknown): error is IpcError {
  return typeof error === 'object' && error !== null && typeof (error as IpcError).code === 'string';
}

/**
 * Applies the patch at once and sends it to the platform. When the platform rejects it, the store goes back to
 * the settings before the patch and the promise rejects with the IpcError. Read-only settings, written by a newer
 * version, change only for this session. So does a host that can't store settings yet (code notImplemented).
 */
export async function updateSettings(patch: SettingsPatch): Promise<void> {
  const before = getSettings();
  const optimistic = applyMergePatch(before, patch);
  settingsStore.set((state) => ({ ...state, settings: optimistic }));
  if (!host || settingsStore.get().readOnly) return;
  try {
    const saved = await host.settings.update(patch);
    settingsStore.set((state) => (state.settings === optimistic ? { ...state, settings: saved } : state));
  } catch (error) {
    if (isIpcError(error) && error.code === 'notImplemented') return;
    settingsStore.set((state) => (state.settings === optimistic ? { ...state, settings: before } : state));
    throw error;
  }
}

export function initSettings(boot: BootData, platform: Platform): void {
  unsubscribe?.();
  host = platform;
  settingsStore.set({ settings: boot.settings, readOnly: boot.settingsReadOnly });
  unsubscribe = platform.settings.onChange((settings) => settingsStore.set((state) => ({ ...state, settings })));
}
