// Password-protected sections (A1-39, A2-16, A4-47; ADR 0042) in the production interface, with the web build's
// fake of the shell's protect calls: protect a section, see it locked, unlock it with the right password only,
// and see it lock again when the person leaves it or chooses Lock section.

import { expect, test } from '../fixtures';

test('protects a section, unlocks it with its password, and locks it again', async ({ page }) => {
  await page.goto('/');
  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  const pages = page.getByRole('tree', { name: 'Pages' });
  const lectures = notebooks.getByRole('treeitem', { name: /Lectures/ });
  await lectures.click();
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();

  await lectures.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Protect with password…' }).click();
  const protect = page.getByRole('dialog', { name: 'Protect “Lectures” with a password?' });
  await protect.getByLabel('Password', { exact: true }).fill('short');
  await protect.getByLabel('Type the password again').fill('short');
  await protect.getByRole('button', { name: 'Protect' }).click();
  await expect(protect.getByText('Use at least 8 characters.')).toBeVisible();
  await protect.getByLabel('Password', { exact: true }).fill('river stone 42');
  await protect.getByLabel('Type the password again').fill('river stone 42');
  await protect.getByRole('button', { name: 'Protect' }).click();
  await expect(protect).toBeHidden();

  await expect(page.getByText('This section is locked.')).toBeVisible();
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Unlock section…' }).click();
  const unlock = page.getByRole('dialog', { name: 'Unlock “Lectures”' });
  await unlock.getByLabel('Password', { exact: true }).fill('wrong guess');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(unlock.getByText("The password isn't right.")).toBeVisible();
  await unlock.getByLabel('Password', { exact: true }).fill('river stone 42');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(unlock).toBeHidden();
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();

  // Leaving the section locks it (the default), so coming back shows the locked pane.
  await notebooks.getByRole('treeitem', { name: /Labs/ }).click();
  await expect(pages.getByRole('treeitem', { name: 'Photosynthesis lab' })).toBeVisible();
  await lectures.click();
  await expect(page.getByText('This section is locked.')).toBeVisible();

  // Lock section from the menu does the same without leaving.
  await page.getByRole('button', { name: 'Unlock section…' }).click();
  await unlock.getByLabel('Password', { exact: true }).fill('river stone 42');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(pages.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();
  await lectures.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Lock section' }).click();
  await expect(page.getByText('This section is locked.')).toBeVisible();
});
