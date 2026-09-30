// Vitest runs two projects (ARCHITECTURE.md section 21.1). The file extension picks the project:
// - unit: *.test.ts in Node, or in jsdom with a `@vitest-environment jsdom` comment
// - components: *.test.tsx in a real browser through Playwright
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { browserChannel } from '../tests/browser';
import { viteConfig } from './vite.config';

export default defineConfig((env) =>
  mergeConfig(viteConfig({ ...env, mode: 'test' }), {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'components',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['src/test/setup.ts'],
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
