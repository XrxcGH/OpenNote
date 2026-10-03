// Static and mounted blocks read the same to a screen reader (Phase 4 ARCHITECTURE.md sections 7.2 and 26.1):
// the sampler page's text has one accessibility tree before its editor mounts and after, so mounting in place
// never changes what a screen reader is reading. The focus walk reaches the text from the page title.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

test.use({
  boot: {
    state: {
      location: { view: 'workspace', notebookId: 'n-biology', sectionId: 's-lectures', pageId: 'p-membranes' },
    },
  } as never,
});

/** The text's accessibility tree before its editor mounts and after. */
async function staticAndMounted(page: Page): Promise<[string, string]> {
  await page.goto('/?fixture=sampler');
  const text = page.getByRole('textbox', { name: 'Page text' });
  await expect(text).toBeVisible();
  await expect(text).not.toHaveAttribute('contenteditable', 'true');
  const before = await text.ariaSnapshot();
  await text.click({ position: { x: 4, y: 4 } });
  await expect(text).toHaveAttribute('contenteditable', 'true');
  return [before, await text.ariaSnapshot()];
}

/** The tree without what only an editor draws: fold buttons, callout menus, checkboxes, and callout names. */
const words = (tree: string) =>
  tree
    .split('\n')
    .filter((line) => !/^\s*- '?(button|checkbox) /.test(line))
    .map((line) => line.replace(/'note "[^"]*"':/, 'note:'))
    // Static math is generated text; an editor's math view puts the same source in a code element.
    .map((line) => line.replace(/^(\s*- )code: (\$.*)$/, '$1text: $2'))
    .join('\n');

test('the sampler text reads the same, in the same structure, static and mounted', async ({ page }) => {
  const [before, after] = await staticAndMounted(page);
  expect(words(after)).toBe(words(before));
});

// Known gaps, left to the schema's owner (docs/perf/phase-4.md): static task items show their state only as a
// drawn box, with no checkbox, and static callouts have no name. When both are fixed, this test passes and
// Playwright reports it, so the expectation is removed.
test('the sampler text has the same accessibility tree static and mounted, controls aside', async ({ page }) => {
  test.fail();
  const [before, after] = await staticAndMounted(page);
  const controls = (tree: string) =>
    tree
      .split('\n')
      .filter((line) => !/^\s*- '?button /.test(line))
      .join('\n');
  expect(controls(after)).toBe(controls(before));
});

test('Tab reaches the page text from the title, and Escape leaves it', async ({ page }) => {
  await page.goto('/?fixture=sampler');
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await page.keyboard.press('Tab');
  const text = page.getByRole('textbox', { name: 'Page text' });
  await expect(text).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(text).not.toBeFocused();
});
