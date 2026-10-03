// Picks the platform at build time (ARCHITECTURE.md section 6.1). app/vite.config.ts sets VITE_PLATFORM.
// The bundler drops the branch it doesn't take, so production builds contain no web fakes.

import type { NotesFixture } from '../services/notes/fixtures';
import { createTauriPlatform } from './tauri';
import type { BootData, Platform } from './types';
import { createWebPlatform } from './web';

export function createPlatform(boot: BootData, options: { fixture?: NotesFixture } = {}): Platform {
  if (import.meta.env.VITE_PLATFORM === 'web') {
    return createWebPlatform({ boot, fixture: options.fixture, followBrowser: true });
  }
  return createTauriPlatform(boot);
}
