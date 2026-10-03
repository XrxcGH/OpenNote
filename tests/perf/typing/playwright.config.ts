// The typing benchmark's pull request run (Phase 4 ARCHITECTURE.md section 24.5; owner after WP0: WP8): the in-page
// measure in Playwright against the test build. WP0 runs it once on the short fixture so the job exists; WP8 adds
// the conditions, the throttling, the comparison with main, and the reference laptop's nightly run.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../../browser';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PORT = Number(process.env.OPENNOTE_TYPING_PORT ?? 4183);
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: import.meta.dirname,
  outputDir: join(import.meta.dirname, 'results'),
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
