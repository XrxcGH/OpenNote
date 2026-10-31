// The web platform's sync: the in-memory host from the sync feature. Playwright and `npm run app:dev` choose with
// the address: `?sync=on` starts set up, with two devices and a change waiting.
import { createFakeSync } from '../../features/sync';
import type { SyncClient } from '../../features/sync';

export function createWebSync(search: string = typeof location === 'undefined' ? '' : location.search): SyncClient {
  return createFakeSync({ configured: new URLSearchParams(search).get('sync') === 'on' });
}
