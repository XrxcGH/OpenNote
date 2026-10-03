// Settings through Rust's settings_update and settings_reset commands and the settings://changed event.

import type { SettingsClient } from '../types';
import { invoke, listen } from './invoke';

export function createTauriSettings(): SettingsClient {
  return {
    update: (patch) => invoke('settings_update', { patch }),
    reset: (section) => invoke('settings_reset', { section }),
    onChange: (listener) => listen('settings://changed', ({ settings, origin }) => listener(settings, origin)),
  };
}
