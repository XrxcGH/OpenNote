// Playwright tests of the production interface in a browser (ARCHITECTURE.md section 21.3). They run against
// `vite build --mode test`, which uses the web platform, served by `vite preview`. Set OPENNOTE_UI_URL to point
// them at a running `npm run app:dev` instead.
//
// Projects: visual (screenshots), a11y, behavior, and perf (never retried). Two more projects rerun tagged tests
// in a variant: forced-colors reruns tests tagged @forced, and pseudo-locale reruns tests tagged @pseudo.

import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../browser';
import type { UiOptions } from './fixtures';

const CI = Boolean(process.env.CI);
const ROOT = join(import.meta.dirname, '..', '..');
const BASE_URL = process.env.OPENNOTE_UI_URL ?? 'http://127.0.0.1:4173';

export default defineConfig<UiOptions>({
  testDir: import.meta.dirname,
  outputDir: join(import.meta.dirname, 'results'),
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{platform}/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github'], ['html', { outputFolder: 'report', open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    // The installed Edge or Chrome: tests never download a browser.
    channel: browserChannel(),
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, threshold: 0.1, animations: 'disabled', caret: 'hide' },
  },
  webServer: process.env.OPENNOTE_UI_URL
    ? undefined
    : { command: 'npm run app:preview:test', url: BASE_URL, cwd: ROOT, reuseExistingServer: !CI, timeout: 60_000 },
  projects: [
    { name: 'visual', testMatch: 'visual/**/*.spec.ts' },
    { name: 'a11y', testMatch: 'a11y/**/*.spec.ts' },
    { name: 'behavior', testMatch: 'behavior/**/*.spec.ts' },
    { name: 'perf', testMatch: 'perf/**/*.spec.ts', retries: 0, fullyParallel: false },
    {
      name: 'forced-colors',
      testMatch: ['visual/**/*.spec.ts', 'a11y/**/*.spec.ts'],
      grep: /@forced\b/,
      use: { forcedColors: 'active' },
    },
    {
      name: 'pseudo-locale',
      testMatch: ['visual/**/*.spec.ts', 'behavior/**/*.spec.ts'],
      grep: /@pseudo\b/,
      use: { pseudoLocale: true },
    },
  ],
});
