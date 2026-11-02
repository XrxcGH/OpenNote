// Runs axe-core in the page (ARCHITECTURE.md section 21.6), with the WCAG 2.2 AA tags and best practices, and
// fails with a readable list of violations. It injects axe-core directly, so no wrapper package is needed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Runs axe on the page as it is now and returns one readable line per violation. */
export async function axeViolations(
  page: Page,
  options: { include?: string; tags?: string[] } = {},
): Promise<string[]> {
  const loaded = await page.evaluate(() => Boolean((window as unknown as { axe?: unknown }).axe));
  if (!loaded) await page.addScriptTag({ content: AXE });
  return page.evaluate(
    async ({ include, tags }) => {
      const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
      // A color change that starts a transition (a theme switch, a hover) is measured half way by axe, so wait for the
      // finite ones to end. An endless animation, such as a spinner, is left running.
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
      const results = await axe.run(include ?? document, { runOnly: { type: 'tag', values: tags } });
      return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
    },
    { include: options.include, tags: options.tags ?? AXE_TAGS },
  );
}

export async function expectNoAxeViolations(page: Page, options: { include?: string; tags?: string[] } = {}) {
  expect(await axeViolations(page, options)).toEqual([]);
}
