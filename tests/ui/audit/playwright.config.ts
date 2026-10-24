// The layout audit's Playwright config: the same browser and server as the other UI tests, with only the audit's two
// projects. The ratchet depends on the audit, so running it runs both. It has its own config so that `npm run test:ui`
// stays fast; CI runs the audit as a job of its own.

import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

export default defineConfig({
  ...base,
  testDir: import.meta.dirname,
  outputDir: base.outputDir ?? '',
  fullyParallel: true,
  retries: 0,
  projects: [
    { name: 'audit', testMatch: 'layout.audit.spec.ts' },
    { name: 'audit-ratchet', testMatch: 'ratchet.spec.ts', dependencies: ['audit'] },
  ],
});
