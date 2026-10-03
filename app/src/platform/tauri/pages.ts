// Pages through Phase 3's core (owner after WP0: WP2). The core's client takes its invoke from here (P3-8), so only
// platform/tauri imports @tauri-apps/api.
import { createCoreClient } from '../../core/client';
import type { CoreInvoke } from '../../core/client';
import { createTauriPageService } from '../../services/pages/tauri';
import type { ImagesClient, PagesClient } from '../types';
import { invoke } from './invoke';

const coreInvoke: CoreInvoke = (command, args) =>
  (invoke as (command: string, args?: Record<string, unknown>) => Promise<unknown>)(command, args);

export function createTauriPages(images: ImagesClient): PagesClient {
  return createTauriPageService(createCoreClient({ invoke: coreInvoke }), images);
}
