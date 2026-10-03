// Read aloud through the on-device engine: with the feature on in Settings, Ctrl+Shift+U reads the page with the
// engine behind the switch, and the bar follows it. The web platform's engine makes silent clips with a word time for
// each word, so this checks the path from the page text to the sound and the highlight.

import { expect, test } from '../fixtures';
import { openMembranes, startWith } from '../intel';

const TEXT = 'Cells make energy. Plants use light.';

test('reads the page and highlights the words when read aloud is on', async ({ page }) => {
  await startWith(page, ['readAloud']);
  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type(TEXT);
  await expect(box).toHaveText(TEXT);
  // Reading starts at the caret, so go to the start of the page's text first.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+KeyU');
  const bar = page.getByRole('region', { name: 'Read aloud' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Pause' })).toBeVisible();
  // The fake gives each word 300 ms, so the first word is marked soon after the sound starts.
  await expect
    .poll(() => page.evaluate(() => [...(CSS.highlights.get('read-aloud') ?? [])].map((range) => range.toString())))
    .toContain('Cells');
  await page.keyboard.press('Control+Shift+KeyU');
  await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('names the voice list from Windows when read aloud is on', async ({ page }) => {
  await startWith(page, ['readAloud']);
  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type(TEXT);
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+KeyU');
  const bar = page.getByRole('region', { name: 'Read aloud' });
  await expect(bar.getByRole('combobox', { name: 'Voice' })).toContainText('Fake voice');
});
