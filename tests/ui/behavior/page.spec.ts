// The page view in the production build: a prompt with no page open, then the page's title as a heading and a text
// box that typing reaches through the web platform's page service.

import { expect, test } from '../fixtures';

test('shows a prompt, then the open page with a text box to type into', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'No page open' })).toBeVisible();
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type('Osmosis moves water');
  await expect(box).toHaveText('Osmosis moves water');
  // Typing reaches the service in batches (the first words, then splices), so the test reads the page it holds.
  const held = () =>
    page.evaluate(() => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
      return JSON.stringify(hooks.pagesHeld());
    });
  await expect.poll(held).toContain('"markdown":"Osmosis moves water"');
});

test('shows every page as the sampler with ?fixture=sampler', async ({ page }) => {
  await page.goto('/?fixture=sampler');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Every kind of text')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Table' })).toBeVisible();
});
