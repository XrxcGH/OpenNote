// The Beta 12 text surfaces in the real interface, on the reviewed 20-page note (footnotes, comments, and
// suggestions among formatted paragraphs): the notes area, the comment and suggestion marks, and the Header
// and footer dialog. Tests tagged @forced also run with forced colors on, where no run may vanish into its background.

import { expect, expectAxeClean, openNote, runCommand, selectParagraph, test } from './helpers';

const reviewed = (page: Parameters<typeof openNote>[0]) => openNote(page, 'twentyPageReviewed', '');

test.describe('the Beta 12 surfaces @forced', () => {
  test('the notes area lists the footnotes and has no axe violations', async ({ page }) => {
    await reviewed(page);
    const notes = page.locator('[aria-label="Notes"]').first();
    await expect(notes).toBeAttached();
    await notes.scrollIntoViewIfNeeded();
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('Note on paragraph 5.');
    await expectAxeClean(page, '[aria-label="Notes"]');
  });

  test('comment and suggestion marks keep their text readable and have no axe violations', async ({ page }) => {
    const box = await reviewed(page);
    await expect(box.locator('[data-comment]').first()).toBeAttached();
    await expect(box.locator('[data-ins]').first()).toContainText('Added words.');
    await expectAxeClean(page, '[data-scope="editor"][data-block]');
  });

  test('the Header and footer dialog has no axe violations', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Header and footer', /^Header and footer/);
    await expect(page.getByRole('dialog', { name: 'Header, footer, and page numbers' })).toBeVisible();
    await expectAxeClean(page);
  });
});
