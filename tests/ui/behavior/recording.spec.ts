// Audio recording on the web platform, where a fake recorder stands in for the microphone (Phase 9): the record
// control and the indicator, the recording block that takes the page's place for the audio, playback with its
// controls, a flag, and trimming. The fake keeps the shape of the real recorder: an entry with a clock anchor and
// pauses, which the player turns into a position map.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openPage(page: Page) {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
}

const record = (page: Page) => page.getByRole('group', { name: 'Recording', exact: true });

test('records into a block of the page, shows the indicator, and plays it back', async ({ page }) => {
  await openPage(page);
  await record(page).getByRole('button', { name: 'Record' }).click();
  // The indicator is in the title bar while the recording runs, and the block shows the recording bar.
  const indicator = page.getByTestId('recording-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAccessibleName(/^Recording \d+:\d\d\. Open the recording controls\.$/);
  await expect(page.getByTestId('recording-bar')).toBeVisible();
  // Writing while it runs doesn't stop it.
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.type('Osmosis');
  await page.waitForTimeout(1600);
  await record(page).getByRole('button', { name: 'Pause' }).click();
  await expect(indicator).toContainText('Paused');
  await record(page).getByRole('button', { name: 'Resume' }).click();
  await expect(indicator).toContainText('Recording');
  await record(page).getByRole('button', { name: 'Stop' }).click();
  await expect(indicator).toBeHidden();
  // The block is now a player with the length of what was recorded.
  const block = page.getByRole('group', { name: /^Recording, \d+:\d\d$/ });
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(block.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await block.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(block.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // Speed changes, and a flag lands in the list.
  await block.getByRole('combobox', { name: 'Speed' }).selectOption('2');
  await block.getByRole('button', { name: 'Flag this moment' }).click();
  await expect(block.getByRole('list', { name: 'Flags' }).getByRole('listitem')).toHaveCount(1);
});

test('keys start, flag, and stop a recording while typing', async ({ page }) => {
  await openPage(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.press('Alt+Shift+A');
  await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await page.keyboard.press('Alt+Shift+M');
  await page.keyboard.press('Alt+Shift+S');
  await expect(page.getByTestId('recording-indicator')).toBeHidden();
  const block = page.getByRole('group', { name: /^Recording, \d+:\d\d$/ });
  await expect(block.getByRole('list', { name: 'Flags' }).getByRole('listitem')).toHaveCount(1);
});

test('the options choose a microphone', async ({ page }) => {
  await openPage(page);
  await record(page).getByRole('button', { name: 'Options' }).click();
  const microphone = page.getByRole('combobox', { name: 'Microphone' });
  await expect(microphone.getByRole('option', { name: 'Headset microphone' })).toHaveCount(1);
  await microphone.selectOption({ label: 'Headset microphone' });
  await page.keyboard.press('Escape');
  await record(page).getByRole('button', { name: 'Record' }).click();
  await page.getByTestId('recording-indicator').click();
  await expect(page.locator('p', { hasText: 'Headset microphone' })).toBeVisible();
});

test('text typed while recording is stamped, and Alt+click on it plays the recording from then', async ({ page }) => {
  await openPage(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.press('Alt+Shift+A');
  await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await page.keyboard.type('Osmosis moves water');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Alt+Shift+S');
  await expect(page.getByTestId('recording-indicator')).toBeHidden();
  // The text block holds its marks beside the Markdown.
  const held = () =>
    page.evaluate(() => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
      return JSON.stringify(hooks.pagesHeld());
    });
  await expect.poll(held).toContain('"marks":{"recordings"');
  await page.getByText('Osmosis moves water').click({ modifiers: ['Alt'] });
  const block = page.getByRole('group', { name: /^Recording, \d+:\d\d$/ });
  await expect(block.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('trims the silence at the start, and removes a marked part', async ({ page }) => {
  await openPage(page);
  await record(page).getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('recording-indicator')).toBeVisible();
  await page.waitForTimeout(4500);
  await record(page).getByRole('button', { name: 'Stop' }).click();
  const long = page.getByRole('group', { name: /^Recording, 0:0[45]$/ });
  await expect(long).toBeVisible();
  await long.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Trim silence at the start and end' }).click();
  // The fake finds a second of silence at the start.
  const trimmed = page.getByRole('group', { name: /^Recording, 0:0[34]$/ });
  await expect(trimmed).toBeVisible();
  // Mark where a part starts, move on, and remove up to there after confirming.
  await trimmed.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Start a part to remove here/ }).click();
  await trimmed.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await trimmed.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Part ends at/ }).click();
  await page.getByRole('button', { name: 'Remove part' }).click();
  await expect(page.getByRole('group', { name: /^Recording, 0:0[0-2]$/ })).toBeVisible();
});
