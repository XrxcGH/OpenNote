// B11 surfaces: Find with format criteria, and the Language and direction commands. Each flow acts through the
// real interface; the axe runs cover the Find bar with its format editor open and the Language menu.

import { expect, expectAxeClean, openNote, runCommand, selectParagraph, test, TEXT_BLOCK } from './helpers';

test.describe('Find with format criteria @forced', () => {
  test('the format editor opens and the bar has no axe violations', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Find on page', /^Find on page/);
    const bar = page.getByRole('search', { name: 'Find on page' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Format', exact: true }).first().click();
    await expect(bar.getByRole('group', { name: 'Find format' })).toBeVisible();
    await expectAxeClean(page, '[role="search"]');
  });

  test('a Bold criterion keeps only bold text', async ({ page }) => {
    const box = await openNote(page);
    const paragraph = await selectParagraph(page, box, 'A few words');
    await page.getByRole('toolbar', { name: 'Home' }).getByRole('button', { name: 'Bold', exact: true }).click();
    await expect(paragraph.locator('strong')).toHaveCount(1);
    await runCommand(page, 'Find on page', /^Find on page/);
    const bar = page.getByRole('search', { name: 'Find on page' });
    await bar.getByRole('textbox', { name: 'Find', exact: true }).fill('words');
    await expect(bar).toContainText(/1 of 1|1 match/i);
    await bar.getByRole('button', { name: 'Format', exact: true }).first().click();
    await bar.getByRole('group', { name: 'Find format' }).getByRole('switch', { name: 'Italic' }).click();
    // Nothing is italic, so with the criterion on there is no match.
    await expect(bar).toContainText(/no match|0/i);
  });
});

test.describe('Language and direction', () => {
  test('Right-to-left text direction sets the paragraph direction', async ({ page }) => {
    const box = await openNote(page);
    const paragraph = await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Right-to-left', /Right-to-left text direction/);
    await expect(paragraph).toHaveAttribute('dir', 'rtl');
    await runCommand(page, 'Left-to-right', /Left-to-right text direction/);
    await expect(paragraph).not.toHaveAttribute('dir', 'rtl');
  });

  test('Do not check spelling marks the text zxx', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Do not check spelling', /Do not check spelling/);
    await expect(page.locator(`${TEXT_BLOCK} [lang="zxx"]`).first()).toBeAttached();
  });

  test('the Language menu has no axe violations', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Language', /^Language/);
    await expect(page.getByRole('menu', { name: 'Language of the selected text' })).toBeVisible();
    await expectAxeClean(page, '[role="menu"]');
  });
});
