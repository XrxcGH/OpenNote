// Practice exams (ADR 0052): make a paper from the open page, take it in the Practice exams window, see it marked,
// and send the missed questions to flashcards.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

const LINES = [
  'Mitochondria: the organelle that releases energy from glucose in respiration.',
  'Ribosome: the small structure where proteins are made from amino acids.',
  'Nucleus: the part of the cell that holds the genetic material and controls it.',
];

test('makes a practice exam from a page, takes it, and marks it', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  for (const line of LINES) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await runCommand(page, 'Make a practice exam from this page');
  const dialog = page.getByRole('dialog', { name: 'Practice exams' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Number of questions').fill('3');
  for (const kind of ['Short answer', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
    await dialog.getByLabel(kind).uncheck();
  await dialog.getByRole('button', { name: 'Make exam' }).click();
  await expect(dialog.getByText('3 questions, 3 marks in all.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Start exam' }).click();

  for (let step = 1; step <= 3; step += 1) {
    await expect(dialog.getByRole('heading', { name: `Question ${step} of 3` })).toBeVisible();
    await dialog.getByLabel('True', { exact: true }).check();
    if (step < 3) await dialog.getByRole('button', { name: 'Next question' }).click();
  }
  await expect(dialog.getByRole('button', { name: 'Question 3, answered' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Submit exam' }).click();

  await expect(dialog.getByRole('heading', { name: /^Score: [0-3] of 3 marks \(\d+ percent\)$/ })).toBeVisible();
  await expect(dialog.getByText('Marked by OpenNote.')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Add missed questions to flashcards' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: /card|missed questions/ })).toBeVisible();
});

test('shows how to start when opened from the palette with no notes chosen', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open practice exams');
  const dialog = page.getByRole('dialog', { name: 'Practice exams' });
  await expect(dialog.getByRole('button', { name: 'Make a practice exam from this section' })).toBeVisible();
});
