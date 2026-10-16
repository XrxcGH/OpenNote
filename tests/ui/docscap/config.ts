// Temporary: documentation screenshot capture. Not committed.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { browserChannel } from '../../browser';

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: '*.spec.ts',
  outputDir: join(tmpdir(), 'docscap-results'),
  fullyParallel: true,
  workers: 4,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4617', browserName: 'chromium', channel: browserChannel(), screenshot: 'only-on-failure' },
});
