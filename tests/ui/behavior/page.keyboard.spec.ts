// Writing and formatting a page from the keyboard (Phase 4 ARCHITECTURE.md section 26.3, page.write.keyboard and
// page.format.keyboard), on the web build. Once the page is open, every step is a key, and each test checks the
// Markdown the page service holds, which is what the core saves as page.md. The E2E versions against the desktop
// app add a restart; see docs/perf/phase-4.md.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/** The text block's Markdown as the page service holds it. */
function held(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as { __OPENNOTE_TEST__: { pagesHeld(): { blocks: { data: { markdown?: string } }[] } } }
    ).__OPENNOTE_TEST__;
    return hooks.pagesHeld().blocks[0]?.data.markdown;
  });
}

/**
 * Waits until the page has loaded the chunks its commands need. A command used sooner runs after the keys typed
 * behind it, which no run on a fast machine shows.
 */
async function waitForCommands(page: Page): Promise<void> {
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
}

/** Opens Membranes, which starts empty, and puts the caret in its text. */
async function openEmptyPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.getByRole('textbox', { name: 'Page title' }).click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Page text' })).toBeFocused();
  await waitForCommands(page);
}

/** Types a line of steps: text, or a key in braces, such as "{Enter}". */
async function keys(page: Page, steps: string): Promise<void> {
  for (const part of steps.split(/(\{[^}]+\})/).filter(Boolean)) {
    if (part.startsWith('{')) await page.keyboard.press(part.slice(1, -1));
    else await page.keyboard.type(part);
  }
}

test('writes a page with Markdown shortcuts, each one undoable back to the typed characters', async ({ page }) => {
  await openEmptyPage(page);
  // Undo right after a shortcut keeps what was typed, as text.
  await keys(page, '# {Control+z}x{Enter}- {Control+z}y{Enter}');
  await expect.poll(() => held(page)).toBe('\\# x\n\n\\- y');
  await keys(page, '{Control+a}{Delete}');
  await keys(page, '# Cell division{Enter}Cells divide in two ways.{Enter}');
  await keys(page, '- Mitosis{Enter}{Tab}Two cells{Enter}{Shift+Tab}Meiosis{Enter}{Enter}');
  await keys(page, '[ ] Read the chapter{Control+Enter}{Enter}{Enter}');
  await keys(page, '> A quote{Enter}{Enter}> [!tip] Remember{Enter}Check the copy.{Enter}{Enter}');
  await keys(page, '```python print(1){ArrowDown}---{Enter}The end.');
  await expect
    .poll(() => held(page))
    .toBe(
      [
        '# Cell division',
        'Cells divide in two ways.',
        '- Mitosis\n\n  - Two cells\n\n- Meiosis',
        '- [x] Read the chapter',
        '> A quote',
        '> [!tip] Remember\n> Check the copy.',
        '```python\nprint(1)\n```',
        '---',
        'The end.',
      ].join('\n\n'),
    );
});

test('formats with keys: marks, a link, headings, an outline move, a date, and AutoCorrect', async ({ page }) => {
  await openEmptyPage(page);
  await keys(page, 'Normal {Control+b}bold{Control+b} {Control+i}italic{Control+i} ');
  await keys(page, '{Control+u}under{Control+u} {Control+Shift+S}gone{Control+Shift+S} ');
  await keys(page, '{Control+Shift+H}marked{Control+Shift+H} {Control+e}code{Control+e}{Enter}');
  await keys(page, 'Heading{Control+Alt+2}{Enter}Plain{Control+Alt+1}{Control+Shift+N}{Enter}');
  // The address is typed straight after Ctrl+K, before the link field has loaded.
  await keys(page, 'Visit site{Control+Shift+ArrowLeft}{Control+k}example.com{Enter}{End}{Enter}');
  await keys(page, '- one{Enter}two{Alt+Shift+ArrowUp}{Control+End}{Enter}{Enter}');
  // AutoCorrect fixes "teh", and one undo puts back what was typed.
  await keys(page, 'I saw teh {Control+z}cat{Enter}Due {Alt+Shift+D}');
  await expect
    .poll(() => held(page))
    .toBe(
      [
        'Normal **bold** *italic* <u>under</u> ~~gone~~ ==marked== `code`',
        '## Heading',
        'Plain',
        'Visit [site](https://example.com)',
        '- two\n- one',
        'I saw teh cat',
        'Due Sep 30, 2026',
      ].join('\n\n'),
    );
});
