// The Math solvers window (beta 5) in the production interface: a palette command opens it on its solver, a solver
// works its problem with steps as the person types, and the window passes the accessibility checks.

import type { Page } from '@playwright/test';
import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';

async function run(page: Page, command: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).pressSequentially(command, { delay: 10 });
  await page
    .getByRole('option', { name: new RegExp(command, 'i') })
    .first()
    .click();
}

test('a palette command opens the solver it names', async ({ page }) => {
  await run(page, 'Solve a double or triple integral');
  const window = page.getByRole('dialog', { name: 'Math solvers' });
  // The window loads on first use, which a development server takes a moment over.
  await expect(window.getByRole('tab', { name: 'Integrals' })).toHaveAttribute('aria-selected', 'true', {
    timeout: 20_000,
  });
  await expect(window.getByText('Value: 4π/3')).toBeVisible();
  await window.getByRole('textbox', { name: 'Radius R' }).fill('3');
  await expect(window.getByText('Value: 36π')).toBeVisible();
  await expect(window.getByRole('region', { name: 'Worked steps' })).toContainText('Change to spherical coordinates.');
  await expectNoAxeViolations(page, { include: '[data-tool="solvers"]' });
});

test("Newton's method shows its table and stops when the guesses run away", async ({ page }) => {
  await run(page, "Find a root with Newton's method");
  const window = page.getByRole('dialog', { name: 'Math solvers' });
  await expect(window.getByRole('tab', { name: 'Roots' })).toHaveAttribute('aria-selected', 'true', {
    timeout: 20_000,
  });
  await window.getByRole('textbox', { name: 'f(x)' }).fill('cbrt(x)');
  await window.getByRole('textbox', { name: 'Starting guess x₀' }).fill('1');
  await expect(window.getByText('Diverged: no root found.')).toBeVisible();
  await expect(window.getByRole('table', { name: 'Iterations' })).toBeVisible();
});
