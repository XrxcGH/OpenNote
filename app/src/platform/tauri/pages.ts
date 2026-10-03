// Pages through Phase 3's core (owner after WP0: WP2). The core's client takes its invoke and listen from here
// (P3-8), so only platform/tauri imports @tauri-apps/api. The adapter loads with the first page, not at start-up.
import { listen as tauriListen } from '@tauri-apps/api/event';
import type { CoreInvoke, CoreListen } from '../../core/client';
import type { PageService } from '../../services/pages/types';
import type { ImagesClient, PagesClient } from '../types';
import { invoke } from './invoke';

const coreInvoke: CoreInvoke = (command, args) =>
  (invoke as (command: string, args?: Record<string, unknown>) => Promise<unknown>)(command, args);

/** Listens for a core event. The returned function stops listening, even before Tauri confirms the listener. */
const coreListen: CoreListen = (event, handler) => {
  let stopped = false;
  let stop: (() => void) | null = null;
  tauriListen(event, ({ payload }) => handler(payload))
    .then((unlisten) => (stopped ? unlisten() : (stop = unlisten)))
    .catch((error: unknown) => console.debug(`${event}: ${String(error)}`));
  return () => {
    stopped = true;
    stop?.();
  };
};

export function createTauriPages(images: ImagesClient): PagesClient {
  let service: Promise<PageService> | null = null;
  const load = async () => {
    const [{ createCoreClient }, { createTauriPageService }] = await Promise.all([
      import('../../core/client'),
      import('../../services/pages/tauri'),
    ]);
    return createTauriPageService(createCoreClient({ invoke: coreInvoke, listen: coreListen }), images);
  };
  return {
    open(pageId, options) {
      service ??= load();
      return service.then((pages) => pages.open(pageId, options));
    },
  };
}
