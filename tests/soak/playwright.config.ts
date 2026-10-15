// The random-editing soak's Playwright setup (A4-35): the test build in the installed browser, one worker, no
// retries, and no timeout of its own, because the soak sets the test's timeout from its length.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../browser';

const ROOT = join(import.meta.dirname, '..', '..');
const PORT = Number(process.env.OPENNOTE_SOAK_PORT ?? 4187);
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /soak\.spec\.ts$/,
  outputDir: join(import.meta.dirname, 'results', 'output'),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    channel: browserChannel(),
    viewport: { width: 1440, height: 900 },
  },
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
