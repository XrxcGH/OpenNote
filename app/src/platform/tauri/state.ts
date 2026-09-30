// Device state through state_update, which Rust debounces, and state_flush.

import type { DeviceStateClient } from '../types';
import { fire, invoke } from './invoke';

export function createTauriState(): DeviceStateClient {
  return {
    update: (patch) => fire('state_update', { patch }),
    flush: async () => void (await invoke('state_flush')),
  };
}
