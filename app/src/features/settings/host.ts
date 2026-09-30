// The platform, for sections that talk to the host (the notes folder, the log folder, the updater).

import { commandContext } from '../../commands/registry';
import type { Platform } from '../../platform/types';

export function host(): Platform {
  return commandContext('menu').platform;
}
