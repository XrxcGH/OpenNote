// My handwriting in the production build (flag ink.myHandwriting): the calibration page takes pen input sent through
// the DevTools Protocol, a finished style writes selected typed text as ink, and Type as handwriting writes as the
// keyboard types. Most of the calibration page is filled in by a test hook with a made-up hand, so the test writes
// only the last boxes with the pen.
import type { Page } from '@playwright/test';
import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';
import { heldStrokes, openPage } from '../ink';
import { along, drawControl, pen } from '../paperSnap';

type Hooks = Record<string, (...args: unknown[]) => unknown>;
const hook = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) => {
      // The hooks arrive with the ink view, a moment after the page shows.
      const fn = (window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.[n as string];
      return typeof fn === 'function' ? fn(...(a as unknown[])) : null;
    },
    [name, args] as const,
  );

async function openSection(page: Page): Promise<void> {
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'My handwriting' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My handwriting' })).toBeVisible();
}

test('uploads stay locked until the calibration page is done', async ({ page }) => {
  await openPage(page);
  await openSection(page);
  await expect(page.getByText('No handwriting style yet.')).toBeVisible();
  await expect(page.getByText(/Uploads open once your calibration page is done/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files…' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start calibration' })).toBeVisible();
  await expectNoAxeViolations(page, { include: '[data-myhand-section]' });
  // The calibration page is reachable and named for a screen reader, box by box.
  await page.getByRole('button', { name: 'Start calibration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibration page' });
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('group', { name: 'small a, 1 of 3' })).toBeVisible();
  await expectNoAxeViolations(page, { include: '[data-myhand-calibration]' });
});

test('the calibration page takes the pen, then the style writes selected text in my hand', async ({ page }) => {
  await openPage(page);
  await expect.poll(() => hook(page, 'myHandSeed', 2)).toBeGreaterThan(300);
  await openSection(page);
  await expect(page.getByText(/Calibration is \d+% done/)).toBeVisible();
  await page.getByRole('button', { name: 'Resume calibration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibration page' });
  for (let i = 0; i < 5; i++) await dialog.getByRole('button', { name: 'Next' }).click();
  const client = await page.context().newCDPSession(page);
  for (const n of [5, 6]) {
    const box = dialog.getByRole('group', { name: new RegExp(`^Sentence ${n}:`) });
    await box.scrollIntoViewIfNeeded();
    const rect = (await box.boundingBox())!;
    // A few words' worth of strokes along the line.
    for (let word = 0; word < 4; word++) {
      const x = rect.x + 30 + word * 120;
      const y = rect.y + rect.height * 0.7;
      await pen(
        client,
        along(
          [
            { x, y },
            { x: x + 20, y: y - 22 },
            { x: x + 40, y },
            { x: x + 60, y: y - 18 },
            { x: x + 80, y },
          ],
          4,
        ),
      );
    }
    await expect(box).toHaveAttribute('aria-description', 'Written');
  }
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('img', { name: 'A sample of your handwriting' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Finish' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Your handwriting style is ready.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files…' })).toBeVisible();

  // Back on the page: type a line, select it, and write it in my hand in its place.
  await page.getByRole('button', { name: 'Back to notes' }).click();
  const editor = page.locator('.ProseMirror').last();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('hello world');
  await page.keyboard.press('Shift+Home');
  const before = (await heldStrokes(page)).length;
  // In the text, Ctrl+K makes a link; out of it, the palette opens. The editor keeps its selection.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+KeyK');
  await page
    .getByRole('combobox', { name: 'Search commands and pages' })
    .pressSequentially('write in my', { delay: 10 });
  await page.getByRole('option', { name: /Write in my handwriting/ }).click();
  const choice = page.getByRole('dialog', { name: 'Write in your handwriting' });
  await expect(choice.getByRole('radio', { name: 'Replace the typed text' })).toBeChecked();
  await choice.getByRole('button', { name: 'Write' }).click();
  await expect.poll(async () => (await heldStrokes(page)).length).toBeGreaterThan(before + 6);
  await expect(page.getByText('hello world')).toHaveCount(0);
});

test('Type as handwriting writes each word as it is typed, and Escape stops', async ({ page }) => {
  await openPage(page);
  await expect.poll(() => hook(page, 'myHandSeed', 0)).toBeGreaterThan(300);
  await expect.poll(() => hook(page, 'myHandFinish')).toBe(true);
  const before = (await heldStrokes(page)).length;
  await (await drawControl(page, 'Type as handwriting')).click();
  const field = page.getByRole('textbox', { name: 'Type as handwriting' });
  await expect(field).toBeFocused();
  await page.keyboard.type('hi there ');
  await expect.poll(async () => (await heldStrokes(page)).length).toBeGreaterThan(before + 4);
  const words = (await heldStrokes(page)).length;
  await page.keyboard.type('again');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect.poll(async () => (await heldStrokes(page)).length).toBeGreaterThan(words);
});
