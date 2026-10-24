// The quiet pen settings sync. Once pen settings have been synced by hand, OpenNote keeps them in step while the app is
// open: a minute after start and then every half hour, with no message. A failure is ignored and tried again later.
import { isEnabled } from '../../../app/flags';
import { runPenSync, syncedService } from './commands';

const EVERY_MS = 30 * 60_000;
const FIRST_MS = 90_000;
let started = false;

async function once(): Promise<void> {
  if (!isEnabled('accounts.penSync')) return;
  try {
    const service = await syncedService();
    if (service) await runPenSync(service);
  } catch {
    // Not now. The next run tries again.
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
