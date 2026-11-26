// Paste the Word and Docs fixtures (the clipboard captures the paste lane keeps) into a note. The fixtures keep their
// source formatting: the typeface, the color, and the alignment of the first paragraph (text design 8).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, openNote, selectParagraph, test } from './helpers';

const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'app', 'src', 'features', 'page', 'paste', 'fixtures');

/** Sends a paste with the fixture's HTML to the focused editor, as the browser does for Ctrl+V. */
async function paste(page: Page, fixture: string): Promise<void> {
  const html = readFileSync(join(FIXTURES, fixture), 'utf8');
  await page.evaluate((html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'Centered Georgia line');
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, html);
}

for (const [source, fixture] of [
  ['Word', 'word-v2.html'],
  ['Docs', 'gdocs-v2.html'],
] as const) {
  test(`pasting from ${source} keeps the typeface, the color, and the indent`, async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await paste(page, fixture);
    const pasted = box.locator('p', { hasText: 'Centered Georgia line' });
    await expect(pasted).toHaveCount(1);
    await expect(pasted.locator('[data-font="Georgia"]')).toHaveCount(1);
    await expect(pasted.locator('[data-color]')).toHaveCount(1);
    // The second pasted paragraph keeps its indent (Docs 36 points; Word 36 points with an 18 point hanging first
    // line). The first one joins the paragraph the paste went into, so it keeps that paragraph's own alignment.
    const indented = box.locator('p', { hasText: /^(Hanging|Indented) and highlighted/ });
    await expect
      .poll(() =>
        indented.evaluate((p) => {
          const style = getComputedStyle(p);
          return Math.max(
            parseFloat(style.marginLeft),
            parseFloat(style.paddingLeft),
            parseFloat(style.marginInlineStart),
          );
        }),
      )
      .toBeGreaterThanOrEqual(24);
  });
}
