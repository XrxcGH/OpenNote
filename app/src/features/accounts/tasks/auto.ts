// The quiet sync. Once a service has been synced by hand, OpenNote keeps it in step while the app is open: shortly after
// start and then every quarter of an hour, with no message and no sound. A failure (offline, signed out) is ignored, and
// the next time just tries again. Turning the flag off, or disconnecting the account, stops it.
import { isEnabled } from '../../../app/flags';
import { isConnected } from '../run';
import { hasSynced, runSync } from './commands';
import type { TasksService } from './commands';

const EVERY_MS = 15 * 60_000;
const FIRST_MS = 60_000;
let started = false;

async function once(): Promise<void> {
  if (!isEnabled('accounts.tasksSync')) return;
  for (const service of ['microsoft', 'google'] as const satisfies readonly TasksService[]) {
    try {
      if ((await hasSynced(service)) && (await isConnected(service))) await runSync(service);
    } catch {
      // Not now. The next run tries again.
    }
  }
}

export function startAutoSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.setTimeout(() => {
    void once();
    window.setInterval(() => void once(), EVERY_MS);
  }, FIRST_MS);
}
