// Runs axe-core in the page (ARCHITECTURE.md section 21.6), with the WCAG 2.2 AA tags and best practices, and
// fails with a readable list of violations. It injects axe-core directly, so no wrapper package is needed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export async function expectNoAxeViolations(page: Page, options: { include?: string; tags?: string[] } = {}) {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(
    async ({ include, tags }) => {
      const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
      const results = await axe.run(include ?? document, { runOnly: { type: 'tag', values: tags } });
      return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
    },
    { include: options.include, tags: options.tags ?? AXE_TAGS },
  );
  expect(violations).toEqual([]);
}
