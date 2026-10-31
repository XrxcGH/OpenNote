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

test('the palette opens Change passphrase, which needs the recovery key', async ({ page }) => {
  await page.goto('/?sync=on');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).pressSequentially('change sync pass', {
    delay: 10,
  });
  await page.getByRole('option', { name: /Change sync passphrase/ }).click();
  await expect(page.getByRole('heading', { name: 'Change passphrase', level: 2 })).toBeFocused();

  await page.getByLabel('Recovery key').fill('ABCD-EFGH');
  await page.getByLabel('New passphrase').fill('a brand new passphrase');
  await page.getByLabel('Type the passphrase again').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Change passphrase' }).click();
  await expect(page.getByRole('alert')).toContainText('unlock');

  await page.getByLabel('Recovery key').fill('test-only-fake-0000-1111-2222-3333-4444-5555-6666-7777-8888-9999');
  await page.getByRole('button', { name: 'Change passphrase' }).click();
  await expect(page.getByRole('heading', { name: 'Change passphrase', level: 2 })).toHaveCount(0);
  await expect(page.getByLabel('Recovery key')).toHaveCount(0);
});

/** Elements that reach past the right edge of a phone-width window, and the page if it scrolls sideways. */
async function spills(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) out.push(`page: ${document.documentElement.scrollWidth}px`);
    // Every element, the dialogs too; one clipped by an ancestor still counts, as its text is cut off.
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > width + 1) out.push(`${el.tagName.toLowerCase()}: ${Math.round(box.right)}px`);
    }
    return out;
  });
}

test('at phone width, setup, the device list, and a pairing code fit without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openSync(page, '');
  await page.getByRole('button', { name: 'Set up sync' }).click();
  await page.getByLabel('Folder', { exact: true }).fill('C:\\Users\\Sam\\OneDrive\\A folder with a long name\\Sync');
  expect(await spills(page)).toEqual([]);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
  await page.getByLabel('Type the passphrase again').fill('correct horse battery');
  expect(await spills(page)).toEqual([]);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery key' })).toBeFocused();
  expect(await spills(page)).toEqual([]);

  await openSync(page, '?sync=on');
  await expect(page.getByText('Surface Laptop (this device)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Desktop' })).toBeVisible();
  expect(await spills(page)).toEqual([]);
  await page.getByRole('button', { name: 'Add a device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a device' });
  await expect(dialog.getByRole('img', { name: 'QR code of the pairing code' })).toBeVisible();
  expect(await spills(page)).toEqual([]);
});
