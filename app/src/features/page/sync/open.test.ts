// @vitest-environment jsdom
// Opening a page sends nothing (PLAN.md section 6.6): mounting every fixture page, and flushing it as a page switch
// does, leaves the page service without a single edit.
import { afterEach, describe, expect, it } from 'vitest';
import { pageFixtures } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';

afterEach(cleanupPages);

describe('opening a page', () => {
  for (const name of [
    'sampler',
    'short',
    'twentyPage',
    'twentyPageOutline',
    'twentyPageCallout',
    'freeform8',
  ] as const) {
    it(`sends no edit for the ${name} fixture`, async () => {
      const page = await renderPage({ fixture: pageFixtures[name] });
      await page.mounted.sync.flushAll('pageSwitch');
      expect(page.sent()).toEqual([]);
    }, 30_000);
  }
});
