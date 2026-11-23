// The code studio's browser benchmarks: studio open, typing in a 1,000-line file with diagnostics, and idle memory,
// in Playwright against the test build (npm run perf:code-studio:browser). Results go to results/browser.json for run.ts.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../../browser';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PORT = Number(process.env.OPENNOTE_CODE_PERF_PORT ?? 5691);
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  outputDir: join(import.meta.dirname, 'results', 'playwright'),
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
