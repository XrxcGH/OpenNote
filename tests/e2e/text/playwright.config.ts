// End-to-end checks of formatted notes in the web build (text program, lane a11y-perf-e2e). They format through the
// Home tab, change a paragraph in the Format pane, show the ruler, paste the Word and Docs fixtures, and run axe over
// the new surfaces. The tests tagged @forced run again with forced colors on. The text flags are off in every
// channel, so each test turns them on through the boot payload. Set OPENNOTE_UI_URL to use a running server.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../../browser';
import type { UiOptions } from '../../ui/fixtures';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PORT = Number(process.env.OPENNOTE_TEXT_E2E_PORT ?? 4185);
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig<UiOptions>({
  testDir: import.meta.dirname,
  outputDir: join(import.meta.dirname, 'results'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    channel: browserChannel(),
    viewport: { width: 1600, height: 1000 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
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
  projects: [{ name: 'default' }, { name: 'forced-colors', grep: /@forced\b/, use: { forcedColors: 'active' } }],
});
