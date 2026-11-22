// B11 surface: the Symbol dialog (text.symbols). Acts through the real interface: opens the dialog from the command
// palette, picks a symbol from its listbox, inserts it, and runs axe (also under forced colors).

import { expect, expectAxeClean, openNote, runCommand, selectParagraph, test } from './helpers';

test.describe('Symbol dialog @forced', () => {
  test('opens, has no axe violations, and inserts the chosen symbol', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await page.keyboard.press('End');
    await runCommand(page, 'Symbol', /^Symbol/);
    const dialog = page.getByRole('dialog', { name: 'Symbol' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox').fill('euro');
    const option = dialog
      .getByRole('listbox')
      .first()
      .getByRole('option', { name: /euro sign, U\+20AC/i });
    await expect(option).toBeVisible();
    await expectAxeClean(page, '[role="dialog"]');
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(box).toContainText('€');
  });
});
