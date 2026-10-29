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

test('a paper handed in late says so, and a mark can be changed, in dark mode at phone width', async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 400, height: 860 });
  await openSmart(page);
  await newLine(page);
  for (const line of LINES) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await runCommand(page, 'Make a practice exam from this page');
  const dialog = page.getByRole('dialog', { name: 'Practice exams' });
  await dialog.getByLabel('Number of questions').fill('1');
  for (const kind of ['Short answer', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
    await dialog.getByLabel(kind).uncheck();
  await dialog.getByLabel('Time the exam').check();
  await dialog.getByLabel('Minutes allowed').fill('1');
  await dialog.getByRole('button', { name: 'Make exam' }).click();
  await dialog.getByRole('button', { name: 'Start exam' }).click();
  await dialog.getByLabel('True', { exact: true }).check();

  // Past the minute the paper stays open: the window says time is up and the answer can still change.
  await page.clock.fastForward('01:40');
  await expect(dialog.getByRole('status').filter({ hasText: 'Time is up.' })).toBeVisible();
  await dialog.getByLabel('False', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Submit exam' }).click();
  await expect(dialog.getByText(/^Submitted 0:(39|4\d) after the time ran out\.$/)).toBeVisible();

  const score = dialog.getByRole('heading', { name: /^Score: [01] of 1 marks/ });
  const before = await score.textContent();
  await dialog.getByRole('button', { name: 'Change this mark' }).click();
  const other = before?.startsWith('Score: 1') ? '0 of 1' : '1 of 1';
  await dialog.getByLabel(other, { exact: true }).check();
  await expect(dialog.getByText(/^OpenNote gave [01] of 1\. You changed it\.$/)).toBeVisible();
  await expect(score).toHaveText(other === '1 of 1' ? /^Score: 1 of 1/ : /^Score: 0 of 1/);
  // Nothing scrolls sideways at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  await page.screenshot({ path: test.info().outputPath('exam-results-dark-narrow.png') });
});

test('a submitted exam saved as pages can be retaken from its results page, with the keyboard', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  for (const line of LINES) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await runCommand(page, 'Make a practice exam from this page');
  const dialog = page.getByRole('dialog', { name: 'Practice exams' });
  await dialog.getByLabel('Number of questions').fill('2');
  for (const kind of ['Short answer', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
    await dialog.getByLabel(kind).uncheck();
  await dialog.getByRole('button', { name: 'Make exam' }).click();
  await dialog.getByRole('button', { name: 'Start exam' }).click();
  await dialog.getByLabel('True', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Next question' }).click();
  await dialog.getByLabel('False', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Submit exam' }).click();
  await dialog.getByRole('button', { name: 'Save results as a page' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved the results' })).toBeVisible();

  // The results page holds the exam: the palette offers a retake there, which opens the same paper with no answers.
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Practice exams' }).click();
  await page
    .getByRole('tree', { name: 'Pages' })
    .getByRole('treeitem', { name: 'Practice exam: Smart notes: results' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Practice exam: Smart notes: results' })).toBeVisible();
  await runCommand(page, 'Retake this practice exam');
  await expect(dialog.getByText('2 questions, 2 marks in all.')).toBeVisible();
  const start = dialog.getByRole('button', { name: 'Start exam' });
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { name: 'Question 1 of 2' })).toBeVisible();
  await expect(dialog.getByLabel('True', { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel('False', { exact: true })).not.toBeChecked();
});

test('a handwritten answer is kept as a picture on the saved results page, in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSmart(page);
  await newLine(page);
  for (const line of LINES) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await runCommand(page, 'Make a practice exam from this page');
  const dialog = page.getByRole('dialog', { name: 'Practice exams' });
  await dialog.getByLabel('Number of questions').fill('1');
  for (const kind of ['True or false', 'Multiple choice', 'Fill in the blanks', 'Worked problem'])
    await dialog.getByLabel(kind).uncheck();
  await dialog.getByRole('button', { name: 'Make exam' }).click();
  await dialog.getByRole('button', { name: 'Start exam' }).click();
  await dialog.getByRole('button', { name: 'Write the answer by hand' }).click();
  const area = dialog.getByRole('img', { name: /^Writing area for Question 1, empty$/ });
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(dialog.getByRole('img', { name: /^Writing area for Question 1, 1 stroke$/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Submit exam' }).click();
  await dialog.getByRole('button', { name: 'Save results as a page' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Saved the results' })).toBeVisible();

  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Practice exams' }).click();
  await page
    .getByRole('tree', { name: 'Pages' })
    .getByRole('treeitem', { name: 'Practice exam: Smart notes: results' })
    .click();
  await expect(page.getByRole('heading', { name: 'Handwritten answers' })).toBeVisible();
  const picture = page.getByRole('img', { name: 'Your handwritten answer to question 1.' });
  await expect(picture).toBeVisible();
  expect(await picture.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(640);
  await page.screenshot({ path: test.info().outputPath('exam-ink-results-dark.png') });
});
