// Export as LaTeX in the production build, on the web platform's fake host (ADR 0054): the format card, the options,
// the live preview of the .tex text, keyboard use, a narrow window, and the request the export sends.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { expectNoAxeViolations } from '../axe';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function openLatexFor(page: Page, row: string, title: RegExp) {
  await page.goto('/');
  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  await notebooks.getByRole('treeitem', { name: row }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /^LaTeX/ }).click();
  return dialog;
}

test('exports a section as LaTeX with the chosen options and a live preview', async ({ page }) => {
  const dialog = await openLatexFor(page, 'Lectures', /^Export "Lectures"/);
  const preview = dialog.getByRole('region', { name: 'Preview of the .tex file' });
  await expect(preview).toContainText('\\documentclass[11pt,letterpaper]{article}');
  await expect(preview).toContainText('\\section{Lectures}');

  await dialog.getByRole('radio', { name: 'A4' }).click();
  await expect(preview).toContainText('\\documentclass[11pt,a4paper]{article}');
  await dialog.getByRole('radio', { name: 'Latin letters only (pdfLaTeX)' }).click();
  await expect(preview).toContainText('% Characters: pdfLaTeX only');
  await dialog.getByRole('textbox', { name: 'Author' }).fill('Ada Lovelace');
  await dialog.getByRole('switch', { name: 'Add a table of contents' }).click();
  await expect(preview).toContainText('\\author{Ada Lovelace}');
  await expect(preview).toContainText('\\tableofcontents');
  await dialog.getByRole('switch', { name: 'Add a title, author, and date' }).click();
  await expect(preview).not.toContainText('\\maketitle');
  await expect(dialog.getByRole('textbox', { name: 'Author' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Choose a folder…' }).click();
  await expect(dialog.getByText('C:\\Users\\Sample\\Documents')).toBeVisible();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Export finished' })).toBeVisible();

  const log = await page.evaluate(
    () => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopLog() as { exports: unknown[] },
  );
  expect(log.exports).toHaveLength(1);
  expect(log.exports[0]).toMatchObject({
    format: 'latex',
    scope: 'section',
    folder: 'C:\\Users\\Sample\\Documents',
    latex: { engine: 'pdflatex', paper: 'a4', toc: true, titleBlock: false, author: 'Ada Lovelace' },
  });
});

test('the LaTeX options work by keyboard, and the preview can be scrolled by keyboard', async ({ page }) => {
  const dialog = await openLatexFor(page, 'Lectures', /^Export "Lectures"/);
  const paper = dialog.getByRole('radio', { name: 'Letter', exact: true });
  await paper.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'A4' })).toBeChecked();
  const preview = dialog.getByRole('region', { name: 'Preview of the .tex file' });
  await expect(preview).toContainText('a4paper');
  await preview.focus();
  await expect(preview).toBeFocused();
});

test('the LaTeX options fit a narrow window and pass the accessibility check', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const dialog = await openLatexFor(page, 'Lectures', /^Export "Lectures"/);
  await expect(dialog.getByRole('region', { name: 'Preview of the .tex file' })).toBeVisible();
  const scrollsSideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(scrollsSideways).toBe(false);
  await expectNoAxeViolations(page);
});

test('Export as LaTeX is in the command palette', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially('latex', { delay: 20 });
  await expect(page.getByRole('option', { name: /Export as LaTeX/ })).toBeVisible();
});
