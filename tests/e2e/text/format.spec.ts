// Format through the Home tab: the buttons and boxes of the tab change the selected text, and the page's DOM shows
// the change (text design 5.1).

import { expect, openNote, selectParagraph, test } from './helpers';

test.describe('the Home tab formats the selected text', () => {
  test('Bold, Italic, and Underline', async ({ page }) => {
    const box = await openNote(page);
    const paragraph = await selectParagraph(page, box, 'A few words');
    const home = page.getByRole('toolbar', { name: 'Home' });
    await home.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(paragraph.locator('strong')).toHaveText('A few words to type after.');
    await home.getByRole('button', { name: 'Italic', exact: true }).click();
    await expect(paragraph.locator('em')).toHaveCount(1);
    await home.getByRole('button', { name: 'Underline', exact: true }).click();
    await expect(paragraph.locator('u')).toHaveCount(1);
    // The same button takes the format off again.
    await home.getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(paragraph.locator('strong')).toHaveCount(0);
  });

  test('the Font box sets a typeface', async ({ page }) => {
    const box = await openNote(page);
    const paragraph = await selectParagraph(page, box, 'A few words');
    const font = page.getByRole('toolbar', { name: 'Home' }).getByRole('combobox', { name: 'Font' });
    await font.fill('Georgia');
    await font.press('Enter');
    await expect(paragraph.locator('[data-font="Georgia"]')).toHaveCount(1);
  });
});
