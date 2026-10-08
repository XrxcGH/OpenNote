// Vitest runs two projects (ARCHITECTURE.md section 21.1). The file extension picks the project:
// - unit: *.test.ts in Node, or in jsdom with a `@vitest-environment jsdom` comment
// - components: *.test.tsx in a real browser through Playwright
import { join } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { browserChannel } from '../tests/browser';
import { packageImports } from './scripts/package-imports.ts';
import { viteConfig } from './vite.config';

export default defineConfig((env) =>
  mergeConfig(viteConfig({ ...env, mode: 'test' }), {
    // Bundles every package the app imports before the first test: one found later, in a chunk that loads lazily,
    // reloads the page under a running test (scripts/package-imports.ts).
    optimizeDeps: { include: packageImports(join(import.meta.dirname, 'src')) },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            // Worker threads start inside the test process. Forked workers are new processes, and under heavy
            // load on Windows they can miss Vitest's fixed 60-second start timeout.
            pool: 'threads',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'components',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['src/test/setup.ts'],
            // The browser project's server port, so parallel runs (agents on one machine) each take their own:
            // Vitest's own default when unset, and the CLI's --api doesn't reach an inline project.
            api: { port: Number(process.env.OPENNOTE_VITEST_PORT) || 63315 },
            browser: {
              enabled: true,
              headless: true,
              // Uses the installed Edge or Chrome, never a downloaded browser.
              provider: playwright({ launchOptions: { channel: browserChannel() } }),
              instances: [{ browser: 'chromium' }],
              viewport: { width: 1280, height: 800 },
            },
          },
        },
      ],
    },
  }),
);
