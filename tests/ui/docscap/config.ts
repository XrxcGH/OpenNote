// The documentation screenshot capture (docs/screens). It is a capture script, not a test, so checks.config.json
// leaves this folder out of CHECKS.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../../browser';

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), `docscap-results-${process.pid}`),
  fullyParallel: true,
  workers: 4,
  reporter: 'list',
  timeout: 150_000,
  use: {
    baseURL: process.env.CAP_URL ?? 'http://127.0.0.1:4617',
    browserName: 'chromium',
    channel: browserChannel(),
    screenshot: 'only-on-failure',
  },
});
