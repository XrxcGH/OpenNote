// Settings, Sync in the production build, over the web platform's in-memory host: set up with a passphrase, save
// and confirm the recovery key, sync, add a device, and pause. Nothing leaves the browser.

import { expect, test } from '../fixtures';

async function openSync(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Sync' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sync' })).toBeFocused();
}

test('sync is off until set up, and setup shows the recovery key once and checks it', async ({ page }) => {
  await openSync(page, '');
  await expect(page.getByText('Sync is off. Nothing leaves this device until you set it up.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is encrypted' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up sync' }).click();
  await expect(page.getByRole('heading', { name: 'Where should sync keep its data?', level: 3 })).toBeFocused();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert')).toHaveText('Fill in where sync keeps its data.');
  await page.getByLabel('Folder', { exact: true }).fill('C:\\Users\\Sam\\OneDrive\\OpenNote Sync');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
  await page.getByLabel('Type the passphrase again').fill('correct horse batterz');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('alert')).toHaveText('The two passphrases differ. Type them again.');
  await page.getByLabel('Type the passphrase again').fill('correct horse battery');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeFocused();
  const key = (await page.getByTestId('sync-recovery-key').textContent()) ?? '';
  expect(key.split('-')).toHaveLength(13);
  await page.getByRole('button', { name: 'Next' }).click();
  const help = (await page.getByText(/^Type group \d+ and group \d+/).textContent()) ?? '';
  const [first, second] = (help.match(/\d+/g) ?? []).map(Number);
  const groups = key.split('-');
  await page.getByLabel(`Group ${first}`, { exact: true }).fill('WRNG');
  await page.getByLabel(`Group ${second}`, { exact: true }).fill(groups[second - 1]);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('alert')).toContainText('match');
  await page.getByLabel(`Group ${first}`, { exact: true }).fill(groups[first - 1].toLowerCase());
  await page.getByRole('button', { name: 'Finish' }).click();

  await expect(page.getByRole('heading', { name: 'Synced' })).toBeVisible();
  await expect(page.getByTestId('sync-recovery-key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();
});

test('a set-up sync previews, syncs, adds a device, and pauses', async ({ page }) => {
  await openSync(page, '?sync=on');
  await expect(page.getByRole('heading', { name: 'Synced' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await expect(page.getByRole('region', { name: 'What the next sync does' })).toContainText('Brings in 1 file');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('region', { name: 'What the next sync does' })).toHaveCount(0);

  await expect(page.getByText('Surface Laptop (this device)')).toBeVisible();
  await page.getByRole('button', { name: 'Add a device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a device' });
  await expect(dialog.getByRole('img', { name: 'QR code of the pairing code' })).toBeVisible();
  await expect(dialog.getByTestId('sync-pairing-code')).not.toBeEmpty();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('switch', { name: 'Sync this device' }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  await page.getByRole('switch', { name: 'Sync this device' }).click();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
});
