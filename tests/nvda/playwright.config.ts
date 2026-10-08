// The NVDA run's Playwright setup (A4-42): the test build served on its own port. The spec opens its own headed
// browser, because NVDA needs a real window, so this config only serves the app and sets the test directory.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..', '..');
const PORT = Number(process.env.OPENNOTE_NVDA_PORT ?? 4188);
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /nvda\.spec\.ts$/,
  outputDir: join(import.meta.dirname, 'results', 'output'),
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: process.env.OPENNOTE_UI_URL
    ? undefined
    : {
        command: `npx vite preview --config app/vite.config.ts --mode test --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: BASE_URL,
        cwd: ROOT,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
