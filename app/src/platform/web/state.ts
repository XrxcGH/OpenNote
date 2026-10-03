// The device state client in a browser: patches apply to an in-memory copy that tests can read.

import { applyMergePatch } from '../mergePatch';
import type { DeviceState, DeviceStateClient } from '../types';
import { registerTestHook } from './testHooks';

export function createWebState(initial: DeviceState): DeviceStateClient {
  let state = initial;
  registerTestHook('deviceState', () => state);
  return {
    update(patch) {
      state = applyMergePatch(state, patch);
    },
    flush: () => Promise.resolve(),
  };
}
