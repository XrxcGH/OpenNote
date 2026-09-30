// The Windows appearance: the boot payload's value, then os://appearance-changed events from Rust.

import type { OsAppearance, OsClient } from '../types';
import { listen } from './invoke';

export function createTauriOs(initial: OsAppearance): OsClient {
  let current = initial;
  listen('os://appearance-changed', (os) => (current = os));
  return {
    current: () => current,
    onChange: (listener) => listen('os://appearance-changed', listener),
  };
}
