// One walk through typed notes on the web build (Phase 4 exit, WP8): Markdown shortcuts and the formatting bar,
// paste from a document, a code block, an image from the file picker, and a table, then undo and redo. Each step
// checks the Markdown the page service holds, which is what the core saves. The web platform keeps pages in
// memory, so persistence across a restart is page.restart's job in the E2E smoke set.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

// A 1 by 1 PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.use({ boot: { settings: { editing: { formattingBar: 'always' } } } as never });

/** The page as the service holds it: each block's Markdown, or its type. */
function held(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __OPENNOTE_TEST__: { pagesHeld(): { blocks: { type: string; data: { markdown?: string } }[] } };
      }
    ).__OPENNOTE_TEST__;
    return hooks.pagesHeld().blocks.map((block) => block.data.markdown ?? block.type);
  });
}

/** Pastes clipboard data the way Ctrl+V delivers it. */
async function paste(page: Page, data: Record<string, string>): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event);
  }, data);
}

/** Picks a slash menu item by typing its name. */
async function slash(page: Page, name: string): Promise<void> {
  await page.keyboard.type(`/${name}`);
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Enter');
}

test('writes, formats, pastes, inserts, and undoes on a page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.getByRole('textbox', { name: 'Text' }).click();
  // Commands used before their chunks load run after the keys typed behind them.
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
  const { keyboard } = page;

  // Markdown shortcuts as you type.
  await keyboard.type('# Membranes\nCells keep **apart** and water moves.');
  await expect.poll(() => held(page)).toEqual(['# Membranes\n\nCells keep **apart** and water moves.']);

  // The formatting bar, set to show for every selection.
  for (let i = 0; i < 'moves.'.length; i += 1) await keyboard.press('Shift+ArrowLeft');
  await page.getByRole('toolbar').getByRole('button', { name: 'Italic' }).click();
  await expect.poll(() => held(page)).toEqual(['# Membranes\n\nCells keep **apart** and water *moves.*']);

  // Paste from a document: HTML becomes blocks and marks.
  await page.getByRole('textbox', { name: 'Text' }).click();
  await keyboard.press('Control+End');
  await keyboard.press('Enter');
  await paste(page, {
    'text/html': '<p>From <b>Word</b></p><ul><li>one</li><li>two</li></ul>',
    'text/plain': 'From Word\none\ntwo',
  });
  await expect.poll(async () => (await held(page))[0]).toContain('From **Word**\n\n- one\n- two');

  // A code block with a language, from three backticks.
  await keyboard.press('Enter');
  await keyboard.press('Enter');
  await keyboard.type('```js const x = 1;');
  await expect.poll(async () => (await held(page))[0]).toContain('```js\nconst x = 1;\n```');
  await keyboard.press('ArrowDown');

  // An image from the file picker, through the slash menu.
  const chooser = page.waitForEvent('filechooser');
  await slash(page, 'image');
  await (await chooser).setFiles({ name: 'cell.png', mimeType: 'image/png', buffer: PIXEL });
  await expect.poll(() => held(page)).toContain('image');
  // The page holds the image before the view has finished with it; the view then selects it and takes the focus. A
  // click and keys sent before that land on the image, not the text.
  await expect(page.getByRole('button', { name: 'Crop image' })).toBeVisible();

  // A table, through the slash menu, typed into.
  await page.getByRole('textbox', { name: 'Text' }).last().click();
  await keyboard.press('Control+End');
  await slash(page, 'table');
  const table = page.getByRole('group', { name: 'Table' });
  await expect(table).toBeVisible();
  await keyboard.type('Head');
  await expect.poll(async () => JSON.stringify(await held(page))).toContain('table');

  // Undo takes the cell's words back off, and redo brings them back.
  // The cell's words reach the service in the next flush, 150 to 300 ms after typing stops.
  const heldPage = () =>
    page.evaluate(() =>
      JSON.stringify(
        (window as unknown as { __OPENNOTE_TEST__: { pagesHeld(): unknown } }).__OPENNOTE_TEST__.pagesHeld(),
      ),
    );
  await expect.poll(heldPage).toContain('"markdown":"Head"');
  await keyboard.press('Control+z');
  await expect.poll(() => table.textContent()).not.toContain('Head');
  await keyboard.press('Control+y');
  await expect.poll(() => table.textContent()).toContain('Head');
  await expect.poll(heldPage).toContain('"markdown":"Head"');
  expect(errors).toEqual([]);
});
