// A web platform for tests, with fixed boot data that doesn't depend on the browser (PLAN.md section 3.14).
// Safe in the unit project: it needs no real browser.

import type { BootOverrides } from '../boot/defaults';
import { createWebPlatform } from '../platform/web';
import type { WebPlatform } from '../platform/web';
import type { NotesFixture } from '../services/notes/fixtures';

export interface TestPlatformOptions {
  boot?: BootOverrides;
  fixture?: NotesFixture;
}

export function createTestPlatform(options: TestPlatformOptions = {}): WebPlatform {
  return createWebPlatform({ boot: options.boot, fixture: options.fixture ?? 'sample', followBrowser: false });
}
