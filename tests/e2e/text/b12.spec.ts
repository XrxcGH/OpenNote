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

  test('a footnote reference is exposed with the name "Footnote N" in the browser accessibility tree', async ({
    page,
  }) => {
    await reviewed(page);
    const ref = page.locator('[data-footnote]').first();
    await expect(ref).toBeAttached();
    await expect(ref).toHaveAttribute('role', 'doc-noteref');
    await expect(ref).toHaveAttribute('href', /^#note-/);
    // What Narrator and NVDA read comes from Chromium's accessibility tree, so ask it, not the CSS.
    const cdp = await page.context().newCDPSession(page);
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const named = nodes.filter((one) => /^Footnote \d+$/.test(String(one.name?.value ?? '')) && !one.ignored);
    expect(named.length).toBeGreaterThan(0);
    expect(named.map((one) => String(one.role?.value))).toContain('doc-noteref');
  });

  test('the Comments pane opens from the command palette and has no axe violations', async ({ page }) => {
    const box = await reviewed(page);
    await box.click({ position: { x: 8, y: 8 } });
    await expect(box).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
    await box.locator('[data-comment]').first().click();
    await runCommand(page, 'Show comments', /^Show comments/);
    const pane = page.locator('[data-comments-pane]');
    await expect(pane).toBeVisible();
    await expect(pane).toContainText('Check paragraph');
    await expectAxeClean(page);
  });
});
