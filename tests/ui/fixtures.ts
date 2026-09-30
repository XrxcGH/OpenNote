// The Playwright test object for OpenNote. Every page starts the way the app does: a boot payload set before any
// script runs (as Rust injects it), a seed library, and optionally the pseudo-locale.

import { test as base, expect } from '@playwright/test';
import type { BootOverrides } from '../../app/src/boot/defaults';
import type { FixtureName } from '../../app/src/services/notes/fixtures';

export interface UiOptions {
  /** Every string in the pseudo-locale; the pseudo-locale project turns it on. */
  pseudoLocale: boolean;
  /** The seed library. */
  fixture: FixtureName;
  /** Merged into the default boot payload, key by key. */
  boot: BootOverrides | undefined;
}

export const test = base.extend<UiOptions>({
  pseudoLocale: [false, { option: true }],
  fixture: ['sample', { option: true }],
  boot: [undefined, { option: true }],
  page: async ({ page, pseudoLocale, fixture, boot }, use) => {
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
    await page.addInitScript(
      (options) => {
        window.__OPENNOTE_DEV__ = { fixture: options.fixture, pseudo: options.pseudo };
        if (options.boot) window.__OPENNOTE_BOOT__ = { ...options.boot, bootVersion: 1 };
      },
      { fixture, pseudo: pseudoLocale, boot },
    );
    await use(page);
  },
});

export { expect };
